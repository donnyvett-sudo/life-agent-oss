// Что показывать на главном экране. Панели включает сам человек: у кого нет часов —
// убирает «Сон», кому важнее учёба — оставляет пары и дедлайны.
// Порядок списка = порядок панелей на экране.
import { check, db, type User } from "../db.ts";
import { dayStreak, habitsOf, isDue, logsBetween, weekStart } from "../habits.ts";
import { dayBounds, fmtTime, localNow, shiftDate } from "../time.ts";
import { HttpError } from "./finance.ts";

/** Все панели главного экрана. Порядок здесь — порядок в списке «Настроить экран». */
export const HOME_PANELS = [
  "sleep",
  "body",
  "supplements",
  "spending",
  "classes",
  "habits",
  "study",
  "milestones",
] as const;

export type HomePanel = typeof HOME_PANELS[number];

/** По умолчанию — то, что было на экране до настройки: ничего не пропадает само. */
export const DEFAULT_HOME: HomePanel[] = ["sleep", "body", "supplements", "spending"];

/**
 * Набор панелей этого человека. Незнакомые и повторы выбрасываем: список приходит
 * из приложения, а состав панелей со временем меняется.
 */
export function homePanels(user: User): HomePanel[] {
  const saved = (user.settings as { home?: unknown }).home;
  if (!Array.isArray(saved)) return DEFAULT_HOME;
  const out = [...new Set(saved.map(String))].filter((p): p is HomePanel =>
    (HOME_PANELS as readonly string[]).includes(p)
  );
  return out;
}

/** Сохранить набор панелей. Пустой список разрешён: человек вправе очистить экран. */
export async function saveHomePanels(user: User, body: { panels?: unknown }): Promise<void> {
  if (!Array.isArray(body.panels)) throw new HttpError(400, "bad panels");
  if (body.panels.length > HOME_PANELS.length) throw new HttpError(400, "too many panels");
  const panels = [...new Set(body.panels.map(String))].filter((p) =>
    (HOME_PANELS as readonly string[]).includes(p)
  );
  const settings = { ...user.settings, home: panels };
  check(await db.from("users").update({ settings }).eq("id", user.id));
  user.settings = settings;
}

// ------------------------------------------------------- данные панелей ---

export type ClassRow = { id: string; course: string | null; kind: string; title: string | null; start: string; end: string; room: string | null };
export type HabitRow = { id: string; title: string; note: string | null; done: boolean; due: boolean; streak: number };
export type StudyRow = { id: string; kind: "assignment" | "exam"; course: string | null; title: string; date: string | null; note: string | null };
export type MilestoneRow = { id: string; title: string; project: string; date: string | null };

/** Пары в этот день: время, аудитория, курс. */
export async function classesOn(user: User, date: string): Promise<ClassRow[]> {
  const { from, to } = dayBounds(date, user.tz);
  const rows = check(
    await db.from("class_sessions").select("id,kind,title,starts_at,ends_at,room,courses(short)")
      .eq("user_id", user.id)
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString())
      .order("starts_at"),
  ) as unknown as {
    id: string; kind: string; title: string | null; starts_at: string; ends_at: string;
    room: string | null; courses: { short: string } | null;
  }[];
  return rows.map((s) => ({
    id: s.id,
    course: s.courses?.short ?? null,
    kind: s.kind,
    title: s.title,
    start: fmtTime(new Date(s.starts_at), user.tz),
    end: fmtTime(new Date(s.ends_at), user.tz),
    room: s.room,
  }));
}

/**
 * Привычки на этот день. Отмечать задним числом умеет вкладка «Привычки»,
 * здесь же показываем только те, что сегодня нужны, плюс уже закрытые.
 */
export async function habitsOn(user: User, date: string): Promise<HabitRow[]> {
  const [habits, logs] = await Promise.all([
    habitsOf(user.id),
    logsBetween(user.id, shiftDate(weekStart(date), -21), date),
  ]);
  return habits
    .map((h) => ({
      id: h.id,
      title: h.title,
      note: h.note,
      done: logs.some((l) => l.habit_id === h.id && l.local_date === date),
      due: isDue(h, logs, date),
      streak: dayStreak(h, logs, date),
    }))
    .filter((h) => h.due || h.done);
}

/** Ближайшие дедлайны: задания и контрольные вперемешку, по дате. */
export async function studySoon(user: User, date: string, limit = 5): Promise<StudyRow[]> {
  const [hwRes, examRes] = await Promise.all([
    db.from("assignments").select("id,title,due_date,due_note,courses(short)")
      .eq("user_id", user.id).eq("status", "todo")
      .order("due_date", { ascending: true, nullsFirst: false }).limit(limit * 2),
    db.from("exams").select("id,title,kind,date,date_to,courses(short)")
      .eq("user_id", user.id).order("date", { ascending: true, nullsFirst: false }).limit(limit * 2),
  ]);
  type Hw = { id: string; title: string; due_date: string | null; due_note: string | null; courses: { short: string } | null };
  type Ex = { id: string; title: string; kind: string; date: string | null; date_to: string | null; courses: { short: string } | null };
  const rows: StudyRow[] = [
    ...(check(hwRes) as unknown as Hw[]).map((a) => ({
      id: a.id,
      kind: "assignment" as const,
      course: a.courses?.short ?? null,
      title: a.title,
      date: a.due_date,
      note: a.due_note,
    })),
    ...(check(examRes) as unknown as Ex[])
      .filter((e) => !e.date || (e.date_to ?? e.date) >= date)
      .map((e) => ({
        id: e.id,
        kind: "exam" as const,
        course: e.courses?.short ?? null,
        title: e.title,
        date: e.date,
        note: e.kind,
      })),
  ];
  // Без даты — в конец: такие задачи не горят, но и терять их не надо.
  rows.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return rows.slice(0, limit);
}

/** Ближайшие незакрытые вехи проектов. */
export async function milestonesSoon(user: User, limit = 5): Promise<MilestoneRow[]> {
  const rows = check(
    await db.from("milestones").select("id,title,due_date,projects(title)")
      .eq("user_id", user.id).eq("status", "todo")
      .order("due_date", { ascending: true, nullsFirst: false }).limit(limit),
  ) as unknown as { id: string; title: string; due_date: string | null; projects: { title: string } | null }[];
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    project: m.projects?.title ?? "",
    date: m.due_date,
  }));
}

/** Сегодняшняя дата человека — панели новых видов показываем только за today. */
export const isToday = (user: User, date: string) => date === localNow(user.tz).date;
