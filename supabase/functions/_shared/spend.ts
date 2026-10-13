// Вопросы про деньги: «сколько потратил вчера и сегодня», «на что ушло за неделю».
// Считаем сами, без Gemini: цифры точные, лимит ИИ не тратится и коуч не выдумывает суммы.
import { check, db, type User } from "./db.ts";
import { userMoney } from "./finance.ts";
import { type Lang, lang, t } from "./i18n.ts";
import { dayBounds, localNow, shiftDate } from "./time.ts";

export type Period = {
  from: string;
  to: string;
  /** Ключ перевода: «вчера», «за {n} дн.», «в {month}». */
  label: string;
  vars?: Record<string, string | number>;
  /** Номер месяца 1–12, если период — месяц по названию. */
  month?: number;
};

type Row = {
  kind: "expense" | "income";
  amount_cny: number | null;
  occurred_at: string;
  note: string | null;
  categories: { title: string } | null;
};

export type Spend = {
  expense: number;
  income: number;
  count: number;
  byCat: { title: string; cny: number }[];
  byDay: { date: string; cny: number }[];
};

const MONTHS: [RegExp, number][] = [
  [/январ|january|\bjan\b/i, 1],
  [/феврал|february|\bfeb\b/i, 2],
  [/март|march|\bmar\b/i, 3],
  [/апрел|april|\bapr\b/i, 4],
  [/\bма[йея]\b|\bmay\b/i, 5],
  [/июн|june|\bjun\b/i, 6],
  [/июл|july|\bjul\b/i, 7],
  [/август|august|\baug\b/i, 8],
  [/сентябр|september|\bsep\b/i, 9],
  [/октябр|october|\boct\b/i, 10],
  [/ноябр|november|\bnov\b/i, 11],
  [/декабр|december|\bdec\b/i, 12],
];

const MONTH_NAMES: Record<Lang, string[]> = {
  ru: [
    "январе",
    "феврале",
    "марте",
    "апреле",
    "мае",
    "июне",
    "июле",
    "августе",
    "сентябре",
    "октябре",
    "ноябре",
    "декабре",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthEnd = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};

/** Период из вопроса. null — период не назван, берём сегодня. */
export function parsePeriod(text: string, today: string): Period | null {
  const q = text.toLowerCase();
  const day = (delta: number) => shiftDate(today, delta);
  const has = (re: RegExp) => re.test(q);

  if (has(/за\s+в[её]с[ье]\s+врем|за всю историю|all time/)) {
    return { from: "2000-01-01", to: today, label: "за всё время" };
  }
  if (has(/позавчера|day before yesterday/)) {
    return { from: day(-2), to: day(-2), label: "позавчера" };
  }

  const yesterday = has(/вчера|yesterday/);
  const todayWord = has(/сегодня|today/);
  if (yesterday && todayWord) return { from: day(-1), to: today, label: "вчера и сегодня" };
  if (yesterday) return { from: day(-1), to: day(-1), label: "вчера" };
  if (todayWord) return { from: today, to: today, label: "сегодня" };

  if (has(/прошл\S*\s+недел|last week/)) {
    return { from: day(-13), to: day(-7), label: "на прошлой неделе" };
  }
  if (has(/(за|последн\S*)\s*(недел|7\s*дн)|на этой недел|с понедельника|this week|past week|last 7 days/)) {
    return { from: day(-6), to: today, label: "за неделю" };
  }
  if (has(/прошл\S*\s+месяц|last month/)) {
    const [y, m] = today.split("-").map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: `${py}-${pad(pm)}-01`, to: monthEnd(py, pm), label: "в прошлом месяце" };
  }
  if (has(/(этот|этом|текущ\S*)\s+месяц|с начала месяца|за месяц|this month/)) {
    return { from: monthStart(today), to: today, label: "в этом месяце" };
  }
  const days = q.match(/за\s+(\d{1,3})\s*дн|last\s+(\d{1,3})\s*days/);
  if (days) {
    const n = Math.min(365, Math.max(1, Number(days[1] ?? days[2])));
    return { from: day(-(n - 1)), to: today, label: "за {n} дн.", vars: { n } };
  }
  for (const [re, m] of MONTHS) {
    if (!re.test(q)) continue;
    const [y, cm] = today.split("-").map(Number);
    const year = m > cm ? y - 1 : y;
    const to = year === y && m === cm ? today : monthEnd(year, m);
    return { from: `${year}-${pad(m)}-01`, to, label: "в {month}", month: m };
  }
  return null;
}

/** Суммы за период местных дат [from, to] включительно. */
export async function spendRange(user: User, from: string, to: string): Promise<Spend> {
  const a = dayBounds(from, user.tz).from;
  const b = dayBounds(to, user.tz).to;
  const rows = check(
    await db.from("transactions").select("kind,amount_cny,occurred_at,note,categories(title)")
      .eq("user_id", user.id).gte("occurred_at", a.toISOString()).lt("occurred_at", b.toISOString()),
  ) as unknown as Row[];

  let expense = 0, income = 0, count = 0;
  const cats = new Map<string, number>();
  const days = new Map<string, number>();
  for (const r of rows) {
    const cny = Number(r.amount_cny ?? 0);
    if (r.kind === "income") {
      income += cny;
      continue;
    }
    expense += cny;
    count++;
    const title = r.categories?.title ?? "Без категории";
    cats.set(title, (cats.get(title) ?? 0) + cny);
    const d = localNow(user.tz, new Date(r.occurred_at)).date;
    days.set(d, (days.get(d) ?? 0) + cny);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    expense: round(expense),
    income: round(income),
    count,
    byCat: [...cats].map(([title, cny]) => ({ title, cny: round(cny) })).sort((x, y) => y.cny - x.cny),
    byDay: [...days].map(([date, cny]) => ({ date, cny: round(cny) })).sort((x, y) => x.date.localeCompare(y.date)),
  };
}

const ASK =
  /(сколько|покажи|итог|сводк|по категори|на что|отчёт|отчет|статистик|how much|show me|what did i|breakdown|report|total)/i;
const MONEY =
  /(потрат|трат|расход|доход|заработ|ушл[оаи]|денег|деньги|бюджет|спустил|накопил|spen[dt]|expense|income|earn|money|budget|cost)/i;
const INCOME_Q = /(доход|заработ|получил|зарплат|income|earn|salary)/i;
const EXPENSE_Q = /(потрат|трат|расход|spen[dt]|expense|cost)/i;
const CATS_Q = /(по категори|на что|категор|подробн|разбив|categor|breakdown|on what|detail)/i;

/** Похоже ли на вопрос о деньгах, а не на запись траты. */
export function looksLikeMoneyQuestion(text: string): boolean {
  if (!ASK.test(text) || !MONEY.test(text)) return false;
  // «потратил 35 на обед» — это запись, а не вопрос: есть сумма и нет вопросительного слова.
  if (/\d/.test(text) && !/(сколько|по категори|на что|итог|сводк|статистик|отчёт|отчет|how much|breakdown|total|report)/i.test(text)) return false;
  return true;
}

const dayName = (user: User, date: string, today: string) =>
  date === today ? t(user, "сегодня") : date === shiftDate(today, -1) ? t(user, "вчера") : date.slice(5);

/** Готовый ответ на денежный вопрос. null — вопрос не про деньги. */
export async function moneyAnswer(user: User, text: string): Promise<string | null> {
  if (!looksLikeMoneyQuestion(text)) return null;
  const today = localNow(user.tz).date;
  const period = parsePeriod(text, today) ?? { from: today, to: today, label: "сегодня" };
  const s = await spendRange(user, period.from, period.to);
  const money = (cny: number) => userMoney(user, cny, period.to);

  const vars = period.month
    ? { month: MONTH_NAMES[lang(user)][period.month - 1] }
    : period.vars;
  const label = t(user, period.label, vars);
  const wantsIncome = INCOME_Q.test(text) && !EXPENSE_Q.test(text);
  if (wantsIncome) {
    if (!s.income) return t(user, "Доходов {period} не записано.", { period: label });
    return t(user, "Доходы {period}: <b>{sum}</b>.", { period: label, sum: await money(s.income) });
  }
  if (!s.count) return t(user, "Трат {period} не записано.", { period: label });

  const lines = [
    t(user, "Траты {period}: <b>{sum}</b> ({n}).", { period: label, sum: await money(s.expense), n: s.count }),
  ];

  // По дням — когда период короткий: «вчера 120, сегодня 94».
  if (s.byDay.length > 1 && s.byDay.length <= 7) {
    const parts = await Promise.all(
      s.byDay.map(async (d) => `${dayName(user, d.date, today)} ${await money(d.cny)}`),
    );
    lines.push(t(user, "По дням: {list}.", { list: parts.join(", ") }));
  }

  const wantsCats = CATS_Q.test(text);
  const top = s.byCat.slice(0, wantsCats ? 8 : 3);
  if (top.length) {
    const parts = await Promise.all(
      top.map(async (c) => `${t(user, c.title)} ${await money(c.cny)}`),
    );
    const rest = s.byCat.length - top.length;
    const more = rest > 0 ? ", " + t(user, "ещё {n}", { n: rest }) : "";
    lines.push(t(user, "По категориям: {list}.", { list: parts.join(", ") + more }));
  }
  if (s.income) lines.push(t(user, "Доходы: {sum}.", { sum: await money(s.income) }));
  return lines.join("\n");
}

/** Денежные строки для фактов коуча: день, вчера, неделя, месяц и топ категорий. */
export async function financeFacts(user: User): Promise<string[]> {
  const today = localNow(user.tz).date;
  const [day, prev, week, month] = await Promise.all([
    spendRange(user, today, today),
    spendRange(user, shiftDate(today, -1), shiftDate(today, -1)),
    spendRange(user, shiftDate(today, -6), today),
    spendRange(user, monthStart(today), today),
  ]);
  const money = (cny: number) => userMoney(user, cny, today);
  const lines = [
    t(user, "Траты: сегодня {day}, вчера {prev}, за 7 дней {week}, с начала месяца {month}.", {
      day: await money(day.expense),
      prev: await money(prev.expense),
      week: await money(week.expense),
      month: await money(month.expense),
    }),
  ];
  if (week.byCat.length) {
    const parts = await Promise.all(
      week.byCat.slice(0, 5).map(async (c) => `${t(user, c.title)} ${await money(c.cny)}`),
    );
    lines.push(t(user, "Категории за 7 дней: {list}.", { list: parts.join(", ") }));
  }
  if (month.income) {
    lines.push(t(user, "Доходы с начала месяца: {sum}.", { sum: await money(month.income) }));
  }
  lines.push(t(user, "Точные суммы за любой период бот считает сам — можно просто спросить."));
  return lines;
}
