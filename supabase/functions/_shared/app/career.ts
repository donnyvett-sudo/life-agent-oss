// Карьера для Mini App: проекты, вехи, активность на GitHub.
import { check, db, type User } from "../db.ts";
import { commitStreak, githubDays, hasGithub, type Milestone, projectsOf } from "../career.ts";
import { localNow, shiftDate } from "../time.ts";
import { HttpError } from "./finance.ts";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["idea", "active", "paused", "done"];
const GRAPH_WEEKS = 26;

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
function reqText(v: unknown, max: number, name: string): string {
  const t = optText(v, max);
  if (!t) throw new HttpError(400, `bad ${name}`);
  return t;
}

async function ownProject(user: User, id: unknown): Promise<string> {
  const { data } = await db.from("projects").select("id").eq("id", String(id ?? ""))
    .eq("user_id", user.id).maybeSingle();
  if (!data) throw new HttpError(400, "bad project");
  return (data as { id: string }).id;
}

export async function careerOverview(user: User) {
  const today = localNow(user.tz).date;
  // Полоса активности всегда кончается сегодня и начинается с понедельника — так её читать привычно.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const from = shiftDate(today, -(GRAPH_WEEKS * 7 - 1 - (dow === 0 ? 0 : 7 - dow)));

  const [projects, msRes, days, streak] = await Promise.all([
    projectsOf(user.id),
    db.from("milestones").select("*").eq("user_id", user.id).order("sort").order("due_date", {
      ascending: true,
      nullsFirst: false,
    }),
    hasGithub(user) ? githubDays(user.id, from, today) : Promise.resolve([]),
    hasGithub(user) ? commitStreak(user) : Promise.resolve(0),
  ]);
  const milestones = check(msRes) as Milestone[];

  const week = days.filter((d) => d.date > shiftDate(today, -7));
  return {
    today,
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      goal: p.goal,
      status: p.status,
      repo: p.repo,
      dueDate: p.due_date,
      milestones: milestones.filter((m) => m.project_id === p.id).map((m) => ({
        id: m.id,
        title: m.title,
        dueDate: m.due_date,
        done: m.status === "done",
        doneAt: m.done_at,
      })),
    })),
    github: hasGithub(user)
      ? {
        from,
        days: days.map((d) => ({ date: d.date, count: d.contributions })),
        streak,
        weekActive: week.filter((d) => d.contributions > 0).length,
      }
      : null,
  };
}

export async function saveProject(user: User, id: string | null, body: Body) {
  const status = body.status === undefined ? "active" : String(body.status);
  if (!STATUSES.includes(status)) throw new HttpError(400, "bad status");
  const row = {
    user_id: user.id,
    title: reqText(body.title, 120, "title"),
    goal: optText(body.goal, 300),
    status,
    repo: optText(body.repo, 120),
    due_date: optDate(body.dueDate, "dueDate"),
    sort: Number(body.sort) || 0,
  };
  const res = id
    ? await db.from("projects").update(row).eq("id", id).eq("user_id", user.id).select("id").single()
    : await db.from("projects").insert(row).select("id").single();
  if (res.error) throw new HttpError(400, res.error.message);
  return { id: (res.data as { id: string }).id };
}

export async function deleteProject(user: User, id: string) {
  // Вехи уходят вместе с проектом (on delete cascade).
  const { count } = await db.from("projects").delete({ count: "exact" })
    .eq("id", id).eq("user_id", user.id);
  if (!count) throw new HttpError(404, "no project");
  return { ok: true };
}

export async function saveMilestone(user: User, id: string | null, body: Body) {
  const done = body.done === true;
  const base = {
    title: reqText(body.title, 160, "title"),
    due_date: optDate(body.dueDate, "dueDate"),
    status: done ? "done" : "todo",
    done_at: done ? new Date().toISOString() : null,
    sort: Number(body.sort) || 0,
  };
  const res = id
    ? await db.from("milestones").update(base).eq("id", id).eq("user_id", user.id).select("id").single()
    : await db.from("milestones").insert({
      ...base,
      user_id: user.id,
      project_id: await ownProject(user, body.projectId),
    }).select("id").single();
  if (res.error) throw new HttpError(400, res.error.message);
  return { id: (res.data as { id: string }).id };
}

export async function deleteMilestone(user: User, id: string) {
  const { count } = await db.from("milestones").delete({ count: "exact" })
    .eq("id", id).eq("user_id", user.id);
  if (!count) throw new HttpError(404, "no milestone");
  return { ok: true };
}
