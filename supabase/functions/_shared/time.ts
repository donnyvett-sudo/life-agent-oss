import type { User } from "./db.ts";
import { type Lang, t } from "./i18n.ts";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type LocalNow = { date: string; hhmm: string; minutes: number; dow: number };

/** Локальные дата/время в зоне tz (время храним в UTC, показываем в tz). */
export function localNow(tz: string, d: Date = new Date()): LocalNow {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${p.hour}:${p.minute}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    dow: DOW.indexOf(p.weekday),
  };
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Тихие часы: с отбоя до подъёма (через полночь). */
export function isQuiet(minutes: number, bed: string, wake: string): boolean {
  const b = toMin(bed), w = toMin(wake);
  return b > w ? minutes >= b || minutes < w : minutes >= b && minutes < w;
}

export function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/** Момент события в минутах от полуночи по часам человека. */
export const localMin = (iso: string, tz: string) => toMin(fmtTime(new Date(iso), tz));

/** Смещение зоны tz относительно UTC в минутах на момент d. */
export function tzOffsetMin(tz: string, d: Date = new Date()): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** UTC-границы локального дня [from, to). date — 'YYYY-MM-DD'. */
export function dayBounds(date: string, tz: string): { from: Date; to: Date } {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const off = tzOffsetMin(tz, noonUtc);
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - off * 60_000);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60_000) };
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Дней от сегодня до даты (отрицательное — просрочено). */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function dueLabel(who: User | Lang, date: string | null, today: string): string {
  if (!date) return t(who, "без даты");
  const d = daysUntil(date, today);
  if (d < 0) return t(who, "просрочено на {n} дн.", { n: -d });
  if (d === 0) return t(who, "сегодня");
  if (d === 1) return t(who, "завтра");
  return t(who, "через {n} дн.", { n: d });
}

/** 320 → «5 ч 20 м». */
export function fmtDuration(who: User | Lang, min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? t(who, "{h} ч {m} м", { h, m }) : t(who, "{m} м", { m });
}

/**
 * Разница «фактическое − целевое» в минутах для времени суток, с переходом через полночь:
 * цель 23:00, факт 01:40 → +160; факт 22:30 → −30.
 */
export function clockDiff(actualMin: number, targetMin: number): number {
  let d = actualMin - targetMin;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}
