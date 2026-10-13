import { t } from "../i18n";
import { Check, GitBranch, GitCommitHorizontal, Target } from "lucide-react";
import { useContext, useState } from "react";
import { api, type Career as CareerData, type Project } from "../api";
import { dueLabel, plural } from "../format";
import { confirm, haptic } from "../tg";
import { ErrorBox, Loading, Nav, PanelHead } from "../ui";
import { useLoad } from "../useLoad";

const STATUS = (): { id: Project["status"]; label: string }[] => [
  { id: "idea", label: t("Идея") },
  { id: "active", label: t("В работе") },
  { id: "paused", label: t("Пауза") },
  { id: "done", label: t("Готов") },
];
const statusLabel = (s: Project["status"]) => STATUS().find((x) => x.id === s)?.label ?? s;

type Milestone = CareerData["projects"][number]["milestones"][number];
type Open = { type: "project" | "milestone"; id: string | null; projectId?: string } | null;

export default function Career() {
  const { data, error, reload } = useLoad<CareerData>("/career");
  const [open, setOpen] = useState<Open>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { openSettings } = useContext(Nav);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return <Loading />;

  const done = () => {
    setOpen(null);
    reload();
  };
  const toggle = (o: NonNullable<Open>) => {
    haptic();
    setOpen(open && open.type === o.type && open.id === o.id && open.projectId === o.projectId ? null : o);
  };
  const isOpen = (type: "project" | "milestone", id: string | null, projectId?: string) =>
    open?.type === type && open.id === id && open.projectId === projectId;

  async function markDone(m: Milestone, value: boolean) {
    setBusy(m.id);
    try {
      await api("PATCH", `/milestones/${m.id}`, { title: m.title, dueDate: m.dueDate, done: value });
      haptic("success");
      reload();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const live = data.projects.filter((p) => p.status !== "done");
  const shipped = data.projects.filter((p) => p.status === "done");
  const closed = data.projects.flatMap((p) => p.milestones.filter((m) => m.done));

  return (
    <>
      {data.github
        ? <Activity github={data.github} today={data.today} />
        : (
          <section className="panel">
            <PanelHead icon={<GitBranch size={18} aria-hidden />} title="GitHub" />
            <p className="muted" style={{ margin: 0 }}>
              {t("Не подключён. Токен добавляется в настройках, после этого здесь появятся коммиты за полгода.")}
            </p>
            <button className="btn ghost full" onClick={openSettings}>{t("Открыть настройки")}</button>
          </section>
        )}

      <section className="panel">
        <PanelHead icon={<Target size={18} aria-hidden />} title={t("Проекты")} meta={`${live.length}`} />
        {live.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            {t("Пока пусто. Проект это то, что можно закончить: курсовая, робот, репетиторство.")}
          </p>
        )}

        {live.map((p) => (
          <div key={p.id}>
            <button className="line line-button" onClick={() => toggle({ type: "project", id: p.id })}>
              <div className="grow proj">
                <div>{p.title}</div>
                <div className="hint">{[statusLabel(p.status), p.goal].filter(Boolean).join(" · ")}</div>
              </div>
              <span className={`due ${p.dueDate ? dueLabel(p.dueDate, data.today).tone : ""}`}>
                {p.dueDate ? dueLabel(p.dueDate, data.today).text : ""}
              </span>
            </button>
            {isOpen("project", p.id) && <ProjectEditor item={p} onDone={done} onCancel={() => setOpen(null)} />}

            {p.milestones.filter((m) => !m.done).map((m) => {
              const due = dueLabel(m.dueDate, data.today);
              return (
                <div key={m.id}>
                  <div className="line ms">
                    <button
                      className="box hit"
                      aria-label={t("{title}: закрыть веху", { title: m.title })}
                      disabled={busy === m.id}
                      onClick={() => markDone(m, true)}
                    />
                    <button
                      className="grow line-text"
                      onClick={() => toggle({ type: "milestone", id: m.id, projectId: p.id })}
                    >
                      <div>{m.title}</div>
                    </button>
                    <span className={`due ${due.tone}`}>{m.dueDate ? due.text : ""}</span>
                  </div>
                  {isOpen("milestone", m.id, p.id) && (
                    <MilestoneEditor projectId={p.id} item={m} onDone={done} onCancel={() => setOpen(null)} />
                  )}
                </div>
              );
            })}

            {isOpen("milestone", null, p.id)
              ? <MilestoneEditor projectId={p.id} onDone={done} onCancel={() => setOpen(null)} />
              : (
                <button
                  className="link quiet"
                  onClick={() => toggle({ type: "milestone", id: null, projectId: p.id })}
                >
                  {t("Добавить веху")}
                </button>
              )}
          </div>
        ))}

        {isOpen("project", null)
          ? <ProjectEditor onDone={done} onCancel={() => setOpen(null)} />
          : <button className="btn ghost full" onClick={() => toggle({ type: "project", id: null })}>{t("Добавить проект")}</button>}

        {(closed.length > 0 || shipped.length > 0) && (
          <>
            <button className="link" style={{ marginTop: 12 }} onClick={() => setShowDone((v) => !v)}>
              {showDone ? t("Скрыть закрытое") : t("Закрытое ({n})", { n: closed.length + shipped.length })}
            </button>
            {showDone && (
              <>
                {closed.map((m) => (
                  <div key={m.id} className="line">
                    <button
                      className="box hit on"
                      aria-label={t("{title}: вернуть в работу", { title: m.title })}
                      disabled={busy === m.id}
                      onClick={() => markDone(m, false)}
                    >
                      <Check size={16} strokeWidth={3} aria-hidden />
                    </button>
                    <div className="grow muted">{m.title}</div>
                  </div>
                ))}
                {shipped.map((p) => (
                  <div key={p.id} className="line">
                    <div className="grow muted">
                      <div>{p.title}</div>
                      <div className="hint">{t("проект готов")}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** Полоса коммитов: столбец на день, недели столбцами как на GitHub. Числа не пишем, важна плотность. */
function Activity({ github, today }: { github: NonNullable<CareerData["github"]>; today: string }) {
  const byDate = new Map(github.days.map((d) => [d.date, d.count]));
  const max = Math.max(1, ...github.days.map((d) => d.count));
  const dates: string[] = [];
  for (let d = github.from; d <= today; d = shiftDay(d)) dates.push(d);

  return (
    <section className="panel">
      <PanelHead
        icon={<GitCommitHorizontal size={18} aria-hidden />}
        title={t("Код")}
        meta={t("{n} из 7 дней", { n: github.weekActive })}
      />
      <div className="commits" role="img" aria-label={t("Коммиты за {n} дней, серия {streak}", { n: dates.length, streak: github.streak })}>
        {dates.map((d) => {
          const n = byDate.get(d) ?? 0;
          return <i key={d} className={`cell l${n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4))}`} title={`${d}: ${n}`} />;
        })}
      </div>
      <p className="chart-note">
        {github.streak
          ? t("Серия {n} {days} подряд.", {
            n: github.streak,
            days: plural(github.streak, "день", "дня", "дней"),
          })
          : t("Сегодня коммитов ещё нет.")}
      </p>
    </section>
  );
}

function shiftDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
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
  };
  return { busy, run };
}

function ProjectEditor({ item, onDone, onCancel }: { item?: Project; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    title: item?.title ?? "",
    goal: item?.goal ?? "",
    status: item?.status ?? "active",
    repo: item?.repo ?? "",
    dueDate: item?.dueDate ?? "",
  });
  const { busy, run } = useSubmit(onDone);
  const body = { ...f, goal: f.goal || null, repo: f.repo || null, dueDate: f.dueDate || null };

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Название")}</span>
        <input
          className="text"
          value={f.title}
          maxLength={120}
          autoFocus={!item}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("Зачем")}</span>
        <input
          className="text"
          placeholder={t("одной строкой")}
          value={f.goal}
          maxLength={300}
          onChange={(e) => setF({ ...f, goal: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("Статус")}</span>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Project["status"] })}>
          {STATUS().map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Репозиторий")}</span>
        <input
          className="text"
          placeholder="owner/name"
          value={f.repo}
          maxLength={120}
          onChange={(e) => setF({ ...f, repo: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("Срок")}</span>
        <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </label>
      <div className="editor-actions">
        {item && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () =>
              (await confirm(t("Удалить проект вместе с вехами?"))) && run(() => api("DELETE", `/projects/${item.id}`))}
          >
            {t("Удалить")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" disabled={busy} onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim()}
          onClick={() => run(() => item ? api("PATCH", `/projects/${item.id}`, body) : api("POST", "/projects", body))}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}

function MilestoneEditor(
  { projectId, item, onDone, onCancel }: {
    projectId: string;
    item?: Milestone;
    onDone: () => void;
    onCancel: () => void;
  },
) {
  const [f, setF] = useState({ title: item?.title ?? "", dueDate: item?.dueDate ?? "" });
  const { busy, run } = useSubmit(onDone);
  const body = { projectId, title: f.title, dueDate: f.dueDate || null, done: item?.done ?? false };

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Веха")}</span>
        <input
          className="text"
          value={f.title}
          maxLength={160}
          autoFocus
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("Срок")}</span>
        <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </label>
      <p className="help">{t("Без срока веха не попадёт ни в утро, ни в недельный разбор.")}</p>
      <div className="editor-actions">
        {item && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => (await confirm(t("Удалить веху?"))) && run(() => api("DELETE", `/milestones/${item.id}`))}
          >
            {t("Удалить")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" disabled={busy} onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim()}
          onClick={() =>
            run(() => item ? api("PATCH", `/milestones/${item.id}`, body) : api("POST", "/milestones", body))}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}
