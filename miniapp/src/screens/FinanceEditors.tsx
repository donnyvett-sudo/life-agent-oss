import { t } from "../i18n";
import { useState } from "react";
import { api, type Currency, type FinAccount, type Finance, type FinTransaction, type FinTransfer } from "../api";
import { confirm, haptic } from "../tg";

const CURRENCIES: Currency[] = ["CNY", "KZT", "USD"];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));

/** Общая обёртка: запрос → перезагрузка экрана, ошибки — алертом. */
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

export function TxEditor({ data, tx, kind: initialKind, onDone, onCancel }: {
  data: Finance;
  tx?: FinTransaction;
  kind?: "expense" | "income";
  onDone: () => void;
  onCancel: () => void;
}) {
  const accounts = data.accounts.filter((a) => !a.isArchived || a.id === tx?.accountId);
  const defaultAcc = accounts.find((a) => a.currency === "USD" && a.isDefault) ?? accounts[0];
  const [f, setF] = useState({
    kind: tx?.kind ?? initialKind ?? "expense",
    amount: tx ? String(tx.amount) : "",
    currency: tx?.currency ?? defaultAcc?.currency ?? "USD",
    note: tx?.note ?? "",
    categoryId: tx?.categoryId ?? "",
    accountId: tx?.accountId ?? defaultAcc?.id ?? "",
    date: tx?.date ?? today(),
  });
  const { busy, run } = useSubmit(onDone);
  const cats = data.categories.filter((c) => c.kind === f.kind);
  const valid = num(f.amount) > 0;

  // При смене счёта подставляем его валюту, если сумма ещё не введена в другой.
  const pickAccount = (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    setF({ ...f, accountId: id, currency: acc && !f.amount ? acc.currency : f.currency });
  };

  const body = {
    kind: f.kind,
    amount: num(f.amount),
    currency: f.currency,
    note: f.note,
    categoryId: f.categoryId || null,
    accountId: f.accountId || null,
    date: f.date,
  };

  return (
    <div className="editor">
      <div className="seg wide" style={{ margin: "10px 0 4px" }}>
        {(["expense", "income"] as const).map((k) => (
          <button
            key={k}
            className={f.kind === k ? "on" : undefined}
            aria-pressed={f.kind === k}
            onClick={() => setF({ ...f, kind: k, categoryId: "" })}
          >
            {k === "expense" ? t("Расход") : t("Доход")}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t("Сумма")}</span>
        <span className="field-pair">
          <input
            inputMode="decimal"
            autoFocus={!tx}
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            aria-label={t("Сумма")}
          />
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })} aria-label={t("Валюта")}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </span>
      </label>
      <label className="field">
        <span>{t("Описание")}</span>
        <input className="text" value={f.note} maxLength={80} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Категория")}</span>
        <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">{tx ? t("Без категории") : t("Авто")}</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{t(c.title)}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Счёт")}</span>
        <select value={f.accountId} onChange={(e) => pickAccount(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.title)} ({a.currency})</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Дата")}</span>
        <input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <div className="editor-actions">
        {tx && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => (await confirm(t("Удалить операцию?"))) && run(() => api("DELETE", `/transactions/${tx.id}`))}
          >
            {t("Удалить")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !valid}
          onClick={() => run(() => (tx ? api("PATCH", `/transactions/${tx.id}`, body) : api("POST", "/transactions", body)))}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}

export function TransferEditor({ data, transfer, onDone, onCancel }: {
  data: Finance;
  transfer?: FinTransfer;
  onDone: () => void;
  onCancel: () => void;
}) {
  const accounts = data.accounts.filter((a) => !a.isArchived);
  const [f, setF] = useState({
    fromAccountId: transfer?.fromAccountId ?? accounts[0]?.id ?? "",
    toAccountId: transfer?.toAccountId ?? accounts[1]?.id ?? "",
    fromAmount: transfer ? String(transfer.fromAmount) : "",
    toAmount: transfer ? String(transfer.toAmount) : "",
    note: transfer?.note ?? "",
    date: transfer?.date ?? today(),
  });
  const { busy, run } = useSubmit(onDone);
  const from = data.accounts.find((a) => a.id === f.fromAccountId);
  const to = data.accounts.find((a) => a.id === f.toAccountId);
  const crossCurrency = from && to && from.currency !== to.currency;
  const valid = num(f.fromAmount) > 0 && f.fromAccountId !== f.toAccountId;

  if (transfer) {
    // Переводы не редактируются: удалить и завести заново проще и надёжнее для балансов.
    return (
      <div className="editor">
        <p className="help">
          {from && t(from.title)} → {to && t(to.title)}: {transfer.fromAmount} {from?.currency}
          {crossCurrency ? ` → ${transfer.toAmount} ${to?.currency}` : ""}
          {transfer.note ? `. ${transfer.note}` : ""}
        </p>
        <div className="editor-actions">
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => (await confirm(t("Удалить перевод?"))) && run(() => api("DELETE", `/transfers/${transfer.id}`))}
          >
            {t("Удалить")}
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={onCancel}>{t("Закрыть")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Откуда")}</span>
        <select value={f.fromAccountId} onChange={(e) => setF({ ...f, fromAccountId: e.target.value })}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.title)} ({a.currency})</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Куда")}</span>
        <select value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.title)} ({a.currency})</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Сумма")}{from ? `, ${from.currency}` : ""}</span>
        <input inputMode="decimal" autoFocus value={f.fromAmount} onChange={(e) => setF({ ...f, fromAmount: e.target.value })} />
      </label>
      {crossCurrency && (
        <label className="field">
          <span>{t("Пришло")}, {to?.currency}</span>
          <input
            inputMode="decimal"
            placeholder={t("по курсу")}
            value={f.toAmount}
            onChange={(e) => setF({ ...f, toAmount: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        <span>{t("Комментарий")}</span>
        <input className="text" value={f.note} maxLength={80} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Дата")}</span>
        <input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      {f.fromAccountId === f.toAccountId && <p className="help warn">{t("Выбери разные счета.")}</p>}
      <div className="editor-actions">
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !valid}
          onClick={() =>
            run(() =>
              api("POST", "/transfers", {
                fromAccountId: f.fromAccountId,
                toAccountId: f.toAccountId,
                fromAmount: num(f.fromAmount),
                toAmount: crossCurrency && f.toAmount ? num(f.toAmount) : undefined,
                note: f.note,
                date: f.date,
              })
            )}
        >
          {t("Перевести")}
        </button>
      </div>
    </div>
  );
}

export function AccountEditor({ account, onDone, onCancel }: {
  account?: FinAccount;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    title: account?.title ?? "",
    currency: account?.currency ?? ("USD" as Currency),
    openingBalance: String(account?.openingBalance ?? 0),
    isDefault: account?.isDefault ?? false,
    inTotal: account?.inTotal ?? true,
  });
  const { busy, run } = useSubmit(onDone);
  const body = {
    title: f.title,
    currency: f.currency,
    openingBalance: num(f.openingBalance || "0"),
    isDefault: f.isDefault,
    inTotal: f.inTotal,
  };

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Название")}</span>
        <input className="text" value={f.title} maxLength={40} autoFocus={!account} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </label>
      {!account && (
        <label className="field">
          <span>{t("Валюта")}</span>
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>{t("Начальный остаток")}</span>
        <input inputMode="decimal" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Основной для {cur}", { cur: f.currency })}</span>
        <input type="checkbox" className="check" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
      </label>
      <label className="field">
        <span>{t("Учитывать в общем балансе")}</span>
        <input type="checkbox" className="check" checked={f.inTotal} onChange={(e) => setF({ ...f, inTotal: e.target.checked })} />
      </label>
      <p className="help">{t("Основной счёт получает записи из чата в его валюте.")}</p>
      <div className="editor-actions">
        {account && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => run(() => api("PATCH", `/accounts/${account.id}`, { isArchived: !account.isArchived }))}
          >
            {account.isArchived ? t("Вернуть из архива") : t("В архив")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={onCancel}>{t("Отмена")}</button>
        <button
          className="btn"
          disabled={busy || !f.title.trim()}
          onClick={() => run(() => (account ? api("PATCH", `/accounts/${account.id}`, body) : api("POST", "/accounts", body)))}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}
