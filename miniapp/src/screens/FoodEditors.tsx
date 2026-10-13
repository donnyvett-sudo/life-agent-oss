import { t } from "../i18n";
import { useState } from "react";
import { api, type FoodDay, type Macros, type Meal } from "../api";
import { confirm, haptic } from "../tg";

function useSave(onDone: (d: FoodDay) => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<FoodDay>) => {
    setBusy(true);
    try {
      const d = await fn();
      haptic("success");
      onDone(d);
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

const n = (s: string) => {
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : 0;
};
const r1 = (v: number) => String(Math.round(v * 10) / 10);

// В полях лежат строки: «12.» и пустое поле не должны превращаться в 0 на лету.
type Row = { name: string; grams: string; kcal: string; p: string; f: string; c: string };

const toRow = (i: Meal["items"][number]): Row => ({
  name: i.name,
  grams: String(i.grams),
  kcal: String(i.kcal),
  p: String(i.p),
  f: String(i.f),
  c: String(i.c),
});

/** Граммы поменялись: КБЖУ позиции идёт следом, пропорционально. */
function regram(row: Row, grams: string): Row {
  const was = n(row.grams), now = n(grams);
  if (was <= 0 || now <= 0 || grams.endsWith(".") || grams.endsWith(",")) return { ...row, grams };
  const k = now / was;
  return {
    ...row,
    grams,
    kcal: String(Math.round(n(row.kcal) * k)),
    p: r1(n(row.p) * k),
    f: r1(n(row.f) * k),
    c: r1(n(row.c) * k),
  };
}

export const itemLabel = (name: string) => (name === "oil" ? t("скрытое масло") : name);

export function MealEditor({ meal, onSaved, onCancel }: {
  meal: Meal;
  onSaved: (d: FoodDay) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(meal.title);
  const [rows, setRows] = useState<Row[]>(meal.items.map(toRow));
  const { busy, run } = useSave(onSaved);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const scaleAll = (k: number) => setRows(rows.map((r) => regram(r, String(Math.round(n(r.grams) * k)))));
  const items = rows.filter((r) => r.name.trim()).map((r) => ({
    name: r.name.trim(),
    grams: n(r.grams),
    kcal: n(r.kcal),
    p: n(r.p),
    f: n(r.f),
    c: n(r.c),
  }));
  const total = items.reduce((s, i) => s + i.kcal, 0);

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Название")}</span>
        <input className="text" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {rows.map((r, i) => (
        <div key={i} className="item-card">
          <div className="name">
            <input
              value={itemLabel(r.name)}
              maxLength={60}
              aria-label={t("Позиция")}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <input
              className="num"
              inputMode="decimal"
              value={r.grams}
              aria-label={t("Граммы")}
              onChange={(e) => set(i, regram(r, e.target.value.replace(",", ".")))}
            />
            <span className="muted small">{t("г")}</span>
          </div>
          <div className="num-grid">
            {([["kcal", t("ккал")], ["p", t("Б")], ["f", t("Ж")], ["c", t("У")]] as const).map(([k, label]) => (
              <label key={k}>
                <span>{label}</span>
                <input
                  inputMode="decimal"
                  value={r[k]}
                  onChange={(e) => set(i, { [k]: e.target.value.replace(",", ".") })}
                />
              </label>
            ))}
          </div>
          {rows.length > 1 && (
            <button className="link quiet" style={{ paddingLeft: 0 }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              {t("Убрать позицию")}
            </button>
          )}
        </div>
      ))}
      <div className="editor-actions">
        <button className="btn ghost" onClick={() => scaleAll(0.5)}>½</button>
        <button className="btn ghost" onClick={() => scaleAll(1.5)}>×1.5</button>
        <span className="spacer" />
        <span className="amount">{total} {t("ккал")}</span>
      </div>
      <div className="editor-actions">
        <button
          className="btn danger"
          disabled={busy}
          onClick={async () => (await confirm(t("Удалить приём пищи?"))) && run(() => api<FoodDay>("DELETE", `/meals/${meal.id}`))}
        >
          {t("Удалить")}
        </button>
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !items.length || !title.trim()}
          onClick={() => run(() => api<FoodDay>("PATCH", `/meals/${meal.id}`, { title: title.trim(), items, status: "confirmed" }))}
        >
          {meal.status === "pending" ? t("Верно") : t("Сохранить")}
        </button>
      </div>
    </div>
  );
}

export function AddMeal({ date, onSaved, onCancel }: {
  date: string;
  onSaved: (d: FoodDay) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({ title: "", kcal: "", protein: "", fat: "", carbs: "" });
  const { busy, run } = useSave(onSaved);
  const num = (k: "kcal" | "protein" | "fat" | "carbs", label: string) => (
    <label>
      <span>{label}</span>
      <input inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(",", ".") })} />
    </label>
  );
  return (
    <div className="editor">
      <label className="field">
        <span>{t("Что съел")}</span>
        <input className="text" value={f.title} maxLength={80} autoFocus onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      <div className="num-grid" style={{ marginTop: 8 }}>
        {num("kcal", t("ккал"))}
        {num("protein", t("Б"))}
        {num("fat", t("Ж"))}
        {num("carbs", t("У"))}
      </div>
      <p className="help">{t("Фото и «съел …» бот считает сам. Здесь, если известны числа с упаковки.")}</p>
      <div className="editor-actions">
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim() || !(n(f.kcal) > 0)}
          onClick={() =>
            run(() =>
              api<FoodDay>("POST", "/meals", {
                date,
                title: f.title.trim(),
                kcal: n(f.kcal),
                protein: n(f.protein),
                fat: n(f.fat),
                carbs: n(f.carbs),
              })
            )}
        >
          {t("Добавить")}
        </button>
      </div>
    </div>
  );
}

export function TargetsEditor({ targets, onSaved, onCancel }: {
  targets: Macros;
  onSaved: (d: FoodDay) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    kcal: String(targets.kcal),
    protein: String(targets.protein),
    fat: String(targets.fat),
    carbs: String(targets.carbs),
  });
  const { busy, run } = useSave(onSaved);
  const row = (k: keyof typeof f, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, "") })} />
    </label>
  );
  return (
    <div className="editor">
      {row("kcal", t("Калории, ккал"))}
      {row("protein", t("Белки, г"))}
      {row("fat", t("Жиры, г"))}
      {row("carbs", t("Углеводы, г"))}
      <div className="editor-actions">
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || n(f.kcal) < 800}
          onClick={() =>
            run(() =>
              api<FoodDay>("PUT", "/food/targets", {
                kcal: n(f.kcal),
                protein: n(f.protein),
                fat: n(f.fat),
                carbs: n(f.carbs),
              })
            )}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}
