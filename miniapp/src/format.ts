import { pick, plural as pluralize, t } from "./i18n";

export const CURRENCY: Record<string, string> = { CNY: "¥", KZT: "₸", USD: "$" };

const locale = () => pick("ru-RU", "en-US");

/** «12 345,5 ¥»: разряды через узкий пробел, до 2 знаков после запятой. */
export function money(amount: number, currency: string, digits = 2): string {
  const s = (Math.round(amount * 100) / 100).toLocaleString(locale(), { maximumFractionDigits: digits })
    .replace(/\u00a0/g, "\u202f");
  return `${s} ${CURRENCY[currency] ?? currency}`;
}

/** Число с разрядами: «8 432», «71,4». Узкий пробел, чтобы цифры не разъезжались. */
export function number(v: number, digits = 0): string {
  return v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .replace(/ /g, " ");
}

/** «2026-09» → «Сентябрь 2026» / «September 2026». */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const name = new Intl.DateTimeFormat(locale(), { month: "long", timeZone: "UTC" })
    .format(Date.UTC(y, m - 1, 12));
  return `${capitalize(name)} ${y}`;
}

export function duration(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  const hu = t("ч"), mu = t("м");
  return h ? (m ? `${h} ${hu} ${m} ${mu}` : `${h} ${hu}`) : `${m} ${mu}`;
}

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const fromMin = (min: number) => {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

/** «Фактическое − цель» для времени суток с переходом через полночь. */
export function clockDiff(actual: number, target: number): number {
  let d = actual - target;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return d;
}

const WEEKDAYS = () => pick(
  ["вс", "пн", "вт", "ср", "чт", "пт", "сб"],
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
);
const WEEKDAYS_FULL = () => pick(
  ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"],
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
);
const MONTHS = () => pick(
  ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
);
const MONTHS_FULL = () => pick(
  ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
);

const utc = (date: string) => new Date(`${date}T12:00:00Z`);

/** «сб, 19 сен» или «19 сен». */
export function dayLabel(date: string, withWeekday = true): string {
  const d = utc(date);
  // В английском день после месяца: «Sep 19».
  const s = pick(`${d.getUTCDate()} ${MONTHS()[d.getUTCMonth()]}`, `${MONTHS()[d.getUTCMonth()]} ${d.getUTCDate()}`);
  return withWeekday ? `${WEEKDAYS()[d.getUTCDay()]}, ${s}` : s;
}

/** «Суббота, 19 сентября». */
export function fullDay(date: string): string {
  const d = utc(date);
  const day = pick(
    `${d.getUTCDate()} ${MONTHS_FULL()[d.getUTCMonth()]}`,
    `${MONTHS_FULL()[d.getUTCMonth()]} ${d.getUTCDate()}`,
  );
  return `${WEEKDAYS_FULL()[d.getUTCDay()]}, ${day}`;
}

export const VERDICT = (): Record<string, { label: string; tone: "good" | "warn" | "bad" }> => ({
  good: { label: t("В режиме"), tone: "good" },
  meh: { label: t("Почти"), tone: "warn" },
  bad: { label: t("Срыв"), tone: "bad" },
});

export const plural = pluralize;

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Компактно для плиток: «7ч 20м». */
export function durationShort(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  const [hu, mu] = pick(["ч", "м"], ["h", "m"]);
  return h ? `${h}${hu} ${String(m).padStart(2, "0")}${mu}` : `${m}${mu}`;
}

/** Понедельник той недели, в которую попала дата: расписание живёт неделями. */
export function weekStart(date: string): string {
  const shift = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return shift ? shiftDay(date, -shift) : date;
}

export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** «Сегодня», «Вчера», «Позавчера» или «Среда, 16 сентября». */
export function relativeDay(date: string, today: string): string {
  if (date === today) return t("Сегодня");
  if (date === shiftDay(today, -1)) return t("Вчера");
  if (date === shiftDay(today, -2)) return t("Позавчера");
  return fullDay(date).split(",")[0];
}

/** Для плиток и шапки: крупные суммы сокращаем («285 тыс ₸», «1,31 млн ₸»). */
export function moneyShort(amount: number, currency: string): string {
  const a = Math.abs(amount), sign = amount < 0 ? "−" : "";
  const sym = CURRENCY[currency] ?? currency;
  const fmt = (v: number, d: number) => v.toLocaleString(locale(), { maximumFractionDigits: d }).replace(/ /g, " ");
  if (a >= 1e6) return `${sign}${fmt(a / 1e6, 2)} ${t("млн")} ${sym}`;
  if (a >= 1e5) return `${sign}${fmt(a / 1e3, 0)} ${t("тыс")} ${sym}`;
  return `${sign}${fmt(a, 0)} ${sym}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** «сегодня», «завтра», «через 5 дней», «просрочено на 2 дня». */
export function dueLabel(date: string | null, today: string): { text: string; tone: "" | "warn" | "bad" } {
  if (!date) return { text: t("без даты"), tone: "" };
  const d = daysBetween(today, date);
  if (d < 0) {
    return {
      text: t("просрочено на {n} {days}", { n: -d, days: plural(-d, "день", "дня", "дней") }),
      tone: "bad",
    };
  }
  if (d === 0) return { text: t("сегодня"), tone: "bad" };
  if (d === 1) return { text: t("завтра"), tone: "warn" };
  return {
    text: t("через {n} {days}", { n: d, days: plural(d, "день", "дня", "дней") }),
    tone: d <= 3 ? "warn" : "",
  };
}
