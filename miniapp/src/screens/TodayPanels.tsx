// Панели главного экрана. Какие из них показывать и в каком порядке — выбирает человек
// (кнопка «Настроить экран» внизу), поэтому каждая панель самостоятельна и ничего не знает
// о соседях. Порядок в PANELS — порядок в списке настройки.
import { t } from "../i18n";
import {
  Check,
  ClipboardList,
  Flag,
  Footprints,
  GraduationCap,
  type LucideIcon,
  Moon,
  Pill,
  Repeat,
  Wallet,
  X,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import type { Slot, Today as TodayData } from "../api";
import { capitalize, dayLabel, dueLabel, duration, money, number, plural, toMin } from "../format";
import { confirm, haptic } from "../tg";
import { Figure, PanelHead, Verdict } from "../ui";

export type PanelCtx = {
  data: TodayData;
  busy: string | null;
  isToday: boolean;
  act: (key: string, method: string, path: string, body?: unknown) => Promise<void>;
};

const SLOTS = (): { slot: Slot; title: string }[] => [
  { slot: "morning", title: t("Утро") },
  { slot: "lunch", title: t("С обедом") },
  { slot: "evening", title: t("Вечер") },
];

/** Пустая панель: одна приглушённая строка вместо пустого места. */
function Empty({ children }: { children: string }) {
  return <p className="muted" style={{ margin: 0 }}>{children}</p>;
}

function Sleep({ data, isToday }: PanelCtx) {
  const s = data.sleep;
  const targetMin = (toMin(data.sleepTarget.wake) - toMin(data.sleepTarget.bed) + 1440) % 1440;
  return (
    <>
      <PanelHead
        icon={<Moon size={18} aria-hidden />}
        title={t("Сон")}
        meta={s && s.date !== data.date ? dayLabel(s.date, false) : undefined}
      />
      {s
        ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
              <Figure minutes={s.asleepMin} />
              <Verdict verdict={s.verdict} />
            </div>
            <div
              className="meter"
              role="img"
              aria-label={t("{done} из {target}", { done: duration(s.asleepMin), target: duration(targetMin) })}
            >
              <i style={{ width: `${Math.min(100, (s.asleepMin / targetMin) * 100)}%` }} />
            </div>
            <div className="kv">
              <span>{t("Засыпание")}<b>{s.bed}</b></span>
              <span>{t("Подъём")}<b>{s.wake}</b></span>
              <span>{t("Глубокий")}<b>{duration(s.deepMin)}</b></span>
              <span>REM<b>{duration(s.remMin)}</b></span>
            </div>
            {s.notes.map((n) => <p key={n} className="remark">{n}</p>)}
          </>
        )
        : (
          <Empty>
            {isToday
              ? t("Данных нет. Передачу сна с iPhone настраивает команда /shortcut в боте.")
              : t("За эту ночь данных нет.")}
          </Empty>
        )}
    </>
  );
}

function Body({ data, busy, isToday, act }: PanelCtx) {
  const [weighing, setWeighing] = useState(false);
  const [kg, setKg] = useState("");
  const b = data.body;
  const has = b.steps !== null || b.weightKg !== null || b.restingHr !== null;
  return (
    <>
      <PanelHead
        icon={<Footprints size={18} aria-hidden />}
        title={t("Тело")}
        meta={b.weightDate && b.weightDate !== data.date ? dayLabel(b.weightDate, false) : undefined}
      />
      {has
        ? (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="meta">{t("Шаги")}</div>
                <div className="tile-value">{b.steps == null ? "–" : number(b.steps)}</div>
              </div>
              <div className="tile">
                <div className="meta">{t("Вес")}</div>
                <div className="tile-value">{b.weightKg == null ? "–" : `${number(b.weightKg, 1)} ${t("кг")}`}</div>
              </div>
              <div className="tile">
                <div className="meta">{t("Пульс покоя")}</div>
                <div className="tile-value">{b.restingHr ?? "–"}</div>
              </div>
            </div>
            {b.steps != null && (
              <div
                className="meter"
                role="img"
                aria-label={t("{done} из {target}", { done: number(b.steps), target: number(b.stepGoal) })}
              >
                <i style={{ width: `${Math.min(100, (b.steps / b.stepGoal) * 100)}%` }} />
              </div>
            )}
          </>
        )
        : (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            {isToday
              ? t("Шаги и пульс покоя передаёт команда с iPhone, её адрес даёт /shortcut.")
              : t("За этот день данных нет.")}
          </p>
        )}
      {/* Весы стоят в ванной, а не в кармане: цифру вводят руками, и путь к ней короткий. */}
      {weighing
        ? (
          <div className="editor">
            <label className="field">
              <span>{t("Вес, кг")}</span>
              <input
                inputMode="decimal"
                autoFocus
                value={kg}
                onChange={(e) => setKg(e.target.value.replace(",", "."))}
              />
            </label>
            <div className="editor-actions">
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setWeighing(false)}>{t("Отмена")}</button>
              <button
                className="btn"
                disabled={busy === "weight" || !(Number(kg) > 20 && Number(kg) < 400)}
                onClick={async () => {
                  await act("weight", "PUT", "/body", { weightKg: Number(kg), date: data.date });
                  setWeighing(false);
                }}
              >
                {t("Сохранить")}
              </button>
            </div>
          </div>
        )
        : (
          <button
            className="link"
            onClick={() => {
              haptic();
              setKg(b.weightKg != null ? String(b.weightKg) : "");
              setWeighing(true);
            }}
          >
            {b.weightKg == null ? t("Записать вес") : t("Изменить вес")}
          </button>
        )}
    </>
  );
}

function Supplements({ data, busy, act }: PanelCtx) {
  const supps = data.supplements;
  const taken = supps.filter((x) => x.status === "taken").length;
  return (
    <>
      <PanelHead icon={<Pill size={18} aria-hidden />} title={t("Добавки")} meta={`${taken} / ${supps.length}`} />
      {SLOTS().map(({ slot, title }) => {
        const items = supps.filter((x) => x.slot === slot);
        if (!items.length) return null;
        return (
          <div key={slot}>
            <div className="sub-title">{title}</div>
            {items.map((x) => {
              const low = x.daysLeft != null && x.daysLeft <= 5;
              return (
                <div key={x.id} className="line">
                  <button
                    className={`box hit ${x.status === "taken" ? "on" : x.status === "skipped" ? "off" : ""}`}
                    aria-label={t(x.status ? "{name}: снять отметку" : "{name}: выпито", { name: t(x.name) })}
                    aria-pressed={x.status === "taken"}
                    disabled={busy === x.id}
                    onClick={() =>
                      act(x.id, "POST", `/supplements/${x.id}/log`, { status: x.status ? null : "taken", date: data.date })}
                  >
                    {x.status === "taken" && <Check size={16} strokeWidth={3} aria-hidden />}
                    {x.status === "skipped" && <X size={16} strokeWidth={3} aria-hidden />}
                  </button>
                  <div className="grow">
                    <div>{t(x.name)}</div>
                    {x.status === "skipped" && <div className="hint">{t("Пропуск")}</div>}
                    {x.status !== "skipped" && x.daysLeft != null && (
                      <div className={low ? "hint warn" : "hint"}>
                        {t("Хватит на {n} {days}", {
                          n: x.daysLeft,
                          days: plural(x.daysLeft, "день", "дня", "дней"),
                        })}
                        {low && x.canRefill && (
                          <>
                            {". "}
                            <button
                              className="link"
                              disabled={busy === x.id}
                              onClick={() => act(x.id, "POST", `/supplements/${x.id}/refill?date=${data.date}`)}
                            >
                              {t("Новая банка")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {!x.status && (
                    <button
                      className="icon-btn"
                      aria-label={t("{name}: пропуск", { name: t(x.name) })}
                      disabled={busy === x.id}
                      onClick={() => act(x.id, "POST", `/supplements/${x.id}/log`, { status: "skipped", date: data.date })}
                    >
                      <X size={18} aria-hidden />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {!supps.length && <Empty>{t("Добавок нет. Добавить можно в настройках.")}</Empty>}
    </>
  );
}

function Spending({ data, busy, isToday, act }: PanelCtx) {
  return (
    <>
      <PanelHead
        icon={<Wallet size={18} aria-hidden />}
        title={t("Траты")}
        meta={data.spending.totals.map((x) => money(x.amount, x.currency)).join(" + ") || undefined}
      />
      {data.spending.items.length
        ? data.spending.items.map((tx) => (
          <div key={tx.id} className="line">
            <div className="grow">
              <div>{capitalize(tx.note)}</div>
              <div className="hint">{[tx.category && t(tx.category), tx.time].filter(Boolean).join(", ")}</div>
            </div>
            <div className="amount">{money(tx.amount, tx.currency)}</div>
            <button
              className="icon-btn"
              aria-label={t("Удалить: {note}", { note: tx.note })}
              disabled={busy === tx.id}
              onClick={async () =>
                (await confirm(t("Удалить «{note}»?", { note: tx.note }))) &&
                act(tx.id, "DELETE", `/transactions/${tx.id}?date=${data.date}`)}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        ))
        : (
          <Empty>
            {isToday
              ? t("Сегодня ничего. Пиши в чат коротко: «обед 35», «такси 18».")
              : t("В этот день трат не записано.")}
          </Empty>
        )}
    </>
  );
}

function Classes({ data }: PanelCtx) {
  // Пара уже кончилась — приглушаем, но не прячем: день полезно видеть целиком.
  const past = (end: string) => data.date === data.today && end < data.time;
  return (
    <>
      <PanelHead
        icon={<GraduationCap size={18} aria-hidden />}
        title={t("Пары")}
        meta={data.classes.length ? String(data.classes.length) : undefined}
      />
      {data.classes.length
        ? data.classes.map((c) => (
          <div key={c.id} className={past(c.end) ? "line dim" : "line"}>
            <span className="mono slot">{c.start}<br /><span className="muted">{c.end}</span></span>
            <div className="grow">
              <div>{c.kind === "lab" && c.title ? `${c.course ?? ""}: ${c.title}` : c.course ?? c.title}</div>
              <div className="hint">{[c.kind === "lab" ? t("лаба") : null, c.room].filter(Boolean).join(", ")}</div>
            </div>
          </div>
        ))
        : <Empty>{t("Пар в этот день нет.")}</Empty>}
    </>
  );
}

function Habits({ data, busy, act }: PanelCtx) {
  const done = data.habits.filter((h) => h.done).length;
  return (
    <>
      <PanelHead
        icon={<Repeat size={18} aria-hidden />}
        title={t("Привычки")}
        meta={data.habits.length ? `${done} / ${data.habits.length}` : undefined}
      />
      {data.habits.length
        ? data.habits.map((h) => (
          <div key={h.id} className="line">
            <button
              className={`box hit ${h.done ? "on" : ""}`}
              aria-label={t(h.done ? "{name}: снять отметку" : "{name}: сделано", { name: t(h.title) })}
              aria-pressed={h.done}
              disabled={busy === h.id}
              onClick={() => act(h.id, "POST", `/habits/${h.id}/log`, { date: data.date })}
            >
              {h.done && <Check size={16} strokeWidth={3} aria-hidden />}
            </button>
            <div className="grow">
              <div>{t(h.title)}</div>
              {h.streak > 1 && (
                <div className="hint">
                  {t("серия {n} {days}", { n: h.streak, days: plural(h.streak, "день", "дня", "дней") })}
                </div>
              )}
            </div>
          </div>
        ))
        : <Empty>{t("На сегодня ничего не запланировано.")}</Empty>}
    </>
  );
}

function Study({ data }: PanelCtx) {
  return (
    <>
      <PanelHead icon={<ClipboardList size={18} aria-hidden />} title={t("Дедлайны")} />
      {data.study.length
        ? data.study.map((x) => {
          const due = dueLabel(x.date, data.today);
          return (
            <div key={x.id} className="line">
              <div className="grow">
                <div>{x.title}</div>
                <div className="hint">
                  {[x.course, x.kind === "exam" ? t("контрольная") : t("задание")].filter(Boolean).join(", ")}
                </div>
              </div>
              <span className={`hint ${due.tone}`}>{x.date ? due.text : t("без срока")}</span>
            </div>
          );
        })
        : <Empty>{t("Открытых дедлайнов нет.")}</Empty>}
    </>
  );
}

function Milestones({ data }: PanelCtx) {
  return (
    <>
      <PanelHead icon={<Flag size={18} aria-hidden />} title={t("Вехи")} />
      {data.milestones.length
        ? data.milestones.map((m) => {
          const due = dueLabel(m.date, data.today);
          return (
            <div key={m.id} className="line">
              <div className="grow">
                <div>{m.title}</div>
                <div className="hint">{m.project}</div>
              </div>
              <span className={`hint ${due.tone}`}>{m.date ? due.text : t("без срока")}</span>
            </div>
          );
        })
        : <Empty>{t("Открытых вех нет.")}</Empty>}
    </>
  );
}

export type PanelDef = { id: string; icon: LucideIcon; title: () => string; Body: (p: PanelCtx) => ReactElement };

/**
 * Панели стабильны как компоненты (иначе React пересоздаёт их на каждой перерисовке
 * и поле веса теряет введённое), а подписи — функции: иначе они не переведутся
 * после переключателя языка.
 */
export const PANELS: PanelDef[] = [
  { id: "sleep", icon: Moon, title: () => t("Сон"), Body: Sleep },
  { id: "body", icon: Footprints, title: () => t("Тело"), Body },
  { id: "supplements", icon: Pill, title: () => t("Добавки"), Body: Supplements },
  { id: "spending", icon: Wallet, title: () => t("Траты"), Body: Spending },
  { id: "classes", icon: GraduationCap, title: () => t("Пары"), Body: Classes },
  { id: "habits", icon: Repeat, title: () => t("Привычки"), Body: Habits },
  { id: "study", icon: ClipboardList, title: () => t("Дедлайны"), Body: Study },
  { id: "milestones", icon: Flag, title: () => t("Вехи"), Body: Milestones },
];
