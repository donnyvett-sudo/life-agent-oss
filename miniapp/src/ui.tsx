import { t } from "./i18n";
import { CalendarDays, ChevronLeft, Check, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { duration, VERDICT } from "./format";

export function Verdict({ verdict }: { verdict: string }) {
  const v = VERDICT()[verdict];
  const Icon = v.tone === "good" ? Check : v.tone === "warn" ? TriangleAlert : X;
  return (
    <span className={`verdict ${v.tone}`}>
      <Icon size={16} strokeWidth={2.4} aria-hidden />
      {v.label}
    </span>
  );
}

/** «7 ч 48 м» крупно: цифры моноширинные, единицы приглушённые. */
export function Figure({ minutes, size }: { minutes: number | null; size?: "md" }) {
  if (minutes == null) return <span className={`figure ${size ?? ""}`}>–</span>;
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return (
    <span className={`figure ${size ?? ""}`} aria-label={duration(minutes)}>
      {h > 0 && <>{h}<span className="u">{t("ч")}</span></>}
      {String(m).padStart(h > 0 ? 2 : 1, "0")}<span className="u">{t("м")}</span>
    </span>
  );
}

/**
 * Дата рядом со стрелками открывает системный календарь: листать стрелками
 * на месяц назад — два десятка тапов. Поле прозрачное и лежит поверх подписи,
 * иначе iOS рисует свой серый прямоугольник вместо неё.
 */
export function DateJump(
  { type = "date", value, min, max, label, onPick, children }: {
    type?: "date" | "month";
    value: string;
    min?: string;
    max?: string;
    label: string;
    onPick: (value: string) => void;
    children: ReactNode;
  },
) {
  return (
    <span
      className="date-jump"
      onClick={(e) => {
        // В телефонном Safari календарь открывает сам тап, в настольном Chrome — нет.
        const input = e.currentTarget.querySelector("input");
        try {
          input?.showPicker?.();
        } catch { /* уже открыт */ }
      }}
    >
      {children}
      <CalendarDays size={15} strokeWidth={1.9} aria-hidden />
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(e) => e.target.value && onPick(e.target.value)}
      />
    </span>
  );
}

/** Настройки живут за шестернёй в шапке, а не во вкладке: заходят туда раз в месяц. */
export const Nav = createContext<{ openSettings: () => void; openLegal?: () => void; back?: () => void }>({
  openSettings: () => {},
});

export function Head({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  const { openSettings, back } = useContext(Nav);
  return (
    <header className="head">
      {back && (
        <button className="gear back" onClick={back} aria-label={t("Назад")}>
          <ChevronLeft size={22} strokeWidth={1.9} aria-hidden />
        </button>
      )}
      <div>
        {eyebrow != null && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      <div className="head-right">
        {right}
        {!back && (
          <button className="gear" onClick={openSettings} aria-label={t("Настройки")}>
            <SlidersHorizontal size={20} strokeWidth={1.8} aria-hidden />
          </button>
        )}
      </div>
    </header>
  );
}

export function PanelHead({ icon, title, meta }: { icon?: ReactNode; title: string; meta?: ReactNode }) {
  return (
    <div className="panel-head">
      {icon}
      <h2>{title}</h2>
      {meta != null && <span className="meta">{meta}</span>}
    </div>
  );
}

export function ErrorBox({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="panel">
      <p>{t("Не загрузилось")}: {message}</p>
      <button className="btn" onClick={retry}>{t("Повторить")}</button>
    </section>
  );
}

export function Loading() {
  return <p className="muted center-pad">{t("Загрузка…")}</p>;
}
