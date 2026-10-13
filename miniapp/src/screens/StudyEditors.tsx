import { t } from "../i18n";
import { useState } from "react";
import { api, type Study, type StudyAssignment, type StudyExam } from "../api";
import { confirm, haptic } from "../tg";

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
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function CourseSelect({ data, value, onChange }: { data: Study; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{t("Курс")}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Без курса")}</option>
        {data.courses.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
      </select>
    </label>
  );
}

export function AssignmentEditor({ data, item, onDone, onCancel }: {
  data: Study;
  item?: StudyAssignment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    title: item?.title ?? "",
    courseId: item?.course?.id ?? "",
    dueDate: item?.dueDate ?? "",
    dueNote: item?.dueNote ?? "",
    details: item?.details ?? "",
  });
  const { busy, run } = useSubmit(onDone);
  const body = { ...f, courseId: f.courseId || null, dueDate: f.dueDate || null };

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Что сдать")}</span>
        <input className="text" value={f.title} maxLength={200} autoFocus={!item} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <CourseSelect data={data} value={f.courseId} onChange={(v) => setF({ ...f, courseId: v })} />
      <label className="field">
        <span>{t("Срок")}</span>
        <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Уточнение")}</span>
        <input className="text" placeholder={t("в классе, до 23:59…")} value={f.dueNote} maxLength={300} onChange={(e) => setF({ ...f, dueNote: e.target.value })} />
      </label>
      {f.details && <p className="help">{f.details}</p>}
      {item?.course?.aiPolicy === "banned" && (
        <p className="help warn">{t("По этому курсу ИИ запрещён во всех заданиях: коуч следит только за сроками.")}</p>
      )}
      <div className="editor-actions">
        {item && !item.fromStudyAgent && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => (await confirm(t("Удалить задание?"))) && run(() => api("DELETE", `/assignments/${item.id}`))}
          >
            {t("Удалить")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim()}
          onClick={() => run(() => (item ? api("PATCH", `/assignments/${item.id}`, body) : api("POST", "/assignments", body)))}
        >
          {t("Сохранить")}
        </button>
      </div>
      {item?.fromStudyAgent && <p className="help">{t("Из Study Agent: удаляется там, здесь можно отметить сданным.")}</p>}
    </div>
  );
}

const KINDS = (): { id: StudyExam["kind"]; label: string }[] => [
  { id: "quiz", label: t("Квиз") },
  { id: "final", label: t("Экзамен") },
  { id: "presentation", label: t("Защита") },
  { id: "other", label: t("Другое") },
];

export function ExamEditor({ data, item, onDone, onCancel }: {
  data: Study;
  item?: StudyExam;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    title: item?.title ?? "",
    courseId: item?.course?.id ?? "",
    kind: item?.kind ?? ("quiz" as StudyExam["kind"]),
    date: item?.date ?? "",
    dateTo: item?.dateTo ?? "",
    tentative: item?.tentative ?? false,
    topic: item?.topic ?? "",
  });
  const { busy, run } = useSubmit(onDone);
  const body = { ...f, courseId: f.courseId || null, date: f.date || null, dateTo: f.dateTo || null };

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Название")}</span>
        <input className="text" value={f.title} maxLength={120} autoFocus={!item} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <CourseSelect data={data} value={f.courseId} onChange={(v) => setF({ ...f, courseId: v })} />
      <label className="field">
        <span>{t("Тип")}</span>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as StudyExam["kind"] })}>
          {KINDS().map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Дата")}</span>
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("По (если диапазон)")}</span>
        <input type="date" value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Ориентировочно")}</span>
        <input type="checkbox" className="check" checked={f.tentative} onChange={(e) => setF({ ...f, tentative: e.target.checked })} />
      </label>
      <label className="field">
        <span>{t("Темы")}</span>
        <input className="text" value={f.topic} maxLength={300} onChange={(e) => setF({ ...f, topic: e.target.value })} />
      </label>
      {item?.notes && <p className="help">{item.notes}</p>}
      <div className="editor-actions">
        {item && !item.fromStudyAgent && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => (await confirm(t("Удалить?"))) && run(() => api("DELETE", `/exams/${item.id}`))}
          >
            {t("Удалить")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim()}
          onClick={() => run(() => (item ? api("PATCH", `/exams/${item.id}`, body) : api("POST", "/exams", body)))}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}
