// Учёба в боте: дедлайны и экзамены, пары, фокус-сессии. Карточки — в cards.ts.
import { check, db, type User } from "./db.ts";
import { cardsStatus } from "./cards.ts";
import { dropKeyboard, esc, type Keyboard, send } from "./telegram.ts";
import { dayBounds, daysUntil, dueLabel, fmtTime, localNow, shiftDate } from "./time.ts";
import { t } from "./i18n.ts";

export type Course = { id: string; code: string; title: string; short: string; ai_policy: string; sort: number };
export type Assignment = {
  id: string; course_id: string | null; title: string; details: string | null;
  due_date: string | null; due_note: string | null; status: string;
};
export type Exam = {
  id: string; course_id: string | null; kind: string; title: string; topic: string | null;
  date: string | null; date_to: string | null; is_tentative: boolean; notes: string | null;
};

export async function coursesOf(userId: string): Promise<Map<string, Course>> {
  const rows = check(await db.from("courses").select("*").eq("user_id", userId)) as Course[];
  return new Map(rows.map((c) => [c.id, c]));
}

/** Невыполненные задания со сроком до today+days (и просроченные). */
export async function upcomingAssignments(user: User, days: number): Promise<Assignment[]> {
  const today = localNow(user.tz).date;
  return check(
    await db.from("assignments").select("*").eq("user_id", user.id).eq("status", "todo")
      .not("due_date", "is", null).lte("due_date", shiftDate(today, days)).order("due_date"),
  ) as Assignment[];
}

/** Экзамены, которые идут в ближайшие days дней (для диапазонов — если диапазон пересекается). */
export async function upcomingExams(user: User, days: number): Promise<Exam[]> {
  const today = localNow(user.tz).date;
  const rows = check(
    await db.from("exams").select("*").eq("user_id", user.id).not("date", "is", null)
      .lte("date", shiftDate(today, days)).order("date"),
  ) as Exam[];
  return rows.filter((e) => (e.date_to ?? e.date!) >= today);
}

export async function classesOn(user: User, date: string) {
  const { from, to } = dayBounds(date, user.tz);
  return check(
    await db.from("class_sessions").select("*").eq("user_id", user.id)
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).order("starts_at"),
  ) as { id: string; course_id: string | null; kind: string; title: string | null; starts_at: string; ends_at: string; room: string | null }[];
}

const courseName = (courses: Map<string, Course>, id: string | null) => (id && courses.get(id)?.short) || "";

export function examLine(user: User, e: Exam, courses: Map<string, Course>, today: string): string {
  const when = e.date_to && e.date_to !== e.date
    ? `${e.date!.slice(5)}…${e.date_to.slice(5)}`
    : dueLabel(user, e.date, today);
  return `${courseName(courses, e.course_id)} · ${e.title}: ${when}` +
    (e.is_tentative ? " " + t(user, "(ориентировочно)") : "");
}

function doneButtons(items: Assignment[], courses: Map<string, Course>): Keyboard {
  return items.slice(0, 6).map((a) => [{
    text: `✅ ${courseName(courses, a.course_id)} ${a.title}`.slice(0, 60),
    callback_data: `hw:${a.id}`,
  }]);
}

const cardsLine = (user: User, s: "ready" | "done") =>
  s === "done" ? t(user, "Карточки на сегодня сделаны.") : t(user, "Сессия карточек на сегодня готова: /cards");

/** Блок учёбы для утреннего сообщения: пары, дедлайны 3 дня, экзамены 7 дней, карточки. */
export async function morningStudy(user: User): Promise<{ text: string; keyboard?: Keyboard } | null> {
  const today = localNow(user.tz).date;
  const [courses, classes, hw, exams, cards] = await Promise.all([
    coursesOf(user.id),
    classesOn(user, today),
    upcomingAssignments(user, 3),
    upcomingExams(user, 7),
    cardsStatus(user),
  ]);
  const lines: string[] = [];
  if (classes.length) {
    lines.push("📚 " + t(user, "<b>Пары сегодня</b>"));
    for (const c of classes) {
      const name = c.title ?? courseName(courses, c.course_id);
      lines.push(`${fmtTime(new Date(c.starts_at), user.tz)} ${esc(name)}${c.room ? `, ${esc(c.room)}` : ""}`);
    }
  }
  if (hw.length) {
    lines.push("", "📝 " + t(user, "<b>Дедлайны</b>"));
    for (const a of hw) lines.push(`${esc(courseName(courses, a.course_id))} · ${esc(a.title)}: ${dueLabel(user, a.due_date, today)}`);
  }
  if (exams.length) {
    lines.push("", "🎯 " + t(user, "<b>Контрольные</b>"));
    for (const e of exams) lines.push(esc(examLine(user, e, courses, today)));
  }
  if (cards) lines.push("", "🃏 " + cardsLine(user, cards));
  if (!lines.length) return null;
  return { text: lines.join("\n").trim(), keyboard: hw.length ? doneButtons(hw, courses) : undefined };
}

/** Вечером: что сдавать завтра. */
export async function eveningStudy(user: User): Promise<{ text: string; keyboard?: Keyboard } | null> {
  const today = localNow(user.tz).date;
  const tomorrow = shiftDate(today, 1);
  const [courses, hw, cards] = await Promise.all([
    coursesOf(user.id),
    upcomingAssignments(user, 1),
    cardsStatus(user),
  ]);
  const soon = hw.filter((a) => a.due_date! <= tomorrow);
  if (!soon.length && !cards) return null;
  const lines: string[] = [];
  if (soon.length) {
    lines.push("📝 " + t(user, "<b>Завтра или раньше сдавать</b>"));
    for (const a of soon) lines.push(`${esc(courseName(courses, a.course_id))} · ${esc(a.title)}: ${dueLabel(user, a.due_date, today)}`);
  }
  // Без счётчиков долга: только «готово» или «сделано».
  if (cards) {
    if (soon.length) lines.push("");
    lines.push("🃏 " + cardsLine(user, cards));
  }
  const keyboard = [
    ...(soon.length ? doneButtons(soon, courses) : []),
    ...(cards === "ready" ? [[{ text: "🃏 " + t(user, "Карточки"), callback_data: "fc:go" }]] : []),
  ];
  return { text: lines.join("\n").trim(), keyboard: keyboard.length ? keyboard : undefined };
}

/** /study: две недели вперёд. */
export async function studyOverview(user: User): Promise<{ text: string; keyboard?: Keyboard }> {
  const today = localNow(user.tz).date;
  const [courses, hw, exams] = await Promise.all([
    coursesOf(user.id),
    upcomingAssignments(user, 14),
    upcomingExams(user, 30),
  ]);
  const lines = ["📚 " + t(user, "<b>Учёба</b>")];
  lines.push(
    "",
    hw.length ? t(user, "<b>Дедлайны (2 недели)</b>") : t(user, "Дедлайнов на 2 недели нет."),
  );
  for (const a of hw) lines.push(`${esc(courseName(courses, a.course_id))} · ${esc(a.title)}: ${dueLabel(user, a.due_date, today)}`);
  if (exams.length) {
    lines.push("", t(user, "<b>Контрольные (месяц)</b>"));
    for (const e of exams) lines.push(esc(examLine(user, e, courses, today)));
  }
  return { text: lines.join("\n"), keyboard: hw.length ? doneButtons(hw, courses) : undefined };
}

export async function markAssignmentDone(user: User, id: string): Promise<string> {
  const { count } = await db.from("assignments").update(
    { status: "done", done_at: new Date().toISOString() },
    { count: "exact" },
  ).eq("id", id).eq("user_id", user.id).eq("status", "todo");
  return count ? t(user, "Отмечено как сданное") : t(user, "Уже отмечено");
}

// ------------------------------------------------------------- фокус ---

export async function startFocus(user: User, args: string): Promise<void> {
  const running = check(
    await db.from("focus_sessions").select("id").eq("user_id", user.id).eq("status", "running").limit(1),
  ) as unknown[];
  if (running.length) {
    await send(user.tg_id, t(user, "Фокус уже идёт. Сначала останови текущий."));
    return;
  }
  const courses = [...(await coursesOf(user.id)).values()];
  let minutes = 25;
  let course: Course | undefined;
  for (const tok of args.split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(tok)) minutes = Number(tok);
    else {
      const t = tok.toLowerCase();
      course = courses.find((c) => c.code.toLowerCase() === t || c.short.toLowerCase().startsWith(t));
    }
  }
  await startFocusWith(user, minutes, course);
}

/** Запуск фокуса (из чата или из приложения). false — уже идёт другой. */
export async function startFocusWith(user: User, rawMinutes: number, course?: Course): Promise<boolean> {
  const busy = check(
    await db.from("focus_sessions").select("id").eq("user_id", user.id).eq("status", "running").limit(1),
  ) as unknown[];
  if (busy.length) return false;
  const minutes = Math.min(180, Math.max(5, Math.round(rawMinutes) || 25));
  const row = check(
    await db.from("focus_sessions").insert({
      user_id: user.id,
      planned_min: minutes,
      course_id: course?.id ?? null,
    }).select("id,started_at").single(),
  ) as { id: string; started_at: string };
  const until = fmtTime(new Date(Date.parse(row.started_at) + minutes * 60_000), user.tz);
  const policy = course?.ai_policy === "banned"
    ? "\n" + t(user, "По этому курсу ИИ запрещён во всех заданиях: работаешь сам.")
    : "";
  const msgId = await send(
    user.tg_id,
    "⏱ " + t(user, "<b>Фокус {n} мин</b>", { n: minutes }) +
      (course ? `: ${esc(course.short)}` : "") +
      " " + t(user, "До {time}.", { time: until }) +
      "\n" + t(user, "Телефон экраном вниз.") + policy,
    [[{ text: "⏹ " + t(user, "Стоп"), callback_data: `fs:${row.id}` }]],
  );
  check(await db.from("focus_sessions").update({ tg_message_id: msgId }).eq("id", row.id));
  return true;
}

async function focusToday(user: User): Promise<number> {
  const { from, to } = dayBounds(localNow(user.tz).date, user.tz);
  const rows = check(
    await db.from("focus_sessions").select("minutes").eq("user_id", user.id).neq("status", "running")
      .gte("started_at", from.toISOString()).lt("started_at", to.toISOString()),
  ) as { minutes: number | null }[];
  return rows.reduce((a, r) => a + (r.minutes ?? 0), 0);
}

type FocusRow = { id: string; user_id: string; planned_min: number; started_at: string; tg_message_id: number | null; status: string };

async function finishFocus(user: User, f: FocusRow, stopped: boolean) {
  const elapsed = Math.floor((Date.now() - Date.parse(f.started_at)) / 60_000);
  const minutes = stopped ? Math.min(elapsed, f.planned_min) : f.planned_min;
  const { count } = await db.from("focus_sessions").update({
    status: stopped ? "stopped" : "done",
    ended_at: new Date().toISOString(),
    minutes,
  }, { count: "exact" }).eq("id", f.id).eq("status", "running");
  if (!count) return; // уже закрыт параллельно
  if (f.tg_message_id) await dropKeyboard(user.tg_id, f.tg_message_id);
  const total = await focusToday(user);
  await send(
    user.tg_id,
    stopped
      ? "⏹ " + t(user, "Фокус остановлен: {n} мин. Сегодня всего {total} мин.", { n: minutes, total })
      : "✅ " +
        t(user, "Фокус {n} мин закончен. Сегодня всего {total} мин. Перерыв 5 минут, потом /focus.", {
          n: minutes,
          total,
        }),
  );
}

export async function stopFocus(user: User, id: string): Promise<string> {
  const f = check(
    await db.from("focus_sessions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
  ) as FocusRow | null;
  if (!f || f.status !== "running") return t(user, "Уже закончен");
  await finishFocus(user, f, true);
  return t(user, "Остановлено");
}

/** Из планировщика: закрыть фокус-сессии, у которых вышло время. */
export async function finishDueFocus(user: User) {
  const running = check(
    await db.from("focus_sessions").select("*").eq("user_id", user.id).eq("status", "running"),
  ) as FocusRow[];
  for (const f of running) {
    if (Date.parse(f.started_at) + f.planned_min * 60_000 <= Date.now()) await finishFocus(user, f, false);
  }
}

// ------------------------------------------------------- для коуча ---

export async function studyFacts(user: User): Promise<string[]> {
  const today = localNow(user.tz).date;
  const [courses, hw, exams, classes] = await Promise.all([
    coursesOf(user.id),
    upcomingAssignments(user, 7),
    upcomingExams(user, 14),
    classesOn(user, today),
  ]);
  const lines: string[] = [];
  if (classes.length) {
    lines.push(t(user, "Пары сегодня: {n}, последняя до {time}.", {
      n: classes.length,
      time: fmtTime(new Date(classes[classes.length - 1].ends_at), user.tz),
    }));
  }
  if (hw.length) {
    lines.push(t(user, "Дедлайны: {list}.", {
      list: hw.map((a) =>
        `${courseName(courses, a.course_id)} «${a.title}» ${dueLabel(user, a.due_date, today)}`
      ).join("; "),
    }));
  }
  if (exams.length) {
    lines.push(t(user, "Контрольные: {list}.", {
      list: exams.map((e) => examLine(user, e, courses, today)).join("; "),
    }));
  }
  const policy = (p: string) => [...courses.values()].filter((c) => c.ai_policy === p).map((c) => c.short);
  const banned = policy("banned");
  const own = policy("own_work");
  if (banned.length) lines.push(t(user, "Курсы с запретом ИИ: {list}.", { list: banned.join(", ") }));
  if (own.length) {
    lines.push(t(user, "Курсы «только своя работа» (объяснять можно, решать за него нельзя): {list}.", {
      list: own.join(", "),
    }));
  }
  return lines;
}

/** Для недельного разбора. */
export async function weekStudySummary(user: User, from: Date, to: Date): Promise<string | null> {
  const [focusRes, reviewsRes, hw] = await Promise.all([
    db.from("focus_sessions").select("minutes").eq("user_id", user.id).neq("status", "running")
      .gte("started_at", from.toISOString()).lt("started_at", to.toISOString()),
    db.from("flashcard_reviews").select("correct").eq("user_id", user.id)
      .gte("reviewed_at", from.toISOString()).lt("reviewed_at", to.toISOString()),
    upcomingAssignments(user, 7),
  ]);
  const focus = (check(focusRes) as { minutes: number | null }[]).reduce((a, r) => a + (r.minutes ?? 0), 0);
  const reviews = check(reviewsRes) as { correct: boolean }[];
  const right = reviews.filter((r) => r.correct).length;
  const parts = [
    t(user, "фокус {h} ч {m} м", { h: Math.floor(focus / 60), m: focus % 60 }),
    reviews.length
      ? t(user, "карточки {right}/{all}", { right, all: reviews.length })
      : t(user, "карточки не повторялись"),
    hw.length ? t(user, "на следующей неделе сдать: {n}", { n: hw.length }) : null,
  ].filter(Boolean);
  return "📚 " + t(user, "Учёба: {list}.", { list: parts.join(", ") });
}
