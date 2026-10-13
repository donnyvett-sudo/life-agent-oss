// Финансы: категории со словарём, курсы валют, счета, создание операций. Без ИИ.
import { check, db, type User, userCurrency } from "./db.ts";
import { type Currency, fmtMoney } from "./parse.ts";
import { localNow } from "./time.ts";
import { lang, t } from "./i18n.ts";

export type Kind = "expense" | "income";

type CategoryDef = { kind: Kind; code: string; title: string; mm?: string[]; words?: RegExp };

/**
 * Встроенные категории. mm — названия из Money Manager (для импорта),
 * words — словарь для новых записей (история учится отдельно, в category_rules).
 */
export const CATEGORY_DEFS: CategoryDef[] = [
  { kind: "expense", code: "cafe", title: "Кафе", mm: ["Eating out"], words: /(кафе|ресторан|макдак|макдон|mcdonald|kfc|бургер|пицц|кофе|лакин|luckin|доставк|meituan|шаурм|суши|обед|ужин|завтрак|ланч|cafe|restaurant|burger|pizza|coffee|delivery|shawarma|sushi|lunch|dinner|breakfast|noodles)/i },
  { kind: "expense", code: "canteen", title: "Столовая", mm: ["Canteen"], words: /(столов|canteen|食堂|mensa|dining hall)/i },
  { kind: "expense", code: "groceries", title: "Продукты", mm: ["Groceries"], words: /(продукт|магазин|супермаркет|снек|снэк|напит|(^|\s)вода($|\s)|фрукт|перекус|snack|drink|grocer|supermarket|water|fruit|store)/i },
  { kind: "expense", code: "transport", title: "Транспорт", mm: ["Transportation"], words: /(такси|метро|автобус|велик|байк|самокат|didi|диди|поезд|транспорт|metro|bus|bike|taxi|subway|scooter|train|didi|transport|ride)/i },
  { kind: "expense", code: "home", title: "Дом", mm: ["Home"], words: /(электрич|(^|\s)свет($|\s)|горяч|аренд|квартир|коммунал|общаг|electricity|rent|utilities|dorm|water bill|apartment)/i },
  { kind: "expense", code: "health", title: "Здоровье", mm: ["Health"], words: /(аптек|лекарств|врач|клиник|добавк|витамин|омега|магний|pharmacy|medicine|doctor|clinic|supplement|vitamin|omega|magnesium|dentist)/i },
  { kind: "expense", code: "study", title: "Учёба", mm: ["Study"], words: /(учеб|учёб|печать|распеча|книг|курс|тетрад|printing|study|textbook|book|course|tuition|print|stationery)/i },
  { kind: "expense", code: "comms", title: "Связь", mm: ["Communications"], words: /(связь|мобил|телефон|интернет|симк|сим-карт|mobile|phone bill|internet|sim card|data plan)/i },
  { kind: "expense", code: "subscriptions", title: "Подписки", mm: ["Subscriptions"], words: /(подписк|spotify|netflix|youtube|chatgpt|claude|icloud|vpn|впн|subscription)/i },
  { kind: "expense", code: "leisure", title: "Досуг", mm: ["Leisure"], words: /(кино|игр|(^|\s)бар($|\s)|клуб|концерт|боулинг|cinema|movie|game|bar|club|concert|bowling|karaoke)/i },
  { kind: "expense", code: "look", title: "Внешность", mm: ["Look"], words: /(стрижк|барбер|парикмах|одежд|кроссов|haircut|barber|clothes|clothing|sneakers|shoes|salon)/i },
  { kind: "expense", code: "workout", title: "Спорт", mm: ["Workout"], words: /(спортзал|тренир|бассейн|фитнес|gym|workout|fitness|pool|training)/i },
  { kind: "expense", code: "shopping", title: "Покупки", mm: ["Needed Stuff to Buy"], words: /(покупк|taobao|таобао|jd\b|техник|наушник|shopping|taobao|amazon|headphones|electronics)/i },
  { kind: "expense", code: "travel", title: "Путешествия", mm: ["Travel"], words: /(отел|гостиниц|самол|авиа|перелёт|перелет|hotel|hostel|flight|airline|ticket|trip|travel)/i },
  { kind: "expense", code: "gifts", title: "Подарки", mm: ["Gifts"], words: /(подар|gift|present)/i },
  { kind: "expense", code: "investment", title: "Инвестиции", mm: ["Investment"], words: /(инвест|акци|invest|stocks?|etf|crypto)/i },
  { kind: "expense", code: "fees", title: "Комиссии", words: /(комисси|commission|(^|\s)fees?($|\s))/i },
  { kind: "expense", code: "other", title: "Прочее", mm: [""] },
  { kind: "income", code: "allowance", title: "От семьи", mm: ["Allowance"], words: /(мама|папа|родител|семь|mom|dad|parents|family|allowance)/i },
  { kind: "income", code: "salary", title: "Стипендия и работа", words: /(стипенд|зарплат|(^|\s)зп($|\s)|репетит|работ|scholarship|stipend|salary|paycheck|tutoring|job|work|freelance)/i },
  { kind: "income", code: "gifts", title: "Подарки", mm: ["Gifts"], words: /(подар|gift|present)/i },
  { kind: "income", code: "cashback", title: "Проценты и кэшбэк", mm: ["Interest / Cashback", "Cashback"], words: /(кэшб|кешб|cashback|процент|interest)/i },
  { kind: "income", code: "dividends", title: "Дивиденды", mm: ["Dividends"], words: /(дивиденд|dividend)/i },
  { kind: "income", code: "opening", title: "Начальный остаток", words: /(начальн\w* остат|opening balance)/i },
  { kind: "income", code: "other", title: "Прочее", mm: [""] },
];

export type Category = { id: string; kind: Kind; code: string | null; title: string; sort: number; is_archived: boolean };

/** Завести недостающие встроенные категории. */
export async function ensureCategories(userId: string): Promise<Category[]> {
  const existing = check(
    await db.from("categories").select("*").eq("user_id", userId),
  ) as Category[];
  const have = new Set(existing.map((c) => `${c.kind}:${c.code}`));
  const missing = CATEGORY_DEFS.filter((d) => !have.has(`${d.kind}:${d.code}`));
  if (missing.length) {
    check(
      await db.from("categories").insert(
        missing.map((d) => ({
          user_id: userId,
          kind: d.kind,
          code: d.code,
          title: d.title,
          sort: CATEGORY_DEFS.indexOf(d),
        })),
      ),
    );
    return check(await db.from("categories").select("*").eq("user_id", userId)) as Category[];
  }
  return existing;
}

/** Ключ для правил: нижний регистр, без цифр и лишних пробелов. */
export function normalizeNote(note: string): string {
  return note.toLowerCase().replace(/ё/g, "е").replace(/[\d.,]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Категория по описанию: выученные правила → словарь → «Прочее». */
export async function resolveCategory(userId: string, kind: Kind, note: string): Promise<Category | null> {
  const cats = await ensureCategories(userId);
  const key = normalizeNote(note);
  const first = key.split(" ")[0];
  const rules = check(
    await db.from("category_rules").select("keyword,category_id").eq("user_id", userId)
      .eq("kind", kind).in("keyword", [...new Set([key, first])]),
  ) as { keyword: string; category_id: string }[];
  const rule = rules.find((r) => r.keyword === key) ?? rules.find((r) => r.keyword === first);
  const byId = (id: string) => cats.find((c) => c.id === id && !c.is_archived) ?? null;
  if (rule && byId(rule.category_id)) return byId(rule.category_id);

  const def = CATEGORY_DEFS.find((d) => d.kind === kind && d.words?.test(note));
  const code = def?.code ?? "other";
  return cats.find((c) => c.kind === kind && c.code === code && !c.is_archived) ?? null;
}

/** Запомнить исправление: в следующий раз такое описание сразу уйдёт в эту категорию. */
export async function learnCategory(userId: string, kind: Kind, note: string, categoryId: string) {
  const key = normalizeNote(note);
  if (!key) return;
  check(
    await db.from("category_rules").upsert(
      { user_id: userId, kind, keyword: key, category_id: categoryId, updated_at: new Date().toISOString() },
      { onConflict: "user_id,kind,keyword" },
    ),
  );
}

// ---------------------------------------------------------------- курсы ---

const FX_URL = "https://open.er-api.com/v6/latest/USD";
export const CURRENCIES: Currency[] = ["CNY", "KZT", "USD"];

/** Загрузить курсы на сегодня (UTC), если их ещё нет. */
export async function refreshRates(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await db.from("fx_rates").select("date", { count: "exact", head: true })
    .eq("date", today);
  if (count && count >= CURRENCIES.length) return;
  const res = await fetch(FX_URL, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json() as { result?: string; rates?: Record<string, number> };
  if (json.result !== "success" || !json.rates) throw new Error(`fx: ${JSON.stringify(json).slice(0, 200)}`);
  check(
    await db.from("fx_rates").upsert(
      CURRENCIES.map((c) => ({ date: today, currency: c, per_usd: json.rates![c] })),
      { onConflict: "date,currency" },
    ),
  );
}

/** Курсы на дату: ближайшие не позже неё (или самые ранние из имеющихся). */
async function ratesOn(date: string): Promise<Record<string, number>> {
  let rows = check(
    await db.from("fx_rates").select("date,currency,per_usd").lte("date", date)
      .order("date", { ascending: false }).limit(CURRENCIES.length * 3),
  ) as { date: string; currency: string; per_usd: number }[];
  if (rows.length === 0) {
    await refreshRates().catch((e) => console.warn(String(e)));
    rows = check(
      await db.from("fx_rates").select("date,currency,per_usd").order("date", { ascending: true })
        .limit(CURRENCIES.length * 3),
    ) as typeof rows;
  }
  const out: Record<string, number> = {};
  for (const r of rows) out[r.currency] ??= Number(r.per_usd);
  return out;
}

type RateRow = { date: string; currency: string; per_usd: number };

/** Вся таблица курсов по возрастанию даты. Страницами: ответ Supabase ограничен 1000 строк. */
async function allRates(): Promise<RateRow[]> {
  const page = 1000;
  const out: RateRow[] = [];
  for (let from = 0;; from += page) {
    const rows = check(
      await db.from("fx_rates").select("date,currency,per_usd").order("date", { ascending: true })
        .order("currency").range(from, from + page - 1),
    ) as RateRow[];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/**
 * Конвертер с кэшем курсов по датам — для пересчёта многих операций за раз
 * (одна выборка курсов на дату, а не на каждую операцию).
 */
export function makeConverter() {
  // Строк немного (3 в день): грузим один раз и ищем в памяти.
  let table: Promise<RateRow[]> | null = null;
  const load = async () => {
    const rows = await allRates();
    if (rows.length) return rows;
    await refreshRates().catch((e) => console.warn(String(e)));
    return await allRates();
  };
  const cache = new Map<string, Record<string, number>>();
  const ratesFor = async (date: string) => {
    if (cache.has(date)) return cache.get(date)!;
    const rows = await (table ??= load());
    // Последний курс не позже даты; для дат раньше первой записи — самый ранний.
    const out: Record<string, number> = {};
    for (const r of rows) if (r.date <= date || !out[r.currency]) out[r.currency] = Number(r.per_usd);
    cache.set(date, out);
    return out;
  };
  return async (amount: number, from: string, to: string, date: string): Promise<number> => {
    if (from === to) return amount;
    const r = await ratesFor(date);
    if (!r[from] || !r[to]) throw new Error(`нет курса ${from}/${to}`);
    return Math.round((amount / r[from]) * r[to] * 100) / 100;
  };
}

/**
 * Сумма из базы (всё сведено к CNY) в валюте пользователя, готовая к показу.
 * Курса нет — показываем как есть, лучше юани, чем ошибка.
 */
export async function userMoney(user: User, amountCny: number, date: string): Promise<string> {
  const cur = userCurrency(user);
  if (cur === "CNY") return fmtMoney(amountCny, "CNY", lang(user));
  const v = await convert(amountCny, "CNY", cur, date).catch(() => null);
  return v == null ? fmtMoney(amountCny, "CNY", lang(user)) : fmtMoney(v, cur, lang(user));
}

/** Перевести сумму между валютами по курсу на дату. */
export async function convert(amount: number, from: string, to: string, date: string): Promise<number> {
  if (from === to) return amount;
  const r = await ratesOn(date);
  if (!r[from] || !r[to]) throw new Error(`нет курса ${from}/${to}`);
  return Math.round((amount / r[from]) * r[to] * 100) / 100;
}

// ---------------------------------------------------------------- счета ---

export type Account = {
  id: string;
  title: string;
  currency: Currency;
  is_default: boolean;
  in_total: boolean;
  is_archived: boolean;
  sort: number;
  opening_balance: number;
};

/** Счёт для новой операции: основной в этой валюте → любой в этой валюте → любой основной. */
export async function defaultAccount(userId: string, currency: string): Promise<Account | null> {
  const accs = check(
    await db.from("accounts").select("*").eq("user_id", userId).eq("is_archived", false)
      .order("sort"),
  ) as Account[];
  return accs.find((a) => a.currency === currency && a.is_default) ??
    accs.find((a) => a.currency === currency) ??
    accs.find((a) => a.is_default) ??
    accs[0] ?? null;
}

/** Первая запись у нового человека: счетов ещё нет — заводим наличные в валюте записи. */
async function createCashAccount(userId: string, currency: string): Promise<Account> {
  return check(
    await db.from("accounts").insert({
      user_id: userId,
      title: "Наличные",
      currency,
      is_default: true,
      in_total: true,
      sort: 0,
    }).select("*").single(),
  ) as Account;
}

export type NewTransaction = {
  kind: Kind;
  amount: number;
  currency: string;
  note: string;
  note_heard?: string | null;
  raw_text?: string;
  occurred_at?: string;
  category_id?: string | null;
  account_id?: string | null;
  source?: string;
};

export type TransactionRow = {
  id: string;
  kind: Kind;
  amount: number;
  currency: string;
  amount_cny: number | null;
  amount_account: number | null;
  note: string | null;
  note_heard: string | null;
  category_id: string | null;
  account_id: string | null;
  occurred_at: string;
};

/** Создать операцию: подобрать счёт и категорию, посчитать суммы в валюте счёта и в юанях. */
export async function createTransaction(
  userId: string,
  tz: string,
  t: NewTransaction,
): Promise<TransactionRow> {
  const occurred = t.occurred_at ? new Date(t.occurred_at) : new Date();
  const date = localNow(tz, occurred).date;

  let account: Account | null = null;
  if (t.account_id) {
    account = check(
      await db.from("accounts").select("*").eq("id", t.account_id).eq("user_id", userId).maybeSingle(),
    ) as Account | null;
  }
  account ??= await defaultAccount(userId, t.currency) ?? await createCashAccount(userId, t.currency);

  const categoryId = t.category_id !== undefined
    ? t.category_id
    : (await resolveCategory(userId, t.kind, t.note))?.id ?? null;

  const [amountCny, amountAccount] = await Promise.all([
    convert(t.amount, t.currency, "CNY", date),
    account ? convert(t.amount, t.currency, account.currency, date) : Promise.resolve(null),
  ]);

  return check(
    await db.from("transactions").insert({
      user_id: userId,
      kind: t.kind,
      amount: t.amount,
      currency: t.currency,
      note: t.note,
      note_heard: t.note_heard ?? null,
      raw_text: t.raw_text ?? null,
      occurred_at: occurred.toISOString(),
      category_id: categoryId,
      account_id: account?.id ?? null,
      amount_account: amountAccount,
      amount_cny: amountCny,
      source: t.source ?? "bot",
    }).select("*").single(),
  ) as TransactionRow;
}

/** Пересчитать суммы после смены счёта / суммы / валюты / даты. */
export async function recalcTransaction(userId: string, tz: string, id: string): Promise<void> {
  const t = check(
    await db.from("transactions").select("*").eq("id", id).eq("user_id", userId).single(),
  ) as TransactionRow;
  const date = localNow(tz, new Date(t.occurred_at)).date;
  const acc = t.account_id
    ? check(await db.from("accounts").select("currency").eq("id", t.account_id).single()) as { currency: string }
    : null;
  check(
    await db.from("transactions").update({
      amount_cny: await convert(Number(t.amount), t.currency, "CNY", date),
      amount_account: acc ? await convert(Number(t.amount), t.currency, acc.currency, date) : null,
    }).eq("id", id),
  );
}

/** Итоги по валюте юаня за период [from, to). */
export async function totalsCny(userId: string, from: Date, to: Date) {
  const rows = check(
    await db.from("transactions").select("kind,amount_cny").eq("user_id", userId)
      .gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString()),
  ) as { kind: Kind; amount_cny: number | null }[];
  let expense = 0, income = 0, count = 0;
  for (const r of rows) {
    if (r.kind === "expense") {
      expense += Number(r.amount_cny ?? 0);
      count++;
    } else income += Number(r.amount_cny ?? 0);
  }
  return { expense: Math.round(expense * 100) / 100, income: Math.round(income * 100) / 100, count };
}
