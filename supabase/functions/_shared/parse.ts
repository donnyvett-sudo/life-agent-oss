// Детерминированный разбор записей: «обед 35», «такси 18.5», «обед 45 тенге», «35 обед»,
// «20$ подписка», «+3000 стипендия» (доход), «стипендия 3000» (доход по слову).
// По-английски так же: «lunch 35», «taxi 18.5», «+3000 scholarship».
import type { Lang } from "./i18n.ts";

export type Currency = "CNY" | "KZT" | "USD";

export type ParsedEntry = {
  kind: "expense" | "income";
  note: string;
  amount: number;
  currency: Currency;
};

const CURRENCIES: [RegExp, Currency][] = [
  [/^(тенге|тинге|тэнге|теньге|тг|тнг|₸|kzt|tenge)$/i, "KZT"],
  [/^(\$|usd|долл\S*|бакс\S*|dollars?|bucks?)$/i, "USD"],
  [/^(юан\S*|куа[йи]|cny|rmb|¥|元|块|yuan|kuai)$/i, "CNY"],
];

// Доход по смыслу, даже без «+».
const INCOME_WORDS =
  /^(стипенд|зарплат|зп($|\s)|кэшб|кешб|cashback|процент|дивиденд|возврат|долг|allowance|scholarship|stipend|salary|paycheck|refund|interest|dividend|debt)/i;

// Глагол прихода в начале фразы: «пополнил Kaspi на 20000», «скинули 5000», «вернули долг 2000».
// Съедаем его вместе с предлогом, иначе он попадёт в название записи.
const INCOME_LEAD =
  /^(пополнил[аи]?|закинул[аи]?|положил[аи]?|скинули|прислал[аи]?|перевели|перечислил[аи]?|получил[аи]?|заработал[аи]?|вернули|deposited|topped up|top up|got|received|earned)\s+/i;

const AMOUNT = String.raw`(\d+(?:[.,]\d{1,2})?)`;

function currencyOf(token: string | undefined, base: Currency): Currency | null {
  if (!token) return base;
  for (const [re, cur] of CURRENCIES) if (re.test(token)) return cur;
  return null;
}

/** base — валюта пользователя: суммы без валютного слова считаются в ней. */
export function parseEntry(input: string, base: Currency = "CNY"): ParsedEntry | null {
  let text = input.trim().replace(/\s+/g, " ");
  if (text.length > 60 || text.startsWith("/")) return null;

  let kind: ParsedEntry["kind"] = "expense";
  if (text.startsWith("+")) {
    kind = "income";
    text = text.slice(1).trim();
  }
  const lead = text.match(INCOME_LEAD);
  if (lead) {
    kind = "income";
    text = text.slice(lead[0].length).trim();
  }
  const incoming = kind === "income" && lead !== null;
  // «$20 …» → «20 $ …»
  text = text.replace(/(^|\s)([$¥₸])(\d+(?:[.,]\d{1,2})?)/g, (_, pre, sign, num) => `${pre}${num} ${sign}`);
  // «45тг», «20$» → «45 тг», «20 $»
  text = text.replace(new RegExp(`${AMOUNT}([^\\d\\s.,]+)`, "gu"), "$1 $2");

  let note: string, amount: string, cur: string | undefined;
  let m = text.match(new RegExp(`^(.+?) ${AMOUNT} ?(\\S+)?$`, "u"));
  if (m) {
    [, note, amount, cur] = m;
  } else {
    m = text.match(new RegExp(`^${AMOUNT} ?(\\S+)? (.+)$`, "u"));
    if (!m) return null;
    [, amount, cur, note] = m;
    // «35 обед»: второй токен не валюта, значит это часть описания.
    if (cur && !currencyOf(cur, base)) {
      note = `${cur} ${note}`;
      cur = undefined;
    }
  }

  const currency = currencyOf(cur, base);
  if (!currency) return null;
  // «пополнил Kaspi на 20000» → название «Kaspi»: предлог глагола прихода не нужен.
  // Только после такого глагола: иначе «лёг вчера поздно в 1» потеряло бы «в» и стало тратой.
  note = note.trim();
  if (incoming) note = note.replace(/\s+(на|в|во|to|on|onto|into)$/i, "").trim();
  // Описание: 1–3 слова с буквами; длинные фразы считаем разговором с коучем.
  if (!/\p{L}/u.test(note) || note.split(" ").length > 3) return null;
  // «вчера обед 35» отдаём живому разбору: здесь дату учесть негде, и запись легла бы
  // на сегодня с названием «вчера обед».
  if (/^(вчера|позавчера|сегодня|yesterday|today)($|\s)/i.test(note)) return null;

  const value = Number(amount.replace(",", "."));
  if (!(value > 0)) return null;
  if (INCOME_WORDS.test(note)) kind = "income";

  return { kind, note, amount: value, currency };
}

const FOOD =
  /(обед|ланч|завтрак|ужин|еда|перекус|столов|кафе|ресторан|доставк|макдо|kfc|бургер|пицц|лапш|шаурм|lunch|dinner|breakfast|food|snack|canteen|cafe|restaurant|delivery|burger|pizza|noodles|sushi)/i;

/** Эта трата — обед (или еда в обеденное окно)? Тогда пора напомнить про добавки. */
export function isLunch(p: ParsedEntry, localMinutes: number): boolean {
  if (p.kind !== "expense") return false;
  if (/(обед|ланч|lunch)/i.test(p.note)) return true;
  return FOOD.test(p.note) && localMinutes >= 11 * 60 && localMinutes < 16 * 60;
}

export const CURRENCY_SIGN: Record<string, string> = { CNY: "¥", KZT: "₸", USD: "$" };

export function fmtMoney(amount: number, currency: string, lang: Lang = "ru"): string {
  const v = Math.round(amount * 100) / 100;
  const s = v.toLocaleString(lang === "en" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 }).replace(/ /g, " ");
  return `${s} ${CURRENCY_SIGN[currency] ?? currency}`;
}
