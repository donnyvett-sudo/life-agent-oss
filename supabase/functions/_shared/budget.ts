/**
 * Лимиты трат на месяц. Смысл не в запрете, а в том, чтобы перерасход был виден
 * не в конце месяца, а в тот момент, когда его ещё можно отыграть: предупреждение
 * приходит на 80 % и на 100 % лимита, сразу после записи траты.
 */
import { check, db, type User, userCurrency } from "./db.ts";
import { convert, ensureCategories } from "./finance.ts";
import { lang, t } from "./i18n.ts";
import { fmtMoney } from "./parse.ts";
import { dayBounds, localNow } from "./time.ts";

export type Budget = { id: string; category_id: string | null; amount: number; currency: string };

export type BudgetStatus = {
  id: string;
  categoryId: string | null;
  title: string;
  amount: number;
  currency: string;
  spent: number;
  pct: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function budgetsOf(userId: string): Promise<Budget[]> {
  return check(
    await db.from("budgets").select("id,category_id,amount,currency").eq("user_id", userId),
  ) as Budget[];
}

function monthRange(user: User, month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: dayBounds(`${month}-01`, user.tz).from, to: dayBounds(`${next}-01`, user.tz).from };
}

/** Потрачено за месяц: всего и по категориям, в валюте лимита. */
async function spentByCategory(user: User, month: string, currency: string) {
  const { from, to } = monthRange(user, month);
  const txs = check(
    await db.from("transactions").select("amount,currency,amount_cny,category_id,occurred_at")
      .eq("user_id", user.id).eq("kind", "expense")
      .gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString()),
  ) as {
    amount: number; currency: string; amount_cny: number | null;
    category_id: string | null; occurred_at: string;
  }[];
  let total = 0;
  const byCat = new Map<string, number>();
  for (const tx of txs) {
    const date = localNow(user.tz, new Date(tx.occurred_at)).date;
    const v = tx.currency === currency
      ? Number(tx.amount)
      : await convert(Number(tx.amount_cny ?? 0), "CNY", currency, date);
    total += v;
    if (tx.category_id) byCat.set(tx.category_id, (byCat.get(tx.category_id) ?? 0) + v);
  }
  return { total, byCat };
}

/** Лимиты с текущим расходом. Месяц по умолчанию — идущий. */
export async function budgetStatus(user: User, month?: string): Promise<BudgetStatus[]> {
  const m = month ?? localNow(user.tz).date.slice(0, 7);
  const budgets = await budgetsOf(user.id);
  if (!budgets.length) return [];
  // Валюту человек может сменить, а старые лимиты останутся в прежней — считаем
  // расход отдельно для каждой валюты, которая встретилась среди лимитов.
  const currencies = [...new Set(budgets.map((b) => b.currency))];
  const spent = new Map(
    await Promise.all(
      currencies.map(async (c) => [c, await spentByCategory(user, m, c)] as const),
    ),
  );
  const cats = await ensureCategories(user.id);
  const title = new Map(cats.map((c) => [c.id, c.title]));
  return budgets
    .map((b) => {
      const { total, byCat } = spent.get(b.currency)!;
      const spentHere = round2(b.category_id ? byCat.get(b.category_id) ?? 0 : total);
      const amount = Number(b.amount);
      return {
        id: b.id,
        categoryId: b.category_id,
        title: b.category_id ? title.get(b.category_id) ?? "—" : t(user, "Всего за месяц"),
        amount,
        currency: b.currency,
        spent: spentHere,
        pct: Math.round((spentHere / amount) * 100),
      };
    })
    .sort((a, b) => (a.categoryId === null ? -1 : b.categoryId === null ? 1 : b.pct - a.pct));
}

const bar = (pct: number) => {
  const full = Math.min(10, Math.round(pct / 10));
  return "█".repeat(full) + "·".repeat(Math.max(0, 10 - full));
};

/** Текст для /budget. Пусто — значит лимитов ещё нет. */
export async function budgetOverview(user: User): Promise<string> {
  const rows = await budgetStatus(user);
  const l = lang(user);
  if (!rows.length) {
    return [
      "💰 " + t(user, "<b>Лимиты на месяц</b>"),
      t(user, "Лимитов нет. Поставить: <code>/budget Еда 1500</code> или <code>/budget всего 6000</code>."),
      t(user, "Предупрежу на 80 % и когда лимит кончится."),
    ].join("\n");
  }
  const lines = rows.map((r) => {
    const left = r.amount - r.spent;
    const tail = left >= 0
      ? t(user, "осталось {v}", { v: fmtMoney(round2(left), r.currency, l) })
      : t(user, "перебор {v}", { v: fmtMoney(round2(-left), r.currency, l) });
    return [
      `${r.pct >= 100 ? "🔴" : r.pct >= 80 ? "🟡" : "🟢"} <b>${r.title}</b> — ${r.pct} %`,
      `<code>${bar(r.pct)}</code> ${fmtMoney(r.spent, r.currency, l)} ${
        t(user, "из")
      } ${fmtMoney(r.amount, r.currency, l)}, ${tail}`,
    ].join("\n");
  });
  return ["💰 " + t(user, "<b>Лимиты на месяц</b>"), ...lines].join("\n");
}

type Seen = Record<string, number>;

/**
 * Предупреждение после записи траты. Каждую ступень (80, 100) говорим один раз
 * за месяц на лимит: иначе каждая следующая покупка повторяла бы одно и то же.
 */
export async function budgetAlert(user: User, categoryId: string | null): Promise<string | null> {
  const rows = await budgetStatus(user);
  if (!rows.length) return null;
  const month = localNow(user.tz).date.slice(0, 7);
  const state = user.state.budget as { month?: string; seen?: Seen } | undefined;
  const seen: Seen = state?.month === month ? { ...state.seen } : {};
  const l = lang(user);

  const out: string[] = [];
  for (const r of rows) {
    // Своя категория и общий лимит — обе строки к месту, чужие категории молчат.
    if (r.categoryId && r.categoryId !== categoryId) continue;
    const step = r.pct >= 100 ? 100 : r.pct >= 80 ? 80 : 0;
    if (!step || (seen[r.id] ?? 0) >= step) continue;
    seen[r.id] = step;
    out.push(
      step >= 100
        ? t(user, "🔴 {title}: лимит {amount} на месяц выбран, потрачено {spent}.", {
          title: r.title,
          amount: fmtMoney(r.amount, r.currency, l),
          spent: fmtMoney(r.spent, r.currency, l),
        })
        : t(user, "🟡 {title}: {pct} % лимита, осталось {left} до конца месяца.", {
          title: r.title,
          pct: r.pct,
          left: fmtMoney(round2(r.amount - r.spent), r.currency, l),
        }),
    );
  }
  if (!out.length) return null;
  user.state = { ...user.state, budget: { month, seen } };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
  return out.join("\n");
}

/** «Еда 1500», «всего 6000», «Транспорт 0». Имя пустое — общий лимит на месяц. */
export function parseBudget(line: string): { name: string | null; amount: number } | null {
  const m = line.trim().match(/^(.*?)\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return null;
  const name = m[1].trim().replace(/^(?:на|for)\s+/i, "");
  const total = /^(всего|общий|итого|все|total|all)$/i.test(name);
  return { name: !name || total ? null : name, amount: Number(m[2].replace(",", ".")) };
}

/** `/budget Еда 1500` из чата: находим категорию по названию и ставим лимит. */
export async function budgetCommand(user: User, line: string): Promise<string> {
  if (!line.trim()) return budgetOverview(user);
  const parsed = parseBudget(line);
  if (!parsed) {
    return t(user, "Формат: <code>/budget Еда 1500</code> или <code>/budget всего 6000</code>. Ноль снимает лимит.");
  }
  let category: { id: string; title: string } | null = null;
  if (parsed.name) {
    const key = parsed.name.toLowerCase().replace(/ё/g, "е");
    const cats = (await ensureCategories(user.id)).filter((c) => c.kind === "expense" && !c.is_archived);
    const found = cats.find((c) => t(user, c.title).toLowerCase() === key || c.title.toLowerCase() === key) ??
      cats.find((c) => t(user, c.title).toLowerCase().startsWith(key) || c.title.toLowerCase().startsWith(key));
    if (!found) return t(user, "Категории «{name}» нет.", { name: parsed.name });
    category = { id: found.id, title: t(user, found.title) };
  }
  const title = category?.title ?? t(user, "Всего за месяц");
  await setBudget(user, category?.id ?? null, parsed.amount);
  if (parsed.amount <= 0) return t(user, "Снял лимит: {title}.", { title });
  return [
    t(user, "Лимит {title}: {amount} в месяц.", {
      title,
      amount: fmtMoney(parsed.amount, userCurrency(user), lang(user)),
    }),
    "",
    await budgetOverview(user),
  ].join("\n");
}

/** Поставить или снять лимит. `amount` ≤ 0 — снять. */
export async function setBudget(user: User, categoryId: string | null, amount: number) {
  if (amount <= 0) {
    const q = db.from("budgets").delete().eq("user_id", user.id);
    check(await (categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null)));
    return;
  }
  check(
    await db.from("budgets").upsert({
      user_id: user.id,
      category_id: categoryId,
      amount: round2(amount),
      currency: userCurrency(user),
    }, { onConflict: "user_id,category_id" }),
  );
}
