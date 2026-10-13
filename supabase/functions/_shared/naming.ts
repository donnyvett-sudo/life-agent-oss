// Память названий: одно заведение — одно написание. Записи ведём латиницей,
// обычные слова переводим («чай» → Tea), нишевые русские названия оставляем как есть.
// Сопоставление детерминированное: скелет слова + расстояние Левенштейна, без Gemini.
import { check, db, type User } from "./db.ts";

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Кириллица → латиница, чтобы «магнолия» и «Magnolia» встретились в одном алфавите. */
export function translit(s: string): string {
  return s.toLowerCase().split("").map((c) => CYR[c] ?? c).join("");
}

/**
 * Скелет: написание, к которому сводятся оба алфавита.
 * «Макдональдс» → makdonalds, «McDonalds» → makdonalds.
 */
export function skel(s: string): string {
  let t = translit(s)
    .replace(/[^a-z0-9]+/g, "")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sh")
    .replace(/kh/g, "h")
    .replace(/c/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/q/g, "k")
    .replace(/y/g, "i");
  // «mcdonalds» → «mkdonalds» → гласная после m возвращает произношение: mak-
  t = t.replace(/^mk/, "mak");
  return t.replace(/(.)\1+/g, "$1");
}

/** Только согласные: последняя попытка сопоставить «snacks» и «снеки». */
export function bones(s: string): string {
  return skel(s).replace(/[aeiou]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return prev[b.length];
}

// Обычные слова: пишем по-английски, как в истории.
const WORDS: Record<string, string> = {
  обед: "Lunch", ланч: "Lunch", завтрак: "Breakfast", ужин: "Dinner", еда: "Food", перекус: "Snacks",
  снеки: "Snacks", снек: "Snacks", чай: "Tea", кофе: "Coffee", вода: "Water", напитки: "Drinks",
  напиток: "Drinks", сок: "Juice", молоко: "Milk", хлеб: "Bread", продукты: "Groceries",
  фрукты: "Fruits", овощи: "Vegetables", мясо: "Meat", сладости: "Sweets", мороженое: "Ice cream",
  пицца: "Pizza", бургер: "Burger", лапша: "Noodles", шаурма: "Shawarma", кебаб: "Kebab",
  столовая: "Canteen", столовке: "Canteen", кафе: "Cafe", ресторан: "Restaurant", доставка: "Delivery",
  такси: "Taxi", метро: "Metro", автобус: "Bus", велосипед: "Bike", велик: "Bike", поезд: "Train",
  самолет: "Flight", билет: "Ticket", бензин: "Fuel", отель: "Hotel", магазин: "Shop", рынок: "Market",
  аптека: "Pharmacy", лекарства: "Medicine", врач: "Doctor", зубной: "Dentist", стрижка: "Haircut",
  прачечная: "Laundry", кино: "Cinema", книга: "Book", подарок: "Gift", одежда: "Clothes",
  обувь: "Shoes", телефон: "Mobile", связь: "Mobile", интернет: "Internet", подписка: "Subscription",
  электричество: "Electricity", вода_горячая: "Hot water", аренда: "Rent", квартира: "Rent",
  общага: "Dorm", общежитие: "Dorm", зал: "Gym", спортзал: "Gym", печать: "Printing",
  распечатка: "Printing", комиссия: "Commission", чаевые: "Tip", штраф: "Fine", перевод: "Transfer",
  стипендия: "Stipend", зарплата: "Salary", кэшбэк: "Cashback", кешбэк: "Cashback", проценты: "Interest",
  мама: "Mom", папа: "Dad", родителям: "Parents", универ: "University", университет: "University",
};

// Сети, которых может не быть в истории: пишем так, как принято.
const BRANDS: Record<string, string> = {
  makdonalds: "McDonalds", makdak: "McDonalds", kfk: "KFC", starbaks: "Starbucks", starbuks: "Starbucks",
  lakin: "Luckin", miksue: "Mixue", mishue: "Mixue", heitea: "Heytea", heiti: "Heytea",
  sabvei: "Subway", kfs: "KFC", uber: "Uber", popais: "Popeyes", ramen: "Ramen", sushi: "Sushi",
  burgerking: "Burger King", pikkadili: "Piccadily", uniklo: "Uniqlo", saizeriya: "Saizeriya",
  vagas: "Wagas", ikea: "IKEA", taobao: "Taobao", meituan: "Meituan", didi: "Didi", alipei: "Alipay",
  vechat: "WeChat", vichat: "WeChat", kaspi: "Kaspi", magnum: "Magnum", glovo: "Glovo",
  yandeks: "Yandex", pitstsahat: "Pizza Hut", chagi: "Chagee", kotti: "Cotti",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Пословный перевод: известные слова — по-английски, остальные остаются как есть. */
export function translateWords(note: string): string {
  const out = note.split(/\s+/).filter(Boolean).map((w) => {
    const key = w.toLowerCase().replace(/[^\p{L}\d+]/gu, "");
    const known = WORDS[key] ?? WORDS[key.replace(/(ом|ами|ах|ой|ы|и|а|у|е)$/u, "")];
    return known ?? w;
  });
  return out.join(" ");
}

export type Named = {
  /** Как записываем. */ note: string;
  /** Что услышали, если заменили. */ heard?: string;
  /** Уверены или стоит переспросить. */ sure: boolean;
};

type AliasRow = { skel: string; canonical: string; hits: number };

async function aliases(userId: string): Promise<AliasRow[]> {
  return check(
    await db.from("note_aliases").select("skel,canonical,hits").eq("user_id", userId),
  ) as AliasRow[];
}

/** Первый раз: собираем словарь из истории операций — там названия уже латиницей. */
export async function seedAliases(user: User): Promise<void> {
  if (user.state.aliases_seeded) return;
  const rows = check(
    await db.from("transactions").select("note").eq("user_id", user.id).not("note", "is", null)
      .limit(5000),
  ) as { note: string }[];

  // Для каждого скелета берём самое частое написание.
  const counts = new Map<string, Map<string, number>>();
  for (const { note } of rows) {
    const n = note.trim();
    if (!n || n.length > 40 || !/\p{L}/u.test(n)) continue;
    const key = skel(n);
    if (!key) continue;
    const byText = counts.get(key) ?? new Map<string, number>();
    byText.set(n, (byText.get(n) ?? 0) + 1);
    counts.set(key, byText);
  }
  const now = new Date().toISOString();
  const payload = [...counts].map(([key, byText]) => {
    const [canonical, hits] = [...byText].sort((a, b) => b[1] - a[1])[0];
    return { user_id: user.id, skel: key, canonical, hits, updated_at: now };
  });
  if (payload.length) {
    check(await db.from("note_aliases").upsert(payload, { onConflict: "user_id,skel" }));
  }
  user.state = { ...user.state, aliases_seeded: true };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
}

/** Порог опечатки: короткие слова путать нельзя, длинные прощают больше. */
const maxDistance = (len: number) => (len >= 9 ? 2 : len >= 5 ? 1 : 0);

/** Найти каноническое написание среди известных. */
export function matchKnown(
  note: string,
  known: { skel: string; canonical: string }[],
): { canonical: string; sure: boolean } | null {
  const key = skel(note);
  if (!key) return null;
  const exact = known.find((k) => k.skel === key);
  if (exact) return { canonical: exact.canonical, sure: true };

  const limit = maxDistance(key.length);
  if (limit > 0) {
    let best: { canonical: string; d: number } | null = null;
    for (const k of known) {
      if (Math.abs(k.skel.length - key.length) > limit) continue;
      const d = levenshtein(key, k.skel);
      if (d <= limit && (!best || d < best.d)) best = { canonical: k.canonical, d };
    }
    if (best) return { canonical: best.canonical, sure: best.d === 0 };
  }

  // Последняя попытка: одни согласные («снеки» и «Snacks»).
  const b = bones(note);
  if (b.length >= 3) {
    const hit = known.find((k) => bones(k.canonical) === b);
    if (hit) return { canonical: hit.canonical, sure: false };
  }
  return null;
}

/**
 * Привести название к каноническому виду: сначала память пользователя,
 * затем известные сети, затем словарь обычных слов.
 */
export async function canonicalNote(user: User, note: string): Promise<Named> {
  const raw = note.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!raw || !/\p{L}/u.test(raw)) return { note: raw, sure: true };
  await seedAliases(user);

  const known = await aliases(user.id);
  const hit = matchKnown(raw, known);
  if (hit) {
    await bump(user.id, raw, hit.canonical);
    return hit.canonical === raw
      ? { note: raw, sure: true }
      : { note: hit.canonical, heard: raw, sure: hit.sure };
  }

  const brand = BRANDS[skel(raw)];
  if (brand) {
    await bump(user.id, raw, brand);
    return brand === raw ? { note: raw, sure: true } : { note: brand, heard: raw, sure: true };
  }

  const translated = cap(translateWords(raw));
  await bump(user.id, raw, translated);
  return translated === raw ? { note: raw, sure: true } : { note: translated, heard: raw, sure: true };
}

/** Запомнить: такое произношение — это такое название. */
export async function bump(userId: string, heard: string, canonical: string): Promise<void> {
  const key = skel(heard);
  if (!key) return;
  const row = check(
    await db.from("note_aliases").select("hits").eq("user_id", userId).eq("skel", key).maybeSingle(),
  ) as { hits: number } | null;
  check(
    await db.from("note_aliases").upsert({
      user_id: userId,
      skel: key,
      canonical,
      hits: (row?.hits ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,skel" }),
  );
}

/** Развязать: это не то же самое, писать как сказано. */
export async function forgetAlias(userId: string, heard: string, canonical: string): Promise<void> {
  const key = skel(heard);
  if (!key) return;
  check(
    await db.from("note_aliases").upsert({
      user_id: userId,
      skel: key,
      canonical,
      hits: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,skel" }),
  );
}
