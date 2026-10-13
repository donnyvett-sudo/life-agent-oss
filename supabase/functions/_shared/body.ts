// Тело: шаги, вес и пульс покоя. Данные приходят утренней командой с iPhone
// вместе со сном, вес можно записать и словами в чате. День — строка, повторная
// присылка того же дня его перезаписывает: часы досчитывают шаги с опозданием.
import { check, db, type User } from "./db.ts";
import { lang, t } from "./i18n.ts";
import { localNow, shiftDate } from "./time.ts";

/** Ориентир по шагам. Не норма ВОЗ, а порог, ниже которого день был сидячим. */
export const STEP_GOAL = 8000;

export type BodyDay = {
  local_date: string;
  steps: number | null;
  weight_kg: number | null;
  resting_hr: number | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Значение из «Здоровья» приходит строкой с единицами и разделителями:
 * «8 432 шага», «8,432», «71,4 кг». Запятая бывает и дробной, и тысячной —
 * различаем по трём цифрам после неё. Всё, что не число, — null.
 */
function num(v: unknown, lo: number, hi: number, int: boolean): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v)
    .replace(/[^\d.,\-]/g, "")
    .replace(/[.,](?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return int ? Math.round(n) : Math.round(n * 10) / 10;
}

/**
 * Если в команде не выставлено «Вычислить», «Здоровье» отдаёт не число, а все
 * образцы за день построчно. Сводим сами: шаги складываем, пульс усредняем,
 * вес берём последний — так команда работает и без ручной настройки.
 */
function fold(v: unknown, how: "sum" | "avg" | "last", lo: number, hi: number, int: boolean): number | null {
  const lines = String(v ?? "").split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length < 2) return num(v, lo, hi, int);
  const xs = lines.map((l) => num(l, lo, hi, int)).filter((n): n is number => n !== null);
  if (!xs.length) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  return num(how === "sum" ? sum : how === "avg" ? sum / xs.length : xs[xs.length - 1], lo, hi, int);
}

type Raw = Record<string, unknown>;

function oneRow(r: Raw, today: string): BodyDay | null {
  const date = String(r.date ?? r.local_date ?? today);
  if (!ISO_DATE.test(date)) return null;
  const row: BodyDay = {
    local_date: date,
    steps: fold(r.steps, "sum", 0, 200_000, true),
    weight_kg: fold(r.weightKg ?? r.weight, "last", 20.1, 399.9, false),
    resting_hr: fold(r.restingHr ?? r.pulse, "avg", 21, 199, true),
  };
  // Пустая строка — не день без движения, а день без данных. Такие не пишем.
  if (row.steps === null && row.weight_kg === null && row.resting_hr === null) return null;
  return row;
}

/**
 * Принимает {days:[…]}, одну запись {date, steps, weightKg, restingHr}
 * или текст «дата;шаги;вес;пульс» построчно — в Shortcuts текст собрать проще.
 * Вместо даты можно прислать {dayShift: -1}: утренняя команда шлёт вчерашний
 * день, а считать его по часовому поясу владельца надёжнее, чем по телефону.
 */
export function parseBody(payload: unknown, now: string): BodyDay[] {
  const b = (payload ?? {}) as { days?: Raw[]; text?: string; dayShift?: unknown } & Raw;
  const shift = Math.min(0, Math.max(-7, Math.trunc(Number(b.dayShift)) || 0));
  const today = shift ? shiftDate(now, shift) : now;
  let raw: Raw[];
  if (Array.isArray(b.days)) raw = b.days;
  else if (typeof b.text === "string") {
    raw = b.text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
      const [date, steps, weight, pulse] = line.split(/[;|\t]/).map((s) => s.trim());
      return { date, steps, weight, pulse };
    });
  } else raw = [b];

  const out = new Map<string, BodyDay>();
  for (const r of raw) {
    const row = oneRow(r, today);
    if (row) out.set(row.local_date, row);
  }
  return [...out.values()].sort((a, b) => a.local_date.localeCompare(b.local_date));
}

export async function saveBody(user: User, rows: BodyDay[]): Promise<number> {
  if (!rows.length) return 0;
  check(
    await db.from("body_days").upsert(
      rows.map((r) => ({ ...r, user_id: user.id, source: "shortcuts" })),
      { onConflict: "user_id,local_date" },
    ),
  );
  return rows.length;
}

/**
 * «вес 71.4», «вешу 71,4 кг», «weight 71.4» — и ничего больше: строка с лишними
 * словами уходит дальше, в траты и к коучу. Иначе «вес рюкзака 7» станет весом.
 */
export function parseWeight(text: string): number | null {
  const m = text.trim().toLowerCase().match(
    /^(?:вес|вешу|weight)\s*[:\-]?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:кг|kg)?$/,
  );
  if (!m) return null;
  const kg = Number(m[1].replace(",", "."));
  return kg > 20 && kg < 400 ? Math.round(kg * 10) / 10 : null;
}

/** Вес руками: «вес 71.4» в чате. Дата — сегодняшняя, остальные поля не трогаем. */
export async function saveWeight(user: User, kg: number, date?: string) {
  const day = date ?? localNow(user.tz).date;
  const exists = await bodyOn(user, day);
  const row = {
    user_id: user.id,
    local_date: day,
    weight_kg: Math.round(kg * 10) / 10,
    // Источник ставим только у новой строки: день мог прийти из «Здоровья».
    ...(exists ? {} : { source: "chat" }),
  };
  check(await db.from("body_days").upsert(row, { onConflict: "user_id,local_date" }));
}

export const fmtNum = (user: User, v: number, digits = 0) =>
  v.toLocaleString(lang(user) === "en" ? "en-US" : "ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).replace(/ /g, " ");

export async function bodyOn(user: User, date: string): Promise<BodyDay | null> {
  return check(
    await db.from("body_days").select("local_date,steps,weight_kg,resting_hr")
      .eq("user_id", user.id).eq("local_date", date).maybeSingle(),
  ) as BodyDay | null;
}

export async function bodyRange(user: User, from: string, to: string): Promise<BodyDay[]> {
  return check(
    await db.from("body_days").select("local_date,steps,weight_kg,resting_hr")
      .eq("user_id", user.id).gte("local_date", from).lte("local_date", to)
      .order("local_date"),
  ) as BodyDay[];
}

/**
 * Последний известный вес: меряют не каждый день, а видеть его хочется всегда.
 * `on` ограничивает выборку днём — в прошлом дне не должен висеть сегодняшний вес.
 */
export async function lastWeight(user: User, on?: string): Promise<{ date: string; kg: number } | null> {
  let q = db.from("body_days").select("local_date,weight_kg").eq("user_id", user.id)
    .not("weight_kg", "is", null);
  if (on) q = q.lte("local_date", on);
  const row = check(
    await q.order("local_date", { ascending: false }).limit(1).maybeSingle(),
  ) as { local_date: string; weight_kg: number } | null;
  return row ? { date: row.local_date, kg: Number(row.weight_kg) } : null;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Строка для недельного разбора. Нет данных — нет строки, пустых блоков не пишем. */
export async function weekBodySummary(user: User, from: string, to: string): Promise<string | null> {
  const rows = await bodyRange(user, from, to);
  if (!rows.length) return null;
  const parts: string[] = [];

  const steps = rows.map((r) => r.steps).filter((v): v is number => v !== null);
  if (steps.length) {
    parts.push(
      t(user, "в среднем {n} шагов в день", { n: fmtNum(user, Math.round(avg(steps))) }) +
        t(user, ", {n} дней из {all} выше {goal}", {
          n: steps.filter((v) => v >= STEP_GOAL).length,
          all: steps.length,
          goal: fmtNum(user, STEP_GOAL),
        }),
    );
  }

  const weights = rows.filter((r) => r.weight_kg !== null)
    .map((r) => ({ date: r.local_date, kg: Number(r.weight_kg) }));
  if (!weights.length) {
    // Взвешиваются не каждый день. Последний известный вес показываем с датой:
    // так видно и цифру, и то, что она старая.
    const last = await lastWeight(user, to);
    if (last) parts.push(t(user, "вес {kg} кг на {date}", { kg: fmtNum(user, last.kg, 1), date: last.date }));
  }
  if (weights.length) {
    const last = weights[weights.length - 1];
    const diff = weights.length > 1 ? last.kg - weights[0].kg : 0;
    parts.push(
      t(user, "вес {kg} кг", { kg: fmtNum(user, last.kg, 1) }) +
        // Полкило — это вода и время взвешивания, а не изменение веса.
        (Math.abs(diff) >= 0.5
          ? t(user, " ({sign}{kg} за неделю)", {
            sign: diff > 0 ? "+" : "−",
            kg: fmtNum(user, Math.abs(diff), 1),
          })
          : ""),
    );
  }

  const hr = rows.map((r) => r.resting_hr).filter((v): v is number => v !== null);
  if (hr.length) parts.push(t(user, "пульс покоя {n}", { n: Math.round(avg(hr)) }));

  return "🚶 " + t(user, "Тело: {list}.", { list: parts.join(", ") });
}

/** Факты для коуча: короткие, без истории — модель не должна пересказывать таблицу. */
export async function bodyFacts(user: User): Promise<string[]> {
  const today = localNow(user.tz).date;
  const rows = await bodyRange(user, shiftDate(today, -7), today);
  if (!rows.length) return [];
  const out: string[] = [];

  const yday = rows.find((r) => r.local_date === shiftDate(today, -1));
  if (yday?.steps !== undefined && yday?.steps !== null) {
    out.push(t(user, "Вчера {n} шагов.", { n: fmtNum(user, yday.steps) }));
  }
  const steps = rows.map((r) => r.steps).filter((v): v is number => v !== null);
  if (steps.length >= 3) {
    out.push(t(user, "За неделю в среднем {n} шагов в день.", {
      n: fmtNum(user, Math.round(avg(steps))),
    }));
  }
  const w = await lastWeight(user);
  if (w) out.push(t(user, "Вес {kg} кг на {date}.", { kg: fmtNum(user, w.kg, 1), date: w.date }));
  return out;
}
