/**
 * Выгрузка всех данных человека: резервная копия и право забрать своё.
 * На бесплатном тарифе Supabase автоматических копий нет, поэтому копия —
 * это файл в Telegram: он переживёт и удаление проекта, и ошибку в миграции.
 */
import { check, db, type User } from "./db.ts";
import { t } from "./i18n.ts";
import { sendDocument } from "./telegram.ts";
import { localNow } from "./time.ts";

/**
 * Таблица и столбец для постраничного чтения (порядок нужен, чтобы страницы не поехали).
 * `reminders` и `messages` не берём: это транзитный шум, а не данные человека.
 */
const TABLES: [string, string][] = [
  ["accounts", "id"],
  ["categories", "id"],
  ["category_rules", "keyword"],
  ["transactions", "id"],
  ["transfers", "id"],
  ["note_aliases", "skel"],
  ["supplements", "id"],
  ["supplement_logs", "id"],
  ["sleep_sessions", "id"],
  ["coach_ledger", "id"],
  ["courses", "id"],
  ["assignments", "id"],
  ["exams", "id"],
  ["class_sessions", "id"],
  ["focus_sessions", "id"],
  ["flashcards", "id"],
  ["flashcard_reviews", "id"],
  ["feedback", "id"],
  ["habits", "id"],
  ["habit_logs", "local_date"],
  ["body_days", "local_date"],
  ["projects", "id"],
  ["milestones", "id"],
  ["github_days", "date"],
  ["promises", "id"],
];

const PAGE = 1000;

async function allRows(table: string, order: string, userId: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0;; from += PAGE) {
    const page = check(
      await db.from(table).select("*").eq("user_id", userId).order(order).range(from, from + PAGE - 1),
    ) as unknown[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export type Backup = { exportedAt: string; user: Record<string, unknown>; data: Record<string, unknown[]> };

/** Всё, что есть у человека. Токены не выгружаем: файл уходит в облако Telegram. */
export async function collect(user: User): Promise<Backup> {
  const data: Record<string, unknown[]> = {};
  for (const [table, order] of TABLES) data[table] = await allRows(table, order, user.id);
  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      tz: user.tz,
      settings: user.settings,
      created_at: (user as unknown as { created_at?: string }).created_at ?? null,
    },
    data,
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Операции таблицей: этот файл открывается в любом Excel, в отличие от JSON. */
export function transactionsCsv(b: Backup): string {
  const accounts = new Map(
    (b.data.accounts as { id: string; title: string }[]).map((a) => [a.id, a.title]),
  );
  const categories = new Map(
    (b.data.categories as { id: string; title: string }[]).map((c) => [c.id, c.title]),
  );
  type Tx = {
    occurred_at: string; kind: string; amount: number; currency: string; amount_cny: number | null;
    note: string | null; category_id: string | null; account_id: string | null;
  };
  const head = ["date", "kind", "amount", "currency", "amount_cny", "note", "category", "account"];
  const lines = (b.data.transactions as Tx[])
    .slice()
    .sort((x, y) => x.occurred_at.localeCompare(y.occurred_at))
    .map((tx) =>
      [
        tx.occurred_at,
        tx.kind,
        tx.amount,
        tx.currency,
        tx.amount_cny,
        tx.note,
        tx.category_id ? categories.get(tx.category_id) ?? "" : "",
        tx.account_id ? accounts.get(tx.account_id) ?? "" : "",
      ].map(csvCell).join(",")
    );
  return [head.join(","), ...lines].join("\n");
}

const count = (b: Backup) => Object.values(b.data).reduce((n, rows) => n + rows.length, 0);

/** Копия файлом в чат. `csv` — только операции, иначе весь JSON. */
export async function sendBackup(user: User, kind: "json" | "csv", caption?: string) {
  const b = await collect(user);
  const date = localNow(user.tz).date;
  if (kind === "csv") {
    await sendDocument(
      user.tg_id,
      `life-agent-operations-${date}.csv`,
      transactionsCsv(b),
      caption ?? t(user, "Операции таблицей: {n} шт.", { n: b.data.transactions.length }),
    );
    return;
  }
  await sendDocument(
    user.tg_id,
    `life-agent-${date}.json`,
    JSON.stringify(b, null, 1),
    caption ?? t(user, "Копия всех данных: {n} записей. Храни файл — на бесплатном тарифе других копий нет.", {
      n: count(b),
    }),
  );
}
