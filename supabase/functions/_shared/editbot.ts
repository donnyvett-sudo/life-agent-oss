// Правка уже записанной операции прямо из чата: «поменяй на 25», «это не такси, а автобус»,
// «назови это Magnolia», «это было вчера», «удали последнюю».
// Сначала детерминированный разбор, непонятное — в Gemini (тратит дневной лимит).
import { check, db, type User, userCurrency } from "./db.ts";
import { generate } from "./gemini.ts";
import { ensureCategories, learnCategory, recalcTransaction, type TransactionRow } from "./finance.ts";
import { bump, canonicalNote } from "./naming.ts";
import { entryCard } from "./moneybot.ts";
import { type Currency, fmtMoney } from "./parse.ts";
import { limitText, takeAi } from "./quota.ts";
import { spokenCurrency } from "./spoken.ts";
import { esc, send } from "./telegram.ts";
import { dayBounds, localNow, shiftDate } from "./time.ts";
import { lang, t } from "./i18n.ts";

export type EditAction =
  | { op: "amount"; value: number }
  | { op: "currency"; value: Currency }
  | { op: "kind"; value: "income" | "expense" }
  | { op: "date"; daysAgo: number }
  // Что это — название или категория, решаем по списку категорий при применении.
  | { op: "label"; value: string }
  | { op: "note"; value: string }
  | { op: "category"; value: string }
  | { op: "delete" };

export type EditIntent = {
  /** Какую запись правим: последнюю или найденную по слову и дню. */
  target: { note?: string; daysAgo?: number };
  actions: EditAction[];
};

const TRIGGER =
  /(помен|измен|исправ|переимен|назови|назовём|назовем|удали|сотри|отмени последн|убери запись|замени|на самом деле|ошибся|ошиблась|неправильно|не верно|неверно|это не |был[оа]? не |^не\s+\S+,?\s+а\s|change|fix it|correct|rename|call it|name it|delete|remove|undo last|replace|actually|i was wrong|wrong (amount|name|category|date)|it'?s not |that'?s not |^not\s)/i;

const DELETE = /(удали|удалить|сотри|убери запись|отмени последн|отмени эту|delete|remove (it|that|this|last)|undo last)/i;
const NUM = /(\d+(?:[.,]\d{1,2})?)/;

const clean = (s: string) =>
  s.replace(/[«»"'.,!?;:]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(это|в|на|как|запись|запиши|же)\s+/i, "").trim();

/** Похоже на просьбу что-то поправить, а не на новую запись или разговор. */
export function looksLikeEdit(text: string): boolean {
  return text.length <= 140 && TRIGGER.test(text);
}

export function parseEdit(text: string, base: Currency): EditIntent | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!looksLikeEdit(t)) return null;

  const target: EditIntent["target"] = {};
  const m = t.match(/вчерашн\S*\s+(\p{L}+)|yesterday'?s?\s+(\p{L}+)/u);
  if (m) {
    target.daysAgo = 1;
    target.note = m[1] ?? m[2];
  }

  if (DELETE.test(t)) return { target, actions: [{ op: "delete" }] };

  const actions: EditAction[] = [];

  // «не 35, а 25» и «не такси, а автобус» — берём то, что после «а».
  const swap = t.match(/не\s+(.+?),?\s+а\s+(.+)$/iu) ??
    t.match(/not\s+(.+?),?\s+(?:but|it'?s|its|it was)\s+(.+)$/iu);
  const tail = swap ? clean(swap[2]) : null;

  const numText = tail && NUM.test(tail)
    ? tail.match(NUM)![1]
    : t.match(
      /(?:помен\S*|исправ\S*|сделай|постав\S*|замен\S*|change|make it|set it to|should be)[^\d]{0,20}(\d+(?:[.,]\d{1,2})?)/iu,
    )?.[1] ??
      (/(на самом деле|было|стоил\S*|там|actually|it was|it cost)\D{0,12}\d/iu.test(t)
        ? t.match(NUM)?.[1]
        : undefined);
  if (numText) {
    const value = Number(numText.replace(",", "."));
    if (value > 0 && value < 1e8) actions.push({ op: "amount", value });
  }

  const cur = spokenCurrency(t);
  if (cur && cur !== base) actions.push({ op: "currency", value: cur });
  else if (
    cur && /(не\s+\S+,?\s+а|это|not\s+\S+,?\s+but|it'?s)\s*\S*\s*(тенге|тинге|юан|доллар|бакс|tenge|yuan|rmb|dollar|buck)/iu
      .test(t)
  ) {
    actions.push({ op: "currency", value: cur });
  }

  if (/(это|был[оа]?|it'?s|it was|that'?s)\s+(доход|приход|заработ|income|earning|salary)/iu.test(t)) {
    actions.push({ op: "kind", value: "income" });
  }
  if (/(это|был[оа]?|it'?s|it was|that'?s)\s+(расход|трата|an? )?(expense|spending|cost)/iu.test(t)) {
    actions.push({ op: "kind", value: "expense" });
  }

  // Дату меняем, только если про неё сказали явно.
  if (
    /(было|это|перенеси|запиши|считай|it was|that was|move it to|make it)\D{0,15}(вчера|позавчера|сегодня|yesterday|today|day before yesterday)/iu
      .test(t) && !target.daysAgo
  ) {
    const twoDays = /позавчера|day before yesterday/i.test(t);
    actions.push({ op: "date", daysAgo: twoDays ? 2 : /вчера|yesterday/i.test(t) ? 1 : 0 });
  }

  // Название: «назови это Magnolia», «название Magnolia».
  const named = t.match(
    /(?:назови|переимен\S*|назван\S*|rename(?: it)?(?: to)?|call it|name it)\s*(?:это|в|как|to)?\s*(.+)$/iu,
  );
  if (named) {
    const value = clean(named[1]).slice(0, 40);
    if (value && /\p{L}/u.test(value)) actions.push({ op: "note", value });
  } else if (/категори\S*|categor\S*/iu.test(t)) {
    const cat = clean(t.replace(/.*(категори\S*|categor\S*)/iu, ""));
    if (cat) actions.push({ op: "category", value: cat.slice(0, 40) });
  } else if (tail && !NUM.test(tail) && /\p{L}/u.test(tail) && !spokenCurrency(tail)) {
    actions.push({ op: "label", value: tail.slice(0, 40) });
  } else {
    const it = t.match(
      /(?:это|it'?s|that'?s)\s+(?!не\b|not\b|доход|расход|приход|трата|было|вчера|позавчера|сегодня|income|expense|yesterday|today)(\p{L}[\p{L} ]{1,30})$/iu,
    );
    const value = it ? clean(it[1]).slice(0, 40) : "";
    // «это тенге» — про валюту, а не про название.
    if (value && !spokenCurrency(value)) actions.push({ op: "label", value });
  }

  return actions.length ? { target, actions } : null;
}

/** Последние операции пользователя — из них выбираем, что править. */
async function recent(user: User, limit = 10): Promise<TransactionRow[]> {
  return check(
    await db.from("transactions").select("*").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(limit),
  ) as TransactionRow[];
}

function pick(rows: TransactionRow[], user: User, target: EditIntent["target"]): TransactionRow | null {
  if (!rows.length) return null;
  let list = rows;
  if (target.daysAgo !== undefined) {
    const date = shiftDate(localNow(user.tz).date, -target.daysAgo);
    const { from, to } = dayBounds(date, user.tz);
    list = list.filter((r) => r.occurred_at >= from.toISOString() && r.occurred_at < to.toISOString());
  }
  if (target.note) {
    const q = target.note.toLowerCase();
    const found = list.filter((r) => (r.note ?? "").toLowerCase().includes(q));
    if (found.length) list = found;
  }
  return list[0] ?? null;
}

/** Применить разобранную правку. Возвращает короткий ответ для чата. */
async function apply(user: User, tx: TransactionRow, actions: EditAction[]): Promise<string> {
  const patch: Record<string, unknown> = {};
  const done: string[] = [];
  const cats = await ensureCategories(user.id);

  for (const a of actions) {
    if (a.op === "amount") {
      patch.amount = a.value;
      done.push(t(user, "сумма {v}", { v: fmtMoney(a.value, (patch.currency as string) ?? tx.currency, lang(user)) }));
    } else if (a.op === "currency") {
      patch.currency = a.value;
      done.push(t(user, "валюта {v}", { v: a.value }));
    } else if (a.op === "kind") {
      patch.kind = a.value;
      done.push(a.value === "income" ? t(user, "это доход") : t(user, "это расход"));
    } else if (a.op === "date") {
      const date = shiftDate(localNow(user.tz).date, -a.daysAgo);
      patch.occurred_at = new Date(dayBounds(date, user.tz).from.getTime() + 12 * 3600_000).toISOString();
      done.push(t(user, "дата {v}", { v: date }));
    } else if (a.op === "note" || a.op === "label" || a.op === "category") {
      const kind = (patch.kind as string) ?? tx.kind;
      const cat = cats.find((c) =>
        !c.is_archived && c.kind === kind && c.title.toLowerCase() === a.value.toLowerCase()
      );
      if (cat && a.op !== "note") {
        patch.category_id = cat.id;
        if (tx.note) await learnCategory(user.id, kind as "income" | "expense", tx.note, cat.id);
        done.push(t(user, "категория {v}", { v: t(user, cat.title) }));
      } else {
        const named = await canonicalNote(user, a.value);
        patch.note = named.note;
        patch.note_heard = null;
        // Раз поправили вручную — это и есть правильное написание.
        if (tx.note_heard) await bump(user.id, tx.note_heard, named.note);
        await bump(user.id, a.value, named.note);
        done.push(t(user, "название {v}", { v: named.note }));
      }
    }
  }
  if (!done.length) return t(user, "Не понял, что поменять.");

  check(await db.from("transactions").update(patch).eq("id", tx.id).eq("user_id", user.id));
  // Суммы в валюте счёта и в юанях считаются заново.
  if (patch.amount || patch.currency || patch.occurred_at) await recalcTransaction(user.id, user.tz, tx.id);

  const card = await entryCard(user, tx.id);
  if (card) await send(user.tg_id, card.text, card.keyboard);
  return t(user, "Поправил: {list}.", { list: done.join(", ") });
}

/** Запасной разбор через Gemini: даём последние операции и просим одно действие. */
async function parseEditAI(user: User, text: string, rows: TransactionRow[]): Promise<
  { index: number; actions: EditAction[] } | null
> {
  const list = rows.map((r, i) =>
    `${i}: ${r.occurred_at.slice(0, 10)} ${r.kind === "income" ? "доход" : "расход"} ` +
    `${r.amount} ${r.currency} «${r.note ?? ""}»`
  ).join("\n");
  const out = await generate(
    "Пользователь правит запись о деньгах. Верни ТОЛЬКО JSON: " +
      '{"index":номер записи из списка,"actions":[{"op":"amount","value":число}|{"op":"currency","value":"CNY"|"KZT"|"USD"}' +
      '|{"op":"kind","value":"income"|"expense"}|{"op":"date","daysAgo":0|1|2}|{"op":"note","value":"название"}' +
      '|{"op":"category","value":"название категории"}|{"op":"delete"}]}. ' +
      "Название пиши латиницей, как принято для этого места. Если непонятно, что править — " +
      '{"index":null,"actions":[]}.\n\nПоследние записи:\n' + list,
    [{ role: "user", text: text.slice(0, 200) }],
    400,
  );
  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { index?: number | null; actions?: EditAction[] };
    const index = Number(parsed.index);
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return null;
    const actions = (parsed.actions ?? []).filter((a) => a && typeof a.op === "string");
    return actions.length ? { index, actions } : null;
  } catch {
    return null;
  }
}

/**
 * Обработать фразу-правку. null — это не правка, пусть разбирается коуч;
 * пустая строка — уже ответили сами (например, спросили подтверждение удаления).
 */
export async function handleEdit(user: User, text: string): Promise<string | null> {
  if (!looksLikeEdit(text)) return null;
  const rows = await recent(user);
  if (!rows.length) return null;

  const intent = parseEdit(text, userCurrency(user) as Currency);
  let tx = intent ? pick(rows, user, intent.target) : null;
  let actions = intent?.actions ?? null;

  if (!actions) {
    // В Gemini идём, только если речь явно про запись: иначе это разговор с коучем.
    if (
      !/(\d|запис|трат|доход|расход|сумм|назван|категори|валют|счёт|счет|entry|record|spend|expense|income|amount|name|categor|currenc|account)/iu
        .test(text)
    ) return null;
    if (!(await takeAi(user))) return limitText(user);
    const ai = await parseEditAI(user, text, rows).catch(() => null);
    if (!ai) return null;
    tx = rows[ai.index];
    actions = ai.actions;
  }
  if (!tx) return t(user, "Не нашёл такую запись.");

  if (actions.some((a) => a.op === "delete")) {
    const sign = tx.kind === "income" ? "+" : "−";
    await send(
      user.tg_id,
      t(user, "Удалить: <b>{note}</b> {sign}{sum}?", {
        note: esc(tx.note ?? ""),
        sign,
        sum: fmtMoney(Number(tx.amount), tx.currency, lang(user)),
      }),
      [[
        { text: t(user, "Удалить"), callback_data: `x:${tx.id}` },
        { text: t(user, "Оставить"), callback_data: `b:${tx.id}` },
      ]],
    );
    return "";
  }
  return await apply(user, tx, actions);
}
