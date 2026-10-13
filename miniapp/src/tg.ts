// Тонкая обёртка над Telegram WebApp (скрипт telegram-web-app.js в index.html).

type HapticStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

type WebApp = {
  initData: string;
  platform?: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent?(event: string, cb: () => void): void;
  openTelegramLink?(url: string): void;
  close?(): void;
  HapticFeedback?: {
    impactOccurred(style: HapticStyle): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const webApp: WebApp | undefined = window.Telegram?.WebApp;

/** initData: из SDK, а если скрипт не загрузился — из hash, который Telegram добавляет к URL. */
export function initData(): string {
  if (webApp?.initData) return webApp.initData;
  const hash = new URLSearchParams(location.hash.slice(1));
  return hash.get("tgWebAppData") ?? "";
}

export function haptic(kind: "tap" | "success" | "error" = "tap") {
  const h = webApp?.HapticFeedback;
  if (!h) return;
  if (kind === "tap") h.impactOccurred("light");
  else h.notificationOccurred(kind);
}

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (webApp?.showConfirm) webApp.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

/** Скрипт Telegram грузится и в обычном браузере; внутри Telegram platform не "unknown". */
export const inTelegram = Boolean(webApp?.platform && webApp.platform !== "unknown");
