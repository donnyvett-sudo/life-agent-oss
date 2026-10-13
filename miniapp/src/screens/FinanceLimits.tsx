import { t } from "../i18n";
import { Gauge, Repeat } from "lucide-react";
import { useState } from "react";
import { api, type BudgetRow, type Finance, type Subscription } from "../api";
import { dayLabel, money } from "../format";
import { confirm, haptic } from "../tg";
import { PanelHead } from "../ui";
import { useLoad } from "../useLoad";

const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));

/** Лимиты на месяц: сколько уже потрачено и сколько осталось. */
export function Budgets({ data }: { data: Finance }) {
  const { data: rows, error, reload } = useLoad<BudgetRow[]>("/budgets");
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ categoryId: "", amount: "" });
  const [busy, setBusy] = useState(false);

  if (error || !rows) return null;

  const used = new Set(rows.map((r) => r.categoryId ?? ""));
  const free = data.categories.filter((c) => c.kind === "expense" && !used.has(c.id));
  const canAddTotal = !used.has("");

  const save = async () => {
    setBusy(true);
    try {
      await api("POST", "/budgets", { categoryId: f.categoryId || null, amount: num(f.amount) });
      haptic("success");
      setAdding(false);
      setF({ categoryId: "", amount: "" });
      reload();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: BudgetRow) => {
    if (!(await confirm(t("Снять лимит «{title}»?", { title: t(row.title) })))) return;
    await api("DELETE", `/budgets/${row.id}`);
    haptic();
    reload();
  };

  return (
    <section className="panel">
      <PanelHead
        icon={<Gauge size={18} aria-hidden />}
        title={t("Лимиты на месяц")}
        meta={
          (canAddTotal || free.length > 0) && (
            <button
              className="link"
              onClick={() => {
                haptic();
                setAdding((v) => !v);
              }}
            >
              {adding ? t("Скрыть") : t("Добавить")}
            </button>
          )
        }
      />

      {rows.length === 0 && !adding && (
        <p className="chart-note">
          {t("Лимит показывает, сколько осталось до конца месяца. Бот предупредит на 80 % и когда лимит кончится.")}
        </p>
      )}

      {rows.map((r) => (
        <button key={r.id} className="cat-row" onClick={() => remove(r)}>
          <span className="cat-top">
            <span className="grow">{t(r.title)}</span>
            <span className="amount">{money(r.spent, r.currency, 0)} {t("из")} {money(r.amount, r.currency, 0)}</span>
            <span className={`share mono${r.pct >= 100 ? " bad" : ""}`}>{r.pct}%</span>
          </span>
          <span className="cat-bar" aria-hidden>
            <i className={r.pct >= 100 ? "over" : r.pct >= 80 ? "near" : undefined} style={{ width: `${Math.min(100, r.pct)}%` }} />
          </span>
        </button>
      ))}

      {adding && (
        <div className="editor">
          <label className="field">
            <span>{t("Категория")}</span>
            <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              {canAddTotal && <option value="">{t("Всего за месяц")}</option>}
              {free.map((c) => <option key={c.id} value={c.id}>{t(c.title)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t("Сумма в месяц")}</span>
            <input inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </label>
          <div className="editor-actions">
            <span className="spacer" />
            <button className="btn ghost" onClick={() => setAdding(false)}>{t("Отмена")}</button>
            <button className="btn" disabled={busy || !(num(f.amount) > 0)} onClick={save}>{t("Сохранить")}</button>
          </div>
        </div>
      )}

      {rows.length > 0 && !adding && <p className="chart-note">{t("Нажми на лимит, чтобы снять его.")}</p>}
    </section>
  );
}

const PERIOD: Record<Subscription["period"], string> = {
  week: "в неделю",
  month: "в месяц",
  quarter: "раз в квартал",
  year: "в год",
};

/** Регулярные списания, найденные в истории: их никто не заводит руками. */
export function Subscriptions() {
  const { data: subs, error } = useLoad<Subscription[]>("/subscriptions");
  if (error || !subs || subs.length === 0) return null;

  const live = subs.filter((s) => !s.overdue);
  const perMonth = new Map<string, number>();
  for (const s of live) perMonth.set(s.currency, (perMonth.get(s.currency) ?? 0) + s.perMonth);

  return (
    <section className="panel">
      <PanelHead
        icon={<Repeat size={18} aria-hidden />}
        title={t("Регулярные списания")}
        meta={t("{sum} в месяц", { sum: [...perMonth].map(([c, v]) => money(v, c, 0)).join(" + ") })}
      />
      {subs.map((s) => (
        <div key={`${s.note}${s.last}`} className="line">
          <div className="grow">
            <div className={s.overdue ? "muted" : undefined}>{s.note}</div>
            <div className="hint">
              {s.overdue
                ? t("последний раз {date}", { date: dayLabel(s.last) })
                : t("следующее около {date}", { date: dayLabel(s.next) })}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={`amount${s.overdue ? " muted" : ""}`}>{money(s.amount, s.currency)}</div>
            <div className="hint">{t(PERIOD[s.period])}</div>
          </div>
        </div>
      ))}
      <p className="chart-note">
        {t("Нашёл по истории: три и больше одинаковых списаний с ровным шагом. Серое — перестало приходить.")}
      </p>
    </section>
  );
}
