// Учёба для Mini App: дедлайны, контрольные, пары на неделю, фокус, карточки.
import { check, db, type User } from "../db.ts";
import { MAX_NEW, MAX_REVIEWS, MY_DECK, nextIntroOrder } from "../cards.ts";
import { type Course, coursesOf, startFocusWith, stopFocus } from "../study.ts";
import { dayBounds, fmtTime, localNow, shiftDate } from "../time.ts";
import { HttpError } from "./finance.ts";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optDate(v: unknown, name: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !ISO_DATE.test(v)) throw new HttpError(400, `bad ${name}`);
  return v;
}
function optText(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}
async function ownCourse(user: User, id: unknown): Promise<string | null> {
  if (!id) return null;
  const courses = await coursesOf(user.id);
  if (!courses.has(String(id))) throw new HttpError(400, "bad course");
  return String(id);
}

/** Понедельник недели, в которую попадает date. */
function weekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = вс
  return shiftDate(date, dow === 0 ? -6 : 1 - dow);
}

export async function studyOverview(user: User, weekParam: string | null) {
  const today = localNow(user.tz).date;
  const monday = weekStart(weekParam && ISO_DATE.test(weekParam) ? weekParam : today);
  const from = dayBounds(monday, user.tz).from;
  const to = dayBounds(shiftDate(monday, 7), user.tz).from;
  const thisMonday = weekStart(today);
  const fw = dayBounds(thisMonday, user.tz).from;

  const [courses, hwRes, doneRes, examsRes, sessRes, focusRes, cardsRes, reviewsRes] = await Promise.all([
    coursesOf(user.id),
    db.from("assignments").select("*").eq("user_id", user.id).eq("status", "todo")
      .order("due_date", { ascending: true, nullsFirst: false }),
    db.from("assignments").select("*").eq("user_id", user.id).eq("status", "done")
      .order("updated_at", { ascending: false }).limit(10),
    db.from("exams").select("*").eq("user_id", user.id).order("date", { ascending: true, nullsFirst: false }),
    db.from("class_sessions").select("*").eq("user_id", user.id)
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at"),
    db.from("focus_sessions").select("course_id,minutes,status,started_at,planned_min,id").eq("user_id", user.id)
      .gte("started_at", fw.toISOString()).order("started_at", { ascending: false }),
    db.from("flashcards").select("box,next_review,status").eq("user_id", user.id).neq("status", "archived"),
    db.from("flashcard_reviews").select("correct").eq("user_id", user.id).gte("reviewed_at", fw.toISOString()),
  ]);

  const course = (id: string | null) => {
    const c = id ? courses.get(id) : undefined;
    return c ? { id: c.id, short: c.short, aiPolicy: c.ai_policy } : null;
  };
  type A = { id: string; course_id: string | null; title: string; details: string | null; due_date: string | null; due_note: string | null; status: string; source: string };
  const mapA = (a: A) => ({
    id: a.id,
    course: course(a.course_id),
    title: a.title,
    details: a.details,
    dueDate: a.due_date,
    dueNote: a.due_note,
    done: a.status === "done",
    fromStudyAgent: a.source === "study-agent",
  });
  type E = { id: string; course_id: string | null; kind: string; title: string; topic: string | null; date: string | null; date_to: string | null; is_tentative: boolean; notes: string | null };
  const exams = (check(examsRes) as E[])
    .filter((e) => !e.date || (e.date_to ?? e.date) >= today)
    .map((e) => ({
      id: e.id,
      course: course(e.course_id),
      kind: e.kind,
      title: e.title,
      topic: e.topic,
      date: e.date,
      dateTo: e.date_to,
      tentative: e.is_tentative,
      notes: e.notes,
      fromStudyAgent: (e as E & { source?: string }).source === "study-agent",
    }));

  type S = { id: string; course_id: string | null; kind: string; title: string | null; starts_at: string; ends_at: string; room: string | null };
  const sessions = (check(sessRes) as S[]).map((s) => ({
    id: s.id,
    course: course(s.course_id),
    kind: s.kind,
    title: s.title,
    date: localNow(user.tz, new Date(s.starts_at)).date,
    start: fmtTime(new Date(s.starts_at), user.tz),
    end: fmtTime(new Date(s.ends_at), user.tz),
    room: s.room,
  }));

  type F = { id: string; course_id: string | null; minutes: number | null; status: string; started_at: string; planned_min: number };
  const focus = check(focusRes) as F[];
  const byCourse = new Map<string, number>();
  let weekMin = 0, todayMin = 0;
  const { from: td } = dayBounds(today, user.tz);
  for (const f of focus) {
    if (f.status === "running") continue;
    weekMin += f.minutes ?? 0;
    if (Date.parse(f.started_at) >= td.getTime()) todayMin += f.minutes ?? 0;
    const key = f.course_id ?? "none";
    byCourse.set(key, (byCourse.get(key) ?? 0) + (f.minutes ?? 0));
  }
  const running = focus.find((f) => f.status === "running");

  const cards = check(cardsRes) as { box: number; next_review: string; status: string }[];
  const reviews = check(reviewsRes) as { correct: boolean }[];

  return {
    today,
    week: monday,
    thisWeek: thisMonday,
    courses: [...courses.values()]
      .sort((a: Course, b: Course) => a.sort - b.sort)
      .map((c) => ({ id: c.id, short: c.short, title: c.title, aiPolicy: c.ai_policy })),
    assignments: (check(hwRes) as A[]).map(mapA),
    recentlyDone: (check(doneRes) as A[]).map(mapA),
    exams,
    sessions,
    focus: {
      weekMin,
      todayMin,
      byCourse: [...byCourse].map(([id, minutes]) => ({ course: id === "none" ? null : course(id), minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      running: running
        ? { id: running.id, plannedMin: running.planned_min, startedAt: running.started_at, course: course(running.course_id) }
        : null,
    },
    cards: {
      total: cards.length,
      // Размер сегодняшней сессии, а не весь хвост просроченных.
      due: Math.min(MAX_REVIEWS, cards.filter((c) => c.status === "learning" && c.next_review <= today).length) +
        Math.min(MAX_NEW, cards.filter((c) => c.status === "new").length),
      byBox: [1, 2, 3, 4, 5].map((b) => cards.filter((c) => c.box === b).length),
      reviewedWeek: reviews.length,
      correctWeek: reviews.filter((r) => r.correct).length,
    },
  };
}

export async function saveAssignment(user: User, id: string | null, b: Body) {
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    const t = optText(b.title, 200);
    if (!t) throw new HttpError(400, "title required");
    patch.title = t;
  }
  if (b.courseId !== undefined) patch.course_id = await ownCourse(user, b.courseId);
  if (b.details !== undefined) patch.details = optText(b.details, 2000);
  if (b.dueDate !== undefined) patch.due_date = optDate(b.dueDate, "dueDate");
  if (b.dueNote !== undefined) patch.due_note = optText(b.dueNote, 300);
  if (b.done !== undefined) {
    patch.status = b.done ? "done" : "todo";
    patch.done_at = b.done ? new Date().toISOString() : null;
  }
  if (id) {
    const res = await db.from("assignments").update(patch, { count: "exact" }).eq("id", id).eq("user_id", user.id);
    check(res);
    if (!res.count) throw new HttpError(404, "not found");
  } else {
    if (!patch.title) throw new HttpError(400, "title required");
    check(await db.from("assignments").insert({ ...patch, user_id: user.id, source: "app" }));
  }
}

export async function deleteAssignment(user: User, id: string) {
  check(await db.from("assignments").delete().eq("id", id).eq("user_id", user.id));
}

export async function saveExam(user: User, id: string | null, b: Body) {
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    const t = optText(b.title, 120);
    if (!t) throw new HttpError(400, "title required");
    patch.title = t;
  }
  if (b.courseId !== undefined) patch.course_id = await ownCourse(user, b.courseId);
  if (b.kind !== undefined) patch.kind = ["quiz", "final", "presentation"].includes(b.kind) ? b.kind : "other";
  if (b.topic !== undefined) patch.topic = optText(b.topic, 300);
  if (b.date !== undefined) patch.date = optDate(b.date, "date");
  if (b.dateTo !== undefined) patch.date_to = optDate(b.dateTo, "dateTo");
  if (b.tentative !== undefined) patch.is_tentative = Boolean(b.tentative);
  if (b.notes !== undefined) patch.notes = optText(b.notes, 1000);
  if (id) {
    const res = await db.from("exams").update(patch, { count: "exact" }).eq("id", id).eq("user_id", user.id);
    check(res);
    if (!res.count) throw new HttpError(404, "not found");
  } else {
    if (!patch.title) throw new HttpError(400, "title required");
    check(await db.from("exams").insert({ ...patch, user_id: user.id, source: "app" }));
  }
}

export async function deleteExam(user: User, id: string) {
  check(await db.from("exams").delete().eq("id", id).eq("user_id", user.id));
}

export async function saveCard(user: User, id: string | null, b: Body) {
  const patch: Record<string, unknown> = {};
  if (b.front !== undefined) {
    const f = optText(b.front, 100);
    if (!f) throw new HttpError(400, "front required");
    patch.front = f;
  }
  if (b.meaning !== undefined) {
    const m = optText(b.meaning, 300);
    if (!m) throw new HttpError(400, "meaning required");
    patch.meaning = m;
  }
  if (b.reading !== undefined) patch.reading = optText(b.reading, 100);
  if (b.example !== undefined) patch.example = optText(b.example, 300);
  if (b.lesson !== undefined) patch.lesson = optText(b.lesson, 40);
  if (b.deck !== undefined) patch.deck = optText(b.deck, 40) ?? MY_DECK;
  if (id) {
    const res = await db.from("flashcards").update(patch, { count: "exact" }).eq("id", id).eq("user_id", user.id);
    check(res);
    if (!res.count) throw new HttpError(404, "not found");
    return;
  }
  if (!patch.front || !patch.meaning) throw new HttpError(400, "front and meaning required");
  // Новое слово повторяем сегодня же, иначе оно всплывёт только завтра.
  check(await db.from("flashcards").insert({
    ...patch,
    user_id: user.id,
    deck: patch.deck ?? MY_DECK,
    status: "new",
    intro_order: await nextIntroOrder(user.id),
    next_review: localNow(user.tz).date,
  }));
}

export async function deleteCard(user: User, id: string) {
  check(await db.from("flashcards").delete().eq("id", id).eq("user_id", user.id));
}

export async function startFocusFromApp(user: User, b: Body) {
  const courseId = await ownCourse(user, b.courseId);
  const course = courseId ? (await coursesOf(user.id)).get(courseId) : undefined;
  if (!(await startFocusWith(user, Number(b.minutes) || 25, course))) {
    throw new HttpError(409, "фокус уже идёт");
  }
}

/** Остановить свою фокус-сессию из приложения (Life Desk): бот закроет её и напишет итог в Telegram. */
export async function stopFocusFromApp(user: User, id: string) {
  return { result: await stopFocus(user, id) };
}
