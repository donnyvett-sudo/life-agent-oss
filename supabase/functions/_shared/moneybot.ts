// Операции в чате: ответ на запись, выбор категории и счёта кнопками.
import { budgetAlert } from "./budget.ts";
import { check, db, type User, userCurrency } from "./db.ts";
import {
  type Account,
  type Category,
  createTransaction,
  ensureCategories,
  learnCategory,
  recalcTransaction,
  type TransactionRow,
  userMoney,
} from "./finance.ts";
import { lang, t } from "./i18n.ts";
import { canonicalNote, forgetAlias } from "./naming.ts";
import { fmtMoney, type ParsedEntry } from "./parse.ts";
import { edit, esc, type Keyboard, send } from "./telegram.ts";
import { dayBounds, localNow, shiftDate } from "./time.ts";

async function load(user: User, id: string) {
  const tx = check(
    await db.from("transactions").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
  ) as TransactionRow | null;
  if (!tx) return null;
  const [cat, acc] = await Promise.all([
    tx.category_id
      ? db.from("categories").select("title").eq("id", tx.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    tx.account_id
      ? db.from("accounts").select("title").eq("id", tx.account_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    tx,
    category: t(user, (cat.data as { title: string } | null)?.title ?? "без категории"),
    account: t(user, (acc.data as { title: string } | null)?.title ?? "без счёта"),
  };
}

/** Сумма в валюте операции, а рядом — в валюте пользователя, если они разные. */
async function entryText(user: User, tx: TransactionRow, category: string, account: string): Promise<string> {
  const sign = tx.kind === "income" ? "+" : "−";
  const main = `${sign}${fmtMoney(Number(tx.amount), tx.currency, lang(user))}`;
  const alt = tx.currency !== userCurrency(user) && tx.amount_cny != null
    ? ` ≈ ${await userMoney(user, Number(tx.amount_cny), tx.occurred_at.slice(0, 10))}`
    : "";
  const icon = tx.kind === "income" ? "💰" : "💸";
  const heard = tx.note_heard ? "\n" + t(user, "услышал «{heard}»", { heard: esc(tx.note_heard) }) : "";
  return `${icon} <b>${esc(tx.note ?? "")}</b> ${main}${alt}\n${esc(category)} · ${esc(account)}${heard}`;
}

function entryKeyboard(user: User, id: string, renamed = false): Keyboard {
  return [
    [
      { text: t(user, "Категория"), callback_data: `c:${id}` },
      { text: t(user, "Счёт"), callback_data: `a:${id}` },
    ],
    ...(renamed ? [[{ text: t(user, "Это другое"), callback_data: `n:${id}` }]] : []),
    [{ text: "↩️ " + t(user, "Отменить"), callback_data: `x:${id}` }],
  ];
}

/** Записать операцию и прислать её в чат с кнопками. daysAgo: 1 — «вчера» (полдень того дня). */
export async function logEntry(
  user: User,
  raw: string,
  e: ParsedEntry,
  daysAgo = 0,
  source = "bot",
  accountId?: string,
): Promise<{ tx: TransactionRow; summary: string }> {
  const occurred = daysAgo > 0
    ? new Date(dayBounds(shiftDate(localNow(user.tz).date, -daysAgo), user.tz).from.getTime() + 12 * 3600_000)
    : undefined;
  // Одно заведение — одно написание: «магнолия» → Magnolia, «чай» → Tea.
  const named = await canonicalNote(user, e.note);
  const tx = await createTransaction(user.id, user.tz, {
    kind: e.kind,
    amount: e.amount,
    currency: e.currency,
    note: named.note,
    note_heard: named.heard ?? null,
    raw_text: raw,
    occurred_at: occurred?.toISOString(),
    // Счёт, названный во фразе; иначе createTransaction возьмёт основной в этой валюте.
    account_id: accountId ?? null,
    source,
  });
  const view = await load(user, tx.id);
  const when = daysAgo === 1
    ? ` (${t(user, "вчера")})`
    : daysAgo === 2
    ? ` (${t(user, "позавчера")})`
    : "";
  await send(
    user.tg_id,
    await entryText(user, tx, view!.category, view!.account) + when,
    entryKeyboard(user, tx.id, !!named.heard),
  );
  // Про лимит лучше узнать в момент траты, а не в конце месяца.
  if (tx.kind === "expense") {
    const alert = await budgetAlert(user, tx.category_id ?? null);
    if (alert) await send(user.tg_id, alert);
  }
  const sign = tx.kind === "income" ? "+" : "−";
  return {
    tx,
    summary: `${tx.note} ${sign}${fmtMoney(Number(tx.amount), tx.currency, lang(user))}, ${view!.category}${when}`,
  };
}

/** Карточка операции для чата: текст и кнопки. */
export async function entryCard(
  user: User,
  id: string,
): Promise<{ text: string; keyboard: Keyboard } | null> {
  const v = await load(user, id);
  if (!v) return null;
  return {
    text: await entryText(user, v.tx, v.category, v.account),
    keyboard: entryKeyboard(user, id, !!v.tx.note_heard),
  };
}

async function categoriesFor(user: User, kind: string): Promise<Category[]> {
  return (await ensureCategories(user.id))
    .filter((c) => c.kind === kind && !c.is_archived)
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

async function accountsFor(user: User): Promise<Account[]> {
  return check(
    await db.from("accounts").select("*").eq("user_id", user.id).eq("is_archived", false).order("sort"),
  ) as Account[];
}

function grid(buttons: { text: string; callback_data: string }[], perRow: number): Keyboard {
  const rows: Keyboard = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return rows;
}

/**
 * Кнопки под записью. Данные колбэка ≤ 64 байт, поэтому категорию/счёт передаём индексом
 * в отсортированном списке: c:<tx> — показать категории, cs:<tx>:<i> — выбрать; a/as — счета;
 * b:<tx> — назад.
 */
export async function handleEntryCallback(
  user: User,
  messageId: number | undefined,
  type: string,
  id: string,
  index?: string,
): Promise<string | undefined> {
  const view = await load(user, id);
  if (!view) return t(user, "Запись не найдена");
  const chat = user.tg_id;
  const show = async (keyboard?: Keyboard) => {
    const fresh = await load(user, id);
    if (!messageId || !fresh) return;
    const kb = keyboard ?? entryKeyboard(user, id, !!fresh.tx.note_heard);
    await edit(chat, messageId, await entryText(user, fresh.tx, fresh.category, fresh.account), kb);
  };

  if (type === "c") {
    const cats = await categoriesFor(user, view.tx.kind);
    await show([
      ...grid(cats.map((c, i) => ({ text: t(user, c.title), callback_data: `cs:${id}:${i}` })), 3),
      [{ text: t(user, "Назад"), callback_data: `b:${id}` }],
    ]);
    return;
  }
  if (type === "a") {
    const accs = await accountsFor(user);
    await show([
      ...grid(
        accs.map((a, i) => ({
          text: `${t(user, a.title)} (${a.currency})`,
          callback_data: `as:${id}:${i}`,
        })),
        2,
      ),
      [{ text: t(user, "Назад"), callback_data: `b:${id}` }],
    ]);
    return;
  }
  if (type === "cs" && index !== undefined) {
    const cat = (await categoriesFor(user, view.tx.kind))[Number(index)];
    if (!cat) return t(user, "Категория не найдена");
    check(await db.from("transactions").update({ category_id: cat.id }).eq("id", id));
    if (view.tx.note) await learnCategory(user.id, view.tx.kind, view.tx.note, cat.id);
    await show();
    return t(user, "Запомнено: {title}", { title: t(user, cat.title) });
  }
  if (type === "as" && index !== undefined) {
    const acc = (await accountsFor(user))[Number(index)];
    if (!acc) return t(user, "Счёт не найден");
    check(await db.from("transactions").update({ account_id: acc.id }).eq("id", id));
    await recalcTransaction(user.id, user.tz, id);
    await show();
    return t(user, acc.title);
  }
  if (type === "n") {
    // «Это другое»: вернуть услышанное название и запомнить его отдельно.
    const heard = view.tx.note_heard;
    if (!heard) return;
    check(await db.from("transactions").update({ note: heard, note_heard: null }).eq("id", id));
    await forgetAlias(user.id, heard, heard);
    await show(entryKeyboard(user, id));
    return t(user, "Записал как «{note}»", { note: heard });
  }
  if (type === "b") {
    await show();
    return;
  }
}
