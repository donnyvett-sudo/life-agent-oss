// Образ жизни для Mini App: привычки, сетка отметок, правка.
import { db, type User } from "../db.ts";
import {
  dayStreak,
  type Habit,
  habitsOf,
  isDue,
  lastDone,
  logsBetween,
  toggleHabit,
  weekCount,
  weekStart,
} from "../habits.ts";
import { localNow, shiftDate } from "../time.ts";
import { HttpError } from "./finance.ts";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["daily", "weekly", "interval"];
const GRID_WEEKS = 5;

export async function habitsOverview(user: User) {
  const today = localNow(user.tz).date;
  const from = shiftDate(weekStart(today), -(GRID_WEEKS - 1) * 7);
  const [habits, logs] = await Promise.all([
    habitsOf(user.id, true),
    logsBetween(user.id, from, today),
  ]);
  const active = habits.filter((h) => h.active);

  return {
    today,
    from,
    habits: habits.map((h) => ({
      id: h.id,
      title: h.title,
      kind: h.kind,
      target: h.target,
      days: h.days,
      note: h.note,
      isHard: h.is_hard,
      active: h.active,
      due: h.active && isDue(h, logs, today),
      doneToday: logs.some((l) => l.habit_id === h.id && l.local_date === today),
      streak: dayStreak(h, logs, today),
      weekDone: weekCount(logs, h, today),
      lastDone: lastDone(logs, h),
      dates: logs.filter((l) => l.habit_id === h.id).map((l) => l.local_date),
    })),
    dueCount: active.filter((h) => isDue(h, logs, today)).length,
  };
}

/** Разбор формы привычки: отдельно от записи, чтобы правила проверялись без базы. */
export function habitRow(user: User, body: Body) {
  const kind = body.kind === undefined ? "daily" : String(body.kind);
  if (!KINDS.includes(kind)) throw new HttpError(400, "bad kind");
  const title = String(body.title ?? "").trim();
  if (!title) throw new HttpError(400, "bad title");

  const target = Math.min(30, Math.max(1, Number(body.target) || 1));
  // days имеет смысл только для ежедневных: у недельной норма считается за неделю целиком.
  const days = kind === "daily" && Array.isArray(body.days) && body.days.length
    ? [...new Set(body.days.map(Number).filter((d: number) => d >= 0 && d <= 6))].sort()
    : null;

  return {
    user_id: user.id,
    title: title.slice(0, 120),
    kind,
    target,
    days,
    note: String(body.note ?? "").trim().slice(0, 200) || null,
    is_hard: body.isHard === true,
    active: body.active !== false,
    sort: Number(body.sort) || 0,
  };
}

export async function saveHabit(user: User, id: string | null, body: Body) {
  const row = habitRow(user, body);
  const res = id
    ? await db.from("habits").update(row).eq("id", id).eq("user_id", user.id).select("id").single()
    : await db.from("habits").insert(row).select("id").single();
  if (res.error) throw new HttpError(400, res.error.message);
  return { id: (res.data as { id: string }).id };
}

export async function deleteHabit(user: User, id: string) {
  // Отметки уходят вместе с привычкой (on delete cascade).
  const { count } = await db.from("habits").delete({ count: "exact" })
    .eq("id", id).eq("user_id", user.id);
  if (!count) throw new HttpError(404, "no habit");
  return { ok: true };
}

/** Отметка за день: тот же переключатель, что и кнопкой в чате. Дата — для «забыл вчера». */
export async function toggleHabitDay(user: User, id: string, body: Body) {
  const date = body.date === undefined ? undefined : String(body.date);
  if (date !== undefined && !ISO_DATE.test(date)) throw new HttpError(400, "bad date");
  const today = localNow(user.tz).date;
  if (date && (date > today || date < shiftDate(today, -60))) throw new HttpError(400, "bad date");
  const reply = await toggleHabit(user, id, date);
  if (reply === "Такой привычки нет") throw new HttpError(404, "no habit");
  return { ok: true, done: reply.startsWith("Отмечено") };
}

export type { Habit };
