// Тикает раз в минуту из pg_cron. Авторизация — x-cron-secret из Vault.
import {
  claimEvent,
  eveningHeader,
  lightsOutMessage,
  morningMessages,
  type Outgoing,
  releaseEvent,
  say,
  weeklyMessage,
} from "../_shared/coach.ts";
import { sendBackup } from "../_shared/backup.ts";
import { safeEqual } from "../_shared/initdata.ts";
import { monthTakeaway, weeklyTakeaway } from "../_shared/chat.ts";
import { MAX_LATE_MIN } from "../_shared/config.ts";
import { check, db, type Reminder, type User } from "../_shared/db.ts";
import { hasGithub, morningCareer, syncGithub } from "../_shared/career.ts";
import { foodEvening } from "../_shared/food.ts";
import { eveningHabits } from "../_shared/habits.ts";
import { refreshRates } from "../_shared/finance.ts";
import { selfCheck } from "../_shared/health.ts";
import { eveningPromises } from "../_shared/promises.ts";
import { monthReview, prevMonth, seasonReview } from "../_shared/review.ts";
import { CHECKIN_DATE, cardsCheckin, sessionTime, startCards } from "../_shared/cards.ts";
import { classesOn, eveningStudy, finishDueFocus, morningStudy } from "../_shared/study.ts";
import { sendSupplementReminder, type Slot } from "../_shared/supplements.ts";
import { dropKeyboard } from "../_shared/telegram.ts";
import { isQuiet, localMin, localNow, toMin } from "../_shared/time.ts";

let cronSecret: string | null = null;

async function authorized(req: Request): Promise<boolean> {
  if (!cronSecret) {
    const { data, error } = await db.rpc("get_cron_secret");
    if (error || !data) throw new Error(`cron secret: ${error?.message}`);
    cronSecret = data as string;
  }
  return safeEqual(req.headers.get("x-cron-secret") ?? "", cronSecret);
}

Deno.serve(async (req) => {
  if (!(await authorized(req))) return new Response("forbidden", { status: 403 });

  // Курсы валют: раз в 30 минут проверяем, есть ли сегодняшние (загрузка — раз в сутки).
  if (new Date().getUTCMinutes() % 30 === 0) await refreshRates().catch((e) => console.warn("fx", e));

  // Пульс: по нему внешняя проверка видит, что pg_cron и функции живы.
  await db.rpc("beat").then(({ error }) => error && console.warn("beat", error.message));

  const users = check(
    await db.from("users").select("*").eq("is_allowed", true).is("blocked_at", null),
  ) as User[];
  const results = await Promise.allSettled(users.map((u) =>
    tickUser(u).catch(async (e) => {
      if (e?.name !== "BotBlocked") throw e;
      // Иначе каждую минуту повторяем то же событие и снова падаем. Снимет пометку сам человек, написав боту.
      await db.from("users").update({ blocked_at: new Date().toISOString() }).eq("id", u.id);
    })
  ));
  results.forEach((r) => r.status === "rejected" && console.error(r.reason));
  return Response.json({ users: users.length });
});

/** Плановое событие наступило (и не слишком давно — если cron лежал, старое не шлём). */
function due(now: number, at: string) {
  const late = now - toMin(at);
  return late >= 0 && late <= MAX_LATE_MIN;
}

type DailyEvent = {
  kind: string;
  at: string;
  when?: (dow: number, date: string) => boolean;
  run: (user: User) => Promise<void>;
};

const sayAll = async (user: User, msgs: (Outgoing | null)[]) => {
  for (const m of msgs) if (m) await say(user, m);
};

function dailyEvents(user: User, cardsAt: string): DailyEvent[] {
  const { schedule } = user.settings;
  return [
    // Карточки приходят сами: за 30 минут до первой пары, без пар в 08:00; не пройдены к 20:00 — ещё раз.
    { kind: "cards", at: cardsAt, run: (u) => startCards(u, "auto") },
    { kind: "cards_evening", at: "20:00", run: (u) => startCards(u, "evening") },
    {
      kind: "cards_checkin",
      at: "20:30",
      when: (_dow, date) => date === CHECKIN_DATE && user.is_owner,
      run: cardsCheckin,
    },
    {
      kind: "morning",
      at: schedule.morning,
      run: async (u) => sayAll(u, [...await morningMessages(u), await morningStudy(u), await morningCareer(u)]),
    },
    {
      kind: "evening",
      at: schedule.evening,
      run: async (u) => {
        const header = await eveningHeader(u);
        // Магний — внутри вечернего чек-ина, с кнопками (если ещё не отмечен).
        const sent = await sendSupplementReminder(u, "evening", "scheduled", `${header}\n\n💊 Перед сном:`);
        if (!sent) await say(u, { text: header });
        const study = await eveningStudy(u);
        if (study) await say(u, study);
        const habits = await eveningHabits(u);
        if (habits) await say(u, habits);
        // Обещания со сроком сегодня: сами подводим итог или спрашиваем друга.
        await eveningPromises(u);
      },
    },
    {
      // Итог еды за день: уходит, только если что-то записано.
      kind: "food_eve",
      at: "21:30",
      run: async (u) => sayAll(u, [await foodEvening(u)]),
    },
    {
      kind: "lights_out",
      at: schedule.lights_out,
      // Частота «тихо» — только утро, вечер и неделя.
      when: () => user.settings.coach.frequency !== "quiet",
      run: async (u) => sayAll(u, [await lightsOutMessage(u)]),
    },
    {
      // Копия данных файлом: на бесплатном тарифе Supabase других копий нет.
      kind: "backup",
      at: schedule.weekly,
      when: (dow) => dow === schedule.weekly_dow,
      run: (u) => sendBackup(u, "json"),
    },
    {
      // Проверка себя: сообщение уходит, только если что-то сломалось.
      kind: "selfcheck",
      at: schedule.evening,
      run: async (u) => sayAll(u, [await selfCheck(u)]),
    },
    {
      // Ретроспектива: первого числа подводим итог прошлому месяцу, а раз в три
      // месяца следом уходит ещё и сезон.
      kind: "monthly",
      at: schedule.weekly,
      when: (_dow, date) => date.endsWith("-01"),
      run: async (u) => {
        const month = prevMonth(localNow(u.tz).date.slice(0, 7));
        const text = await monthReview(u, month);
        const takeaway = await monthTakeaway(u, text);
        await say(u, { text: takeaway ? `${text}\n\n${takeaway}` : text });
        const season = await seasonReview(u, month);
        if (season) await say(u, { text: season });
      },
    },
    {
      kind: "weekly",
      at: schedule.weekly,
      when: (dow) => dow === schedule.weekly_dow,
      run: async (u) => {
        const msg = await weeklyMessage(u);
        const takeaway = await weeklyTakeaway(user, msg.text);
        await say(u, takeaway ? { ...msg, text: `${msg.text}\n\n${takeaway}` } : msg);
      },
    },
  ];
}

async function tickUser(user: User) {
  const now = localNow(user.tz);

  // GitHub: раз в час, чтобы /work и недельный разбор видели сегодняшние коммиты.
  // Ночью тоже: коммит в час ночи — тоже коммит.
  if (hasGithub(user) && new Date().getUTCMinutes() === 7) {
    await syncGithub(user).catch((e) => console.warn("github", e));
  }

  const { schedule, sleep } = user.settings;
  const quiet = isQuiet(now.minutes, sleep.bed, sleep.wake);

  if (!quiet) {
    // 1. Сообщения по расписанию: каждое не больше раза в день.
    const first = (await classesOn(user, now.date))[0];
    const cardsAt = sessionTime(first ? localMin(first.starts_at, user.tz) : null);
    for (const ev of dailyEvents(user, cardsAt)) {
      if (!due(now.minutes, ev.at) || (ev.when && !ev.when(now.dow, now.date))) continue;
      if (!(await claimEvent(user, ev.kind, now.date))) continue;
      try {
        await ev.run(user);
      } catch (e) {
        await releaseEvent(user, ev.kind, now.date); // повторим на следующем тике
        throw e;
      }
    }

    // 2. Добавки утром и запасное напоминание к обеду (основной триггер — трата на обед).
    const slotTimes: [Slot, string][] = [
      ["morning", schedule.morning],
      ["lunch", schedule.lunch_fallback],
    ];
    for (const [slot, at] of slotTimes) {
      if (due(now.minutes, at)) {
        await sendSupplementReminder(user, slot, slot === "lunch" ? "fallback" : "scheduled");
      }
    }
  }

  // 3. Фокус-сессии, у которых вышло время (и ночью тоже — сессию запустили сами).
  await finishDueFocus(user);

  // 4. Повторы и «через 15 мин».
  const pending = check(
    await db.from("reminders").select("*").eq("user_id", user.id).eq("status", "pending")
      .lte("next_at", new Date().toISOString()),
  ) as Reminder[];
  for (const rem of pending) {
    if (quiet || rem.local_date !== now.date) {
      // Ночью молчим; вчерашние напоминания не тащим в новый день.
      await db.from("reminders").update({ status: "expired", next_at: null }).eq("id", rem.id);
      if (rem.tg_message_id) await dropKeyboard(user.tg_id, rem.tg_message_id);
      continue;
    }
    if (user.settings.coach.frequency === "quiet") {
      // «Тихо»: без повторов; «через 15 мин» всё же присылаем — о нём попросили явно.
      if (rem.attempts > 0) {
        await db.from("reminders").update({ next_at: null }).eq("id", rem.id);
        continue;
      }
    }
    if (rem.kind.startsWith("supp_")) {
      await sendSupplementReminder(user, rem.kind.replace("supp_", "") as Slot, "repeat");
    }
  }
}
