// Приём сна из iOS «Команд». Авторизация — персональный токен пользователя
// (users.ingest_token) в заголовке X-Token (или ?token=).
import { claimEvent, getSleep, lateSleepMessages, reevaluateNight, say, sleepLine } from "../_shared/coach.ts";
import { check, db, type User } from "../_shared/db.ts";
import { t } from "../_shared/i18n.ts";
import { mainNights, parseSamples, type SleepSummary, summarizeAll } from "../_shared/sleep.ts";
import { fmtDuration, fmtTime, isQuiet, localNow } from "../_shared/time.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const token = req.headers.get("x-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || token.length < 32) return json({ ok: false, error: "unauthorized" }, 401);
  const user = check(
    await db.from("users").select("*").eq("ingest_token", token).eq("is_allowed", true)
      .maybeSingle(),
  ) as User | null;
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);

  // Shortcuts может прислать JSON ({samples} / {text}) или просто текст.
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = { text: raw };
  }

  // Ночью (отбой–подъём) сон ещё идёт: не сохраняем половину ночи, ждём утреннего запуска.
  const nowLocal = localNow(user.tz);
  if (isQuiet(nowLocal.minutes, user.settings.sleep.bed, user.settings.sleep.wake)) {
    return json({
      ok: true,
      skipped: "night",
      reply: t(user, "Ночь ещё идёт, сон отправится утром."),
    });
  }

  const samples = parseSamples(body);
  const nights = summarizeAll(samples);
  if (nights.length === 0) {
    return json({
      ok: false,
      error: "no sleep samples",
      parsed: samples.length,
      reply: samples.length
        ? t(user, "Сон не найден: есть записи, но нет фаз сна.")
        : t(user, "Сна за последние сутки нет. Часы синхронизировались?"),
    }, 422);
  }

  const today = localNow(user.tz).date;
  // Часы могут синхронизироваться с опозданием и прислать сразу несколько ночей.
  // Пишем все — так ни одна не теряется, — а разбираем только сегодняшнюю: иначе
  // бот выпишет штраф за ночь, которая давно закрыта.
  let fresh: { sum: SleepSummary; before: Awaited<ReturnType<typeof getSleep>> } | null = null;
  for (const sum of mainNights(nights, (d) => localNow(user.tz, d).date)) {
    const date = localNow(user.tz, sum.wake_at).date;
    const before = await getSleep(user.id, date);
    // Дневной сон приходит отдельной отправкой и не должен затирать ночь,
    // записанную утром: ложиться в постель днём — не начало ночи.
    const daytime = localNow(user.tz, sum.bed_at).minutes >= 9 * 60 &&
      localNow(user.tz, sum.bed_at).minutes < 21 * 60;
    if (before && daytime && before.asleep_min >= sum.asleep_min) continue;
    check(
      await db.from("sleep_sessions").upsert({
        user_id: user.id,
        night_date: date,
        ...sum,
        bed_at: sum.bed_at.toISOString(),
        wake_at: sum.wake_at.toISOString(),
        source: "shortcuts",
        raw: { samples: samples.length },
      }, { onConflict: "user_id,night_date" }),
    );
    if (date === today) fresh = { sum, before };
  }

  const sum = fresh?.sum ?? nights[nights.length - 1];
  const nightDate = localNow(user.tz, sum.wake_at).date;
  const stale = !fresh;
  const before = fresh?.before ?? null;

  // Ночь уже разобрана, но данные заметно изменились — пересматриваем (и снимаем лишний штраф).
  const changed = before && (
    Math.abs(before.asleep_min - sum.asleep_min) >= 10 ||
    Math.abs(Date.parse(before.bed_at) - sum.bed_at.getTime()) >= 10 * 60_000
  );
  if (!stale && changed && user.state.last_eval_night === nightDate) {
    const s = await getSleep(user.id, nightDate);
    if (s) {
      const ev = await reevaluateNight(user, s);
      await say(user, { text: ["🛌 " + t(user, "Данные сна обновились.") + " " + sleepLine(user, s), ...ev.lines].join("\n") });
      for (const m of ev.extras) await say(user, m);
    }
  } else if (nightDate === today) {
    // Утреннее сообщение уже ушло без сна — разбираем ночь отдельным сообщением (один раз).
    const { data: morning } = await db.from("reminders").select("id").eq("user_id", user.id)
      .eq("kind", "morning").eq("local_date", today).maybeSingle();
    if (morning && (await claimEvent(user, "sleep_followup", today))) {
      const s = await getSleep(user.id, nightDate);
      if (s) for (const m of await lateSleepMessages(user, s)) await say(user, m);
    }
  }

  return json({
    ok: true,
    night: nightDate,
    stale,
    asleep: fmtDuration(user, sum.asleep_min),
    reply: stale
      ? t(user, "Это сон за ночь {date}, свежих данных нет. Записал, разбор ночи не менял.", {
        date: nightDate,
      })
      : t(user, "Сон {total} записан ({bed}–{wake}).", {
        total: fmtDuration(user, sum.asleep_min),
        bed: fmtTime(sum.bed_at, user.tz),
        wake: fmtTime(sum.wake_at, user.tz),
      }),
  });
});
