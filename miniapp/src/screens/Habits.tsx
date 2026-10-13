import { t } from "../i18n";
import { Check, Repeat } from "lucide-react";
import { useState } from "react";
import { api, type Habit, type Habits as HabitsData } from "../api";
import { plural, shiftDay } from "../format";
import { confirm, haptic } from "../tg";
import { ErrorBox, Loading, PanelHead } from "../ui";
import { useLoad } from "../useLoad";

const KINDS = (): { id: Habit["kind"]; label: string }[] => [
  { id: "daily", label: t("Каждый день") },
  { id: "weekly", label: t("Раз в неделю") },
  { id: "interval", label: t("Не реже чем") },
];
// Индекс в API: 0 = вс, поэтому в разметке сдвигаем.
const DOW = () => [t("пн"), t("вт"), t("ср"), t("чт"), t("пт"), t("сб"), t("вс")];
const dowId = (i: number) => (i + 1) % 7;
const STRIP_DAYS = 7;

export default function Habits() {
  const { data, error, reload } = useLoad<HabitsData>("/habits");
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const [showOff, setShowOff] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return <Loading />;

  const done = () => {
    setOpen(undefined);
    reload();
  };
  const toggleOpen = (id: string | null) => {
    haptic();
    setOpen(open === id ? undefined : id);
  };

  async function mark(h: Habit, date: string) {
    setBusy(h.id + date);
    try {
      await api("POST", `/habits/${h.id}/toggle`, { date });
      haptic("success");
      reload();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const active = data.habits.filter((h) => h.active);
  const off = data.habits.filter((h) => !h.active);

  return (
    <section className="panel">
      <PanelHead
        icon={<Repeat size={18} aria-hidden />}
        title={t("Привычки")}
        meta={active.length
          ? (data.dueCount ? t("осталось {n}", { n: data.dueCount }) : t("всё закрыто"))
          : undefined}
      />
      {active.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t("Пока пусто. Сюда идёт то, что повторяется: спорт три раза в неделю, звонок домой раз в три дня.")}
        </p>
      )}

      {active.map((h) => (
        <div key={h.id}>
          <div className="line">
            <button
              className={`box hit ${h.doneToday ? "on" : ""}`}
              aria-label={`${h.title}: ${h.doneToday ? t("снять отметку") : t("отметить")}`}
              disabled={busy === h.id + data.today}
              onClick={() => mark(h, data.today)}
            >
              {h.doneToday && <Check size={16} strokeWidth={3} aria-hidden />}
            </button>
            <button className="grow line-text" onClick={() => toggleOpen(h.id)}>
              <div>{h.title}</div>
              {/* Оранжевым только то, за что спросят в воскресенье. Мягкие не кричат. */}
              <div className={`hint ${h.due && h.isHard ? "warn" : ""}`}>{tail(h, data.today)}</div>
            </button>
            <Strip habit={h} today={data.today} busy={busy} onPick={(d) => mark(h, d)} />
          </div>
          {open === h.id && <Editor item={h} onDone={done} onCancel={() => setOpen(undefined)} />}
        </div>
      ))}

      {open === null
        ? <Editor onDone={done} onCancel={() => setOpen(undefined)} />
        : <button className="btn ghost full" onClick={() => toggleOpen(null)}>{t("Добавить привычку")}</button>}

      {off.length > 0 && (
        <>
          <button className="link" style={{ marginTop: 12 }} onClick={() => setShowOff((v) => !v)}>
            {showOff ? t("Скрыть выключенные") : t("Выключенные ({n})", { n: off.length })}
          </button>
          {showOff && off.map((h) => (
            <div key={h.id}>
              <button className="line line-button" onClick={() => toggleOpen(h.id)}>
                <div className="grow muted">{h.title}</div>
              </button>
              {open === h.id && <Editor item={h} onDone={done} onCancel={() => setOpen(undefined)} />}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** Подпись под названием: у каждого вида нормы свой смысл, среднего показателя тут нет. */
function tail(h: Habit, today: string): string {
  const hard = h.isHard ? t(" · со штрафом") : "";
  if (h.kind === "weekly") return t("{done} из {need} за неделю", { done: h.weekDone, need: h.target }) + hard;
  if (h.kind === "interval") {
    if (!h.lastDone) return t("раз в {n} дн., ещё ни разу", { n: h.target }) + hard;
    const ago = Math.round((Date.parse(today) - Date.parse(h.lastDone)) / 86_400_000);
    const when = ago === 0 ? t("сегодня") : t("{n} дн. назад", { n: ago });
    return t("раз в {n} дн., {when}", { n: h.target, when }) + hard;
  }
  // У привычки по дням недели серия в днях не считается: там свой ритм.
  if (h.days?.length) {
    return `${h.days.map((d) => DOW()[(d + 6) % 7]).join(", ")}${hard}`;
  }
  const streak = t("серия {n} {days}", { n: h.streak, days: plural(h.streak, "день", "дня", "дней") });
  return (h.streak ? streak : t("серии нет")) + hard;
}

/** Неделя точками: правая — сегодня. Касание закрывает забытый день задним числом. */
function Strip(
  { habit, today, busy, onPick }: {
    habit: Habit;
    today: string;
    busy: string | null;
    onPick: (date: string) => void;
  },
) {
  const done = new Set(habit.dates);
  const dates: string[] = [];
  for (let i = STRIP_DAYS - 1; i >= 0; i--) dates.push(shiftDay(today, -i));

  return (
    <div className="strip">
      {dates.map((d) => (
        <button
          key={d}
          className={done.has(d) ? "dot on" : "dot"}
          aria-label={`${habit.title}, ${d}`}
          disabled={busy === habit.id + d}
          onClick={() => onPick(d)}
        />
      ))}
    </div>
  );
}

function Editor({ item, onDone, onCancel }: { item?: Habit; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    title: item?.title ?? "",
    kind: item?.kind ?? "daily",
    target: item?.target ?? 3,
    days: item?.days ?? [],
    note: item?.note ?? "",
    isHard: item?.isHard ?? false,
    active: item?.active ?? true,
  });
  const [busy, setBusy] = useState(false);

  const body = {
    ...f,
    days: f.kind === "daily" && f.days.length ? f.days : null,
    note: f.note || null,
  };

  async function save(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      haptic("success");
      onDone();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // Пустой список значит «все дни», поэтому первое касание гасит один день, а не зажигает один.
  const toggleDay = (id: number) => {
    const cur = f.days.length ? f.days : [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(id) ? cur.filter((d) => d !== id) : [...cur, id];
    if (!next.length) return;
    haptic();
    setF({ ...f, days: next.length === 7 ? [] : next.sort((a, b) => a - b) });
  };

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Привычка")}</span>
        <input
          className="text"
          value={f.title}
          maxLength={120}
          autoFocus={!item}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("Как считать")}</span>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Habit["kind"] })}>
          {KINDS().map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>

      {f.kind === "daily" && (
        <div className="field wrap">
          <span>{t("Дни")}</span>
          <div className="seg wide">
            {DOW().map((label, i) => {
              const id = dowId(i);
              const on = f.days.length === 0 || f.days.includes(id);
              return (
                <button key={id} className={on ? "on" : undefined} aria-pressed={on} onClick={() => toggleDay(id)}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {f.kind === "weekly" && (
        <label className="field">
          <span>{t("Раз в неделю")}</span>
          <input
            type="number"
            min={1}
            max={14}
            value={f.target}
            onChange={(e) => setF({ ...f, target: Number(e.target.value) })}
          />
        </label>
      )}
      {f.kind === "interval" && (
        <label className="field">
          <span>{t("Не реже чем раз в, дней")}</span>
          <input
            type="number"
            min={1}
            max={30}
            value={f.target}
            onChange={(e) => setF({ ...f, target: Number(e.target.value) })}
          />
        </label>
      )}

      <label className="field">
        <span>{t("Заметка")}</span>
        <input
          className="text"
          placeholder={t("кому, сколько, где")}
          value={f.note}
          maxLength={200}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
      </label>
      <div className="field">
        <span>{t("Спрос за неделю")}</span>
        <div className="seg">
          {([[false, t("Мягко")], [true, t("Штраф")]] as const).map(([v, label]) => (
            <button
              key={label}
              className={f.isHard === v ? "on" : undefined}
              aria-pressed={f.isHard === v}
              onClick={() => setF({ ...f, isHard: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {item && (
        <div className="field">
          <span>{t("Привычка включена")}</span>
          <div className="seg">
            {([[true, t("Да")], [false, t("Нет")]] as const).map(([v, label]) => (
              <button
                key={label}
                className={f.active === v ? "on" : undefined}
                aria-pressed={f.active === v}
                onClick={() => setF({ ...f, active: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="help">
        {f.isHard
          ? t("В воскресном разборе коуч спросит за норму и выдаст штраф, если она не закрыта.")
          : t("Мягкая привычка просто показывается в итогах недели, без штрафа.")}
      </p>

      <div className="editor-actions">
        {item && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () =>
              (await confirm(t("Удалить привычку вместе с историей отметок?"))) &&
              save(() => api("DELETE", `/habits/${item.id}`))}
          >
            {t("Удалить")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" disabled={busy} onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim()}
          onClick={() => save(() => item ? api("PATCH", `/habits/${item.id}`, body) : api("POST", "/habits", body))}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}
