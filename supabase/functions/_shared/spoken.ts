// Разбор живой речи о деньгах: «потратил 35 юаней на обед», «вчера такси 18 и кофе 25»,
// «получил стипендию 3000 тенге». Детерминированно; Gemini — только запасной вариант.
import { generate } from "./gemini.ts";
import type { Currency, ParsedEntry } from "./parse.ts";
import type { ParsedTransfer } from "./transferbot.ts";

export type SpokenEntry = ParsedEntry & { daysAgo: number };

const NUMBER = /(\d+(?:[.,]\d{1,2})?)/;
const CURRENCY_WORDS: [RegExp, Currency][] = [
  [/(тенге|тинге|тэнге|теньге|тнг|(^|\s)тг($|\s)|₸|kzt|tenge)/i, "KZT"],
  [/(доллар|бакс|\$|usd|dollars?|bucks?)/i, "USD"],
  [/(юан|куа[йи]|кита[йи]ских|rmb|cny|¥|元|块|yuan|kuai)/i, "CNY"],
];
const INCOME =
  /(получил|получила|пришл[оиа]|заработал|стипенд|зарплат|зп($|\s)|кэшб|кешб|вернули|вернул мне|отдал[аи]? мне|доход|пополнил|пополнила|закинул|положил[аи]? на|скинул\S* мне|скинули|прислал|прислали|перечислил|перевели|перевёл мне|перевел мне|(^|\s)занял\S* мне|\+\s*\d|\b(got|earned|received|salary|paycheck|scholarship|allowance|refund|cashback|income|deposit|deposited|topped up|top ?up|sent me|transferred me|paid me|lent me)\b)/i;
// Служебные слова, которые не описывают трату.
const FILLER = new Set([
  "вот", "я", "мы", "сегодня", "вчера", "позавчера", "потратил", "потратила", "потратили", "потрачено",
  "заплатил", "заплатила", "заплатили", "оплатил", "оплатила", "купил", "купила", "взял", "взяла",
  "отдал", "отдала", "получил", "получила", "пришло", "пришли", "пришла", "заработал", "заработала",
  "на", "за", "в", "во", "по", "с", "это", "было", "сколько", "около", "примерно", "всего", "ещё", "еще",
  "и", "а", "также", "плюс", "минус", "расход", "трата", "стоил", "стоило", "стоила", "мне",
  // Английские служебные слова: «I spent 35 on lunch yesterday».
  "i", "we", "today", "yesterday", "spent", "spend", "paid", "pay", "bought", "buy", "got", "received",
  "earned", "cost", "costs", "on", "for", "at", "in", "of", "a", "an", "the", "it", "was", "were",
  "about", "around", "some", "and", "plus", "minus", "also", "another", "more", "me", "my",
  // Приход денег: «мне скинули 5000 от мамы» → название «мамы», а не «скинули».
  "скинул", "скинула", "скинули", "закинул", "закинула", "закинули", "прислал", "прислала",
  "прислали", "перевели", "перевёл", "перевел", "перечислил", "перечислила", "перечислили",
  "пополнил", "пополнила", "положил", "положила", "положили", "вернул", "вернула", "вернули",
  "дали", "занял", "заняла", "заняли", "от", "деньги", "счёт", "счет", "карту", "карты",
  "sent", "lent", "deposited", "topped", "up", "transferred", "back", "from", "into", "onto",
]);
const CURRENCY_TOKEN =
  /^(юан\S*|куа[йи]|тенге|тинге|тэнге|теньге|тг|тнг|доллар\S*|бакс\S*|кита[йи]ских|rmb|cny|usd|kzt|yuan|kuai|tenge|dollars?|bucks?|[$¥₸元块])$/i;

function segmentEntry(seg: string, daysAgo: number, base: Currency): SpokenEntry | null {
  const m = seg.match(NUMBER);
  if (!m) return null;
  const amount = Number(m[1].replace(",", "."));
  if (!(amount > 0) || amount > 1e8) return null;

  const currency = CURRENCY_WORDS.find(([re]) => re.test(seg))?.[1] ?? base;
  const kind = INCOME.test(seg) ? "income" : "expense";
  const words = seg.replace(m[0], " ").replace(/[.,!?;:+]/g, " ").split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w && !FILLER.has(w) && !CURRENCY_TOKEN.test(w) && !/^\d/.test(w));
  const note = words.slice(0, 4).join(" ") || (kind === "income" ? "доход" : "расход");
  return { kind, amount: Math.round(amount * 100) / 100, currency, note, daysAgo };
}

/** Одна фраза может содержать несколько трат: «такси 18 и кофе 25». */
export function parseSpoken(input: string, base: Currency = "CNY"): SpokenEntry[] {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text || text.length > 300 || !NUMBER.test(text)) return [];
  const daysAgo = /позавчера|day before yesterday/i.test(text)
    ? 2
    : /вчера|yesterday/i.test(text)
    ? 1
    : 0;

  // Делим на части, только если в каждой части есть число.
  // Запятая с цифрой после — десятичная («25,5»), по ней не режем.
  const parts = text
    .split(/\s*(?:,(?!\d)|;|\sи\s|\sа ещё\s|\sа еще\s|\sплюс\s|\sand\s|\splus\s|\.\s)\s*/i)
    .filter(Boolean);
  const segments = parts.length > 1 && parts.every((p) => NUMBER.test(p)) ? parts : [text];
  return segments.map((s) => segmentEntry(s, daysAgo, base)).filter((e): e is SpokenEntry => e !== null);
}

/** Валюта, названная словом в фразе («в тенге», «юаней»). */
export function spokenCurrency(text: string): Currency | null {
  return CURRENCY_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** Похоже ли на запись о деньгах (для голосовых в чате, чтобы не путать с разговором). */
export function looksLikeMoney(text: string): boolean {
  return NUMBER.test(text) &&
    /(потрат|заплат|оплат|купил|стоил|получил|пришл|заработал|стипенд|зарплат|пополн|закинул|скинул|прислал|перечислил|перевели|вернули|занял\S* мне|юан|куа[йи]|тенге|тинге|доллар|бакс|[$¥₸]|\b(spent|spend|paid|bought|cost|got|earned|salary|scholarship|deposit|deposited|top ?up|topped up|sent me|lent me|yuan|kuai|tenge|dollars?|bucks?)\b)/i.test(text);
}

/**
 * Запасной разбор через Gemini: в модель уходит только сама фраза.
 * Возвращает либо траты и доходы, либо перевод между своими счетами — одним обращением,
 * чтобы дневной лимит ИИ не тратился дважды на одну фразу.
 */
export async function parseSpokenAI(
  text: string,
  base: Currency = "CNY",
): Promise<{ entries: SpokenEntry[]; transfer: ParsedTransfer | null }> {
  const out = await generate(
    "Извлеки денежные операции из фразы (русский или английский). Верни ТОЛЬКО JSON без пояснений: " +
      '{"entries":[{"kind":"expense"|"income","amount":число,"currency":"CNY"|"KZT"|"USD","note":"1-3 слова, что это","daysAgo":0|1|2}]}. ' +
      "note пиши латиницей: обычные слова переводи на английский (чай → Tea, обед → Lunch), " +
      "названия сетей и заведений пиши так, как они пишутся официально (Макдональдс → McDonalds, " +
      "Лакин → Luckin). Нишевое название без принятого латинского написания оставь на русском. " +
      `Валюта: если в фразе названа («тенге», «юаней», «долларов», "tenge", "yuan", "dollars") — бери её, иначе ${base}. ` +
      "«вчера» / yesterday — daysAgo 1. Если сумм нет — пустой массив. " +
      "Если это перемещение денег между СВОИМИ счетами (перевёл, перекинул, обменял, поменял валюту, " +
      "пополнил один свой счёт с другого), верни вместо entries: " +
      '{"transfer":{"fromAmount":число,"fromCurrency":"CNY"|"KZT"|"USD"|null,"toAmount":число|null,' +
      '"toCurrency":"CNY"|"KZT"|"USD"|null,"fromHint":"кусок названия счёта как сказано"|null,' +
      '"toHint":"кусок названия счёта"|null,"daysAgo":0|1|2}}. ' +
      "Деньги от другого человека («скинули мне», «прислал», «зарплата») — это НЕ перевод, а income.",
    [{ role: "user", text: text.slice(0, 300) }],
    400,
  );
  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { entries: [], transfer: null };
  try {
    const parsed = JSON.parse(json) as {
      entries?: Partial<SpokenEntry>[];
      transfer?: Partial<ParsedTransfer> | null;
    };
    const entries = (parsed.entries ?? []).flatMap((e) => {
      const amount = Number(e.amount);
      if (!(amount > 0) || amount > 1e8) return [];
      const currency = (["CNY", "KZT", "USD"] as const).find((c) => c === e.currency) ?? base;
      return [{
        kind: e.kind === "income" ? "income" as const : "expense" as const,
        amount: Math.round(amount * 100) / 100,
        currency,
        note: String(e.note ?? "").trim().slice(0, 40) || "расход",
        daysAgo: [1, 2].includes(Number(e.daysAgo)) ? Number(e.daysAgo) : 0,
      }];
    });
    return { entries, transfer: cleanTransfer(parsed.transfer, base) };
  } catch {
    return { entries: [], transfer: null };
  }
}

const money = (v: unknown): number | null => {
  const n = Number(v);
  return n > 0 && n <= 1e9 ? Math.round(n * 100) / 100 : null;
};
const cur = (v: unknown): Currency | null => (["CNY", "KZT", "USD"] as const).find((c) => c === v) ?? null;
const hint = (v: unknown): string | null => {
  const s = String(v ?? "").trim().slice(0, 40);
  return s && /\p{L}/u.test(s) && s !== "null" ? s : null;
};

/** Перевод от модели: без суммы и без обеих сторон он бесполезен. */
function cleanTransfer(raw: unknown, base: Currency): ParsedTransfer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fromAmount = money(r.fromAmount);
  if (fromAmount === null) return null;
  const t: ParsedTransfer = {
    fromAmount,
    toAmount: money(r.toAmount),
    fromCurrency: cur(r.fromCurrency),
    toCurrency: cur(r.toCurrency),
    fromHint: hint(r.fromHint),
    toHint: hint(r.toHint),
    daysAgo: [1, 2].includes(Number(r.daysAgo)) ? Number(r.daysAgo) : 0,
  };
  // Ни счетов, ни второй валюты — сторону «куда» подобрать не из чего.
  if (!t.toHint && !t.fromHint && (t.toCurrency ?? base) === (t.fromCurrency ?? base)) return null;
  return t;
}
