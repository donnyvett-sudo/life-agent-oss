// Язык интерфейса. Ключ перевода — русская строка прямо в коде: чего нет в словаре,
// остаётся по-русски. Язык хранится на сервере (settings.lang), в приложении кэшируется.
import { useSyncExternalStore } from "react";
import { EN } from "./i18n_en";

export type Lang = "ru" | "en";

const RU_LOCALE = /^(ru|uk|be|kk|ky|uz|tg|az|hy|mo)/i;

/** Язык клиента Telegram: нужен до первого ответа сервера. */
function fromTelegram(): Lang {
  try {
    const raw = new URLSearchParams(window.Telegram?.WebApp?.initData ?? "").get("user");
    const code = raw ? (JSON.parse(raw) as { language_code?: string }).language_code : null;
    return RU_LOCALE.test(code ?? "ru") ? "ru" : "en";
  } catch {
    return "ru";
  }
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "ru" || saved === "en") return saved;
  } catch { /* приватный режим */ }
  return fromTelegram();
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem("lang", l);
  } catch { /* не критично */ }
  document.documentElement.lang = l;
  for (const fn of listeners) fn();
}

/** Подписка на смену языка: экраны перерисовываются сразу после переключателя. */
export function useLang(): Lang {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, getLang);
}

/** t("Осталось {n} дн.", { n: 3 }) — подстановка по именам. */
export function t(ru: string, vars?: Record<string, string | number>): string {
  const s = current === "en" ? EN[ru] ?? ru : ru;
  return vars ? s.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Когда перевод — не строка, а другое значение: массив, форма числа, локаль. */
export const pick = <T>(ru: T, en: T): T => (current === "en" ? en : ru);

/** Множественное число: в русском три формы, в английском две. */
export function plural(n: number, one: string, few: string, many: string, enMany?: string): string {
  if (current === "en") {
    const base = t(one);
    return n === 1 ? base : enMany ?? `${base}s`;
  }
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

document.documentElement.lang = current;
