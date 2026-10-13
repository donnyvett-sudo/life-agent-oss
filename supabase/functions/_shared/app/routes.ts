// Маршруты Mini App: HTTP-обёртка в api/index.ts, чат-агент в _shared/agent.ts —
// оба ходят сюда, чтобы правила и проверки были в одном месте.
import { bodyOn, lastWeight, saveWeight, STEP_GOAL } from "../body.ts";
import { budgetStatus } from "../budget.ts";
import { getSleep, judgeNight, openDebts, resolveLedger } from "../coach.ts";
import { subscriptions } from "../subs.ts";
import { check, db, type Supplement, type User, userCurrency } from "../db.ts";
import { MINIAPP_URL } from "../config.ts";
import { convert, CURRENCIES } from "../finance.ts";
import { setupChat } from "../telegram.ts";
import { githubLogin, hasServerGithub, syncGithub } from "../career.ts";
import { type Lang, lang as userLang } from "../i18n.ts";
import { aiLeft, DAILY_AI } from "../quota.ts";
import { logSupplement, refillSupplement } from "../supplements.ts";
import { dayBounds, fmtTime, localNow, shiftDate } from "../time.ts";
import {
  createTransfer,
  createTx,
  deleteBudget,
  deleteTransfer,
  financeOverview,
  HttpError,
  saveBudget,
  saveAccount,
  saveCategory,
  toSort,
  updateTx,
} from "./finance.ts";
import { createMeal, deleteDish, deleteMeal, foodDay, foodHistory, listDishes, patchMeal, putTargets, saveDish } from "./food.ts";
import { careerOverview, deleteMilestone, deleteProject, saveMilestone, saveProject } from "./career.ts";
import {
  classesOn,
  habitsOn,
  HOME_PANELS,
  homePanels,
  milestonesSoon,
  saveHomePanels,
  studySoon,
} from "./home.ts";
import { deleteHabit, habitsOverview, saveHabit, toggleHabitDay } from "./habits.ts";
import {
  deleteAssignment,
  deleteExam,
  saveAssignment,
  saveExam,
  startFocusFromApp,
  stopFocusFromApp,
  saveCard,
  deleteCard,
  studyOverview,
} from "./study.ts";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

export async function route(user: User, method: string, path: string, q: URLSearchParams, body: Body) {
  let m: RegExpMatchArray | null;
  if (method === "GET" && path === "/today") return today(user, q.get("date"));
  if (method === "PUT" && path === "/home") {
    await saveHomePanels(user, body);
    return today(user, body.date);
  }
  if (method === "GET" && path === "/sleep") return sleepHistory(user, Number(q.get("days") ?? 30));
  if (method === "GET" && path === "/settings") return settings(user);
  if (method === "PUT" && path === "/settings") return updateSettings(user, body);
  if (method === "PUT" && path === "/settings/github") return connectGithub(user, body);
  if (method === "DELETE" && path === "/settings/github") return disconnectGithub(user);

  if (method === "POST" && path === "/supplements") return createSupplement(user, body);
  if ((m = path.match(/^\/supplements\/([0-9a-f-]{36})(\/\w+)?$/))) {
    const [, id, action] = m;
    if (method === "PATCH" && !action) return updateSupplement(user, id, body);
    if (method === "DELETE" && !action) return updateSupplement(user, id, { active: false });
    if (method === "POST" && action === "/log") {
      const status = body.status === "taken" || body.status === "skipped" ? body.status : null;
      const date = pastDate(user, body.date);
      await logSupplement(user, id, status, date);
      return today(user, date);
    }
    if (method === "POST" && action === "/refill") {
      await refillSupplement(user, id);
      return today(user, q.get("date"));
    }
  }
  if (method === "POST" && (m = path.match(/^\/ledger\/([0-9a-f-]{36})\/(done|use)$/))) {
    await resolveLedger(user, m[1], m[2] === "done" ? "penalty" : "reward");
    return today(user);
  }
  if (method === "DELETE" && (m = path.match(/^\/transactions\/([0-9a-f-]{36})$/))) {
    check(await db.from("transactions").delete().eq("id", m[1]).eq("user_id", user.id));
    return today(user, q.get("date"));
  }

  // Финансы
  if (method === "GET" && path === "/finance") return financeOverview(user, q.get("month"), q.get("currency"));
  if (method === "GET" && path === "/finance/sort") return toSort(user, q.get("limit"));
  if (method === "POST" && path === "/transactions") return createTx(user, body);
  if (method === "PATCH" && (m = path.match(/^\/transactions\/([0-9a-f-]{36})$/))) return updateTx(user, m[1], body);
  if (method === "POST" && path === "/transfers") return createTransfer(user, body);
  if (method === "DELETE" && (m = path.match(/^\/transfers\/([0-9a-f-]{36})$/))) return deleteTransfer(user, m[1]);
  if (method === "POST" && path === "/accounts") return saveAccount(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/accounts\/([0-9a-f-]{36})$/))) return saveAccount(user, m[1], body);
  if (method === "GET" && path === "/subscriptions") return subscriptions(user);
  if (method === "GET" && path === "/budgets") return budgetStatus(user, q.get("month") ?? undefined);
  if (method === "POST" && path === "/budgets") return saveBudget(user, body);
  if (method === "DELETE" && (m = path.match(/^\/budgets\/([0-9a-f-]{36})$/))) return deleteBudget(user, m[1]);
  if (method === "POST" && path === "/categories") return saveCategory(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/categories\/([0-9a-f-]{36})$/))) return saveCategory(user, m[1], body);

  // Учёба
  if (method === "GET" && path === "/study") return studyOverview(user, q.get("week"));
  if (method === "POST" && path === "/assignments") return saveAssignment(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/assignments\/([0-9a-f-]{36})$/))) return saveAssignment(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/assignments\/([0-9a-f-]{36})$/))) return deleteAssignment(user, m[1]);
  if (method === "POST" && path === "/exams") return saveExam(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/exams\/([0-9a-f-]{36})$/))) return saveExam(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/exams\/([0-9a-f-]{36})$/))) return deleteExam(user, m[1]);
  if (method === "POST" && path === "/cards") return saveCard(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/cards\/([0-9a-f-]{36})$/))) return saveCard(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/cards\/([0-9a-f-]{36})$/))) return deleteCard(user, m[1]);
  if (method === "POST" && path === "/focus") return startFocusFromApp(user, body);
  if (method === "POST" && (m = path.match(/^\/focus\/([0-9a-f-]{36})\/stop$/))) return stopFocusFromApp(user, m[1]);

  // Карьера
  if (method === "GET" && path === "/career") return careerOverview(user);
  if (method === "POST" && path === "/projects") return saveProject(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/projects\/([0-9a-f-]{36})$/))) return saveProject(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/projects\/([0-9a-f-]{36})$/))) return deleteProject(user, m[1]);
  if (method === "POST" && path === "/milestones") return saveMilestone(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/milestones\/([0-9a-f-]{36})$/))) return saveMilestone(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/milestones\/([0-9a-f-]{36})$/))) return deleteMilestone(user, m[1]);
  // Образ жизни
  if (method === "GET" && path === "/habits") return habitsOverview(user);
  if (method === "POST" && path === "/habits") return saveHabit(user, null, body);
  if (method === "PATCH" && (m = path.match(/^\/habits\/([0-9a-f-]{36})$/))) return saveHabit(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/habits\/([0-9a-f-]{36})$/))) return deleteHabit(user, m[1]);
  if (method === "POST" && (m = path.match(/^\/habits\/([0-9a-f-]{36})\/toggle$/))) return toggleHabitDay(user, m[1], body);
  // Отметка с главного экрана: в ответ нужен весь день, а не «ok» — экран перерисовывается целиком.
  if (method === "POST" && (m = path.match(/^\/habits\/([0-9a-f-]{36})\/log$/))) {
    await toggleHabitDay(user, m[1], body);
    return today(user, body.date);
  }

  // Еда
  if (method === "GET" && path === "/food") return foodDay(user, q.get("date"));
  if (method === "GET" && path === "/food/history") return foodHistory(user, q.get("days"));
  if (method === "PUT" && path === "/food/targets") return putTargets(user, body);
  if (method === "POST" && path === "/meals") return createMeal(user, body);
  if (method === "PATCH" && (m = path.match(/^\/meals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/))) return patchMeal(user, m[1], body);
  if (method === "DELETE" && (m = path.match(/^\/meals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/))) return deleteMeal(user, m[1]);
  if (method === "GET" && path === "/dishes") return listDishes(user);
  if (method === "POST" && path === "/dishes") return saveDish(user, body);
  if (method === "DELETE" && (m = path.match(/^\/dishes\/([^/]+)$/))) return deleteDish(user, m[1]);

  // Тело: шаги и пульс покоя приходят из «Здоровья», вес можно записать руками.
  if (method === "PUT" && path === "/body") return putWeight(user, body, q.get("date"));
  throw new HttpError(404, `no route ${method} ${path}`);
}

// ------------------------------------------------------------------- экраны ---

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DAYS = 60;

/** Дата из запроса: не в будущем и не глубже HISTORY_DAYS. Пусто → сегодня. */
export function pastDate(user: User, v: unknown): string {
  const todayDate = localNow(user.tz).date;
  if (v === undefined || v === null || v === "") return todayDate;
  if (typeof v !== "string" || !ISO_DATE.test(v)) throw new HttpError(400, "bad date");
  if (v > todayDate || v < shiftDate(todayDate, -HISTORY_DAYS)) throw new HttpError(400, "date out of range");
  return v;
}

export async function today(user: User, dateParam?: string | null) {
  const now = localNow(user.tz);
  const date = pastDate(user, dateParam);
  const isToday = date === now.date;
  const { from, to } = dayBounds(date, user.tz);
  // Панели человек выбирает сам, поэтому за скрытыми в базу не ходим.
  const home = homePanels(user);
  const on = (p: string) => home.includes(p as never);
  const none = <T>(v: T) => Promise.resolve(v);

  const [suppsRes, logsRes, txRes, sToday, sYesterday, debts, rewardsRes, bodyDay, weight, classes, habits, study, milestones] =
    await Promise.all([
      on("supplements")
        ? db.from("supplements").select("*").eq("user_id", user.id).eq("active", true).order("sort")
        : none({ data: [], error: null }),
      on("supplements")
        ? db.from("supplement_logs").select("supplement_id,status").eq("user_id", user.id).eq("local_date", date)
        : none({ data: [], error: null }),
      on("spending")
        ? db.from("transactions").select("id,note,amount,currency,amount_cny,occurred_at,categories(title)")
          .eq("user_id", user.id).eq("kind", "expense")
          .gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString())
          .order("occurred_at", { ascending: false })
        : none({ data: [], error: null }),
      on("sleep") ? getSleep(user.id, date) : none(null),
      // Сегодня сна может ещё не быть — тогда показываем прошлую ночь; для прошлых дней строго свою.
      on("sleep") && isToday ? getSleep(user.id, shiftDate(date, -1)) : none(null),
      isToday ? openDebts(user.id) : none([]),
      db.from("coach_ledger").select("id,title").eq("user_id", user.id).eq("kind", "reward")
        .eq("status", "open"),
      on("body") ? bodyOn(user, date) : none(null),
      // Вес меряют не каждый день: переносим последний известный на этот день.
      on("body") ? lastWeight(user, date) : none(null),
      on("classes") ? classesOn(user, date) : none([]),
      on("habits") ? habitsOn(user, date) : none([]),
      // Дедлайны и вехи всегда про ближайшее будущее, в прошлом дне им делать нечего.
      on("study") && isToday ? studySoon(user, date) : none([]),
      on("milestones") && isToday ? milestonesSoon(user) : none([]),
    ]);
  const supps = check(suppsRes) as Supplement[];
  const status = new Map(
    (check(logsRes) as { supplement_id: string; status: string }[]).map((l) => [
      l.supplement_id,
      l.status,
    ]),
  );
  const tx = check(txRes) as unknown as {
    id: string;
    note: string | null;
    amount: number;
    currency: string;
    amount_cny: number | null;
    occurred_at: string;
    categories: { title: string } | null;
  }[];
  const spentCny = Math.round(tx.reduce((a, t) => a + Number(t.amount_cny ?? 0), 0) * 100) / 100;
  // В базе всё сведено к юаням, показываем в валюте пользователя.
  const display = userCurrency(user);
  const spent = display === "CNY" ? spentCny : await convert(spentCny, "CNY", display, date).catch(() => null);

  const s = sToday ?? sYesterday;
  return {
    date,
    today: now.date,
    minDate: shiftDate(now.date, -HISTORY_DAYS),
    time: now.hhmm,
    schedule: user.settings.schedule,
    sleepTarget: user.settings.sleep,
    home,
    allPanels: [...HOME_PANELS],
    supplements: supps.map((x) => ({
      id: x.id,
      name: x.name,
      slot: x.slot,
      status: status.get(x.id) ?? null,
      daysLeft: x.units_left != null
        ? Math.floor(Number(x.units_left) / Number(x.units_per_intake))
        : null,
      canRefill: x.units_per_pack != null,
    })),
    sleep: s ? nightView(user, s) : null,
    body: {
      steps: bodyDay?.steps ?? null,
      restingHr: bodyDay?.resting_hr ?? null,
      stepGoal: STEP_GOAL,
      weightKg: bodyDay?.weight_kg != null ? Number(bodyDay.weight_kg) : weight?.kg ?? null,
      weightDate: bodyDay?.weight_kg != null ? date : weight?.date ?? null,
    },
    classes,
    habits,
    study,
    milestones,
    streak: Number(user.state.sleep_streak ?? 0),
    cheatToday: isToday && user.state.cheat_date === now.date,
    debts,
    rewards: isToday ? check(rewardsRes) as { id: string; title: string }[] : [],
    spending: {
      totals: tx.length ? [{ currency: spent == null ? "CNY" : display, amount: spent ?? spentCny }] : [],
      items: tx.map((t) => ({
        id: t.id,
        note: t.note ?? t.categories?.title ?? "",
        category: t.categories?.title ?? null,
        amount: Number(t.amount),
        currency: t.currency,
        time: fmtTime(new Date(t.occurred_at), user.tz),
      })),
    },
  };
}

async function putWeight(user: User, body: Body, dateParam?: string | null) {
  const kg = Number(String(body.weightKg ?? body.weight ?? "").replace(",", "."));
  if (!(kg > 20 && kg < 400)) throw new HttpError(400, "bad weight");
  const date = pastDate(user, body.date ?? dateParam);
  await saveWeight(user, kg, date);
  return today(user, date);
}

type Night = {
  night_date: string;
  bed_at: string;
  wake_at: string;
  asleep_min: number;
  deep_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  core_min?: number | null;
};

function nightView(user: User, s: Night) {
  const { verdict, notes } = judgeNight(user, s, user.settings.sleep.bed, user.tz);
  return {
    date: s.night_date,
    bed: fmtTime(new Date(s.bed_at), user.tz),
    wake: fmtTime(new Date(s.wake_at), user.tz),
    asleepMin: s.asleep_min,
    deepMin: s.deep_min,
    remMin: s.rem_min,
    coreMin: s.core_min ?? null,
    awakeMin: s.awake_min,
    verdict,
    notes: notes.map((n) => n.replace(/<[^>]+>/g, "")),
  };
}

async function sleepHistory(user: User, days: number) {
  const n = Math.min(Math.max(days || 30, 7), 90);
  const today = localNow(user.tz).date;
  const rows = check(
    await db.from("sleep_sessions").select("*").eq("user_id", user.id)
      .gte("night_date", shiftDate(today, -(n - 1))).order("night_date"),
  ) as Night[];
  return { target: user.settings.sleep, today, days: n, nights: rows.map((r) => nightView(user, r)) };
}

export async function settings(user: User) {
  const supps = check(
    await db.from("supplements").select("*").eq("user_id", user.id).order("sort"),
  ) as Supplement[];
  return {
    tz: user.tz,
    lang: userLang(user),
    profile: {
      about: user.settings.profile?.about ?? "",
      name: user.settings.profile?.name ?? user.first_name ?? "",
      currency: userCurrency(user),
      // Сам токен наружу не отдаём, только факт подключения.
      github: user.github_token ? "own" : hasServerGithub && user.is_owner ? "server" : "none",
      githubLogin: user.github_token ? user.settings.profile?.github_login ?? null : null,
    },
    schedule: user.settings.schedule,
    sleep: user.settings.sleep,
    coach: user.settings.coach,
    ai: { left: aiLeft(user), limit: DAILY_AI },
    supplements: supps.map((s) => ({
      id: s.id,
      name: s.name,
      slot: s.slot,
      active: s.active,
      unitsPerIntake: Number(s.units_per_intake),
      unitsPerPack: s.units_per_pack,
      unitsLeft: s.units_left == null ? null : Number(s.units_left),
    })),
  };
}

// ------------------------------------------------------------- изменения ---

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLOTS = ["morning", "lunch", "evening"];
const FREQUENCIES = ["quiet", "normal", "active"];
const ABOUT_MAX = 400;

/** Часовой пояс проверяем самим Intl: список зон в Deno уже есть. */
function validTz(v: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

function pickTimes<T extends Record<string, unknown>>(src: Body | undefined, keys: (keyof T)[]) {
  const out: Partial<T> = {};
  for (const k of keys) {
    const v = src?.[k as string];
    if (v === undefined) continue;
    if (typeof v !== "string" || !HHMM.test(v)) throw new HttpError(400, `bad time ${String(k)}`);
    out[k] = v as T[keyof T];
  }
  return out;
}

async function updateSettings(user: User, body: Body) {
  const s = user.settings;
  const schedule = {
    ...s.schedule,
    ...pickTimes<typeof s.schedule>(body.schedule, [
      "morning",
      "lunch_fallback",
      "evening",
      "lights_out",
      "weekly",
    ]),
  };
  if (body.schedule?.weekly_dow !== undefined) {
    const d = Number(body.schedule.weekly_dow);
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new HttpError(400, "bad weekly_dow");
    schedule.weekly_dow = d;
  }
  const sleep = { ...s.sleep, ...pickTimes<typeof s.sleep>(body.sleep, ["bed", "wake"]) };
  const coach = { ...s.coach };
  if (body.coach?.frequency !== undefined) {
    if (!FREQUENCIES.includes(body.coach.frequency)) throw new HttpError(400, "bad frequency");
    coach.frequency = body.coach.frequency;
  }
  const profile = { ...s.profile, about: s.profile?.about ?? "", currency: userCurrency(user) };
  if (body.profile?.about !== undefined) {
    const about = String(body.profile.about).trim().slice(0, ABOUT_MAX);
    profile.about = about;
  }
  if (body.profile?.name !== undefined) {
    profile.name = String(body.profile.name).trim().slice(0, 40);
  }
  if (body.profile?.currency !== undefined) {
    const c = String(body.profile.currency);
    if (!CURRENCIES.includes(c as never)) throw new HttpError(400, "bad currency");
    profile.currency = c;
  }

  const settingsRow: User["settings"] = { ...s, schedule, sleep, coach, profile };
  if (body.lang !== undefined) {
    const l = String(body.lang);
    if (l !== "ru" && l !== "en") throw new HttpError(400, "bad lang");
    settingsRow.lang = l as Lang;
  }
  const row: Record<string, unknown> = { settings: settingsRow };
  if (body.tz !== undefined) {
    const tz = String(body.tz);
    if (!validTz(tz)) throw new HttpError(400, "bad tz");
    row.tz = tz;
  }
  check(await db.from("users").update(row).eq("id", user.id));
  const langChanged = settingsRow.lang !== s.lang;
  user.settings = row.settings as User["settings"];
  if (row.tz) user.tz = row.tz as string;
  // Команды и кнопка меню в чате подписаны на языке интерфейса — обновляем их сразу.
  if (langChanged) await setupChat(user.tg_id, MINIAPP_URL, userLang(user)).catch(() => {});
  return settings(user);
}

/**
 * Токен GitHub вводится в приложении, а не в чат: в переписке он остался бы навсегда.
 * Храним только сам токен и логин, чтобы человек видел, чей аккаунт подключён.
 */
async function connectGithub(user: User, body: Body) {
  const token = String(body.token ?? "").trim();
  if (!token || token.length > 255) throw new HttpError(400, "bad token");
  const login = await githubLogin(token).catch(() => null);
  if (!login) throw new HttpError(400, "GitHub не принял токен");
  const profile = { about: user.settings.profile?.about ?? "", currency: userCurrency(user), github_login: login };
  const settingsNext = { ...user.settings, profile };
  check(await db.from("users").update({ github_token: token, settings: settingsNext }).eq("id", user.id));
  user.github_token = token;
  user.settings = settingsNext;
  await syncGithub(user).catch((e) => console.warn("github sync", e));
  return settings(user);
}

async function disconnectGithub(user: User) {
  const profile = { about: user.settings.profile?.about ?? "", currency: userCurrency(user), github_login: null };
  const settingsNext = { ...user.settings, profile };
  check(await db.from("users").update({ github_token: null, settings: settingsNext }).eq("id", user.id));
  user.github_token = null;
  user.settings = settingsNext;
  return settings(user);
}

export function supplementFields(body: Body, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 40) throw new HttpError(400, "bad name");
    out.name = name;
  } else if (!partial) throw new HttpError(400, "name required");
  if (body.slot !== undefined) {
    if (!SLOTS.includes(body.slot)) throw new HttpError(400, "bad slot");
    out.slot = body.slot;
  } else if (!partial) out.slot = "lunch";
  const num = (key: string, col: string, int: boolean) => {
    if (body[key] === undefined) return;
    if (body[key] === null) {
      out[col] = null;
      return;
    }
    const v = Number(body[key]);
    if (!(v >= 0) || (int && !Number.isInteger(v)) || v > 10_000) {
      throw new HttpError(400, `bad ${key}`);
    }
    out[col] = v;
  };
  num("unitsPerIntake", "units_per_intake", false);
  num("unitsPerPack", "units_per_pack", true);
  num("unitsLeft", "units_left", false);
  if (out.units_per_intake === 0 || out.units_per_pack === 0) throw new HttpError(400, "must be > 0");
  if (body.active !== undefined) out.active = Boolean(body.active);
  // Новый остаток — предупреждение о конце банки снова актуально.
  if ("units_left" in out) out.low_stock_warned = false;
  return out;
}

async function createSupplement(user: User, body: Body) {
  const fields = supplementFields(body, false);
  const { count } = await db.from("supplements").select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  check(
    await db.from("supplements").insert({ ...fields, user_id: user.id, sort: (count ?? 0) + 1 }),
  );
  return settings(user);
}

async function updateSupplement(user: User, id: string, body: Body) {
  const fields = supplementFields(body, true);
  const res = await db.from("supplements").update(fields, { count: "exact" })
    .eq("id", id).eq("user_id", user.id);
  check(res);
  if (!res.count) throw new HttpError(404, "supplement not found");
  return settings(user);
}
