// Тема: системная (по Telegram / устройству), светлая или тёмная. Выбор хранится на устройстве.
import { useEffect, useState } from "react";
import { inTelegram, webApp } from "./tg";

export type ThemeMode = "system" | "light" | "dark";
const KEY = "theme";

// Совпадают с --bg в styles.css — чтобы шапка Telegram была того же цвета.
const BG = { light: "#f6f3ec", dark: "#151411" };

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* недоступно — по умолчанию */ }
  return "system";
}

function systemScheme(): "light" | "dark" {
  // Вне Telegram скрипт всё равно отдаёт colorScheme "light" — там верим устройству.
  if (inTelegram && webApp?.colorScheme) return webApp.colorScheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(mode: ThemeMode) {
  const scheme = mode === "system" ? systemScheme() : mode;
  document.documentElement.dataset.theme = scheme;
  try {
    webApp?.setHeaderColor?.(BG[scheme]);
    webApp?.setBackgroundColor?.(BG[scheme]);
    webApp?.setBottomBarColor?.(BG[scheme]);
  } catch { /* старые клиенты Telegram */ }
}

/** Применить сохранённую тему до первого рендера (без мигания). */
export function initTheme() {
  apply(readMode());
  const onChange = () => readMode() === "system" && apply("system");
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
  webApp?.onEvent?.("themeChanged", onChange);
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  useEffect(() => apply(mode), [mode]);
  return [
    mode,
    (m) => {
      try {
        localStorage.setItem(KEY, m);
      } catch { /* не критично */ }
      setMode(m);
    },
  ];
}
