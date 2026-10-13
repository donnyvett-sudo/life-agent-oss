import { t } from "../i18n";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LayoutGrid, Plus } from "lucide-react";
import { useState } from "react";
import { api, type Today as TodayData } from "../api";
import { dayLabel, fullDay, plural, relativeDay, shiftDay } from "../format";
import { confirm, haptic } from "../tg";
import { DateJump, ErrorBox, Head, Loading, PanelHead } from "../ui";
import { useLoad } from "../useLoad";
import { PANELS, type PanelCtx } from "./TodayPanels";

export default function Today() {
  const [date, setDate] = useState<string | null>(null); // null — сегодня
  const { data, setData, error, reload } = useLoad<TodayData>(`/today${date ? `?date=${date}` : ""}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null); // не null — открыт выбор панелей

  async function act(key: string, method: string, path: string, body?: unknown) {
    setBusy(key);
    try {
      setData(await api<TodayData>(method, path, body));
      haptic("success");
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return <Loading />;

  const isToday = data.date === data.today;
  const go = (d: string) => {
    haptic();
    setDate(d === data.today ? null : d);
    window.scrollTo(0, 0);
  };
  const ctx: PanelCtx = { data, busy, isToday, act };
  // Приложение может быть старее сервера: незнакомые панели просто пропускаем.
  const shown = data.home.map((id) => PANELS.find((p) => p.id === id)).filter((p) => p !== undefined);

  return (
    <>
      <Head
        eyebrow={fullDay(data.date)}
        title={relativeDay(data.date, data.today)}
        right={isToday && (
          <div className="counter">
            <b>{data.streak}</b>
            <span>{t("{n} подряд", { n: plural(data.streak, "ночь", "ночи", "ночей") })}</span>
          </div>
        )}
      />

      <div className="month-nav">
        <button
          className="icon-btn"
          aria-label={t("Предыдущий день")}
          disabled={data.date <= data.minDate}
          onClick={() => go(shiftDay(data.date, -1))}
        >
          <ChevronLeft size={20} aria-hidden />
        </button>
        <span className="nav-center">
          <DateJump value={data.date} min={data.minDate} max={data.today} label={t("Выбрать день")} onPick={go}>
            <span className="mono">{dayLabel(data.date)}</span>
          </DateJump>
          {!isToday && <button className="link" onClick={() => go(data.today)}>{t("Сегодня")}</button>}
        </span>
        <button className="icon-btn" aria-label={t("Следующий день")} disabled={isToday} onClick={() => go(shiftDay(data.date, 1))}>
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      {data.cheatToday && (
        <div className="note good">
          <span>{t("Сегодня чит-вечер: отбой до 00:00 без штрафа.")}</span>
        </div>
      )}

      {data.debts.map((d) => (
        <div key={d.id} className="note">
          <div>
            <div className="note-label">{t("Долг")}</div>
            {t(d.title)}
          </div>
          <button
            className="btn"
            disabled={busy === d.id}
            onClick={() => act(d.id, "POST", `/ledger/${d.id}/done`)}
          >
            {t("Готово")}
          </button>
        </div>
      ))}
      {data.rewards.map((r) => (
        <div key={r.id} className="note good">
          <div>
            <div className="note-label">{t("Награда")}</div>
            {t(r.title)}
          </div>
          <button
            className="btn"
            disabled={busy === r.id}
            onClick={async () =>
              (await confirm(t("Использовать награду сегодня?"))) && act(r.id, "POST", `/ledger/${r.id}/use`)}
          >
            {t("Сегодня")}
          </button>
        </div>
      ))}

      {shown.map((p) => (
        <section key={p.id} className="panel">
          <p.Body {...ctx} />
        </section>
      ))}

      {!shown.length && !draft && (
        <p className="muted center-pad">{t("Экран пустой. Добавь панели кнопкой ниже.")}</p>
      )}

      {draft
        ? (
          <PanelPicker
            draft={draft}
            busy={busy === "home"}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={async () => {
              await act("home", "PUT", "/home", { panels: draft, date: isToday ? undefined : data.date });
              setDraft(null);
            }}
          />
        )
        : (
          <button
            className="add-panel"
            onClick={() => {
              haptic();
              setDraft(data.home);
            }}
          >
            <Plus size={18} aria-hidden />
            {t("Настроить экран")}
          </button>
        )}
    </>
  );
}

/**
 * Выбор панелей: отмеченные идут сверху в своём порядке, остальные ниже.
 * Стрелки вместо перетаскивания: перетаскивание внутри Telegram-браузера
 * спорит с прокруткой страницы, а промахнуться пальцем по списку легко.
 */
function PanelPicker(
  { draft, busy, onChange, onCancel, onSave }: {
    draft: string[];
    busy: boolean;
    onChange: (v: string[]) => void;
    onCancel: () => void;
    onSave: () => void;
  },
) {
  const hidden = PANELS.filter((p) => !draft.includes(p.id));
  const move = (i: number, by: number) => {
    const next = [...draft];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    haptic();
    onChange(next);
  };
  const toggle = (id: string) => {
    haptic();
    onChange(draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id]);
  };

  return (
    <section className="panel">
      <PanelHead icon={<LayoutGrid size={18} aria-hidden />} title={t("Главный экран")} />
      <p className="remark">{t("Отметь, что показывать. Стрелки меняют порядок.")}</p>
      {draft.map((id, i) => {
        const p = PANELS.find((x) => x.id === id);
        if (!p) return null;
        return (
          <div key={id} className="line">
            <button
              className="box hit on"
              aria-label={t("Убрать: {name}", { name: p.title() })}
              aria-pressed
              onClick={() => toggle(id)}
            >
              <Check size={16} strokeWidth={3} aria-hidden />
            </button>
            <div className="grow">
              <p.icon size={16} strokeWidth={1.8} className="row-icon" aria-hidden />
              {p.title()}
            </div>
            <button
              className="icon-btn"
              aria-label={t("Выше: {name}", { name: p.title() })}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ChevronUp size={18} aria-hidden />
            </button>
            <button
              className="icon-btn"
              aria-label={t("Ниже: {name}", { name: p.title() })}
              disabled={i === draft.length - 1}
              onClick={() => move(i, 1)}
            >
              <ChevronDown size={18} aria-hidden />
            </button>
          </div>
        );
      })}

      {hidden.length > 0 && <div className="sub-title">{t("Не показывать")}</div>}
      {hidden.map((p) => (
        <div key={p.id} className="line">
          <button
            className="box hit"
            aria-label={t("Показать: {name}", { name: p.title() })}
            aria-pressed={false}
            onClick={() => toggle(p.id)}
          />
          <div className="grow muted">
            <p.icon size={16} strokeWidth={1.8} className="row-icon" aria-hidden />
            {p.title()}
          </div>
        </div>
      ))}

      <div className="editor-actions">
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button className="btn" disabled={busy} onClick={onSave}>{t("Готово")}</button>
      </div>
    </section>
  );
}
