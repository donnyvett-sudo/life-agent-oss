// Еда для Mini App и Life Desk: день, история с трендом веса, правка приёмов, цели, словарь.
// Расчёты и разбор лежат в _shared/food.ts, здесь только HTTP-проверки и ответы.
import { bodyRange } from "../body.ts";
import { check, db, type User } from "../db.ts";
import {
  allDishes,
  cleanItems,
  estimateTdee,
  getMeal,
  type Item,
  type Macros,
  mealsOn,
  normName,
  rememberDishes,
  saveMeal,
  setItems,
  sumMacros,
  targetsOf,
  totals,
} from "../food.ts";
import { dayBounds, fmtTime, localNow, shiftDate } from "../time.ts";
import { HttpError } from "./finance.ts";

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BACK = 365;

/** Дата из запроса: не в будущем и не глубже года. Пусто → сегодня. */
export function foodDate(user: User, v: unknown): string {
  const today = localNow(user.tz).date;
  if (v === undefined || v === null || v === "") return today;
  if (typeof v !== "string" || !ISO_DATE.test(v)) throw new HttpError(400, "bad date");
  if (v > today || v < shiftDate(today, -MAX_BACK)) throw new HttpError(400, "date out of range");
  return v;
}

const mealView = (user: User, m: Awaited<ReturnType<typeof mealsOn>>[number]) => ({
  id: m.id,
  time: fmtTime(new Date(m.eaten_at), user.tz),
  title: m.title,
  items: m.items,
  kcal: Number(m.kcal),
  protein: Number(m.protein),
  fat: Number(m.fat),
  carbs: Number(m.carbs),
  confidence: m.confidence === null ? null : Number(m.confidence),
  status: m.status,
  source: m.source,
  corrected: m.corrected,
});

export async function foodDay(user: User, dateParam?: unknown) {
  const date = foodDate(user, dateParam);
  const meals = await mealsOn(user, date);
  return {
    date,
    today: localNow(user.tz).date,
    targets: targetsOf(user),
    totals: sumMacros(meals),
    meals: meals.map((m) => mealView(user, m)),
  };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Дни с суммами и вес со скользящим средним за 7 дней; TDEE — когда данных хватает. */
export async function foodHistory(user: User, daysParam: unknown) {
  const n = Math.min(Math.max(Math.round(Number(daysParam)) || 28, 7), 90);
  const today = localNow(user.tz).date;
  const from = shiftDate(today, -(n - 1));
  const { data, error } = await db.from("meal_logs").select("local_date,kcal,protein,fat,carbs")
    .eq("user_id", user.id).gte("local_date", from).lte("local_date", today);
  if (error) throw error;
  const by = new Map<string, Macros[]>();
  for (const r of (data ?? []) as (Macros & { local_date: string })[]) {
    by.set(r.local_date, [...(by.get(r.local_date) ?? []), r]);
  }
  const series = Array.from({ length: n }, (_, i) => {
    const date = shiftDate(from, i);
    const rows = by.get(date) ?? [];
    return { date, meals: rows.length, ...sumMacros(rows) };
  });

  const body = await bodyRange(user, shiftDate(today, -(Math.max(n, 28) + 6)), today);
  const raw = body.filter((b) => b.weight_kg !== null).map((b) => ({ date: b.local_date, kg: Number(b.weight_kg) }));
  const weights = raw.filter((w) => w.date >= from).map((w) => ({
    ...w,
    avg: Math.round(avg(raw.filter((x) => x.date <= w.date && x.date > shiftDate(w.date, -7)).map((x) => x.kg)) * 10) / 10,
  }));

  const win = shiftDate(today, -27);
  const tdee = estimateTdee(
    series.filter((d) => d.date >= win && d.meals > 0).map((d) => ({ date: d.date, kcal: d.kcal })),
    raw.filter((w) => w.date >= win),
  );
  return { today, days: n, targets: targetsOf(user), series, weights, tdee };
}

// ------------------------------------------------------------- изменения ---

/** Суммы приёма должны помещаться в ограничения таблицы: иначе вместо 400 будет 500 от базы. */
function assertFits(items: Item[]) {
  const t = totals(items);
  if (t.kcal > 20000 || t.protein > 1500 || t.fat > 1500 || t.carbs > 3000) throw new HttpError(400, "meal too large");
}

function macroField(v: unknown, name: string, max: number): number {
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0 || x > max) throw new HttpError(400, `bad ${name}`);
  return x;
}

/** Приём руками: позиции списком или одна строка с КБЖУ. */
export async function createMeal(user: User, body: Body) {
  const date = foodDate(user, body.date);
  const title = String(body.title ?? "").trim().slice(0, 80);
  let items: Item[];
  if (Array.isArray(body.items)) {
    items = cleanItems(body.items);
    if (!items.length) throw new HttpError(400, "empty items");
    assertFits(items);
  } else {
    const kcal = macroField(body.kcal, "kcal", 5000);
    if (!title) throw new HttpError(400, "title required");
    items = cleanItems([{
      name: title,
      grams: body.grams ?? 0,
      kcal,
      p: macroField(body.protein ?? 0, "protein", 300),
      f: macroField(body.fat ?? 0, "fat", 300),
      c: macroField(body.carbs ?? 0, "carbs", 500),
    }]);
  }
  await saveMeal(
    user,
    { title: title || items.slice(0, 2).map((i) => i.name).join(", "), items, confidence: 1 },
    "manual",
    { date, status: "confirmed" },
  );
  await rememberDishes(user, items, false);
  return foodDay(user, date);
}

export async function patchMeal(user: User, id: string, body: Body) {
  const row = await getMeal(user, id);
  if (!row) throw new HttpError(404, "meal not found");
  const upd: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, 80);
    if (!title) throw new HttpError(400, "bad title");
    upd.title = title;
  }
  if (body.status !== undefined) {
    if (body.status !== "pending" && body.status !== "confirmed") throw new HttpError(400, "bad status");
    upd.status = body.status;
  }
  if (body.date !== undefined && body.date !== row.local_date) {
    const date = foodDate(user, body.date);
    upd.local_date = date;
    upd.eaten_at = new Date(dayBounds(date, user.tz).from.getTime() + 12 * 3_600_000).toISOString();
  }

  let items: Item[] | null = null;
  if (Array.isArray(body.items)) {
    items = cleanItems(body.items);
    if (!items.length) throw new HttpError(400, "empty items");
  } else if (["kcal", "protein", "fat", "carbs"].some((k) => body[k] !== undefined)) {
    // Только итоги: приём сводим к одной позиции с этими числами.
    const cur = totals(row.items);
    items = cleanItems([{
      name: String(upd.title ?? row.title),
      grams: row.items.reduce((s, i) => s + i.grams, 0),
      kcal: macroField(body.kcal ?? cur.kcal, "kcal", 5000),
      p: macroField(body.protein ?? cur.protein, "protein", 300),
      f: macroField(body.fat ?? cur.fat, "fat", 300),
      c: macroField(body.carbs ?? cur.carbs, "carbs", 500),
    }]);
  }
  if (items) assertFits(items);
  if (items) await setItems(user, id, items, upd);
  else if (Object.keys(upd).length) check(await db.from("meal_logs").update(upd).eq("id", id).eq("user_id", user.id));

  // Подтверждённое или исправленное в приложении — эталон для словаря.
  const confirmed = (upd.status ?? row.status) === "confirmed";
  if (confirmed && (items || (upd.status === "confirmed" && row.status !== "confirmed"))) {
    await rememberDishes(user, items ?? row.items, Boolean(items));
  }
  return foodDay(user, (upd.local_date as string | undefined) ?? row.local_date);
}

export async function deleteMeal(user: User, id: string) {
  const row = await getMeal(user, id);
  if (!row) throw new HttpError(404, "meal not found");
  check(await db.from("meal_logs").delete().eq("id", id).eq("user_id", user.id));
  return foodDay(user, row.local_date);
}

export async function putTargets(user: User, body: Body) {
  const cur = targetsOf(user);
  const next = {
    kcal: body.kcal === undefined ? cur.kcal : Math.round(macroField(body.kcal, "kcal", 8000)),
    protein: body.protein === undefined ? cur.protein : Math.round(macroField(body.protein, "protein", 500)),
    fat: body.fat === undefined ? cur.fat : Math.round(macroField(body.fat, "fat", 400)),
    carbs: body.carbs === undefined ? cur.carbs : Math.round(macroField(body.carbs, "carbs", 1000)),
  };
  if (next.kcal < 800) throw new HttpError(400, "bad kcal");
  const settings = { ...user.settings, nutrition: next } as User["settings"];
  check(await db.from("users").update({ settings }).eq("id", user.id));
  user.settings = settings;
  return foodDay(user);
}

// --------------------------------------------------------------- словарь ---

export async function listDishes(user: User) {
  const dishes = await allDishes(user);
  return {
    dishes: dishes.map((d) => ({
      key: d.name_norm,
      name: d.name,
      grams: d.grams,
      kcal: d.kcal,
      protein: Number(d.protein),
      fat: Number(d.fat),
      carbs: Number(d.carbs),
      uses: d.uses,
    })),
  };
}

export async function saveDish(user: User, body: Body) {
  const name = String(body.name ?? "").trim().slice(0, 60);
  const norm = normName(name);
  if (!norm) throw new HttpError(400, "name required");
  const grams = Math.round(macroField(body.grams, "grams", 5000));
  if (grams < 1) throw new HttpError(400, "bad grams");
  const [item] = cleanItems([{
    name,
    grams,
    kcal: macroField(body.kcal, "kcal", 5000),
    p: macroField(body.protein ?? 0, "protein", 300),
    f: macroField(body.fat ?? 0, "fat", 300),
    c: macroField(body.carbs ?? 0, "carbs", 500),
  }]);
  check(
    await db.from("dishes").upsert({
      user_id: user.id,
      name_norm: norm,
      name,
      grams: item.grams,
      kcal: item.kcal,
      protein: item.p,
      fat: item.f,
      carbs: item.c,
    }, { onConflict: "user_id,name_norm" }),
  );
  return listDishes(user);
}

export async function deleteDish(user: User, rawKey: string) {
  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    throw new HttpError(400, "bad key");
  }
  check(await db.from("dishes").delete().eq("user_id", user.id).eq("name_norm", key));
  return listDishes(user);
}
