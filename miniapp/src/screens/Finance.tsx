import { t } from "../i18n";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Landmark, List, PieChart, Tags } from "lucide-react";
import { useMemo, useState } from "react";
import type { Currency, Finance as FinanceData } from "../api";
import { capitalize, dayLabel, money, moneyShort, monthLabel } from "../format";
import { haptic } from "../tg";
import { DateJump, ErrorBox, Head, Loading, PanelHead } from "../ui";
import { useLoad } from "../useLoad";
import { AccountEditor, TransferEditor, TxEditor } from "./FinanceEditors";
import { Budgets, Subscriptions } from "./FinanceLimits";
import FinanceSort from "./FinanceSort";

type Open =
  | { type: "tx"; id: string }
  | { type: "transfer"; id: string }
  | { type: "account"; id: string }
  | { type: "new"; what: "expense" | "income" | "transfer" | "account" }
  | null;

const CURRENCY_KEY = "finCurrency";
const DISPLAY: { id: Currency; label: string }[] = [
  { id: "CNY", label: "¥ CNY" },
  { id: "KZT", label: "₸ KZT" },
  { id: "USD", label: "$ USD" },
];

function savedCurrency(): Currency {
  try {
    const v = localStorage.getItem(CURRENCY_KEY);
    if (v === "CNY" || v === "KZT" || v === "USD") return v;
  } catch { /* по умолчанию */ }
  return "USD";
}

export default function Finance() {
  const [month, setMonth] = useState<string | null>(null);
  const [cur, setCur] = useState<Currency>(savedCurrency);
  const params = new URLSearchParams({ currency: cur, ...(month ? { month } : {}) });
  const { data, error, reload } = useLoad<FinanceData>(`/finance?${params}`);
  const [open, setOpen] = useState<Open>(null);
  const [filter, setFilter] = useState<string | null>(null); // категория
  const [showArchive, setShowArchive] = useState(false);
  const [sorting, setSorting] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const cat = new Map(data.categories.map((c) => [c.id, t(c.title)]));
    const acc = new Map(data.accounts.map((a) => [a.id, a]));
    type Row =
      | { type: "tx"; date: string; key: string; t: FinanceData["transactions"][number] }
      | { type: "transfer"; date: string; key: string; f: FinanceData["transfers"][number] };
    const rows: Row[] = [
      ...data.transactions
        .filter((t) => !filter || (t.kind === "expense" && (t.categoryId ?? "none") === filter))
        .map((t) => ({ type: "tx" as const, date: t.date, key: `t${t.id}`, t })),
      ...(filter ? [] : data.transfers.map((f) => ({ type: "transfer" as const, date: f.date, key: `f${f.id}`, f }))),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const byDay = new Map<string, Row[]>();
    for (const r of rows) byDay.set(r.date, [...(byDay.get(r.date) ?? []), r]);
    const maxCat = Math.max(1, ...data.byCategory.map((c) => c.amount));
    return { cat, acc, byDay, maxCat };
  }, [data, filter]);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data || !view) return <Loading />;

  const done = () => {
    setOpen(null);
    reload();
  };
  const toggle = (o: NonNullable<Open>) => {
    haptic();
    setOpen(JSON.stringify(open) === JSON.stringify(o) ? null : o);
  };
  const go = (m: string | null) => {
    if (!m) return;
    haptic();
    setMonth(m);
    setFilter(null);
    setOpen(null);
  };
  const isOpen = (o: NonNullable<Open>) => JSON.stringify(open) === JSON.stringify(o);

  const pickCurrency = (c: Currency) => {
    haptic();
    setCur(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch { /* не критично */ }
  };
  const dc = data.currency; // валюта отображения, в которой посчитаны итоги
  const digits = dc === "KZT" ? 0 : 2;

  const active = data.accounts.filter((a) => !a.isArchived);
  const archived = data.accounts.filter((a) => a.isArchived);
  const net = data.income - data.expense;

  return (
    <>
      <Head
        eyebrow={t("Итоги по курсу дня операции")}
        title={t("Финансы")}
        right={
          <div className="counter">
            <b>{moneyShort(data.total, dc)}</b>
            <span>{t("на счетах")}</span>
          </div>
        }
      />

      <div className="seg wide" style={{ marginBottom: 12 }} role="group" aria-label={t("Валюта")}>
        {DISPLAY.map((d) => (
          <button key={d.id} className={cur === d.id ? "on" : undefined} aria-pressed={cur === d.id} onClick={() => pickCurrency(d.id)}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="month-nav">
        <button className="icon-btn" aria-label={t("Предыдущий месяц")} onClick={() => go(data.prev)}>
          <ChevronLeft size={20} aria-hidden />
        </button>
        <DateJump
          type="month"
          value={data.month}
          max={data.next ? undefined : data.month}
          label={t("Выбрать месяц")}
          onPick={go}
        >
          <span className="mono">{monthLabel(data.month)}</span>
        </DateJump>
        <button className="icon-btn" aria-label={t("Следующий месяц")} disabled={!data.next} onClick={() => go(data.next)}>
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="meta">{t("Расходы")}</div>
          <div className="tile-value">{moneyShort(data.expense, dc)}</div>
        </div>
        <div className="tile">
          <div className="meta">{t("Доходы")}</div>
          <div className="tile-value">{moneyShort(data.income, dc)}</div>
        </div>
        <div className="tile">
          <div className="meta">{t("Итог")}</div>
          <div className={`tile-value ${net < 0 ? "bad" : "good"}`}>
            {net > 0 ? "+" : ""}{moneyShort(net, dc)}
          </div>
        </div>
      </div>

      {data.byCategory.length > 0 && (
        <section className="panel">
          <PanelHead icon={<PieChart size={18} aria-hidden />} title={t("Куда ушло")} meta={filter ? t("фильтр") : undefined} />
          {data.byCategory.map((c) => {
            const key = c.id ?? "none";
            const share = data.expense ? Math.round((c.amount / data.expense) * 100) : 0;
            return (
              <button
                key={key}
                className={`cat-row${filter === key ? " on" : ""}`}
                aria-pressed={filter === key}
                onClick={() => {
                  haptic();
                  setFilter(filter === key ? null : key);
                }}
              >
                <span className="cat-top">
                  <span className="grow">{t(c.title)}</span>
                  <span className="amount">{money(c.amount, dc, 0)}</span>
                  <span className="share mono">{share}%</span>
                </span>
                <span className="cat-bar" aria-hidden>
                  <i style={{ width: `${(c.amount / view.maxCat) * 100}%` }} />
                </span>
              </button>
            );
          })}
          <p className="chart-note">{t("Нажми на категорию, чтобы оставить в списке только её.")}</p>
        </section>
      )}

      <Budgets data={data} />
      <Subscriptions />

      <section className="panel">
        <PanelHead
          icon={<Tags size={18} aria-hidden />}
          title={t("Разобрать")}
          meta={
            <button
              className="link"
              onClick={() => {
                haptic();
                setSorting((v) => !v);
              }}
            >
              {sorting ? t("Скрыть") : t("Открыть")}
            </button>
          }
        />
        {sorting
          ? <FinanceSort onChanged={reload} />
          : <p className="chart-note">{t("Операции из «Прочего» и без категории за всё время, по одному касанию.")}</p>}
      </section>

      <section className="panel">
        <PanelHead icon={<Landmark size={18} aria-hidden />} title={t("Счета")} />
        {active.map((a) => (
          <div key={a.id}>
            <button className="line line-button" onClick={() => toggle({ type: "account", id: a.id })}>
              <div className="grow">
                <div>{t(a.title)}</div>
                <div className="hint">
                  {a.currency}
                  {a.isDefault ? t(", основной") : ""}
                  {!a.inTotal ? t(", не в общем балансе") : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className={`amount${a.balance < 0 ? " bad" : ""}`}>{money(a.balance, a.currency)}</div>
                {a.currency !== dc && <div className="hint mono">{money(a.balanceDisplay, dc, 0)}</div>}
              </div>
            </button>
            {isOpen({ type: "account", id: a.id }) && <AccountEditor account={a} onDone={done} onCancel={() => setOpen(null)} />}
          </div>
        ))}
        {isOpen({ type: "new", what: "account" })
          ? <AccountEditor onDone={done} onCancel={() => setOpen(null)} />
          : <button className="btn ghost full" onClick={() => toggle({ type: "new", what: "account" })}>{t("Добавить счёт")}</button>}
        {archived.length > 0 && (
          <>
            <button className="link" style={{ marginTop: 12 }} onClick={() => setShowArchive((v) => !v)}>
              {showArchive ? t("Скрыть архив") : t("Архив ({n})", { n: archived.length })}
            </button>
            {showArchive && archived.map((a) => (
              <div key={a.id}>
                <button className="line line-button" onClick={() => toggle({ type: "account", id: a.id })}>
                  <div className="grow muted">{t(a.title)}</div>
                  <div className="amount muted">{money(a.balance, a.currency)}</div>
                </button>
                {isOpen({ type: "account", id: a.id }) && <AccountEditor account={a} onDone={done} onCancel={() => setOpen(null)} />}
              </div>
            ))}
          </>
        )}
      </section>

      <section className="panel">
        <PanelHead
          icon={<List size={18} aria-hidden />}
          title={t("Операции")}
          meta={filter ? view.cat.get(filter) ?? t("Без категории") : undefined}
        />
        <div className="actions">
          <button className="btn ghost" onClick={() => toggle({ type: "new", what: "expense" })}>{t("Расход")}</button>
          <button className="btn ghost" onClick={() => toggle({ type: "new", what: "income" })}>{t("Доход")}</button>
          <button className="btn ghost" onClick={() => toggle({ type: "new", what: "transfer" })}>
            <ArrowLeftRight size={16} aria-hidden /> {t("Перевод")}
          </button>
        </div>
        {(isOpen({ type: "new", what: "expense" }) || isOpen({ type: "new", what: "income" })) && (
          <TxEditor
            data={data}
            kind={open && open.type === "new" && open.what === "income" ? "income" : "expense"}
            onDone={done}
            onCancel={() => setOpen(null)}
          />
        )}
        {isOpen({ type: "new", what: "transfer" }) && (
          <TransferEditor data={data} onDone={done} onCancel={() => setOpen(null)} />
        )}
        {filter && (
          <button className="link" style={{ margin: "10px 0 0" }} onClick={() => setFilter(null)}>
            {t("Показать все операции")}
          </button>
        )}

        {view.byDay.size === 0 && <p className="muted" style={{ margin: "12px 0 0" }}>{t("За этот месяц операций нет.")}</p>}
        {[...view.byDay].map(([date, rows]) => (
          <div key={date}>
            <div className="sub-title">{dayLabel(date)}</div>
            {rows.map((r) => {
              if (r.type === "transfer") {
                const from = view.acc.get(r.f.fromAccountId), to = view.acc.get(r.f.toAccountId);
                const o = { type: "transfer" as const, id: r.f.id };
                return (
                  <div key={r.key}>
                    <button className="line line-button" onClick={() => toggle(o)}>
                      <ArrowLeftRight size={16} className="muted" aria-hidden />
                      <div className="grow">
                        <div>{from && t(from.title)} → {to && t(to.title)}</div>
                        {r.f.note && <div className="hint">{r.f.note}</div>}
                      </div>
                      <div className="amount muted">{money(r.f.fromAmount, from?.currency ?? "CNY")}</div>
                    </button>
                    {isOpen(o) && <TransferEditor data={data} transfer={r.f} onDone={done} onCancel={() => setOpen(null)} />}
                  </div>
                );
              }
              const tx = r.t;
              const catTitle = tx.categoryId ? view.cat.get(tx.categoryId) : undefined;
              const account = tx.accountId ? view.acc.get(tx.accountId) : undefined;
              const o = { type: "tx" as const, id: tx.id };
              return (
                <div key={r.key}>
                  <button className="line line-button" onClick={() => toggle(o)}>
                    <div className="grow">
                      <div>{capitalize(tx.note || catTitle || t("Без описания"))}</div>
                      <div className="hint">
                        {[tx.note ? catTitle : null, account && t(account.title), tx.time].filter(Boolean).join(", ")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className={`amount${tx.kind === "income" ? " good" : ""}`}>
                        {tx.kind === "income" ? "+" : "−"}{money(tx.amount, tx.currency)}
                      </div>
                      {tx.currency !== dc && <div className="hint mono">{money(tx.amountDisplay, dc, digits)}</div>}
                    </div>
                  </button>
                  {isOpen(o) && <TxEditor data={data} tx={tx} onDone={done} onCancel={() => setOpen(null)} />}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </>
  );
}
