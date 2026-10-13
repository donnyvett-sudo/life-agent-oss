// Финансы для Mini App: обзор месяца, операции, переводы, счета, категории.
import { budgetStatus, setBudget } from "../budget.ts";
import { check, db, type User, userCurrency } from "../db.ts";
import {
  type Account,
  CURRENCIES,
  convert,
  createTransaction,
  makeConverter,
  ensureCategories,
  learnCategory,
  recalcTransaction,
} from "../finance.ts";
import { dayBounds, localNow } from "../time.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function monthBounds(month: string, tz: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return {
    from: dayBounds(`${month}-01`, tz).from,
    to: dayBounds(`${next}-01`, tz).from,
    prev,
    next,
  };
}

/** Время операции: дата из формы → полдень по местному времени (если дата сегодня — сейчас). */
export function occurredAt(date: string | undefined, tz: string): string | undefined {
  if (!date) return undefined;
  if (!ISO_DATE.test(date)) throw new HttpError(400, "bad date");
  if (date === localNow(tz).date) return new Date().toISOString();
  const { from } = dayBounds(date, tz);
  return new Date(from.getTime() + 12 * 3600_000).toISOString();
}

export function positive(v: unknown, name: string): number {
  const n = Number(v);
  if (!(n > 0) || n > 1e9) throw new HttpError(400, `bad ${name}`);
  return round2(n);
}

export function currency(v: unknown): string {
  if (!CURRENCIES.includes(v as never)) throw new HttpError(400, "bad currency");
  return v as string;
}

async function balances(user: User, display: string) {
  const [accsRes, balRes] = await Promise.all([
    db.from("accounts").select("*").eq("user_id", user.id).order("sort"),
    db.rpc("account_balances", { p_user: user.id }),
  ]);
  const accs = check(accsRes) as Account[];
  const bal = new Map((check(balRes) as { account_id: string; balance: number }[]).map((b) => [b.account_id, Number(b.balance)]));
  const today = localNow(user.tz).date;
  const out = await Promise.all(accs.map(async (a) => {
    const balance = round2(bal.get(a.id) ?? 0);
    return {
      id: a.id,
      title: a.title,
      currency: a.currency,
      balance,
      balanceCny: await convert(balance, a.currency, "CNY", today),
      balanceDisplay: await convert(balance, a.currency, display, today),
      openingBalance: Number(a.opening_balance),
      isDefault: a.is_default,
      inTotal: a.in_total,
      isArchived: a.is_archived,
    };
  }));
  const inTotal = out.filter((a) => a.inTotal && !a.isArchived);
  return {
    accounts: out,
    totalCny: round2(inTotal.reduce((s, a) => s + a.balanceCny, 0)),
    total: round2(inTotal.reduce((s, a) => s + a.balanceDisplay, 0)),
  };
}

export async function financeOverview(user: User, month: string | null, displayParam: string | null) {
  const m = month && MONTH.test(month) ? month : localNow(user.tz).date.slice(0, 7);
  const display = CURRENCIES.includes(displayParam as never) ? displayParam! : userCurrency(user);
  const { from, to, prev, next } = monthBounds(m, user.tz);
  const [txRes, trRes, cats, bal] = await Promise.all([
    db.from("transactions")
      .select("id,kind,amount,currency,amount_cny,note,category_id,account_id,occurred_at,source")
      .eq("user_id", user.id).gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString())
      .order("occurred_at", { ascending: false }),
    db.from("transfers").select("*").eq("user_id", user.id)
      .gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString())
      .order("occurred_at", { ascending: false }),
    ensureCategories(user.id),
    balances(user, display),
  ]);
  const txs = check(txRes) as {
    id: string; kind: string; amount: number; currency: string; amount_cny: number | null;
    note: string | null; category_id: string | null; account_id: string | null; occurred_at: string; source: string;
  }[];
  const transfers = check(trRes) as {
    id: string; from_account_id: string; to_account_id: string; from_amount: number; to_amount: number;
    note: string | null; occurred_at: string;
  }[];

  // Сумма в валюте отображения: своя валюта — как есть, иначе из юаней по курсу дня операции.
  const conv = makeConverter();
  const inDisplay = await Promise.all(txs.map((t) => {
    if (t.currency === display) return Number(t.amount);
    const date = localNow(user.tz, new Date(t.occurred_at)).date;
    return conv(Number(t.amount_cny ?? 0), "CNY", display, date);
  }));

  let expense = 0, income = 0;
  const byCat = new Map<string, number>();
  for (const [i, t] of txs.entries()) {
    const v = inDisplay[i];
    if (t.kind === "expense") {
      expense += v;
      const key = t.category_id ?? "none";
      byCat.set(key, (byCat.get(key) ?? 0) + v);
    } else income += v;
  }
  const catTitle = new Map(cats.map((c) => [c.id, c.title]));

  return {
    month: m,
    currency: display,
    prev,
    next: next <= localNow(user.tz).date.slice(0, 7) ? next : null,
    expense: round2(expense),
    income: round2(income),
    byCategory: [...byCat]
      .map(([id, amount]) => ({ id: id === "none" ? null : id, title: catTitle.get(id) ?? "Без категории", amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    ...bal,
    categories: cats
      .filter((c) => !c.is_archived)
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
      .map((c) => ({ id: c.id, kind: c.kind, title: c.title })),
    transactions: txs.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: Number(t.amount),
      currency: t.currency,
      amountCny: t.amount_cny == null ? null : Number(t.amount_cny),
      amountDisplay: inDisplay[txs.indexOf(t)],
      note: t.note,
      categoryId: t.category_id,
      accountId: t.account_id,
      date: localNow(user.tz, new Date(t.occurred_at)).date,
      time: t.source === "import" ? null : localNow(user.tz, new Date(t.occurred_at)).hhmm,
    })),
    transfers: transfers.map((f) => ({
      id: f.id,
      fromAccountId: f.from_account_id,
      toAccountId: f.to_account_id,
      fromAmount: Number(f.from_amount),
      toAmount: Number(f.to_amount),
      note: f.note,
      date: localNow(user.tz, new Date(f.occurred_at)).date,
    })),
  };
}

/**
 * Операции без внятной категории («Прочее» или пусто) за всё время — для разбора пачкой.
 * Их много после импорта из Money Manager, а по месяцам разбирать долго.
 */
export async function toSort(user: User, limitParam: string | null) {
  const limit = Math.min(Math.max(Number(limitParam) || 100, 1), 300);
  const cats = await ensureCategories(user.id);
  const vague = cats.filter((c) => c.title === "Прочее").map((c) => c.id);

  const q = db.from("transactions")
    .select("id,kind,amount,currency,amount_cny,note,category_id,account_id,occurred_at", { count: "exact" })
    .eq("user_id", user.id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const res = await (vague.length ? q.or(`category_id.is.null,category_id.in.(${vague.join(",")})`) : q.is("category_id", null));
  const rows = check(res) as {
    id: string; kind: string; amount: number; currency: string; amount_cny: number | null;
    note: string | null; category_id: string | null; account_id: string | null; occurred_at: string;
  }[];

  return {
    total: res.count ?? rows.length,
    items: rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: Number(t.amount),
      currency: t.currency,
      amountCny: t.amount_cny == null ? null : Number(t.amount_cny),
      note: t.note,
      categoryId: t.category_id,
      accountId: t.account_id,
      date: localNow(user.tz, new Date(t.occurred_at)).date,
    })),
    categories: cats
      .filter((c) => !c.is_archived && c.title !== "Прочее")
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
      .map((c) => ({ id: c.id, kind: c.kind, title: c.title })),
  };
}

async function ownAccount(user: User, id: unknown): Promise<Account> {
  const a = check(
    await db.from("accounts").select("*").eq("id", String(id)).eq("user_id", user.id).maybeSingle(),
  ) as Account | null;
  if (!a) throw new HttpError(400, "bad account");
  return a;
}

async function ownCategory(user: User, id: unknown, kind: string): Promise<string | null> {
  if (id === null || id === undefined || id === "") return null;
  const c = check(
    await db.from("categories").select("id,kind").eq("id", String(id)).eq("user_id", user.id).maybeSingle(),
  ) as { id: string; kind: string } | null;
  if (!c || c.kind !== kind) throw new HttpError(400, "bad category");
  return c.id;
}

export async function createTx(user: User, b: Body) {
  const kind = b.kind === "income" ? "income" : "expense";
  const note = String(b.note ?? "").trim().slice(0, 80);
  if (b.accountId) await ownAccount(user, b.accountId);
  const categoryId = b.categoryId !== undefined ? await ownCategory(user, b.categoryId, kind) : undefined;
  await createTransaction(user.id, user.tz, {
    kind,
    amount: positive(b.amount, "amount"),
    currency: currency(b.currency ?? "CNY"),
    note,
    category_id: categoryId,
    account_id: b.accountId ?? null,
    occurred_at: occurredAt(b.date, user.tz),
    source: "app",
  });
}

export async function updateTx(user: User, id: string, b: Body) {
  const t = check(
    await db.from("transactions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
  ) as { kind: string; note: string | null; category_id: string | null } | null;
  if (!t) throw new HttpError(404, "not found");
  const kind = b.kind === "income" || b.kind === "expense" ? b.kind : t.kind;
  const patch: Record<string, unknown> = { kind };
  if (b.amount !== undefined) patch.amount = positive(b.amount, "amount");
  if (b.currency !== undefined) patch.currency = currency(b.currency);
  if (b.note !== undefined) patch.note = String(b.note).trim().slice(0, 80);
  if (b.accountId !== undefined) patch.account_id = (await ownAccount(user, b.accountId)).id;
  if (b.categoryId !== undefined) patch.category_id = await ownCategory(user, b.categoryId, kind);
  if (b.date !== undefined) patch.occurred_at = occurredAt(b.date, user.tz);
  check(await db.from("transactions").update(patch).eq("id", id));
  await recalcTransaction(user.id, user.tz, id);

  // Исправление категории — повод выучить правило.
  const note = (patch.note as string | undefined) ?? t.note;
  if (patch.category_id && patch.category_id !== t.category_id && note) {
    await learnCategory(user.id, kind, note, patch.category_id as string);
  }
}

export async function createTransfer(user: User, b: Body) {
  const from = await ownAccount(user, b.fromAccountId);
  const to = await ownAccount(user, b.toAccountId);
  if (from.id === to.id) throw new HttpError(400, "same account");
  const fromAmount = positive(b.fromAmount, "amount");
  const date = b.date && ISO_DATE.test(b.date) ? b.date : localNow(user.tz).date;
  const toAmount = b.toAmount ? positive(b.toAmount, "amount") : await convert(fromAmount, from.currency, to.currency, date).catch(() => {
      throw new HttpError(400, `нет курса ${from.currency}/${to.currency}`);
    });
  // id нужен чату: под карточкой перевода живут кнопки правки и «Отменить».
  return check(
    await db.from("transfers").insert({
      user_id: user.id,
      from_account_id: from.id,
      to_account_id: to.id,
      from_amount: fromAmount,
      to_amount: toAmount,
      note: String(b.note ?? "").trim().slice(0, 80) || null,
      occurred_at: occurredAt(date, user.tz) ?? new Date().toISOString(),
    }).select("id").single(),
  ) as { id: string };
}

export async function deleteTransfer(user: User, id: string) {
  check(await db.from("transfers").delete().eq("id", id).eq("user_id", user.id));
}

export async function saveAccount(user: User, id: string | null, b: Body) {
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title || title.length > 40) throw new HttpError(400, "bad title");
    patch.title = title;
  }
  if (b.openingBalance !== undefined) {
    const v = Number(b.openingBalance);
    if (!Number.isFinite(v) || Math.abs(v) > 1e10) throw new HttpError(400, "bad balance");
    patch.opening_balance = round2(v);
  }
  if (b.inTotal !== undefined) patch.in_total = Boolean(b.inTotal);
  if (b.isArchived !== undefined) patch.is_archived = Boolean(b.isArchived);
  if (b.isDefault !== undefined) patch.is_default = Boolean(b.isDefault);

  let acc: Account;
  if (id) {
    acc = await ownAccount(user, id);
    check(await db.from("accounts").update(patch).eq("id", id));
  } else {
    if (!patch.title) throw new HttpError(400, "title required");
    const cur = currency(b.currency);
    const { count } = await db.from("accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    acc = check(
      await db.from("accounts").insert({ ...patch, user_id: user.id, currency: cur, sort: (count ?? 0) + 1 })
        .select("*").single(),
    ) as Account;
  }
  // Основной счёт в валюте — только один.
  if (patch.is_default === true) {
    check(
      await db.from("accounts").update({ is_default: false }).eq("user_id", user.id)
        .eq("currency", acc.currency).neq("id", acc.id),
    );
  }
}

export async function saveCategory(user: User, id: string | null, b: Body) {
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title || title.length > 30) throw new HttpError(400, "bad title");
    patch.title = title;
  }
  if (b.isArchived !== undefined) patch.is_archived = Boolean(b.isArchived);
  if (id) {
    const res = await db.from("categories").update(patch, { count: "exact" }).eq("id", id).eq("user_id", user.id);
    check(res);
    if (!res.count) throw new HttpError(404, "not found");
  } else {
    if (!patch.title) throw new HttpError(400, "title required");
    const kind = b.kind === "income" ? "income" : "expense";
    check(await db.from("categories").insert({ ...patch, user_id: user.id, kind, sort: 200 }));
  }
}

/** Лимит из приложения: сумма в валюте человека, категория необязательна. */
export async function saveBudget(user: User, b: Body) {
  const amount = positive(b.amount, "amount");
  const categoryId = b.categoryId == null ? null : String(b.categoryId);
  if (categoryId && !/^[0-9a-f-]{36}$/.test(categoryId)) throw new HttpError(400, "bad categoryId");
  await setBudget(user, categoryId, amount);
  return budgetStatus(user);
}

export async function deleteBudget(user: User, id: string) {
  const res = await db.from("budgets").delete({ count: "exact" }).eq("id", id).eq("user_id", user.id);
  check(res);
  if (!res.count) throw new HttpError(404, "not found");
  return budgetStatus(user);
}
