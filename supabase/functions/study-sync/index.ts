// Синхронизация из Study Agent (tools/life_sync.py). Авторизация — личный токен (X-Token).
// Правила слияния: статус «сдано» из бота не откатывается; прогресс карточек не трогаем;
// будущие занятия из Study Agent, которых больше нет в его файлах, удаляются.
import { nextIntroOrder } from "../_shared/cards.ts";
import { check, db, type User } from "../_shared/db.ts";
import { findByToken } from "../_shared/users.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

// deno-lint-ignore no-explicit-any
type Item = Record<string, any>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === "string" && ISO_DATE.test(v) ? v : null);
const text = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const list = (v: unknown): Item[] => (Array.isArray(v) ? v.slice(0, 2000) : []);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const user = await findByToken(req.headers.get("x-token"));
  if (!user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null) as Item | null;
  if (!body) return json({ error: "bad json" }, 400);
  try {
    return json({ ok: true, ...(await sync(user, body)) });
  } catch (e) {
    console.error("study-sync", e);
    return json({ error: String(e) }, 500);
  }
});

async function sync(user: User, body: Item) {
  const uid = user.id;

  // Курсы
  const courses = list(body.courses).filter((c) => text(c.code, 40));
  if (courses.length) {
    check(
      await db.from("courses").upsert(
        courses.map((c) => ({
          user_id: uid,
          code: text(c.code, 40),
          title: text(c.title, 120) ?? c.code,
          short: text(c.short, 30) ?? c.code,
          ai_policy: ["banned", "own_work"].includes(c.aiPolicy) ? c.aiPolicy : "none",
          sort: Number(c.sort) || 0,
        })),
        { onConflict: "user_id,code" },
      ),
    );
  }
  const courseRows = check(await db.from("courses").select("id,code").eq("user_id", uid)) as { id: string; code: string }[];
  const courseId = new Map(courseRows.map((c) => [c.code, c.id]));

  // Задания: «сдано» в боте сильнее, чем «не сдано» в файле.
  const hw = list(body.assignments).filter((a) => text(a.externalId, 120) && text(a.title, 200));
  const existing = new Map(
    (check(
      await db.from("assignments").select("external_id,status").eq("user_id", uid).in(
        "external_id",
        hw.map((a) => a.externalId),
      ),
    ) as { external_id: string; status: string }[]).map((r) => [r.external_id, r.status]),
  );
  if (hw.length) {
    check(
      await db.from("assignments").upsert(
        hw.map((a) => {
          const done = a.done === true || existing.get(a.externalId) === "done";
          return {
            user_id: uid,
            external_id: a.externalId,
            course_id: courseId.get(a.course) ?? null,
            title: text(a.title, 200),
            details: text(a.details),
            due_date: date(a.dueDate),
            due_note: text(a.dueNote, 300),
            status: done ? "done" : "todo",
            source: "study-agent",
          };
        }),
        { onConflict: "user_id,external_id" },
      ),
    );
  }

  // Экзамены
  const exams = list(body.exams).filter((e) => text(e.externalId, 120) && text(e.title, 120));
  if (exams.length) {
    check(
      await db.from("exams").upsert(
        exams.map((e) => ({
          user_id: uid,
          external_id: e.externalId,
          course_id: courseId.get(e.course) ?? null,
          kind: ["quiz", "final", "presentation"].includes(e.kind) ? e.kind : "other",
          title: text(e.title, 120),
          topic: text(e.topic, 300),
          date: date(e.date),
          date_to: date(e.dateTo),
          is_tentative: Boolean(e.tentative),
          notes: text(e.notes, 1000),
          source: "study-agent",
        })),
        { onConflict: "user_id,external_id" },
      ),
    );
  }

  // Занятия: полный список из файлов; будущие, пропавшие из файлов, удаляем.
  const sessions = list(body.sessions).filter((s) =>
    text(s.externalId, 120) && !isNaN(Date.parse(s.startsAt)) && !isNaN(Date.parse(s.endsAt))
  );
  if (sessions.length) {
    check(
      await db.from("class_sessions").upsert(
        sessions.map((s) => ({
          user_id: uid,
          external_id: s.externalId,
          course_id: courseId.get(s.course) ?? null,
          kind: s.kind === "lab" ? "lab" : s.kind === "other" ? "other" : "lecture",
          title: text(s.title, 200),
          starts_at: new Date(s.startsAt).toISOString(),
          ends_at: new Date(s.endsAt).toISOString(),
          room: text(s.room, 40),
          source: "study-agent",
        })),
        { onConflict: "user_id,external_id" },
      ),
    );
  }
  const keep = new Set(sessions.map((s) => s.externalId));
  const future = check(
    await db.from("class_sessions").select("id,external_id").eq("user_id", uid).eq("source", "study-agent")
      .gt("starts_at", new Date().toISOString()),
  ) as { id: string; external_id: string }[];
  const stale = future.filter((s) => !keep.has(s.external_id)).map((s) => s.id);
  if (stale.length) check(await db.from("class_sessions").delete().in("id", stale));

  // Карточки: только новые (прогресс повторения и статус живут в боте). Новые встают в очередь
  // ввода после всех остальных; у уже существующих intro_order не меняется (строка не вставится).
  const cards = list(body.cards).filter((c) => text(c.externalId, 120) && text(c.front, 100) && text(c.meaning, 300));
  let newCards = 0;
  if (cards.length) {
    const order = await nextIntroOrder(uid);
    const res = await db.from("flashcards").upsert(
      cards.map((c, i) => ({
        user_id: uid,
        external_id: c.externalId,
        deck: text(c.deck, 40) ?? "chinese1",
        front: text(c.front, 100),
        reading: text(c.reading, 100),
        meaning: text(c.meaning, 300),
        example: text(c.example, 300),
        lesson: text(c.lesson, 40),
        box: Math.min(5, Math.max(1, Number(c.box) || 1)),
        next_review: date(c.nextReview) ?? new Date().toISOString().slice(0, 10),
        status: "new",
        intro_order: order + i,
      })),
      { onConflict: "user_id,external_id", ignoreDuplicates: true },
    ).select("id");
    newCards = (check(res) ?? []).length;
  }

  return {
    courses: courses.length,
    assignments: hw.length,
    exams: exams.length,
    sessions: sessions.length,
    removedSessions: stale.length,
    newCards,
  };
}
