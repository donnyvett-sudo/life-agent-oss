// Инициативные сообщения коуча: утро, вечер, отбой, неделя; разбор ночи, штрафы и награды.
// Всё детерминированно — Gemini здесь не участвует.
import { check, db, type User } from "./db.ts";
import { MINIAPP_URL } from "./config.ts";
import { totalsCny, userMoney } from "./finance.ts";
import { weekBodySummary } from "./body.ts";
import { weekCareerSummary } from "./career.ts";
import { weekHabitsSummary } from "./habits.ts";
import { weekStudySummary } from "./study.ts";
import { esc, type Keyboard, send } from "./telegram.ts";
import { t } from "./i18n.ts";
import {
  clockDiff,
  dayBounds,
  fmtDuration,
  fmtTime,
  localMin,
  localNow,
  shiftDate,
  toMin,
} from "./time.ts";

export type SleepRow = {
  id: string;
  night_date: string;
  bed_at: string;
  wake_at: string;
  asleep_min: number;
  deep_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
};

export type Outgoing = { text: string; keyboard?: Keyboard };

// ---------------------------------------------------------------- утилиты ---

/** Застолбить событие дня (идемпотентно). true — мы первые, можно отправлять. */
export async function claimEvent(user: User, kind: string, date: string): Promise<boolean> {
  const res = await db.from("reminders").upsert(
    { user_id: user.id, kind, local_date: date, status: "done" },
    { onConflict: "user_id,kind,local_date", ignoreDuplicates: true },
  ).select("id");
  return (check(res) ?? []).length > 0;
}

export async function releaseEvent(user: User, kind: string, date: string) {
  await db.from("reminders").delete().eq("user_id", user.id).eq("kind", kind)
    .eq("local_date", date);
}

/** Отправить и записать в историю чата (контекст для коуча). */
export async function say(user: User, msg: Outgoing) {
  await send(user.tg_id, msg.text, msg.keyboard);
  await db.from("messages").insert({
    user_id: user.id,
    role: "coach",
    text: msg.text.replace(/<[^>]+>/g, ""),
  });
}

async function setState(user: User, patch: Record<string, unknown>) {
  user.state = { ...user.state, ...patch };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
}


// -------------------------------------------------------------------- сон ---

export async function getSleep(userId: string, nightDate: string): Promise<SleepRow | null> {
  return check(
    await db.from("sleep_sessions").select("*").eq("user_id", userId)
      .eq("night_date", nightDate).maybeSingle(),
  ) as SleepRow | null;
}

export function sleepLine(user: User, s: SleepRow): string {
  const stages = [
    s.deep_min ? t(user, "глубокий {d}", { d: fmtDuration(user, s.deep_min) }) : null,
    s.rem_min ? `REM ${fmtDuration(user, s.rem_min)}` : null,
  ].filter(Boolean).join(", ");
  return t(user, "Сон: {bed} → {wake}, <b>{total}</b>{stages}.", {
    bed: fmtTime(new Date(s.bed_at), user.tz),
    wake: fmtTime(new Date(s.wake_at), user.tz),
    total: fmtDuration(user, s.asleep_min),
    stages: stages ? ` (${stages})` : "",
  });
}

export type Verdict = "good" | "meh" | "bad";

export function judgeNight(
  user: User,
  s: Pick<SleepRow, "bed_at" | "asleep_min">,
  targetBed: string,
  tz: string,
  graceMin = 0,
): { verdict: Verdict; notes: string[] } {
  const bedDiff = clockDiff(localMin(s.bed_at, tz), toMin(targetBed)) - graceMin;
  const notes: string[] = [];
  if (bedDiff > 15) {
    notes.push(
      t(user, "Засыпание в {time}, на {late} позже цели.", {
        time: fmtTime(new Date(s.bed_at), tz),
        late: fmtDuration(user, bedDiff),
      }),
    );
  }
  if (s.asleep_min < 360) {
    notes.push(t(user, "Сна {total}. Не планируй сложное после 16:00.", {
      total: fmtDuration(user, s.asleep_min),
    }));
  }
  const verdict: Verdict = bedDiff > 60 || s.asleep_min < 360
    ? "bad"
    : bedDiff <= 20 && s.asleep_min >= 390
    ? "good"
    : "meh";
  return { verdict, notes };
}

// Наказания и награды — сюрприз для владельца: не перечислять их заранее в сообщениях.
const PENALTIES: [string, string][] = [
  ["pushups", "40 отжиманий до 20:00"],
  ["squats", "60 приседаний до 20:00"],
  ["study45", "45 минут учёбы без телефона сегодня"],
  ["nophone", "час без телефона после 21:00"],
  ["noshorts", "сегодня без YouTube / Reels / Douyin"],
];
const REWARD: [string, string] = [
  "cheat_evening",
  "чит-вечер: один вечер без напоминания об отбое, отбой до 00:00 без штрафа",
];
const REWARD_EVERY = 7;

/** Названия штрафов и наград лежат в базе по-русски — переводим при показе. */
export const penaltyTitle = (user: User, title: string): string => t(user, title);

/** Один штраф из пула, но не тот же, что в прошлый раз. reason — «ночь 2026-09-19», «неделя …». */
async function issuePenalty(user: User, reason: string): Promise<{ id: string; title: string }> {
  const last = user.state.last_penalty as string | undefined;
  const pool = PENALTIES.filter(([code]) => code !== last);
  const [code, title] = pool[Math.floor(Math.random() * pool.length)];
  const row = check(
    await db.from("coach_ledger").insert({
      user_id: user.id,
      kind: "penalty",
      code,
      title,
      reason,
    }).select("id").single(),
  ) as { id: string };
  await setState(user, { last_penalty: code });
  return { id: row.id, title };
}

/** Разобрать ночь один раз: серия, штраф или награда. */
export async function evaluateNight(user: User, s: SleepRow): Promise<{
  lines: string[];
  extras: Outgoing[];
}> {
  if (user.state.last_eval_night === s.night_date) return { lines: [], extras: [] };

  const cheat = user.state.cheat_date === shiftDate(s.night_date, -1);
  const { verdict, notes } = judgeNight(user, s, user.settings.sleep.bed, user.tz, cheat ? 60 : 0);
  const streakBefore = Number(user.state.sleep_streak ?? 0);
  const streak = verdict === "good" ? streakBefore + 1 : 0;
  const lines = [...notes];
  const extras: Outgoing[] = [];

  if (verdict === "good") lines.push(t(user, "Режим соблюдён. Ночей подряд: {n}.", { n: streak }));
  if (verdict === "meh") lines.push(t(user, "Не провал, но и не режим. Серия обнулена."));

  if (verdict === "bad") {
    const { id, title } = await issuePenalty(user, `ночь ${s.night_date}`);
    extras.push({
      text: t(user, "⚖️ Штраф за эту ночь: <b>{title}</b>.", { title: esc(penaltyTitle(user, title)) }) +
        "\n" + t(user, "Пока не закроешь — коуч в урезанном режиме."),
      keyboard: [[{ text: "✅ " + t(user, "Готово"), callback_data: `p:${id}` }]],
    });
  }

  if (verdict === "good" && streak % REWARD_EVERY === 0) {
    const row = check(
      await db.from("coach_ledger").insert({
        user_id: user.id,
        kind: "reward",
        code: REWARD[0],
        title: REWARD[1],
        reason: `ночь ${s.night_date}: ${streak} ночей в режиме`,
      }).select("id").single(),
    ) as { id: string };
    extras.push({
      text: t(user, "🎁 {n} ночей в режиме подряд. Награда — <b>{title}</b>.", {
        n: streak,
        title: esc(t(user, REWARD[1])),
      }),
      keyboard: [[{ text: "🎁 " + t(user, "Использовать сегодня"), callback_data: `g:${row.id}` }]],
    });
  }

  // streak_before — чтобы можно было пересмотреть ночь, если данные сна придут заново.
  await setState(user, { last_eval_night: s.night_date, sleep_streak: streak, streak_before: streakBefore });
  return { lines, extras };
}

/**
 * Данные уже разобранной ночи пришли заново и изменились (например, первый раз команда
 * отрезала начало сна). Отменяем выданные за эту ночь штраф/награду и разбираем ночь снова.
 */
export async function reevaluateNight(user: User, s: SleepRow): Promise<{ lines: string[]; extras: Outgoing[] }> {
  if (user.state.last_eval_night !== s.night_date) return await evaluateNight(user, s);
  const { data: cancelled } = await db.from("coach_ledger").update(
    { status: "expired", resolved_at: new Date().toISOString() },
  ).eq("user_id", user.id).eq("status", "open").like("reason", `ночь ${s.night_date}%`).select("title");
  await setState(user, { last_eval_night: null, sleep_streak: Number(user.state.streak_before ?? 0) });
  const ev = await evaluateNight(user, s);
  const lines = [...ev.lines];
  if (cancelled?.length) {
    lines.unshift(t(user, "Прошлый разбор был по неполным данным. Снято: {list}.", {
      list: cancelled.map((c) => esc(penaltyTitle(user, c.title))).join(", "),
    }));
  }
  return { lines, extras: ev.extras };
}

export async function openDebts(userId: string): Promise<{ id: string; title: string }[]> {
  return check(
    await db.from("coach_ledger").select("id,title").eq("user_id", userId)
      .eq("kind", "penalty").eq("status", "open").order("created_at"),
  ) as { id: string; title: string }[];
}

const debtLines = (user: User, debts: { title: string }[]) =>
  debts.map((d) => t(user, "⚖️ Долг: {title}.", { title: esc(penaltyTitle(user, d.title)) }));

export async function resolveLedger(
  user: User,
  id: string,
  kind: "penalty" | "reward",
): Promise<string> {
  const status = kind === "penalty" ? "done" : "used";
  const { count } = await db.from("coach_ledger").update(
    { status, resolved_at: new Date().toISOString() },
    { count: "exact" },
  ).eq("id", id).eq("user_id", user.id).eq("kind", kind).eq("status", "open");
  if (!count) return t(user, "Уже закрыто");
  if (kind === "reward") await setState(user, { cheat_date: localNow(user.tz).date });
  return kind === "penalty" ? t(user, "Долг закрыт") : t(user, "Чит-вечер активирован");
}

// ---------------------------------------------------------------- траты ---

/** Топ категорий расходов за период (в юанях). */
export async function topCategories(userId: string, from: Date, to: Date, limit = 3) {
  const rows = check(
    await db.from("transactions").select("amount_cny,categories(title)").eq("user_id", userId)
      .eq("kind", "expense").gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString()),
  ) as unknown as { amount_cny: number | null; categories: { title: string } | null }[];
  const sums = new Map<string, number>();
  for (const r of rows) {
    const title = r.categories?.title ?? "Без категории";
    sums.set(title, (sums.get(title) ?? 0) + Number(r.amount_cny ?? 0));
  }
  return [...sums].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// ------------------------------------------------------------- сообщения ---

export async function morningMessages(user: User): Promise<Outgoing[]> {
  const today = localNow(user.tz).date;
  const s = await getSleep(user.id, today);
  const lines = ["☀️ " + t(user, "<b>Утро.</b>")];
  let extras: Outgoing[] = [];

  if (s) {
    lines.push(sleepLine(user, s));
    const ev = await evaluateNight(user, s);
    lines.push(...ev.lines);
    extras = ev.extras;
  } else {
    lines.push(t(user, "Данных сна пока нет. Придут — разберу ночь отдельным сообщением."));
  }

  const lunch = check(
    await db.from("supplements").select("name").eq("user_id", user.id).eq("slot", "lunch")
      .eq("active", true).order("sort"),
  ) as { name: string }[];
  if (lunch.length) {
    lines.push(t(user, "💊 С обедом: {list}. Запиши обед — напомню.", {
      list: lunch.map((x) => esc(x.name)).join(", "),
    }));
  }
  lines.push(...debtLines(user, await openDebts(user.id)));

  return [{
    text: lines.join("\n"),
    keyboard: [[{ text: "📱 " + t(user, "День в приложении"), web_app: { url: MINIAPP_URL } }]],
  }, ...extras];
}

/** Сон пришёл после утреннего сообщения — разбираем отдельно (один раз за день). */
export async function lateSleepMessages(user: User, s: SleepRow): Promise<Outgoing[]> {
  const ev = await evaluateNight(user, s);
  return [{ text: ["🛌 " + sleepLine(user, s), ...ev.lines].join("\n") }, ...ev.extras];
}

export async function eveningHeader(user: User): Promise<string> {
  const today = localNow(user.tz).date;
  const { from, to } = dayBounds(today, user.tz);
  const lines = ["🌙 " + t(user, "<b>Итоги дня.</b>")];

  const lunch = check(
    await db.from("supplements").select("id,name").eq("user_id", user.id).eq("slot", "lunch")
      .eq("active", true),
  ) as { id: string; name: string }[];
  if (lunch.length) {
    const taken = check(
      await db.from("supplement_logs").select("supplement_id").eq("user_id", user.id)
        .eq("local_date", today).eq("status", "taken").in("supplement_id", lunch.map((x) => x.id)),
    ) as unknown[];
    lines.push(
      taken.length >= lunch.length
        ? t(user, "💊 Дневные добавки: ✅")
        : t(user, "💊 Дневные добавки: {state}.", {
          state: taken.length ? t(user, "частично") : t(user, "❌ не выпиты"),
        }),
    );
  }

  const spend = await totalsCny(user.id, from, to);
  lines.push(
    spend.count
      ? t(user, "💸 Траты: {n} зап., {sum}. Всё внесено? Забытое пиши сейчас.", {
        n: spend.count,
        sum: await userMoney(user, spend.expense, today),
      })
      : t(user, "💸 Трат не записано. Правда ноль? Если нет, внеси сейчас."),
  );
  lines.push(...debtLines(user, await openDebts(user.id)));
  return lines.join("\n");
}

export async function lightsOutMessage(user: User): Promise<Outgoing | null> {
  const today = localNow(user.tz).date;
  if (user.state.cheat_date === today) return null;
  const lines = [
    t(user, "🕥 Через 15 минут отбой ({bed}). Экран гаснет, телефон на зарядку не у кровати.", {
      bed: user.settings.sleep.bed,
    }),
    ...debtLines(user, await openDebts(user.id)),
  ];
  return { text: lines.join("\n") };
}

export async function weeklyMessage(user: User): Promise<Outgoing> {
  const today = localNow(user.tz).date;
  const weekAgo = shiftDate(today, -6);
  const lines = ["📊 " + t(user, "<b>Неделя.</b>")];

  const nights = check(
    await db.from("sleep_sessions").select("bed_at,asleep_min").eq("user_id", user.id)
      .gte("night_date", weekAgo).lte("night_date", today),
  ) as { bed_at: string; asleep_min: number }[];
  if (nights.length) {
    const target = toMin(user.settings.sleep.bed);
    const avgSleep = nights.reduce((a, n) => a + n.asleep_min, 0) / nights.length;
    const avgDiff = nights.reduce((a, n) => a + clockDiff(localMin(n.bed_at, user.tz), target), 0) /
      nights.length;
    const good = nights.filter((n) =>
      judgeNight(user, n, user.settings.sleep.bed, user.tz).verdict === "good"
    ).length;
    const bedAt = ((target + Math.round(avgDiff)) % 1440 + 1440) % 1440;
    lines.push(
      t(user, "🛌 Сон: в среднем {avg}, засыпание ~{bed}. В режиме {good} из {all} ночей.", {
        avg: fmtDuration(user, avgSleep),
        bed: `${String(Math.floor(bedAt / 60)).padStart(2, "0")}:${String(bedAt % 60).padStart(2, "0")}`,
        good,
        all: nights.length,
      }),
    );
  } else {
    lines.push(t(user, "🛌 Данных сна за неделю нет."));
  }

  const { count: suppCount } = await db.from("supplements").select("id", {
    count: "exact",
    head: true,
  }).eq("user_id", user.id).eq("active", true);
  const { count: taken } = await db.from("supplement_logs").select("id", {
    count: "exact",
    head: true,
  }).eq("user_id", user.id).eq("status", "taken").gte("local_date", weekAgo);
  if (suppCount) {
    lines.push(t(user, "💊 Добавки: {pct}% приёмов.", {
      pct: Math.round(((taken ?? 0) / (suppCount * 7)) * 100),
    }));
  }

  const from = dayBounds(weekAgo, user.tz).from, to = dayBounds(today, user.tz).to;
  const spend = await totalsCny(user.id, from, to);
  if (spend.count || spend.income) {
    const top = await topCategories(user.id, from, to);
    lines.push(
      t(user, "💸 Расходы {sum}", { sum: await userMoney(user, spend.expense, today) }) +
        (spend.income
          ? t(user, ", доходы {sum}", { sum: await userMoney(user, spend.income, today) })
          : "") +
        (top.length
          ? t(user, ". Больше всего: {list}.", {
            list: (await Promise.all(
              top.map(async ([title, v]) => `${t(user, title)} ${await userMoney(user, v, today)}`),
            )).join(", "),
          })
          : "."),
    );
  } else lines.push(t(user, "💸 Трат не записано."));

  const body = await weekBodySummary(user, weekAgo, today);
  if (body) lines.push(body);

  const study = await weekStudySummary(user, from, to);
  if (study) lines.push(study);

  const career = await weekCareerSummary(user, from, to);
  if (career) lines.push(career);

  // Привычки: штраф только за «жёсткие» и один на неделю, сколько бы их ни просело.
  let keyboard: Keyboard | undefined;
  const habits = await weekHabitsSummary(user, from, to);
  if (habits) {
    lines.push(habits.line);
    if (habits.hardMissed.length) {
      const { id, title } = await issuePenalty(user, `неделя ${weekAgo}…${today}`);
      lines.push(
        t(user, "⚖️ Норма не выполнена: {list}. Штраф — <b>{title}</b>.", {
          list: habits.hardMissed.map(esc).join(", "),
          title: esc(penaltyTitle(user, title)),
        }),
      );
      keyboard = [[{ text: "✅ " + t(user, "Готово"), callback_data: `p:${id}` }]];
    }
  }

  const debts = await openDebts(user.id);
  if (debts.length) lines.push(t(user, "⚖️ Незакрытых долгов: {n}.", { n: debts.length }));
  return { text: lines.join("\n"), keyboard };
}
