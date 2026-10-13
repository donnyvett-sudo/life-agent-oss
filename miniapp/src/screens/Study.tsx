import { BOT_LINK } from "../operator";
import { t } from "../i18n";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Languages, NotebookPen, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type Study as StudyData } from "../api";
import { dayLabel, dueLabel, durationShort, shiftDay, weekStart } from "../format";
import { haptic, webApp } from "../tg";
import { DateJump, ErrorBox, Loading, PanelHead } from "../ui";
import { useLoad } from "../useLoad";
import { AssignmentEditor, ExamEditor } from "./StudyEditors";

const BOT_CARDS = `${BOT_LINK}?start=cards`;
const KIND_LABEL = (): Record<string, string> => ({ quiz: t("Квиз"), final: t("Экзамен"), presentation: t("Защита"), other: "" });

type Open = { type: "hw" | "exam"; id: string | null } | null;

export default function Study() {
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, reload } = useLoad<StudyData>(`/study${week ? `?week=${week}` : ""}`);
  const [open, setOpen] = useState<Open>(null);
  const [showDone, setShowDone] = useState(false);
  const [focus, setFocus] = useState({ minutes: 25, courseId: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const days = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 7 }, (_, i) => shiftDay(data.week, i)).map((d) => ({
      date: d,
      items: data.sessions.filter((s) => s.date === d),
    }));
  }, [data]);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return <Loading />;

  const done = () => {
    setOpen(null);
    reload();
  };
  const toggle = (o: NonNullable<Open>) => {
    haptic();
    setOpen(open && open.type === o.type && open.id === o.id ? null : o);
  };
  const isOpen = (type: "hw" | "exam", id: string | null) => open?.type === type && open.id === id;

  async function markDone(id: string, value: boolean) {
    setBusy(id);
    try {
      await api("PATCH", `/assignments/${id}`, { done: value });
      haptic("success");
      reload();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function startFocus() {
    setBusy("focus");
    try {
      await api("POST", "/focus", { minutes: focus.minutes, courseId: focus.courseId || null });
      haptic("success");
      reload();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const maxFocus = Math.max(1, ...data.focus.byCourse.map((c) => c.minutes));
  const maxBox = Math.max(1, ...data.cards.byBox);
  const r = data.focus.running;
  const runningUntil = r
    ? new Date(Date.parse(r.startedAt) + r.plannedMin * 60_000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <>
      <section className="panel">
        <PanelHead icon={<NotebookPen size={18} aria-hidden />} title={t("Задания")} meta={`${data.assignments.length}`} />
        {data.assignments.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("Несданных заданий нет.")}</p>}
        {data.assignments.map((a) => {
          const due = dueLabel(a.dueDate, data.today);
          return (
            <div key={a.id}>
              <div className="line">
                <button
                  className="box hit"
                  aria-label={t("{title}: сдано", { title: a.title })}
                  disabled={busy === a.id}
                  onClick={() => markDone(a.id, true)}
                />
                <button className="grow line-text" onClick={() => toggle({ type: "hw", id: a.id })}>
                  <div>{a.title}</div>
                  <div className="hint">
                    {[a.course?.short, a.dueNote && !a.dueDate ? a.dueNote : null].filter(Boolean).join(", ")}
                  </div>
                </button>
                <span className={`due ${due.tone}`}>{due.text}</span>
              </div>
              {isOpen("hw", a.id) && <AssignmentEditor data={data} item={a} onDone={done} onCancel={() => setOpen(null)} />}
            </div>
          );
        })}
        {isOpen("hw", null)
          ? <AssignmentEditor data={data} onDone={done} onCancel={() => setOpen(null)} />
          : <button className="btn ghost full" onClick={() => toggle({ type: "hw", id: null })}>{t("Добавить задание")}</button>}
        {data.recentlyDone.length > 0 && (
          <>
            <button className="link" style={{ marginTop: 12 }} onClick={() => setShowDone((v) => !v)}>
              {showDone ? t("Скрыть сданные") : t("Сданные ({n})", { n: data.recentlyDone.length })}
            </button>
            {showDone && data.recentlyDone.map((a) => (
              <div key={a.id} className="line">
                <button
                  className="box hit on"
                  aria-label={t("{title}: вернуть в несданные", { title: a.title })}
                  disabled={busy === a.id}
                  onClick={() => markDone(a.id, false)}
                >
                  <Check size={16} strokeWidth={3} aria-hidden />
                </button>
                <div className="grow muted">
                  <div>{a.title}</div>
                  <div className="hint">{a.course?.short}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="panel">
        <PanelHead icon={<Target size={18} aria-hidden />} title={t("Контрольные")} />
        {data.exams.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("Ничего не запланировано.")}</p>}
        {data.exams.map((e) => {
          const when = e.dateTo && e.dateTo !== e.date
            ? `${dayLabel(e.date!, false)} – ${dayLabel(e.dateTo, false)}`
            : e.date ? dueLabel(e.date, data.today).text : t("дата неизвестна");
          return (
            <div key={e.id}>
              <button className="line line-button" onClick={() => toggle({ type: "exam", id: e.id })}>
                <div className="grow">
                  <div>{[e.course?.short, e.title].filter(Boolean).join(": ")}</div>
                  <div className="hint">
                    {[KIND_LABEL()[e.kind], e.topic, e.tentative ? t("ориентировочно") : null].filter(Boolean).join(", ")}
                  </div>
                </div>
                <span className={`due ${e.date && !e.dateTo ? dueLabel(e.date, data.today).tone : ""}`}>{when}</span>
              </button>
              {isOpen("exam", e.id) && <ExamEditor data={data} item={e} onDone={done} onCancel={() => setOpen(null)} />}
            </div>
          );
        })}
        {isOpen("exam", null)
          ? <ExamEditor data={data} onDone={done} onCancel={() => setOpen(null)} />
          : <button className="btn ghost full" onClick={() => toggle({ type: "exam", id: null })}>{t("Добавить контрольную")}</button>}
      </section>

      <section className="panel">
        <PanelHead icon={<CalendarClock size={18} aria-hidden />} title={t("Пары")} />
        <div className="month-nav inset">
          <button className="icon-btn" aria-label={t("Прошлая неделя")} onClick={() => setWeek(shiftDay(data.week, -7))}>
            <ChevronLeft size={20} aria-hidden />
          </button>
          <DateJump value={data.week} label={t("Выбрать неделю")} onPick={(d) => setWeek(weekStart(d))}>
            <span className="mono">
              {data.week === data.thisWeek ? t("Эта неделя") : `${dayLabel(data.week, false)} – ${dayLabel(shiftDay(data.week, 6), false)}`}
            </span>
          </DateJump>
          <button className="icon-btn" aria-label={t("Следующая неделя")} onClick={() => setWeek(shiftDay(data.week, 7))}>
            <ChevronRight size={20} aria-hidden />
          </button>
        </div>
        {data.sessions.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>{t("Расписания на эту неделю нет.")}</p>
        )}
        {days.filter((d) => d.items.length).map((d) => (
          <div key={d.date}>
            <div className={`sub-title${d.date === data.today ? " today" : ""}`}>
              {dayLabel(d.date)}{d.date === data.today ? t(", сегодня") : ""}
            </div>
            {d.items.map((s) => (
              <div key={s.id} className="line">
                <span className="mono slot">{s.start}<br /><span className="muted">{s.end}</span></span>
                <div className="grow">
                  <div>{s.kind === "lab" && s.title ? `${s.course?.short ?? ""}: ${s.title}` : s.course?.short ?? s.title}</div>
                  <div className="hint">{[s.kind === "lab" ? t("лаба") : null, s.room].filter(Boolean).join(", ")}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="panel">
        <PanelHead
          icon={<Clock size={18} aria-hidden />}
          title={t("Фокус")}
          meta={t("неделя {time}", { time: durationShort(data.focus.weekMin) })}
        />
        {r
          ? (
            <div className="note">
              <span>
                {t("Идёт {n} мин{course}, до {until}. Остановить можно в чате.", {
                  n: r.plannedMin,
                  course: r.course ? `: ${r.course.short}` : "",
                  until: runningUntil,
                })}
              </span>
            </div>
          )
          : (
            <>
              <div className="seg wide">
                {[25, 50, 90].map((m) => (
                  <button key={m} className={focus.minutes === m ? "on" : undefined} aria-pressed={focus.minutes === m} onClick={() => setFocus({ ...focus, minutes: m })}>
                    {t("{n} мин", { n: m })}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>{t("Курс")}</span>
                <select value={focus.courseId} onChange={(e) => setFocus({ ...focus, courseId: e.target.value })}>
                  <option value="">{t("Без курса")}</option>
                  {data.courses.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
                </select>
              </label>
              <button className="btn full" disabled={busy === "focus"} onClick={startFocus}>{t("Начать фокус")}</button>
              <p className="help">{t("Таймер идёт в боте: по окончании придёт сообщение.")}</p>
            </>
          )}
        {data.focus.byCourse.length > 0 && (
          <>
            <div className="sub-title">{t("За неделю, сегодня {n} мин", { n: data.focus.todayMin })}</div>
            {data.focus.byCourse.map((c) => (
              <div key={c.course?.id ?? "none"} className="cat-row static">
                <span className="cat-top">
                  <span className="grow">{c.course?.short ?? t("Без курса")}</span>
                  <span className="amount">{t("{n} мин", { n: c.minutes })}</span>
                </span>
                <span className="cat-bar" aria-hidden><i style={{ width: `${(c.minutes / maxFocus) * 100}%` }} /></span>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="panel">
        <PanelHead icon={<Languages size={18} aria-hidden />} title={t("Карточки")} meta={t("{n} всего", { n: data.cards.total })} />
        <div className="cards-row">
          <div>
            <div className="figure md">{data.cards.due}</div>
            <div className="hint">{t("к повторению сегодня")}</div>
          </div>
          <div className="boxes" role="img" aria-label={t("По коробкам: {list}", { list: data.cards.byBox.join(", ") })}>
            {data.cards.byBox.map((n, i) => (
              <div key={i} className="box-col">
                <span className="box-bar"><i style={{ height: `${(n / maxBox) * 100}%` }} /></span>
                <span className="mono small-num">{n}</span>
                <span className="hint">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="help">
          {t("Коробки Лейтнера: из первой повтор завтра, из пятой через месяц.")}
          {data.cards.reviewedWeek
            ? " " + t("За неделю: {right} из {all} верно.", {
              right: data.cards.correctWeek,
              all: data.cards.reviewedWeek,
            })
            : ""}
        </p>
        <button
          className="btn full"
          disabled={!data.cards.due}
          onClick={() => {
            haptic();
            if (webApp?.openTelegramLink) {
              webApp.openTelegramLink(BOT_CARDS);
              webApp.close?.();
            } else window.open(BOT_CARDS, "_blank");
          }}
        >
          {t("Повторить в боте")}
        </button>
      </section>
    </>
  );
}
