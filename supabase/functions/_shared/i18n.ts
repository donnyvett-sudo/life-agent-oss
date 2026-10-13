// Язык интерфейса. Исходная строка в коде — русская, она же ключ перевода:
// так код остаётся читаемым, а словарь лежит в одном месте (`i18n_en.ts`).
// Нет перевода — показываем русский, это лучше пустого места; тест ловит пропуски.
import type { User } from "./db.ts";
import { EN } from "./i18n_en.ts";

export type Lang = "ru" | "en";

export const lang = (u: User): Lang => (u.settings.lang === "en" ? "en" : "ru");

// Коды языков, которым по умолчанию даём русский интерфейс; остальным — английский.
const RU_LOCALE = /^(ru|uk|be|kk|ky|uz|tg|az|hy|mo)/i;

/** Язык по коду клиента Telegram: язык в настройках ещё не выбран. */
export const langFromLocale = (code?: string | null): Lang =>
  RU_LOCALE.test(code ?? "ru") ? "ru" : "en";

/** Подставить {имя} значениями. */
function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Перевести строку для пользователя. Ключ — русский текст с {плейсхолдерами}. */
export function t(
  who: User | Lang,
  ru: string,
  vars?: Record<string, string | number>,
): string {
  const l = typeof who === "string" ? who : lang(who);
  return fill(l === "en" ? EN[ru] ?? ru : ru, vars);
}

/** Выбор между двумя готовыми значениями любого типа (списки, объекты). */
export function pick<T>(who: User | Lang, ru: T, en: T): T {
  const l = typeof who === "string" ? who : lang(who);
  return l === "en" ? en : ru;
}
