import { BOT } from "./operator";
import { t, useLang } from "./i18n";
import { Briefcase, CalendarDays, Moon, Repeat, Utensils, Wallet, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { isMock } from "./api";
import Finance from "./screens/Finance";
import Food from "./screens/Food";
import Legal from "./screens/Legal";
import Habits from "./screens/Habits";
import Settings from "./screens/Settings";
import Sleep from "./screens/Sleep";
import Today from "./screens/Today";
import Work from "./screens/Work";
import { haptic, initData } from "./tg";
import { Nav } from "./ui";

const TABS = (): { id: string; label: string; icon: LucideIcon }[] => [
  { id: "today", label: t("День"), icon: CalendarDays },
  { id: "food", label: t("Еда"), icon: Utensils },
  { id: "sleep", label: t("Сон"), icon: Moon },
  { id: "money", label: t("Финансы"), icon: Wallet },
  { id: "work", label: t("Дело"), icon: Briefcase },
  { id: "habits", label: t("Привычки"), icon: Repeat },
];

function initialTab(): string {
  try {
    const saved = localStorage.getItem("tab");
    if (saved && TABS().some((x) => x.id === saved)) return saved;
  } catch { /* приватный режим, не критично */ }
  return "today";
}

type Layer = null | "settings" | "legal";

export default function App() {
  const desk = Boolean(window.__LIFE_TOKEN__); // Mac-приложение Life Desk: вкладки в его боковой панели
  const [tab, setTab] = useState(initialTab);
  useLang(); // перерисовать всё дерево после переключателя языка
  const [layer, setLayer] = useState<Layer>(null);

  useEffect(() => {
    if (!desk) return;
    document.body.classList.add("desk");
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (TABS().some((x) => x.id === id)) {
        setLayer(null);
        setTab(id);
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("lifedesk:tab", onTab);
    return () => window.removeEventListener("lifedesk:tab", onTab);
  }, [desk]);

  if (!initData() && !window.__LIFE_TOKEN__ && !isMock) {
    return (
      <main className="screen center">
        <p className="muted">{t("Открой приложение из бота @{bot}.", { bot: BOT })}</p>
      </main>
    );
  }

  const choose = (t: string) => {
    haptic();
    setTab(t);
    try {
      localStorage.setItem("tab", t);
    } catch { /* не критично */ }
    window.scrollTo(0, 0);
  };

  const open = (v: Layer) => {
    haptic();
    setLayer(v);
    window.scrollTo(0, 0);
  };

  // Настройки и правила — не вкладки, а слои поверх: заходят туда редко.
  if (layer) {
    return (
      <Nav.Provider
        value={{
          openSettings: () => open("settings"),
          openLegal: () => open("legal"),
          back: () => open(layer === "legal" ? "settings" : null),
        }}
      >
        <main className="screen">
          {layer === "settings" ? <Settings /> : <Legal />}
        </main>
      </Nav.Provider>
    );
  }

  return (
    <Nav.Provider value={{ openSettings: () => open("settings") }}>
      <main className="screen">
        {tab === "today" && <Today />}
        {tab === "food" && <Food />}
        {tab === "sleep" && <Sleep />}
        {tab === "money" && <Finance />}
        {tab === "work" && <Work />}
        {tab === "habits" && <Habits />}
      </main>
      <nav className="tabbar" hidden={desk}>
        {TABS().map((x) => (
          <button
            key={x.id}
            className={x.id === tab ? "tab active" : "tab"}
            onClick={() => choose(x.id)}
            aria-current={x.id === tab ? "page" : undefined}
          >
            <x.icon size={22} strokeWidth={x.id === tab ? 2.1 : 1.7} aria-hidden />
            <span>{x.label}</span>
          </button>
        ))}
      </nav>
    </Nav.Provider>
  );
}
