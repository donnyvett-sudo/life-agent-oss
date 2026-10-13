// Карьера: проекты, вехи и активность на GitHub. Без ИИ.
// Штрафов здесь нет намеренно: неделя без коммитов часто значит «думаю», а не «ленюсь».
import { check, db, type User } from "./db.ts";
import { esc, type Keyboard } from "./telegram.ts";
import { daysUntil, dueLabel, localNow, shiftDate } from "./time.ts";
import { t } from "./i18n.ts";

export type Project = {
  id: string;
  title: string;
  goal: string | null;
  status: "idea" | "active" | "paused" | "done";
  repo: string | null;
  due_date: string | null;
  sort: number;
};

export type Milestone = {
  id: string;
  project_id: string;
  title: string;
  due_date: string | null;
  status: "todo" | "done";
  done_at: string | null;
  sort: number;
};

const STATUS_LABEL: Record<Project["status"], string> = {
  idea: "идея",
  active: "в работе",
  paused: "пауза",
  done: "готов",
};

export async function projectsOf(userId: string): Promise<Project[]> {
  return check(
    await db.from("projects").select("*").eq("user_id", userId).order("sort").order("created_at"),
  ) as Project[];
}

/** Незакрытые вехи со сроком до today+days, вместе с просроченными. Без срока — не тянем. */
export async function upcomingMilestones(user: User, days: number): Promise<Milestone[]> {
  const today = localNow(user.tz).date;
  return check(
    await db.from("milestones").select("*").eq("user_id", user.id).eq("status", "todo")
      .not("due_date", "is", null).lte("due_date", shiftDate(today, days)).order("due_date"),
  ) as Milestone[];
}

export async function markMilestoneDone(user: User, id: string): Promise<string> {
  const { data } = await db.from("milestones")
    .update({ status: "done", done_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", user.id).eq("status", "todo").select("title").single();
  return data
    ? t(user, "Веха закрыта: {title}", { title: (data as { title: string }).title })
    : t(user, "Уже отмечено");
}

// ---------------------------------------------------------- GitHub ---

const SERVER_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? null;
/** Серверный токен — это токен владельца; остальные подключают свой в приложении. */
export const hasServerGithub = !!SERVER_TOKEN;
export const githubToken = (user: User): string | null =>
  user.github_token || (user.is_owner ? SERVER_TOKEN : null);
/** Без токена блок GitHub просто не показывается: остальная карьера работает. */
export const hasGithub = (user: User): boolean => !!githubToken(user);

type CalendarDay = { date: string; contributionCount: number };

/** Проверка токена при подключении: возвращает логин аккаунта или null, если токен не годится. */
export async function githubLogin(token: string): Promise<string | null> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "life-coach-bot",
    },
    body: JSON.stringify({ query: "query { viewer { login } }" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = await res.json() as { data?: { viewer?: { login?: string } } };
  return json.data?.viewer?.login ?? null;
}

/**
 * Граф контрибуций через GraphQL: `viewer` — владелец токена, поэтому логин знать не нужно,
 * а приватные репозитории попадают в счёт (свою активность видно всю).
 */
async function fetchCalendar(token: string, from: Date, to: Date): Promise<CalendarDay[]> {
  const query = `query($from: DateTime!, $to: DateTime!) {
    viewer { contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    } }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "life-coach-bot",
    },
    body: JSON.stringify({ query, variables: { from: from.toISOString(), to: to.toISOString() } }),
  });
  if (!res.ok) throw new Error(`github ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json() as {
    data?: { viewer?: { contributionsCollection: { contributionCalendar: { weeks: { contributionDays: CalendarDay[] }[] } } } };
    errors?: { message: string }[];
  };
  if (json.errors?.length) throw new Error(`github: ${json.errors.map((e) => e.message).join("; ")}`);
  const weeks = json.data?.viewer?.contributionsCollection.contributionCalendar.weeks ?? [];
  return weeks.flatMap((w) => w.contributionDays);
}

/**
 * Перезаписать последние days дней графа. Если истории ещё нет, тянем сразу полгода:
 * полоса в приложении показывает 26 недель, и пустой она выглядела бы как провал.
 */
export async function syncGithub(user: User, days = 30): Promise<number> {
  const token = githubToken(user);
  if (!token) return 0;
  const to = new Date();
  const { count } = await db.from("github_days").select("date", { count: "exact", head: true })
    .eq("user_id", user.id);
  const from = new Date(to.getTime() - (count ? days : 190) * 86_400_000);
  const cal = await fetchCalendar(token, from, to);
  if (!cal.length) return 0;
  const rows = cal.map((d) => ({
    user_id: user.id,
    date: d.date,
    contributions: d.contributionCount,
    synced_at: to.toISOString(),
  }));
  check(await db.from("github_days").upsert(rows, { onConflict: "user_id,date" }).select("date"));
  return rows.length;
}

export async function githubDays(userId: string, from: string, to: string) {
  return check(
    await db.from("github_days").select("date,contributions").eq("user_id", userId)
      .gte("date", from).lte("date", to).order("date"),
  ) as { date: string; contributions: number }[];
}

/**
 * Дней подряд с коммитами. Сегодняшний день ещё не кончился, поэтому пустое сегодня
 * серию не рвёт: считаем от сегодня, если коммиты есть, иначе от вчера.
 */
export async function commitStreak(user: User): Promise<number> {
  const today = localNow(user.tz).date;
  const rows = await githubDays(user.id, shiftDate(today, -120), today);
  const byDate = new Map(rows.map((r) => [r.date, r.contributions]));
  let day = (byDate.get(today) ?? 0) > 0 ? today : shiftDate(today, -1);
  let streak = 0;
  while ((byDate.get(day) ?? 0) > 0) {
    streak++;
    day = shiftDate(day, -1);
  }
  return streak;
}

// -------------------------------------------------------- сообщения ---

function milestoneLine(user: User, m: Milestone, projects: Map<string, Project>, today: string): string {
  const p = projects.get(m.project_id);
  return `${p ? `${esc(p.title)}: ` : ""}${esc(m.title)} — ${dueLabel(user, m.due_date, today)}`;
}

/** Блок карьеры для утреннего сообщения: только вехи ближе трёх дней, иначе это шум. */
export async function morningCareer(user: User): Promise<{ text: string; keyboard?: Keyboard } | null> {
  const today = localNow(user.tz).date;
  const near = await upcomingMilestones(user, 3);
  if (!near.length) return null;
  const projects = new Map((await projectsOf(user.id)).map((p) => [p.id, p]));
  return {
    text: "🛠 " + t(user, "Вехи:") + "\n" +
      near.map((m) => `• ${milestoneLine(user, m, projects, today)}`).join("\n"),
    keyboard: near.slice(0, 3).map((m) => [{ text: `✅ ${m.title}`, callback_data: `ms:${m.id}` }]),
  };
}

/** /work: проекты, ближайшие вехи, активность. */
export async function careerOverview(user: User): Promise<{ text: string; keyboard?: Keyboard }> {
  const today = localNow(user.tz).date;
  const [projects, near, streak] = await Promise.all([
    projectsOf(user.id),
    upcomingMilestones(user, 30),
    commitStreak(user),
  ]);
  const live = projects.filter((p) => p.status !== "done");
  if (!live.length && !near.length) {
    return { text: t(user, "Проектов пока нет. Добавь их в приложении, на вкладке «Дело».") };
  }

  const byId = new Map(projects.map((p) => [p.id, p]));
  const lines: string[] = [t(user, "<b>Дело</b>")];
  for (const p of live) {
    const own = near.filter((m) => m.project_id === p.id);
    const tail = p.due_date
      ? t(user, ", срок {due}", { due: dueLabel(user, p.due_date, today) })
      : "";
    lines.push(`\n<b>${esc(p.title)}</b> — ${t(user, STATUS_LABEL[p.status])}${tail}`);
    if (p.goal) lines.push(`<i>${esc(p.goal)}</i>`);
    for (const m of own) lines.push(`• ${esc(m.title)} — ${dueLabel(user, m.due_date, today)}`);
  }
  const orphan = near.filter((m) => !byId.has(m.project_id));
  for (const m of orphan) lines.push(`• ${milestoneLine(user, m, byId, today)}`);

  if (hasGithub(user)) {
    const week = await githubDays(user.id, shiftDate(today, -6), today);
    const active = week.filter((d) => d.contributions > 0).length;
    lines.push(
      "\n💻 " + t(user, "GitHub: {n} из 7 дней с коммитами", { n: active }) +
        (streak ? t(user, ", серия {n} дн.", { n: streak }) : ""),
    );
  }

  return {
    text: lines.join("\n"),
    keyboard: near.slice(0, 3).map((m) => [{ text: `✅ ${m.title}`, callback_data: `ms:${m.id}` }]),
  };
}

/** Для недельного разбора. */
export async function weekCareerSummary(user: User, from: Date, to: Date): Promise<string | null> {
  const today = localNow(user.tz).date;
  const [projects, doneRes] = await Promise.all([
    projectsOf(user.id),
    db.from("milestones").select("title").eq("user_id", user.id).eq("status", "done")
      .gte("done_at", from.toISOString()).lt("done_at", to.toISOString()),
  ]);
  const live = projects.filter((p) => p.status === "active");
  if (!live.length) return null;

  const done = check(doneRes) as { title: string }[];
  const days = hasGithub(user)
    ? await githubDays(user.id, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
    : [];
  const active = days.filter((d) => d.contributions > 0).length;
  const parts = [
    hasGithub(user) ? t(user, "{n} дн. с коммитами", { n: active }) : null,
    done.length ? t(user, "закрыто вех: {n}", { n: done.length }) : t(user, "вех не закрыто"),
  ].filter(Boolean);

  // Застрявший проект: активен, вехи есть, но ни одна не закрыта и коммитов не было.
  const stuck = !done.length && !active && hasGithub(user) ? live[0] : null;
  const tail = stuck
    ? " " + t(user, "Что с «{title}»? Неделя прошла мимо него.", { title: esc(stuck.title) })
    : "";
  const overdue = (await upcomingMilestones(user, 0)).filter((m) => daysUntil(m.due_date!, today) < 0);
  const late = overdue.length ? " " + t(user, "Просрочено вех: {n}.", { n: overdue.length }) : "";
  return "🛠 " + t(user, "Дело: {list}.", { list: parts.join(", ") }) + late + tail;
}

export async function careerFacts(user: User): Promise<string[]> {
  const today = localNow(user.tz).date;
  const [projects, near, streak] = await Promise.all([
    projectsOf(user.id),
    upcomingMilestones(user, 14),
    commitStreak(user),
  ]);
  const active = projects.filter((p) => p.status === "active");
  const lines: string[] = [];
  if (active.length) {
    lines.push(t(user, "Проекты в работе: {list}.", { list: active.map((p) => p.title).join(", ") }));
  }
  if (near.length) {
    const byId = new Map(projects.map((p) => [p.id, p]));
    lines.push(t(user, "Вехи: {list}.", {
      list: near.map((m) => {
        const p = byId.get(m.project_id);
        return `${p ? `${p.title} ` : ""}«${m.title}» ${dueLabel(user, m.due_date, today)}`;
      }).join("; "),
    }));
  }
  if (hasGithub(user) && streak) lines.push(t(user, "Дней подряд с коммитами: {n}.", { n: streak }));
  return lines;
}
