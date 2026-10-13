// Ретроспектива: месяц к месяцу и сезон к сезону. Неделя показывает шум,
// месяц — направление, поэтому сравниваем с прошлым периодом и говорим не
// «сколько», а «больше или меньше стало».
import { check, db, type User } from "./db.ts";
import { t } from "./i18n.ts";
import { judgeNight, type SleepRow, topCategories } from "./coach.ts";
import { totalsCny, userMoney } from "./finance.ts";
import { linksBlock } from "./links.ts";
import { clockDiff, dayBounds, fmtDuration, localMin, localNow, toMin } from "./time.ts";

export type Range = { from: string; to: string };

/** Месяц в виде YYYY-MM → первый и последний день. */
export function monthRange(month: string): Range {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const shiftMonth = (month: string, by: number): string => {
  let out = month;
  for (let i = 0; i < Math.abs(by); i++) out = by < 0 ? prevMonth(out) : nextMonth(out);
  return out;
};

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export const monthName = (month: string) => MONTHS[Number(month.split("-")[1]) - 1];

/**
 * Сезон, который закончился этим месяцем. Зима — декабрь, январь, февраль,
 * дальше по три месяца; не тот месяц — null, сезонной сводки в этот раз нет.
 */
export function seasonEndedWith(month: string): { months: string[]; name: string; icon: string } | null {
  const m = Number(month.split("-")[1]);
  const names: Record<number, [string, string]> = {
    2: ["зима", "❄️"],
    5: ["весна", "🌱"],
    8: ["лето", "☀️"],
    11: ["осень", "🍂"],
  };
  const s = names[m];
  if (!s) return null;
  return { months: [shiftMonth(month, -2), prevMonth(month), month], name: s[0], icon: s[1] };
}

export type Stats = {
  days: number;
  nights: number;
  sleepAvg: number | null;
  bedAvg: number | null;
  goodNights: number;
  spend: number;
  income: number;
  top: [string, number][];
  focusMin: number;
  cards: number;
  cardsOk: number;
  habits: number;
  suppPct: number | null;
  commits: number;
  commitDays: number;
  kept: number;
  broken: number;
  penalties: number;
};

/** Все цифры периода одним заходом. Даты — местные, границы считает dayBounds. */
export async function periodStats(user: User, range: Range): Promise<Stats> {
  const from = dayBounds(range.from, user.tz).from;
  const to = dayBounds(range.to, user.tz).to;
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);

  const [nightsRes, focusRes, cardsRes, habitsRes, suppRes, suppTakenRes, ghRes, promRes, penRes] =
    await Promise.all([
      db.from("sleep_sessions").select("bed_at,asleep_min").eq("user_id", user.id)
        .gte("night_date", range.from).lte("night_date", range.to),
      db.from("focus_sessions").select("minutes").eq("user_id", user.id).neq("status", "running")
        .gte("started_at", from.toISOString()).lt("started_at", to.toISOString()),
      db.from("flashcard_reviews").select("correct").eq("user_id", user.id)
        .gte("reviewed_at", from.toISOString()).lt("reviewed_at", to.toISOString()),
      db.from("habit_logs").select("habit_id", { count: "exact", head: true }).eq("user_id", user.id)
        .gte("local_date", range.from).lte("local_date", range.to),
      db.from("supplements").select("id", { count: "exact", head: true }).eq("user_id", user.id)
        .eq("active", true),
      db.from("supplement_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id)
        .eq("status", "taken").gte("local_date", range.from).lte("local_date", range.to),
      db.from("github_days").select("contributions").eq("user_id", user.id)
        .gte("date", range.from).lte("date", range.to),
      db.from("promises").select("status").eq("user_id", user.id)
        .gte("due_date", range.from).lte("due_date", range.to),
      db.from("coach_ledger").select("id", { count: "exact", head: true }).eq("user_id", user.id)
        .eq("kind", "penalty").gte("created_at", from.toISOString()).lt("created_at", to.toISOString()),
    ]);

  const nights = check(nightsRes) as Pick<SleepRow, "bed_at" | "asleep_min">[];
  const target = toMin(user.settings.sleep.bed);
  const focus = check(focusRes) as { minutes: number | null }[];
  const cards = check(cardsRes) as { correct: boolean }[];
  const gh = check(ghRes) as { contributions: number }[];
  const prom = check(promRes) as { status: string }[];
  const money = await totalsCny(user.id, from, to);

  return {
    days,
    nights: nights.length,
    sleepAvg: nights.length
      ? nights.reduce((a, n) => a + n.asleep_min, 0) / nights.length
      : null,
    bedAvg: nights.length
      ? nights.reduce((a, n) => a + clockDiff(localMin(n.bed_at, user.tz), target), 0) / nights.length
      : null,
    goodNights: nights.filter((n) =>
      judgeNight(user, n, user.settings.sleep.bed, user.tz).verdict === "good"
    ).length,
    spend: money.expense,
    income: money.income,
    top: await topCategories(user.id, from, to, 3),
    focusMin: focus.reduce((a, f) => a + (f.minutes ?? 0), 0),
    cards: cards.length,
    cardsOk: cards.filter((c) => c.correct).length,
    habits: habitsRes.count ?? 0,
    suppPct: suppRes.count
      ? Math.round(((suppTakenRes.count ?? 0) / (suppRes.count * days)) * 100)
      : null,
    commits: gh.reduce((a, g) => a + g.contributions, 0),
    commitDays: gh.filter((g) => g.contributions > 0).length,
    kept: prom.filter((p) => p.status === "kept").length,
    broken: prom.filter((p) => p.status === "broken").length,
    penalties: penRes.count ?? 0,
  };
}

/** «+12 %» к прошлому периоду. Пусто, если сравнивать не с чем или разница мелкая. */
export function delta(now: number, was: number, minPct = 5): string {
  if (!was) return "";
  const pct = Math.round(((now - was) / Math.abs(was)) * 100);
  if (Math.abs(pct) < minPct) return "";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}

const withDelta = (text: string, d: string) => (d ? `${text} (${d})` : text);

/**
 * Какие категории сильнее всего съехали. Берём только заметные суммы: рост
 * «с 3 ¥ до 30 ¥» формально +900 %, а по делу ничего не значит.
 */
export function movers(now: [string, number][], was: [string, number][], floor = 100) {
  const prev = new Map(was);
  const out: { title: string; pct: number; now: number }[] = [];
  for (const [title, v] of now) {
    const p = prev.get(title) ?? 0;
    if (Math.max(v, p) < floor) continue;
    const pct = p ? Math.round(((v - p) / p) * 100) : 100;
    if (Math.abs(pct) < 25) continue;
    out.push({ title, pct, now: v });
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

/** Текст ретроспективы: период, сравнение с предыдущим такого же размера. */
export async function reviewText(
  user: User,
  head: string,
  range: Range,
  prev: Range,
): Promise<string> {
  const [now, was] = await Promise.all([periodStats(user, range), periodStats(user, prev)]);
  const today = localNow(user.tz).date;
  const lines = [head];

  if (now.sleepAvg !== null) {
    const bed = ((toMin(user.settings.sleep.bed) + Math.round(now.bedAvg ?? 0)) % 1440 + 1440) % 1440;
    lines.push(
      "🛌 " + withDelta(
        t(user, "Сон: в среднем {avg}, засыпание ~{bed}. В режиме {good} из {all} ночей.", {
          avg: fmtDuration(user, now.sleepAvg),
          bed: `${String(Math.floor(bed / 60)).padStart(2, "0")}:${String(bed % 60).padStart(2, "0")}`,
          good: now.goodNights,
          all: now.nights,
        }),
        delta(now.sleepAvg, was.sleepAvg ?? 0, 3),
      ),
    );
  }

  if (now.spend || now.income) {
    lines.push(
      "💸 " + withDelta(
        t(user, "Расходы {sum}", { sum: await userMoney(user, now.spend, today) }),
        delta(now.spend, was.spend),
      ) +
        (now.income
          ? t(user, ", доходы {sum}", { sum: await userMoney(user, now.income, today) })
          : "") + ".",
    );
    if (now.top.length) {
      lines.push(
        "  " + t(user, "Больше всего: {list}.", {
          list: (await Promise.all(
            now.top.map(async ([title, v]) => `${t(user, title)} ${await userMoney(user, v, today)}`),
          )).join(", "),
        }),
      );
    }
    const moved = movers(now.top, was.top).slice(0, 2);
    for (const m of moved) {
      lines.push(
        "  " + (m.pct > 0
          ? t(user, "«{title}» выросла на {pct} %.", { title: t(user, m.title), pct: m.pct })
          : t(user, "«{title}» упала на {pct} %.", { title: t(user, m.title), pct: -m.pct })),
      );
    }
  }

  if (now.focusMin || now.cards) {
    const parts = [];
    if (now.focusMin) {
      parts.push(withDelta(
        t(user, "фокус {time}", { time: fmtDuration(user, now.focusMin) }),
        delta(now.focusMin, was.focusMin),
      ));
    }
    if (now.cards) {
      parts.push(t(user, "карточек {n}, верно {pct} %", {
        n: now.cards,
        pct: Math.round((now.cardsOk / now.cards) * 100),
      }));
    }
    lines.push("📚 " + t(user, "Учёба: {list}.", { list: parts.join(", ") }));
  }

  if (now.commits) {
    lines.push(
      "💻 " + withDelta(
        t(user, "Код: {n} коммитов за {days} дней.", { n: now.commits, days: now.commitDays }),
        delta(now.commits, was.commits),
      ),
    );
  }

  if (now.habits) {
    lines.push(
      "🔁 " + withDelta(
        t(user, "Привычек отмечено: {n}.", { n: now.habits }),
        delta(now.habits, was.habits),
      ),
    );
  }

  if (now.suppPct !== null) {
    lines.push("💊 " + withDelta(t(user, "Добавки: {pct} %.", { pct: now.suppPct }), delta(now.suppPct, was.suppPct ?? 0)));
  }

  if (now.kept || now.broken) {
    lines.push("🤝 " + t(user, "Обещания: сдержано {kept}, провалено {broken}.", {
      kept: now.kept,
      broken: now.broken,
    }));
  }

  if (now.penalties) {
    lines.push("⚖️ " + withDelta(t(user, "Штрафов: {n}.", { n: now.penalties }), delta(now.penalties, was.penalties)));
  }

  if (lines.length === 1) lines.push(t(user, "Данных за этот период почти нет."));
  return lines.join("\n");
}

/** Сводка за месяц (по умолчанию — за прошлый: текущий ещё не закончился). */
export async function monthReview(user: User, month?: string): Promise<string> {
  const m = month ?? prevMonth(localNow(user.tz).date.slice(0, 7));
  const head = "📅 " + t(user, "<b>Итоги месяца: {month}.</b>", { month: t(user, monthName(m)) });
  const text = await reviewText(user, head, monthRange(m), monthRange(prevMonth(m)));
  const links = await linksBlock(user);
  return links ? `${text}\n\n${links}` : text;
}

/** Последний закончившийся сезон — для команды /season. */
export async function lastSeasonReview(user: User): Promise<string> {
  let m = prevMonth(localNow(user.tz).date.slice(0, 7));
  // Сезон кончается каждый третий месяц, так что дальше трёх шагов искать нечего.
  for (let i = 0; i < 3; i++) {
    const text = await seasonReview(user, m);
    if (text) return text;
    m = prevMonth(m);
  }
  return t(user, "Сезон ещё не закончился.");
}

/** Сводка за сезон: три месяца против трёх предыдущих. */
export async function seasonReview(user: User, endMonth: string): Promise<string | null> {
  const season = seasonEndedWith(endMonth);
  if (!season) return null;
  const range = { from: monthRange(season.months[0]).from, to: monthRange(endMonth).to };
  const prevEnd = shiftMonth(endMonth, -3);
  const prev = { from: monthRange(shiftMonth(prevEnd, -2)).from, to: monthRange(prevEnd).to };
  const head = season.icon + " " + t(user, "<b>Сезон: {season}.</b> Три месяца против трёх предыдущих.", {
    season: t(user, season.name),
  });
  return await reviewText(user, head, range, prev);
}
