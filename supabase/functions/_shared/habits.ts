// Образ жизни: привычки, спорт и звонки родным. Одна таблица на всё, без ИИ.
// Отметки собираются вечером вместе с итогами дня: утром человек ещё ничего не сделал.
import { check, db, type User } from "./db.ts";
import { esc, type Keyboard } from "./telegram.ts";
import { localNow, shiftDate } from "./time.ts";
import { type Lang, pick, t } from "./i18n.ts";

export type Habit = {
  id: string;
  title: string;
  kind: "daily" | "weekly" | "interval";
  target: number;
  days: number[] | null;
  note: string | null;
  is_hard: boolean;
  active: boolean;
  sort: number;
};

export type HabitLog = { habit_id: string; local_date: string; amount: number };

const KIND_LABEL: Record<Habit["kind"], (h: Habit, who: User | Lang) => string> = {
  daily: (h, who) =>
    h.days?.length
      ? t(who, "по дням: {days}", { days: h.days.map((d) => dow(who)[d]).join(", ") })
      : t(who, "каждый день"),
  weekly: (h, who) =>
    pick(who, `${h.target} раз${h.target > 1 ? "а" : ""} в неделю`, `${h.target}× a week`),
  interval: (h, who) => t(who, "не реже чем раз в {n} дн.", { n: h.target }),
};
const dow = (who: User | Lang) =>
  pick(who, ["вс", "пн", "вт", "ср", "чт", "пт", "сб"], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

export const habitLabel = (h: Habit, who: User | Lang = "ru") => KIND_LABEL[h.kind](h, who);

/** Понедельник недели, в которую попадает date. Неделя считается от понедельника. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, dow === 0 ? -6 : 1 - dow);
}

export async function habitsOf(userId: string, withInactive = false): Promise<Habit[]> {
  const q = db.from("habits").select("*").eq("user_id", userId).order("sort").order("created_at");
  return check(withInactive ? await q : await q.eq("active", true)) as Habit[];
}

export async function logsBetween(userId: string, from: string, to: string): Promise<HabitLog[]> {
  return check(
    await db.from("habit_logs").select("habit_id,local_date,amount").eq("user_id", userId)
      .gte("local_date", from).lte("local_date", to).order("local_date"),
  ) as HabitLog[];
}

/** Сколько раз привычка отмечена на неделе, в которую попадает today. */
export const weekCount = (logs: HabitLog[], h: Habit, today: string) =>
  logs.filter((l) => l.habit_id === h.id && l.local_date >= weekStart(today) && l.local_date <= today).length;

export const lastDone = (logs: HabitLog[], h: Habit): string | null =>
  logs.filter((l) => l.habit_id === h.id).at(-1)?.local_date ?? null;

/**
 * Нужна ли привычка сегодня. Недельная считается нужной, пока норма не закрыта:
 * так она сама подтягивается к концу недели, а не требует расписания по дням.
 */
export function isDue(h: Habit, logs: HabitLog[], today: string): boolean {
  if (logs.some((l) => l.habit_id === h.id && l.local_date === today)) return false;
  if (h.kind === "daily") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    return !h.days?.length || h.days.includes(dow);
  }
  if (h.kind === "weekly") return weekCount(logs, h, today) < h.target;
  const last = lastDone(logs, h);
  return !last || last <= shiftDate(today, -h.target);
}

/** Дней подряд для ежедневных; для остальных серия считается неделями, поэтому 0. */
export function dayStreak(h: Habit, logs: HabitLog[], today: string): number {
  if (h.kind !== "daily" || h.days?.length) return 0;
  const done = new Set(logs.filter((l) => l.habit_id === h.id).map((l) => l.local_date));
  // Сегодняшний день ещё не кончился: пустое сегодня серию не рвёт.
  let day = done.has(today) ? today : shiftDate(today, -1);
  let n = 0;
  while (done.has(day)) {
    n++;
    day = shiftDate(day, -1);
  }
  return n;
}

/** Отметить или снять отметку за день. Возвращает текст для ответа в чате. */
export async function toggleHabit(user: User, habitId: string, date?: string): Promise<string> {
  const day = date ?? localNow(user.tz).date;
  const { data: habit } = await db.from("habits").select("title").eq("id", habitId)
    .eq("user_id", user.id).maybeSingle();
  if (!habit) return t(user, "Такой привычки нет");
  const title = (habit as { title: string }).title;

  const { count } = await db.from("habit_logs").delete({ count: "exact" })
    .eq("habit_id", habitId).eq("local_date", day);
  if (count) return t(user, "Отметка снята: {title}", { title });
  check(
    await db.from("habit_logs").insert({ user_id: user.id, habit_id: habitId, local_date: day })
      .select("habit_id"),
  );
  return t(user, "Отмечено: {title}", { title });
}

// -------------------------------------------------------- сообщения ---

/** Хвост вечернего чек-ина: что из привычек ещё не отмечено сегодня. */
export async function eveningHabits(user: User): Promise<{ text: string; keyboard?: Keyboard } | null> {
  const today = localNow(user.tz).date;
  const [habits, logs] = await Promise.all([
    habitsOf(user.id),
    logsBetween(user.id, shiftDate(today, -30), today),
  ]);
  if (!habits.length) return null;
  const due = habits.filter((h) => isDue(h, logs, today));
  const done = habits.filter((h) => logs.some((l) => l.habit_id === h.id && l.local_date === today));

  if (!due.length) {
    return done.length
      ? { text: t(user, "🔁 Привычки: всё закрыто ({n}).", { n: done.length }) }
      : null;
  }
  return {
    text: "🔁 " + t(user, "Осталось сегодня:") + "\n" + due.map((h) => `• ${esc(h.title)}`).join("\n"),
    keyboard: due.slice(0, 6).map((h) => [{ text: `✅ ${h.title}`, callback_data: `h:${h.id}` }]),
  };
}

/** /habits: что нужно сегодня, серии и недельные нормы. */
export async function habitsOverview(user: User): Promise<{ text: string; keyboard?: Keyboard }> {
  const today = localNow(user.tz).date;
  const [habits, logs] = await Promise.all([
    habitsOf(user.id),
    logsBetween(user.id, shiftDate(today, -60), today),
  ]);
  if (!habits.length) {
    return { text: t(user, "Привычек пока нет. Заведи их в приложении, на вкладке «Привычки».") };
  }

  const lines = [t(user, "<b>Образ жизни</b>")];
  for (const h of habits) {
    const marked = logs.some((l) => l.habit_id === h.id && l.local_date === today);
    const streak = dayStreak(h, logs, today);
    const tail = h.kind === "weekly"
      ? t(user, "{n} из {need} за неделю", { n: weekCount(logs, h, today), need: h.target })
      : h.kind === "interval"
      ? (() => {
        const last = lastDone(logs, h);
        if (!last) return t(user, "ещё ни разу");
        const ago = Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000);
        return ago === 0 ? t(user, "сегодня") : t(user, "{n} дн. назад", { n: ago });
      })()
      : streak
      ? t(user, "серия {n} дн.", { n: streak })
      : t(user, "серии нет");
    lines.push(`${marked ? "✅" : isDue(h, logs, today) ? "▫️" : "·"} ${esc(h.title)} — ${tail}`);
  }

  const due = habits.filter((h) => isDue(h, logs, today));
  return {
    text: lines.join("\n"),
    keyboard: due.slice(0, 6).map((h) => [{ text: `✅ ${h.title}`, callback_data: `h:${h.id}` }]),
  };
}

/**
 * Для недельного разбора. hardMissed — жёсткие привычки, не добравшие норму:
 * по ним коуч выдаёт штраф (один на неделю, не по штуке за привычку).
 */
export async function weekHabitsSummary(
  user: User,
  from: Date,
  to: Date,
): Promise<{ line: string; hardMissed: string[] } | null> {
  const fromDate = from.toISOString().slice(0, 10), toDate = to.toISOString().slice(0, 10);
  const [habits, logs] = await Promise.all([habitsOf(user.id), logsBetween(user.id, fromDate, toDate)]);
  if (!habits.length) return null;

  const parts: string[] = [];
  const hardMissed: string[] = [];
  for (const h of habits) {
    const n = logs.filter((l) => l.habit_id === h.id).length;
    const need = h.kind === "weekly"
      ? h.target
      : h.kind === "daily"
      ? (h.days?.length ?? 7)
      : Math.floor(7 / h.target);
    parts.push(`${h.title} ${n}/${need}`);
    if (h.is_hard && n < need) hardMissed.push(h.title);
  }
  return { line: t(user, "🔁 Привычки: {list}.", { list: parts.join(", ") }), hardMissed };
}

export async function habitFacts(user: User): Promise<string[]> {
  const today = localNow(user.tz).date;
  const [habits, logs] = await Promise.all([
    habitsOf(user.id),
    logsBetween(user.id, shiftDate(today, -14), today),
  ]);
  if (!habits.length) return [];
  const due = habits.filter((h) => isDue(h, logs, today));
  const lines = [
    t(user, "Привычки: {list}.", {
      list: habits.map((h) => `${h.title} (${habitLabel(h, user)})`).join(", "),
    }),
  ];
  if (due.length) {
    lines.push(t(user, "Сегодня ещё не сделано: {list}.", { list: due.map((h) => h.title).join(", ") }));
  }
  return lines;
}
