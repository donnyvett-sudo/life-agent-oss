import { t } from "../i18n";
import { useState } from "react";
import { api, type Currency } from "../api";
import { capitalize, dayLabel, money } from "../format";
import { haptic } from "../tg";
import { ErrorBox, Loading } from "../ui";
import { useLoad } from "../useLoad";

type Item = {
  id: string;
  kind: "expense" | "income";
  amount: number;
  currency: Currency;
  note: string | null;
  date: string;
};

type Queue = {
  total: number;
  items: Item[];
  categories: { id: string; kind: "expense" | "income"; title: string }[];
};

/**
 * Разбор операций без внятной категории (после импорта из Money Manager их сотни).
 * Список за всё время, категория ставится одним касанием.
 */
export default function FinanceSort({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload } = useLoad<Queue>("/finance/sort?limit=200");
  const [open, setOpen] = useState<string | null>(null);
  const [sorted, setSorted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data) return <Loading />;

  const left = data.items.filter((x) => !sorted[x.id]);
  const assign = async (tx: Item, categoryId: string, title: string) => {
    setBusy(tx.id);
    try {
      await api("PATCH", `/transactions/${tx.id}`, { categoryId });
      haptic("success");
      setSorted((s) => ({ ...s, [tx.id]: title }));
      setOpen(null);
      onChanged();
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doneCount = Object.keys(sorted).length;

  return (
    <>
      <p className="note">
        <span className="note-label">{t("Осталось разобрать")}</span>
        {t("{left} из {all}", { left: data.total - doneCount, all: data.total })}
        {doneCount > 0 && <>. {t("Разобрано сейчас: {n}.", { n: doneCount })}</>}
      </p>

      {left.length === 0 && (
        <p className="muted" style={{ margin: "12px 0 0" }}>
          {data.total > data.items.length
            ? t("Эта сотня разобрана. Обнови экран, чтобы взять следующую.")
            : t("Всё разобрано.")}
        </p>
      )}

      {left.map((tx) => {
        const cats = data.categories.filter((c) => c.kind === tx.kind);
        const isOpen = open === tx.id;
        return (
          <div key={tx.id}>
            <button
              className="line line-button"
              disabled={busy === tx.id}
              onClick={() => {
                haptic();
                setOpen(isOpen ? null : tx.id);
              }}
            >
              <div className="grow">
                <div>{capitalize(tx.note || t("Без описания"))}</div>
                <div className="hint">{dayLabel(tx.date)}</div>
              </div>
              <div className={`amount${tx.kind === "income" ? " good" : ""}`}>
                {tx.kind === "income" ? "+" : "−"}{money(tx.amount, tx.currency)}
              </div>
            </button>
            {isOpen && (
              <div className="pick">
                {cats.map((c) => (
                  <button key={c.id} className="btn ghost" disabled={busy === tx.id} onClick={() => assign(tx, c.id, c.title)}>
                    {t(c.title)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
