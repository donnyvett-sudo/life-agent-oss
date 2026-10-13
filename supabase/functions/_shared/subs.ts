/**
 * Подписки и регулярные списания. Никто их не заводит руками: они видны прямо
 * в истории — одно и то же название, похожая сумма, ровный шаг в днях. Нужны,
 * чтобы забытая подписка не тянула деньги молча и чтобы знать обязательный
 * расход месяца до того, как он случится.
 */
import { check, db, type User } from "./db.ts";
import { lang, t } from "./i18n.ts";
import { skel } from "./naming.ts";
import { fmtMoney } from "./parse.ts";
import { localNow, shiftDate } from "./time.ts";

/** Смотрим год назад: меньше — и годовые списания не соберутся в ряд. */
const WINDOW_DAYS = 400;
/** Три повтора — уже правило, два — совпадение. */
const MIN_HITS = 3;
/** Сумма гуляет от курса и от тарифа, но не в разы. */
const AMOUNT_SPREAD = 1.2;

export type Period = "week" | "month" | "quarter" | "year";

export type Sub = {
  note: string;
  amount: number;
  currency: string;
  period: Period;
  count: number;
  last: string;
  next: string;
  /** Сколько это стоит в месяц: годовая подписка делится на 12. */
  perMonth: number;
  /** Списание просрочено больше чем на неделю — возможно, отписались. */
  overdue: boolean;
};

export type Charge = { date: string; amount: number; currency: string; note: string };

const PERIODS: { period: Period; days: number; min: number; max: number }[] = [
  { period: "week", days: 7, min: 6, max: 8 },
  { period: "month", days: 30, min: 26, max: 33 },
  { period: "quarter", days: 91, min: 85, max: 96 },
  { period: "year", days: 365, min: 358, max: 372 },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Разложить списания на подписки. Чистая функция: на вход — операции с датами
 * по местному времени, на выход — то, что повторяется ровным шагом.
 */
export function detect(charges: Charge[], today: string): Sub[] {
  const groups = new Map<string, Charge[]>();
  for (const c of charges) {
    const name = skel(c.note);
    if (!name) continue;
    const key = `${c.currency}|${name}`;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }

  const subs: Sub[] = [];
  for (const items of groups.values()) {
    if (items.length < MIN_HITS) continue;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((c) => c.amount);
    if (Math.max(...amounts) > Math.min(...amounts) * AMOUNT_SPREAD) continue;

    // Два списания в один день — это не шаг, а разбитая покупка.
    const dates = [...new Set(sorted.map((c) => c.date))];
    if (dates.length < MIN_HITS) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const step = median(gaps);
    const found = PERIODS.find((p) => step >= p.min && step <= p.max);
    if (!found) continue;
    // Ряд должен быть ровным: один выброс терпим, разнобой — нет.
    const offbeat = gaps.filter((g) => g < found.min || g > found.max).length;
    if (offbeat > Math.floor(gaps.length / 3)) continue;

    const last = dates[dates.length - 1];
    const amount = round2(median(amounts));
    const perMonth = found.period === "year"
      ? amount / 12
      : found.period === "quarter"
      ? amount / 3
      : found.period === "week"
      ? amount * (30 / 7)
      : amount;
    subs.push({
      note: sorted[sorted.length - 1].note,
      amount,
      currency: sorted[0].currency,
      period: found.period,
      count: dates.length,
      last,
      next: shiftDate(last, found.days),
      perMonth: round2(perMonth),
      overdue: daysBetween(shiftDate(last, found.days), today) > 7,
    });
  }
  return subs.sort((a, b) => b.perMonth - a.perMonth);
}

export async function subscriptions(user: User): Promise<Sub[]> {
  const today = localNow(user.tz).date;
  const from = shiftDate(today, -WINDOW_DAYS);
  const rows = check(
    await db.from("transactions").select("amount,currency,note,occurred_at")
      .eq("user_id", user.id).eq("kind", "expense").not("note", "is", null)
      .gte("occurred_at", `${from}T00:00:00Z`).order("occurred_at"),
  ) as { amount: number; currency: string; note: string; occurred_at: string }[];
  return detect(
    rows.map((r) => ({
      date: localNow(user.tz, new Date(r.occurred_at)).date,
      amount: Number(r.amount),
      currency: r.currency,
      note: r.note,
    })),
    today,
  );
}

const periodWord = (user: User, p: Period) =>
  t(user, p === "week" ? "в неделю" : p === "month" ? "в месяц" : p === "quarter" ? "раз в квартал" : "в год");

/** Текст для /subs. */
export async function subsOverview(user: User): Promise<string> {
  const subs = await subscriptions(user);
  const l = lang(user);
  if (!subs.length) {
    return "🔁 " + t(user, "<b>Регулярные списания</b>") + "\n" +
      t(user, "Пока не вижу ни одного: нужно хотя бы три одинаковых списания подряд.");
  }
  const live = subs.filter((s) => !s.overdue);
  const lines = subs.map((s) => {
    const head = `${s.overdue ? "⚪️" : "🔁"} <b>${s.note}</b> — ${fmtMoney(s.amount, s.currency, l)} ${
      periodWord(user, s.period)
    }`;
    const tail = s.overdue
      ? t(user, "последний раз {date}, больше не приходит", { date: s.last })
      : t(user, "следующее около {date}", { date: s.next });
    return `${head}\n${tail}`;
  });
  const byCurrency = new Map<string, number>();
  for (const s of live) byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + s.perMonth);
  const total = [...byCurrency].map(([c, v]) => fmtMoney(round2(v), c, l)).join(" + ");
  return [
    "🔁 " + t(user, "<b>Регулярные списания</b>"),
    ...lines,
    "",
    t(user, "Всего в месяц: {total}.", { total }),
  ].join("\n");
}
