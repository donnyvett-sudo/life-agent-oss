// Связи между модулями: «после коротких ночей тратишь больше», «в дни с фокусом
// ложишься раньше». Считаем сами, без ИИ: делим дни на две группы и сравниваем
// средние. Показываем, только если дней хватает и разница крупная, — иначе это
// шум, а не закономерность, и доверия к боту он не добавит.
import { check, db, type User } from "./db.ts";
import { t } from "./i18n.ts";
import { clockDiff, dayBounds, fmtDuration, localMin, localNow, shiftDate, toMin } from "./time.ts";

/** Сколько дней истории берём. */
export const WINDOW = 90;
/** Меньше шести дней в группе — совпадение, а не связь. */
const MIN_DAYS = 6;
/** Разница меньше четверти — в пределах обычного разброса. */
const MIN_PCT = 25;
/** Короткая ночь и поздний отбой — те же пороги, что у разбора ночи. */
const SHORT_SLEEP = 390;
const LATE_BED = 60;

export type DayRow = {
  date: string;
  sleepMin: number | null;
  bedDiff: number | null;
  /** Ночь, которая начнётся вечером этого дня. */
  nextBedDiff: number | null;
  spend: number;
  focus: number;
  cards: number;
  habits: number;
  commits: number;
};

export type LinkKind =
  | "sleep_spend"
  | "sleep_focus"
  | "sleep_habits"
  | "sleep_commits"
  | "late_spend"
  | "focus_bed";

export type Link = {
  kind: LinkKind;
  /** Среднее в дни, когда условие выполнилось, и в остальные. */
  yes: number;
  no: number;
  /** Насколько «да» отличается от «нет», в процентах. */
  pct: number;
  days: number;
};

type Rule = {
  kind: LinkKind;
  cause: (r: DayRow) => boolean | null;
  effect: (r: DayRow) => number | null;
  /** Ниже этого среднего разница ничего не значит (делить на ноль тем более). */
  floor: number;
};

const short = (r: DayRow) => (r.sleepMin === null ? null : r.sleepMin < SHORT_SLEEP);

const RULES: Rule[] = [
  { kind: "sleep_spend", cause: short, effect: (r) => r.spend, floor: 20 },
  { kind: "sleep_focus", cause: short, effect: (r) => r.focus, floor: 15 },
  { kind: "sleep_habits", cause: short, effect: (r) => r.habits, floor: 0.5 },
  { kind: "sleep_commits", cause: short, effect: (r) => r.commits, floor: 1 },
  {
    kind: "late_spend",
    cause: (r) => (r.bedDiff === null ? null : r.bedDiff > LATE_BED),
    effect: (r) => r.spend,
    floor: 20,
  },
  {
    // Обратная сторона: не ночь влияет на день, а день на ночь.
    kind: "focus_bed",
    cause: (r) => r.focus >= 25,
    effect: (r) => r.nextBedDiff,
    floor: 15,
  },
];

const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** Чистая часть: из дней делает связи. Сортировка — по силе разницы. */
export function findLinks(rows: DayRow[]): Link[] {
  const out: Link[] = [];
  for (const rule of RULES) {
    const yes: number[] = [], no: number[] = [];
    for (const r of rows) {
      const c = rule.cause(r), e = rule.effect(r);
      if (c === null || e === null) continue;
      (c ? yes : no).push(e);
    }
    if (yes.length < MIN_DAYS || no.length < MIN_DAYS) continue;
    const a = avg(yes), b = avg(no);
    if (Math.max(Math.abs(a), Math.abs(b)) < rule.floor) continue;
    // Отсчитываем от «обычных» дней, но не от нуля: иначе любая мелочь — бесконечность.
    const base = Math.max(Math.abs(b), rule.floor);
    const pct = Math.round(((a - b) / base) * 100);
    if (Math.abs(pct) < MIN_PCT) continue;
    out.push({ kind: rule.kind, yes: a, no: b, pct, days: yes.length });
  }
  return out.sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));
}

/** Одна связь одной строкой. Формулировка зависит от знака: «больше» или «меньше». */
export function linkLine(user: User, l: Link): string {
  const pct = Math.abs(l.pct), days = l.days;
  const up = l.pct > 0;
  switch (l.kind) {
    case "sleep_spend":
      return up
        ? t(user, "После коротких ночей тратишь на {pct} % больше ({days} таких дней).", { pct, days })
        : t(user, "После коротких ночей тратишь на {pct} % меньше ({days} таких дней).", { pct, days });
    case "sleep_focus":
      return up
        ? t(user, "После коротких ночей занимаешься дольше на {pct} % ({days} таких дней).", { pct, days })
        : t(user, "После коротких ночей занимаешься на {pct} % меньше: {yes} против {no}.", {
          pct,
          yes: fmtDuration(user, Math.round(l.yes)),
          no: fmtDuration(user, Math.round(l.no)),
        });
    case "sleep_habits":
      return up
        ? t(user, "После коротких ночей привычек закрываешь больше на {pct} %.", { pct })
        : t(user, "После коротких ночей привычек закрываешь на {pct} % меньше ({days} таких дней).", { pct, days });
    case "sleep_commits":
      return up
        ? t(user, "После коротких ночей коммитов больше на {pct} %.", { pct })
        : t(user, "После коротких ночей коммитов на {pct} % меньше ({days} таких дней).", { pct, days });
    case "late_spend":
      return up
        ? t(user, "После позднего отбоя тратишь на {pct} % больше ({days} таких дней).", { pct, days })
        : t(user, "После позднего отбоя тратишь на {pct} % меньше ({days} таких дней).", { pct, days });
    case "focus_bed":
      return up
        ? t(user, "В дни с фокус-сессиями ложишься позже на {diff}.", {
          diff: fmtDuration(user, Math.round(Math.abs(l.yes - l.no))),
        })
        : t(user, "В дни с фокус-сессиями ложишься раньше на {diff}.", {
          diff: fmtDuration(user, Math.round(Math.abs(l.yes - l.no))),
        });
  }
}

/** Дни за окно: одна строка на дату, собранная из всех модулей. */
export async function dayRows(user: User, days = WINDOW): Promise<DayRow[]> {
  const today = localNow(user.tz).date;
  const from = shiftDate(today, -days);
  const since = dayBounds(from, user.tz).from.toISOString();
  const local = (ts: string) => localNow(user.tz, new Date(ts)).date;

  const [nights, tx, focus, cards, habits, commits] = await Promise.all([
    db.from("sleep_sessions").select("night_date,asleep_min,bed_at").eq("user_id", user.id)
      .gte("night_date", from),
    db.from("transactions").select("occurred_at,amount_cny").eq("user_id", user.id)
      .eq("kind", "expense").gte("occurred_at", since),
    db.from("focus_sessions").select("started_at,minutes").eq("user_id", user.id)
      .neq("status", "running").gte("started_at", since),
    db.from("flashcard_reviews").select("reviewed_at").eq("user_id", user.id)
      .gte("reviewed_at", since),
    db.from("habit_logs").select("local_date").eq("user_id", user.id).gte("local_date", from),
    db.from("github_days").select("date,contributions").eq("user_id", user.id).gte("date", from),
  ]);

  const rows = new Map<string, DayRow>();
  const at = (date: string) => {
    let r = rows.get(date);
    if (!r) {
      r = { date, sleepMin: null, bedDiff: null, nextBedDiff: null, spend: 0, focus: 0, cards: 0, habits: 0, commits: 0 };
      rows.set(date, r);
    }
    return r;
  };

  // Дни без единой записи тоже нужны: «в этот день не занимался» — это данные.
  for (let d = from; d <= today; d = shiftDate(d, 1)) at(d);

  const target = toMin(user.settings.sleep.bed);
  for (const n of check(nights) as { night_date: string; asleep_min: number; bed_at: string }[]) {
    const r = at(n.night_date);
    r.sleepMin = n.asleep_min;
    r.bedDiff = clockDiff(localMin(n.bed_at, user.tz), target);
  }
  for (const x of check(tx) as { occurred_at: string; amount_cny: number | null }[]) {
    at(local(x.occurred_at)).spend += Number(x.amount_cny ?? 0);
  }
  for (const f of check(focus) as { started_at: string; minutes: number | null }[]) {
    at(local(f.started_at)).focus += f.minutes ?? 0;
  }
  for (const c of check(cards) as { reviewed_at: string }[]) at(local(c.reviewed_at)).cards += 1;
  for (const h of check(habits) as { local_date: string }[]) at(h.local_date).habits += 1;
  for (const g of check(commits) as { date: string; contributions: number }[]) {
    at(g.date).commits = g.contributions;
  }

  // Ночь, которая начнётся вечером этого дня, лежит в строке следующего дня.
  const list = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of list) r.nextBedDiff = rows.get(shiftDate(r.date, 1))?.bedDiff ?? null;
  return list;
}

/** Блок связей для ретроспективы; null — данных пока мало. */
export async function linksBlock(user: User, limit = 3): Promise<string | null> {
  const links = findLinks(await dayRows(user)).slice(0, limit);
  if (!links.length) return null;
  return ["🔗 " + t(user, "<b>Что с чем связано</b>"), ...links.map((l) => "• " + linkLine(user, l))]
    .join("\n");
}

/** Те же связи фактами для коуча: он должен опираться на данные, а не угадывать. */
export async function linkFacts(user: User): Promise<string[]> {
  return findLinks(await dayRows(user)).slice(0, 3).map((l) => linkLine(user, l));
}
