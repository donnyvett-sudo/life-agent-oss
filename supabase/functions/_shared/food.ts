// Еда: фото или текст → КБЖУ. Gemini только оценивает блюдо; суммы, остаток дня,
// правки (½, ×1.5, «риса было 300 г») и личный словарь считаем сами: это быстро
// и не тратит лимит ИИ.
import { check, db, type User } from "./db.ts";
import { generate, toBase64 } from "./gemini.ts";
import { type Lang, lang, t } from "./i18n.ts";
import { mealLimitText, takeMealAi } from "./quota.ts";
import { downloadFile, edit, esc, type Keyboard, send, typing } from "./telegram.ts";
import { dayBounds, fmtTime, localNow, shiftDate } from "./time.ts";

export type Item = { name: string; grams: number; kcal: number; p: number; f: number; c: number };
export type Macros = { kcal: number; protein: number; fat: number; carbs: number };
export type Meal = { title: string; items: Item[]; confidence: number };
export type MealRow = Macros & {
  id: string;
  title: string;
  items: Item[];
  confidence: number | null;
  status: "pending" | "confirmed";
  local_date: string;
  eaten_at: string;
  source: string;
  corrected: boolean;
};
export type Dish = {
  name_norm: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  uses: number;
};

export const DEFAULT_TARGETS: Macros = { kcal: 2250, protein: 150, fat: 66, carbs: 262 };
export const OIL = "oil";

export const targetsOf = (user: User): Macros => ({
  ...DEFAULT_TARGETS,
  ...((user.settings as { nutrition?: Partial<Macros> }).nutrition ?? {}),
});

const r1 = (v: number) => Math.round(v * 10) / 10;
const num = (v: unknown, max: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(Math.max(x, 0), max) : 0;
};
const dec = (s: string) => Number(s.replace(",", "."));

/** Название для сравнения: регистр, ё, пунктуация и пробелы не важны. */
export const normName = (s: string) =>
  s.toLowerCase().replaceAll("ё", "е").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

// ---------- разбор и математика ----------

/** Схема ответа Gemini (JSON-режим). */
export const MEAL_SCHEMA = {
  type: "OBJECT",
  properties: {
    not_food: { type: "BOOLEAN" },
    title: { type: "STRING" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          grams: { type: "NUMBER" },
          kcal: { type: "NUMBER" },
          p: { type: "NUMBER" },
          f: { type: "NUMBER" },
          c: { type: "NUMBER" },
        },
        required: ["name", "grams", "kcal", "p", "f", "c"],
      },
    },
    hidden_oil_kcal: { type: "NUMBER" },
    confidence: { type: "NUMBER" },
  },
  required: ["not_food", "title", "items", "confidence"],
};

/** Позиции из сырого списка: числа в границах, ккал согласованы с БЖУ (Этуотер). */
export function cleanItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  const items: Item[] = [];
  for (const it of raw.slice(0, 12)) {
    const name = String(it?.name ?? "").trim().slice(0, 60);
    if (!name) continue;
    const p = r1(num(it.p, 300)), f = r1(num(it.f, 300)), c = r1(num(it.c, 500));
    let kcal = Math.round(num(it.kcal, 3000));
    const atwater = Math.round(4 * p + 9 * f + 4 * c);
    // При расхождении больше 20% верим граммам БЖУ, а не ккал.
    if (atwater > 0 && (kcal === 0 || Math.abs(kcal - atwater) / atwater > 0.2)) kcal = atwater;
    items.push({ name, grams: Math.round(num(it.grams, 3000)), kcal, p, f, c });
  }
  return items;
}

/** Ответ Gemini → блюдо. null — не еда или мусор. */
export function parseMeal(raw: string | unknown): Meal | null {
  let j: Record<string, unknown>;
  try {
    j = typeof raw === "string" ? JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "") : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || j.not_food === true) return null;
  const items = cleanItems(j.items);
  if (!items.length) return null;
  const oil = Math.round(num(j.hidden_oil_kcal, 400));
  if (oil > 0 && !items.some((i) => i.name === OIL)) {
    items.push({ name: OIL, grams: Math.round(oil / 9), kcal: oil, p: 0, f: r1(oil / 9), c: 0 });
  }
  const title = String(j.title ?? "").trim().slice(0, 80) || items.slice(0, 2).map((i) => i.name).join(", ");
  return { title, items, confidence: Math.round(num(j.confidence, 1) * 100) / 100 };
}

export function totals(items: Item[]): Macros {
  const s = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, f: a.f + i.f, c: a.c + i.c }), {
    kcal: 0,
    p: 0,
    f: 0,
    c: 0,
  });
  return { kcal: Math.round(s.kcal), protein: r1(s.p), fat: r1(s.f), carbs: r1(s.c) };
}

/** Порция изменилась в k раз: граммы и всё КБЖУ масштабируются вместе. */
export function scale(items: Item[], k: number): Item[] {
  return items.map((i) => ({
    ...i,
    grams: Math.round(i.grams * k),
    kcal: Math.round(i.kcal * k),
    p: r1(i.p * k),
    f: r1(i.f * k),
    c: r1(i.c * k),
  }));
}

const FACTORS: Record<string, number> = { half: 0.5, x15: 1.5 };

// ---------- слова пользователя: «съел …», правки, словарь ----------

const EAT_RE = /^(?:\/eat(?:@\w+)?|(?:съел|съела|съели|ел|ела|поел|поела|позавтракал|позавтракала|пообедал|пообедала|поужинал|поужинала|перекусил|перекусила))\s+(\S[\s\S]*)$/iu;

/** «/eat 2 яйца и банан», «съел борщ» → описание еды. Иначе null: это не запись еды. */
export function parseEatText(text: string): string | null {
  const m = text.trim().match(EAT_RE);
  return m ? m[1].trim().slice(0, 300) : null;
}

const GRAMS_RE = /(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм\p{L}*|g)(?![\p{L}])/iu;
const FILLER = new Set(["было", "была", "был", "стало", "на", "только", "всего", "это", "нет", "а", "не", "ещё", "еще"]);

/**
 * Правка словами без ИИ: «риса было 300 г», «×2», «половина».
 * null — не поняли, дальше решает Gemini.
 */
export function applyEdit(items: Item[], text: string): Item[] | null {
  const s = text.trim();
  const whole = s.match(/^(?:[x×х]\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*[x×х])$/iu);
  if (whole) {
    const k = dec(whole[1] ?? whole[2]);
    return k > 0 && k <= 10 ? scale(items, k) : null;
  }
  if (/^(?:половина|пополам|½|1\/2)$/iu.test(s)) return scale(items, 0.5);

  const gm = s.match(GRAMS_RE);
  if (!gm) return null;
  const grams = dec(gm[1]);
  if (!(grams > 0 && grams <= 3000)) return null;
  const tokens = normName(s.replace(GRAMS_RE, " ")).split(" ").filter((w) => w.length >= 3 && !FILLER.has(w));
  const food = items.map((i, idx) => ({ i, idx })).filter((x) => x.i.name !== OIL);
  const hit = food.filter(({ i }) => {
    const n = normName(i.name);
    return tokens.some((w) => n.includes(w.slice(0, Math.max(3, w.length - 2))));
  });
  const target = hit.length === 1 ? hit[0] : !tokens.length && food.length === 1 ? food[0] : null;
  if (!target || target.i.grams <= 0) return null;
  const scaled = scale([target.i], grams / target.i.grams)[0];
  scaled.grams = Math.round(grams);
  return items.map((it, idx) => (idx === target.idx ? scaled : it));
}

/**
 * Текст целиком из личного словаря: «рис, курица 200 г», «2 борщ». Любое незнакомое
 * блюдо — null, тогда считает Gemini. Порция: «N г» от граммов блюда, иначе число-множитель.
 */
export function resolveDishes(text: string, dishes: Dish[]): Meal | null {
  const byName = new Map(dishes.map((d) => [d.name_norm, d]));
  const parts = text.split(/\s*(?:,|;|\+|\sи\s)\s*/iu).map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const items: Item[] = [];
  for (const part of parts) {
    let s = part, k = 1, grams: number | null = null;
    const gm = s.match(GRAMS_RE);
    if (gm) {
      grams = dec(gm[1]);
      s = s.replace(GRAMS_RE, " ");
    } else {
      const lead = s.match(/^(\d+(?:[.,]\d+)?)\s*[x×х]?\s+(?=\p{L})/iu);
      const tail = s.match(/\s*[x×х]\s*(\d+(?:[.,]\d+)?)$/iu);
      if (lead) {
        k = dec(lead[1]);
        s = s.slice(lead[0].length);
      } else if (tail) {
        k = dec(tail[1]);
        s = s.slice(0, tail.index);
      }
    }
    const d = byName.get(normName(s));
    if (!d) return null;
    if (grams !== null) k = grams / d.grams;
    if (!(k > 0 && k <= 20)) return null;
    const base: Item = { name: d.name, grams: d.grams, kcal: d.kcal, p: Number(d.protein), f: Number(d.fat), c: Number(d.carbs) };
    items.push(scale([base], k)[0]);
  }
  return { title: items.map((i) => i.name).join(", ").slice(0, 80), items, confidence: 1 };
}

// ---------- хранилище ----------

const COLS = "id,title,items,kcal,protein,fat,carbs,confidence,status,local_date,eaten_at,source,corrected";

export async function saveMeal(
  user: User,
  meal: Meal,
  source: "photo" | "text" | "dish" | "manual",
  opts: { fileId?: string; date?: string; status?: "pending" | "confirmed" } = {},
): Promise<string> {
  const tot = totals(meal.items);
  const today = localNow(user.tz).date;
  const date = opts.date ?? today;
  const { data, error } = await db.from("meal_logs").insert({
    user_id: user.id,
    local_date: date,
    // Приём за прошлый день ставим на полдень этого дня, иначе он уехал бы в сегодняшнее время.
    ...(date !== today ? { eaten_at: new Date(dayBounds(date, user.tz).from.getTime() + 12 * 3_600_000).toISOString() } : {}),
    title: meal.title,
    items: meal.items,
    kcal: tot.kcal,
    protein: tot.protein,
    fat: tot.fat,
    carbs: tot.carbs,
    confidence: meal.confidence,
    source,
    status: opts.status ?? "pending",
    tg_file_id: opts.fileId ?? null,
  }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function getMeal(user: User, id: string): Promise<MealRow | null> {
  const { data, error } = await db.from("meal_logs").select(COLS).eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data as MealRow | null;
}

export async function mealsOn(user: User, date: string): Promise<MealRow[]> {
  const { data, error } = await db.from("meal_logs").select(COLS)
    .eq("user_id", user.id).eq("local_date", date).order("eaten_at");
  if (error) throw error;
  return (data ?? []) as MealRow[];
}

/** Новые позиции в строку приёма: пересчитываем итоги, помечаем правкой. */
export async function setItems(user: User, id: string, items: Item[], extra: Record<string, unknown> = {}) {
  const tot = totals(items);
  check(
    await db.from("meal_logs").update({
      items,
      kcal: tot.kcal,
      protein: tot.protein,
      fat: tot.fat,
      carbs: tot.carbs,
      corrected: true,
      ...extra,
    }).eq("id", id).eq("user_id", user.id),
  );
}

export const sumMacros = (rows: Macros[]): Macros => ({
  kcal: rows.reduce((s, r) => s + Number(r.kcal), 0),
  protein: r1(rows.reduce((s, r) => s + Number(r.protein), 0)),
  fat: r1(rows.reduce((s, r) => s + Number(r.fat), 0)),
  carbs: r1(rows.reduce((s, r) => s + Number(r.carbs), 0)),
});

export async function dayTotals(user: User, date: string): Promise<Macros> {
  const { data, error } = await db.from("meal_logs").select("kcal,protein,fat,carbs")
    .eq("user_id", user.id).eq("local_date", date);
  if (error) throw error;
  return sumMacros((data ?? []) as Macros[]);
}

// ---------- личный словарь ----------

export async function allDishes(user: User): Promise<Dish[]> {
  const { data, error } = await db.from("dishes").select("name_norm,name,grams,kcal,protein,fat,carbs,uses")
    .eq("user_id", user.id).order("uses", { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []) as Dish[];
}

/**
 * Запомнить позиции приёма. Подтверждённое без правок только повышает счётчик (оценку модели
 * не выдаём за эталон); исправленное человеком перезаписывает эталон.
 */
export async function rememberDishes(user: User, items: Item[], corrected: boolean) {
  const rows = new Map<string, { item: Item; norm: string }>();
  for (const item of items) {
    const norm = normName(item.name);
    if (item.name === OIL || !norm || item.grams <= 0) continue;
    rows.set(norm, { item, norm });
  }
  if (!rows.size) return;
  const { data, error } = await db.from("dishes").select("name_norm,uses")
    .eq("user_id", user.id).in("name_norm", [...rows.keys()]);
  if (error) throw error;
  const have = new Map((data ?? []).map((d: { name_norm: string; uses: number }) => [d.name_norm, d.uses]));
  const up = [...rows.values()].filter(({ norm }) => corrected || !have.has(norm)).map(({ item, norm }) => ({
    user_id: user.id,
    name_norm: norm,
    name: item.name,
    grams: item.grams,
    kcal: item.kcal,
    protein: item.p,
    fat: item.f,
    carbs: item.c,
    uses: (have.get(norm) ?? 0) + 1,
  }));
  if (up.length) check(await db.from("dishes").upsert(up, { onConflict: "user_id,name_norm" }));
  // Остальным — только счётчик.
  for (const [norm, uses] of have) {
    if (!up.some((u) => u.name_norm === norm)) {
      check(await db.from("dishes").update({ uses: uses + 1 }).eq("user_id", user.id).eq("name_norm", norm));
    }
  }
}

// ---------- карточка ----------

const KEYS = (id: string, confirmed: boolean): Keyboard => [[
  ...(confirmed ? [] : [{ text: "✅", callback_data: `ml:ok:${id}` }]),
  { text: "½", callback_data: `ml:half:${id}` },
  { text: "×1.5", callback_data: `ml:x15:${id}` },
  { text: "✏️", callback_data: `ml:ed:${id}` },
  { text: "🗑", callback_data: `ml:del:${id}` },
]];

const itemName = (user: User, i: Item) => (i.name === OIL ? t(user, "скрытое масло") : i.name);

export function mealCard(
  user: User,
  m: { id: string; title: string; items: Item[]; confidence: number | null; status: string },
  day: Macros,
  targets: Macros,
): { text: string; keyboard: Keyboard } {
  const tot = totals(m.items);
  const lines = [
    `🍽 <b>${esc(m.title)}</b>`,
    ...m.items.map((i) => `• ${esc(itemName(user, i))} ${i.grams} ${t(user, "г")} · ${i.kcal}`),
    `<b>${tot.kcal} ${t(user, "ккал")}</b> · ${t(user, "Б")} ${Math.round(tot.protein)} · ${t(user, "Ж")} ${Math.round(tot.fat)} · ${t(user, "У")} ${Math.round(tot.carbs)}`,
  ];
  if (m.confidence !== null && m.confidence < 0.5) lines.push(t(user, "⚠️ Оценка неточная: проверь порции."));
  const left = targets.kcal - day.kcal;
  lines.push(
    left >= 0
      ? t(user, "Осталось за день: {kcal} ккал, белка {p} г", { kcal: left, p: Math.max(0, Math.round(targets.protein - day.protein)) })
      : t(user, "Сверх цели на {kcal} ккал", { kcal: -left }),
  );
  return { text: lines.join("\n"), keyboard: KEYS(m.id, m.status === "confirmed") };
}

// ---------- Gemini ----------

const systemPrompt = (l: Lang, dishes: Dish[]) =>
  [
    "Ты считаешь калории и БЖУ по фото еды или её описанию. Отвечай строго JSON по схеме.",
    "Разбери блюдо на позиции, оцени вес каждой в граммах (для готового блюда, не сухого) и его ккал, белки (p), жиры (f), углеводы (c) в граммах.",
    "Масштаб порции оценивай по тарелке, палочкам, ложке и руке, если они в кадре.",
    "Жареное, тушёное и столовская еда (炒, 红烧) содержит скрытое масло: верни его в hidden_oil_kcal, по умолчанию 80-120 ккал на порцию, 0 для варёного и сырого.",
    "Если на фото нет еды или в тексте нет еды, верни not_food=true и пустой items.",
    "confidence от 0 до 1: насколько уверен в весе и составе. Не завышай: пересвеченное или закрытое блюдо не выше 0.5.",
    `Названия пиши на языке: ${l === "en" ? "английский" : "русский"}, коротко.`,
    "Если есть подпись или описание, учти его (количество порций, вес, состав): названные граммы важнее твоей оценки.",
    ...(dishes.length
      ? [
        "Личные эталоны человека (проверенные порции). Если блюдо похоже, бери эти граммы и значения:",
        ...dishes.map((d) => `- ${d.name}: ${d.grams} г, ${d.kcal} ккал, Б ${d.protein}, Ж ${d.fat}, У ${d.carbs}`),
      ]
      : []),
  ].join("\n");

/** Подходящее превью: ширины около 800 px хватает, большее только тратит время и токены. */
export function pickPhoto<T extends { width: number }>(photos: T[]): T {
  const sorted = [...photos].sort((a, b) => a.width - b.width);
  return sorted.find((p) => p.width >= 700) ?? sorted[sorted.length - 1];
}

const ask = async (user: User, dishes: Dish[], text: string, image?: Uint8Array): Promise<Meal | null> =>
  parseMeal(
    await generate(
      systemPrompt(lang(user), dishes),
      [{ role: "user", text }],
      1024,
      image ? [{ inline_data: { mime_type: "image/jpeg", data: toBase64(image) } }] : [],
      MEAL_SCHEMA,
    ),
  );

export const analyzePhoto = async (user: User, bytes: Uint8Array, caption?: string) =>
  await ask(user, (await allDishes(user)).slice(0, 8), caption?.trim() ? `Подпись к фото: ${caption.trim().slice(0, 200)}` : "Оцени блюдо на фото.", bytes);

export const analyzeText = async (user: User, text: string) =>
  await ask(user, (await allDishes(user)).slice(0, 8), `Приём пищи описан текстом: ${text.slice(0, 300)}`);

/** Правка, которую не разобрали словами: Gemini получает текущую оценку и слова человека. */
async function reviseWithAI(user: User, items: Item[], text: string): Promise<Item[] | null> {
  const meal = await ask(
    user,
    [],
    `Текущая оценка: ${JSON.stringify(items)}\nЧеловек поправляет: ${text.slice(0, 300)}\nВерни исправленный список позиций целиком, hidden_oil_kcal 0 (масло уже позиция "oil" в списке, если было).`,
  );
  return meal?.items ?? null;
}

// ---------- обработчики ----------

/** Сохранить блюдо и показать карточку: правим плейсхолдер, если он есть. */
async function postMeal(
  user: User,
  meal: Meal,
  source: "photo" | "text" | "dish",
  mid: number | null,
  fileId?: string,
) {
  const id = await saveMeal(user, meal, source, { fileId });
  const card = mealCard(user, { id, ...meal, status: "pending" }, await dayTotals(user, localNow(user.tz).date), targetsOf(user));
  if (mid) await edit(user.tg_id, mid, card.text, card.keyboard);
  else await send(user.tg_id, card.text, card.keyboard);
}

/** Фото еды: плейсхолдер сразу, потом правим это же сообщение. */
export async function mealPhoto(user: User, photos: { file_id: string; width: number }[], caption?: string) {
  if (!(await takeMealAi(user))) {
    await send(user.tg_id, mealLimitText(user));
    return;
  }
  await typing(user.tg_id);
  const mid = await send(user.tg_id, t(user, "🔍 Считаю…"));
  try {
    const photo = pickPhoto(photos);
    const { bytes } = await downloadFile(photo.file_id);
    const meal = await analyzePhoto(user, bytes, caption);
    if (!meal) {
      await edit(user.tg_id, mid, t(user, "Не вижу еды на фото. Попробуй ещё раз ближе и при свете."));
      return;
    }
    await postMeal(user, meal, "photo", mid, photo.file_id);
  } catch (e) {
    console.error("meal photo", e);
    await edit(user.tg_id, mid, t(user, "Не удалось посчитать: Gemini не ответил. Попробуй ещё раз."));
  }
}

/** Еда словами: сначала личный словарь (мгновенно, без ИИ), потом Gemini. */
export async function mealText(user: User, text: string) {
  const known = resolveDishes(text, await allDishes(user));
  if (known) {
    await postMeal(user, known, "dish", null);
    return;
  }
  if (!(await takeMealAi(user))) {
    await send(user.tg_id, mealLimitText(user));
    return;
  }
  await typing(user.tg_id);
  const mid = await send(user.tg_id, t(user, "🔍 Считаю…"));
  try {
    const meal = await analyzeText(user, text);
    if (!meal) {
      await edit(user.tg_id, mid, t(user, "Не понял, что это за еда. Напиши, например: /eat 2 яйца и банан."));
      return;
    }
    await postMeal(user, meal, "text", mid);
  } catch (e) {
    console.error("meal text", e);
    await edit(user.tg_id, mid, t(user, "Не удалось посчитать: Gemini не ответил. Попробуй ещё раз."));
  }
}

/** Кнопки карточки: ✅ подтвердить, ½ и ×1.5 пересчитать, ✏️ поправить словами, 🗑 удалить. */
export async function mealAction(
  user: User,
  action: string,
  id: string,
  mid?: number,
): Promise<{ toast: string; text?: string; keyboard?: Keyboard }> {
  const row = await getMeal(user, id);
  if (!row) return { toast: t(user, "Запись не найдена") };
  if (action === "del") {
    check(await db.from("meal_logs").delete().eq("id", id).eq("user_id", user.id));
    return { toast: t(user, "Запись удалена"), text: t(user, "↩️ <s>приём пищи удалён</s>"), keyboard: [] };
  }
  if (action === "ed") {
    user.state = { ...user.state, meal_edit: { id, mid: mid ?? null, ts: Date.now() } };
    check(await db.from("users").update({ state: user.state }).eq("id", user.id));
    await send(user.tg_id, t(user, "✏️ Что поправить? Например: «риса было 300 г» или «×2»."));
    return { toast: "" };
  }
  let items = row.items;
  let status = row.status;
  if (action === "ok") {
    check(await db.from("meal_logs").update({ status: "confirmed" }).eq("id", id).eq("user_id", user.id));
    status = "confirmed";
    await rememberDishes(user, items, row.corrected);
  } else if (FACTORS[action]) {
    items = scale(row.items, FACTORS[action]);
    await setItems(user, id, items);
  } else {
    return { toast: "" };
  }
  const card = mealCard(user, { ...row, items, status }, await dayTotals(user, row.local_date), targetsOf(user));
  return { toast: action === "ok" ? t(user, "Записано") : t(user, "Пересчитал"), ...card };
}

const EDIT_TTL_MS = 30 * 60_000;

/** Следующее сообщение после ✏️ — это правка. true — сообщение съели. */
export async function mealEditAnswer(user: User, text: string): Promise<boolean> {
  const st = user.state.meal_edit as { id: string; mid: number | null; ts: number } | undefined;
  if (!st) return false;
  user.state = { ...user.state };
  delete user.state.meal_edit;
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
  if (Date.now() - st.ts > EDIT_TTL_MS) return false;

  const row = await getMeal(user, st.id);
  if (!row) {
    await send(user.tg_id, t(user, "Запись не найдена"));
    return true;
  }
  let items = applyEdit(row.items, text);
  if (!items) {
    if (!(await takeMealAi(user))) {
      await send(user.tg_id, mealLimitText(user));
      return true;
    }
    await typing(user.tg_id);
    items = await reviseWithAI(user, row.items, text).catch(() => null);
  }
  if (!items) {
    await send(user.tg_id, t(user, "Не понял правку. Нажми ✏️ и напиши иначе, например «риса было 300 г»."));
    return true;
  }
  await setItems(user, st.id, items);
  if (row.status === "confirmed") await rememberDishes(user, items, true);
  const card = mealCard(user, { ...row, items }, await dayTotals(user, row.local_date), targetsOf(user));
  if (st.mid) await edit(user.tg_id, st.mid, card.text, card.keyboard);
  else await send(user.tg_id, card.text, card.keyboard);
  return true;
}

// ---------- сводки ----------

/** /food: сегодня списком и неделя одной строкой. */
export async function foodOverview(user: User): Promise<string> {
  const date = localNow(user.tz).date;
  const [meals, week] = await Promise.all([mealsOn(user, date), weekTotals(user, date)]);
  const tg = targetsOf(user);
  if (!meals.length) return t(user, "Сегодня ещё ничего не записано. Пришли фото еды или напиши: /eat 2 яйца и банан.");
  const day = sumMacros(meals);
  const lines = [
    `<b>${t(user, "Еда сегодня")}</b>`,
    ...meals.map((m) => `• ${fmtTime(new Date(m.eaten_at), user.tz)} ${esc(m.title)} — ${m.kcal}`),
    t(user, "Итого: {kcal} из {goal} ккал · Б {p}/{pg} · Ж {f}/{fg} · У {c}/{cg}", {
      kcal: day.kcal,
      goal: tg.kcal,
      p: Math.round(day.protein),
      pg: tg.protein,
      f: Math.round(day.fat),
      fg: tg.fat,
      c: Math.round(day.carbs),
      cg: tg.carbs,
    }),
  ];
  if (week.days > 1) lines.push(t(user, "Неделя: в среднем {kcal} ккал (дней с записями: {n})", { kcal: week.avgKcal, n: week.days }));
  return lines.join("\n");
}

/** Итог за последние 7 дней: только дни, где что-то записано. */
export async function weekTotals(user: User, today: string): Promise<{ days: number; avgKcal: number }> {
  const { data, error } = await db.from("meal_logs").select("local_date,kcal")
    .eq("user_id", user.id).gte("local_date", shiftDate(today, -6)).lte("local_date", today);
  if (error) throw error;
  const byDay = new Map<string, number>();
  for (const r of (data ?? []) as { local_date: string; kcal: number }[]) {
    byDay.set(r.local_date, (byDay.get(r.local_date) ?? 0) + Number(r.kcal));
  }
  const vals = [...byDay.values()];
  return { days: vals.length, avgKcal: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
}

/** Вечерний итог дня. null — за день ничего не записано, молчим. */
export async function foodEvening(user: User): Promise<{ text: string } | null> {
  const date = localNow(user.tz).date;
  const meals = await mealsOn(user, date);
  if (!meals.length) return null;
  const day = sumMacros(meals);
  const tg = targetsOf(user);
  const left = tg.protein - day.protein;
  const head = t(user, "🍽 Еда за день: {kcal} из {goal} ккал, белок {p} из {pg} г.", {
    kcal: day.kcal,
    goal: tg.kcal,
    p: Math.round(day.protein),
    pg: tg.protein,
  });
  return { text: left > 15 ? `${head} ${t(user, "Белка не хватает: {n} г.", { n: Math.round(left) })}` : head };
}

/** Факты для коуча: коротко, без истории. */
export async function mealFacts(user: User): Promise<string[]> {
  const date = localNow(user.tz).date;
  const [day, week] = await Promise.all([dayTotals(user, date), weekTotals(user, date)]);
  const tg = targetsOf(user);
  const out: string[] = [];
  if (day.kcal > 0) {
    out.push(t(user, "Сегодня съедено {kcal} из {goal} ккал, белка {p} из {pg} г.", {
      kcal: day.kcal,
      goal: tg.kcal,
      p: Math.round(day.protein),
      pg: tg.protein,
    }));
  }
  if (week.days >= 3) out.push(t(user, "За неделю в среднем {kcal} ккал в день.", { kcal: week.avgKcal }));
  return out;
}

/**
 * Личный расход калорий по тренду веса: TDEE = средние ккал − 7700 · (кг в день).
 * Нужны ≥ 10 дней с записями еды и ≥ 6 взвешиваний, растянутых на ≥ 14 дней, иначе null:
 * вода двигает вес на ±1 кг, на короткой дистанции это ±1100 ккал в день шума.
 */
export function estimateTdee(
  kcalByDay: { date: string; kcal: number }[],
  weights: { date: string; kg: number }[],
): { tdee: number; slopeKgPerWeek: number; avgKcal: number } | null {
  if (kcalByDay.length < 10 || weights.length < 6) return null;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const xs = weights.map((w) => day(w.date));
  if (Math.max(...xs) - Math.min(...xs) < 14) return null;
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = weights.reduce((a, w) => a + w.kg, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (weights[i].kg - my), 0) / sxx;
  const avgKcal = kcalByDay.reduce((a, d) => a + d.kcal, 0) / kcalByDay.length;
  return {
    tdee: Math.round(avgKcal - 7700 * slope),
    slopeKgPerWeek: Math.round(slope * 7 * 100) / 100,
    avgKcal: Math.round(avgKcal),
  };
}
