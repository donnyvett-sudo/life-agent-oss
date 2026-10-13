/**
 * Самопроверка. Бот, который молча сломался, хуже бота, который ругается:
 * напоминания просто перестают приходить, и это списывается на «нечего сказать».
 * Раз в день проверяем следы работы и пишем владельцу, если следов нет.
 */
import { check, db, type User } from "./db.ts";
import { t } from "./i18n.ts";
import { localNow, shiftDate } from "./time.ts";

export type Health = { ok: boolean; problems: string[]; facts: Record<string, unknown> };

/** Сколько дней тишины считаем поломкой, а не паузой. */
const SLEEP_SILENT_DAYS = 3;
const FX_SILENT_DAYS = 2;
const BACKUP_SILENT_DAYS = 10;
const TICK_SILENT_MIN = 10;

async function lastDate(table: string, col: string, userId: string): Promise<string | null> {
  const { data } = await db.from(table).select(col).eq("user_id", userId)
    .order(col, { ascending: false }).limit(1).maybeSingle();
  return (data as Record<string, string> | null)?.[col] ?? null;
}

/** Когда планировщик последний раз тикал. Общий на всех, поэтому вне пользователя. */
export async function lastTick(): Promise<{ at: string | null; ageMin: number | null }> {
  const { data } = await db.from("heartbeat").select("last_tick").eq("id", true).maybeSingle();
  const at = (data as { last_tick: string } | null)?.last_tick ?? null;
  return { at, ageMin: at ? Math.round((Date.now() - Date.parse(at)) / 60_000) : null };
}

export async function health(user: User): Promise<Health> {
  const today = localNow(user.tz).date;
  const problems: string[] = [];
  const facts: Record<string, unknown> = {};

  const tick = await lastTick();
  facts.lastTickMin = tick.ageMin;
  if (tick.ageMin === null || tick.ageMin > TICK_SILENT_MIN) {
    problems.push(t(user, "Планировщик молчит {n} мин — напоминания не придут.", { n: tick.ageMin ?? -1 }));
  }

  // Вчерашнее утро: событие отмечается в reminders, поэтому пропуск виден.
  const yesterday = shiftDate(today, -1);
  const { data: morning } = await db.from("reminders").select("id").eq("user_id", user.id)
    .eq("kind", "morning").eq("local_date", yesterday).maybeSingle();
  facts.morningYesterday = Boolean(morning);
  if (!morning) problems.push(t(user, "Вчера не ушло утреннее сообщение."));

  const sleep = await lastDate("sleep_sessions", "night_date", user.id);
  facts.lastSleep = sleep;
  if (sleep && sleep < shiftDate(today, -SLEEP_SILENT_DAYS)) {
    problems.push(t(user, "Сон не приходит с часов с {date}.", { date: sleep }));
  }

  const backup = check(
    await db.from("reminders").select("local_date").eq("user_id", user.id).eq("kind", "backup")
      .order("local_date", { ascending: false }).limit(1),
  ) as { local_date: string }[];
  facts.lastBackup = backup[0]?.local_date ?? null;
  if (backup.length && backup[0].local_date < shiftDate(today, -BACKUP_SILENT_DAYS)) {
    problems.push(t(user, "Копия данных не делалась с {date}.", { date: backup[0].local_date }));
  }

  // Общие для всех проверки беспокоят только владельца: чинить их всё равно ему.
  if (user.is_owner) {
    const { data: fx } = await db.from("fx_rates").select("date").order("date", { ascending: false })
      .limit(1).maybeSingle();
    const fxDate = (fx as { date: string } | null)?.date ?? null;
    facts.lastFx = fxDate;
    if (!fxDate || fxDate < shiftDate(today, -FX_SILENT_DAYS)) {
      problems.push(t(user, "Курсы валют не обновлялись с {date}.", { date: fxDate ?? "никогда" }));
    }
    facts.gemini = Boolean(Deno.env.get("GEMINI_API_KEY"));
    if (!facts.gemini) problems.push(t(user, "Ключ Gemini не задан — коуч молчит."));
  }

  return { ok: problems.length === 0, problems, facts };
}

/** Ежедневная проверка: молчим, когда всё хорошо. */
export async function selfCheck(user: User): Promise<{ text: string } | null> {
  const h = await health(user);
  if (h.ok) return null;
  return {
    text: ["🔧 " + t(user, "<b>Кажется, я сломался</b>"), ...h.problems.map((p) => "• " + p)].join("\n"),
  };
}
