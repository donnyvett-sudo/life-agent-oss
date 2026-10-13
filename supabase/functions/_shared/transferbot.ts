// Переводы между своими счетами прямо из чата: «перекинул 50000 тенге с Каспи на WeChat,
// получил 690 юаней». Разбор детерминированный; Gemini подключается только в spoken.ts,
// когда фраза не легла ни на один шаблон.
//
// Правило, которое делает разбор безопасным: перевод записывается, только если нашлись
// ДВА разных своих счёта. Иначе фраза падает дальше — в обычный доход или расход,
// поэтому «пополнил Kaspi на 20000» остаётся доходом, а «перевёл маме 5000» — тратой.
import { check, db, type User, userCurrency } from "./db.ts";
import { looksLikeEdit } from "./editbot.ts";
import { type Account, convert, defaultAccount } from "./finance.ts";
import { createTransfer } from "./app/finance.ts";
import { lang, t } from "./i18n.ts";
import { levenshtein, skel } from "./naming.ts";
import { type Currency, fmtMoney } from "./parse.ts";
import { spokenCurrency } from "./spoken.ts";
import { edit, esc, type Keyboard, send } from "./telegram.ts";
import { localNow, shiftDate } from "./time.ts";

export type ParsedTransfer = {
  fromAmount: number;
  toAmount: number | null;
  fromCurrency: Currency | null;
  toCurrency: Currency | null;
  fromHint: string | null;
  toHint: string | null;
  daysAgo: number;
};

// Глаголы перемещения денег. «Пополнил» и «закинул» тоже здесь: если второй счёт назван —
// это перевод, если нет — фраза уходит в доход.
const VERB =
  /(перев[еёо]л|перевела|перевод|переведи|перекин|переброс|перебрас|перебил|перебива|перелож|перен[её]с|обменя|обмен[ауые]|поменя|конвертир|вывел|вывела|завёл|завел|зан[её]с|закинул|закинула|скинул|скинула|кинул|кинула|сбросил|отправил|отправила|зачислил|пополн|положил|положила|снял|сняла|transferr?ed|transfer|moved|move|exchang|convert|swap|withdrew|withdraw|top ?up|topped up)/i;

// «Скинули мне», «прислал от мамы» — это доход, а не перекладывание своих денег.
const INCOMING = /((^|\s)мне($|\s)|(^|\s)от\s+\p{L}|(^|\s)(to|for)\s+me($|\s)|(^|\s)from\s+(mom|dad|parents))/iu;

// Слова, которые стоят перед счётом, но названием не являются: «со счёта каспи».
const SKIP = /^(сч[её]т\S*|карт\S*|баланс\S*|кошел\S*|депозит\S*|account|card|balance|wallet|my|the|мо[ей]\S*|сво\S*)$/i;

// На этих словах кусок с названием счёта кончается.
const STOP =
  /^(на|в|во|и|а|с|со|по|за|то|это|мне|же|курс\S*|комисси\S*|вчера|позавчера|сегодня|yesterday|today|to|into|and|for|at|got|received|rate|fee|получ\S*|пришл\S*|вышл\S*|стал\S*|вз[ая]л\S*)$/i;

const NUM = /\d+(?:[.,]\d{1,2})?/;

/** Быстрая проверка: стоит ли вообще разбирать фразу как перевод. */
export function looksLikeTransfer(text: string): boolean {
  return text.length <= 300 && NUM.test(text) && VERB.test(text) &&
    (!INCOMING.test(text) || /(^|\s)(с|со|from)\s+\p{L}/iu.test(text));
}

/** Привести «$200» и «45тг» к виду «200 $», «45 тг», склеить «50 000» в 50000. */
function normalize(input: string): string {
  let text = input.trim().replace(/\s+/g, " ");
  text = text.replace(/(^|\s)([$¥₸])(\d+(?:[.,]\d{1,2})?)/g, (_, pre, sign, num) => `${pre}${num} ${sign}`);
  text = text.replace(/(\d+(?:[.,]\d{1,2})?)([^\d\s.,]+)/gu, "$1 $2");
  // «50 000 тенге» → «50000 тенге»: в расшифровке голоса разряды часто разделены пробелом.
  for (let i = 0; i < 3; i++) text = text.replace(/(\d)[  ](\d{3})(?!\d)/g, "$1$2");
  return text;
}

/** Суммы по порядку, с валютой из слова сразу за числом. Курс и комиссия — не суммы перевода. */
function amounts(text: string): { value: number; currency: Currency | null }[] {
  const hits = [...text.matchAll(/\d+(?:[.,]\d{1,2})?/g)];
  const out: { value: number; currency: Currency | null }[] = [];
  for (const [i, h] of hits.entries()) {
    const before = text.slice(Math.max(0, h.index! - 14), h.index!);
    if (/(курс\S*|rate|комисси\S*|fee|процент\S*)\s*\S{0,3}$/i.test(before)) continue;
    const value = Number(h[0].replace(",", "."));
    if (!(value > 0) || value > 1e9) continue;
    const till = hits[i + 1]?.index ?? text.length;
    const after = text.slice(h.index! + h[0].length, till).slice(0, 22);
    out.push({ value: Math.round(value * 100) / 100, currency: spokenCurrency(after) });
  }
  return out;
}

/** Кусок текста после предлога → название счёта (не больше трёх слов) и длина хвоста. */
function hintOf(raw: string | undefined): { text: string; taken: number; total: number } | null {
  if (!raw) return null;
  const all = raw.trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  let taken = 0;
  for (const w of all) {
    const word = w.replace(/[«»"'.,!?;:()]/g, "");
    if (!word) continue;
    if (/\d/.test(word) || STOP.test(word)) break;
    taken++;
    if (SKIP.test(word)) continue;
    words.push(word);
    if (words.length === 3) break;
  }
  const text = words.join(" ");
  return text && /\p{L}/u.test(text) ? { text, taken, total: all.length } : null;
}

const hint = (raw: string | undefined): string | null => hintOf(raw)?.text ?? null;

/** Разобрать фразу о переводе. Счета здесь ещё не ищутся — только подсказки для поиска. */
export function parseTransfer(input: string): ParsedTransfer | null {
  if (!looksLikeTransfer(input)) return null;
  const text = normalize(input);
  const list = amounts(text);
  if (!list.length) return null;

  const daysAgo = /позавчера|day before yesterday/i.test(text)
    ? 2
    : /вчера|yesterday/i.test(text)
    ? 1
    : 0;

  let fromHint = hint(text.match(/(?:^|\s)(?:с|со|из|from|off)\s+(.+)$/iu)?.[1]);
  let toHint = hint(text.match(/(?:^|\s)(?:на|в|во|to|into|onto)\s+(.+)$/iu)?.[1]);
  // «обменял на юани»: после предлога не счёт, а валюта.
  let fromCurrency = list[0].currency;
  let toCurrency = list[1]?.currency ?? null;
  if (fromHint && spokenCurrency(fromHint) && !/\s/.test(fromHint)) {
    fromCurrency ??= spokenCurrency(fromHint);
    fromHint = null;
  }
  if (toHint && spokenCurrency(toHint) && !/\s/.test(toHint)) {
    toCurrency ??= spokenCurrency(toHint);
    toHint = null;
  }
  // Одна сумма, ни валюты, ни счетов — говорят не о переводе («поменяй на 25»).
  // Если названа хотя бы одна сторона, вторую досчитаем по курсу дня.
  if (list.length < 2 && !fromCurrency && !toCurrency && !fromHint && !toHint) return null;

  return {
    fromAmount: list[0].value,
    toAmount: list[1]?.value ?? null,
    fromCurrency,
    toCurrency,
    fromHint,
    toHint,
    daysAgo,
  };
}

// ------------------------------------------------------------- счета ---

/** Русское окончание падежа: «с вичата» и «с Каспия» — те же счета, что «вичат» и «Каспи». */
const stem = (w: string) =>
  /^[а-яё]+$/i.test(w) ? w.replace(/(ами|ах|ом|ем|ой|ей|ов|ы|и|а|у|е|я|ю)$/i, "") : w;

/** Счёт по куску названия: «каспи» → Kaspi Balance, «вичат» → WeChat Balance. */
export function matchAccount(accounts: Account[], hint: string): Account | null {
  const cands: { key: string; acc: Account }[] = [];
  for (const a of accounts) {
    cands.push({ key: skel(a.title), acc: a });
    for (const w of a.title.split(/\s+/)) {
      // Скелет сжимает повторы, поэтому «bcc» — это «bk»: двухбуквенные ключи тоже нужны.
      const k = skel(w);
      if (k.length >= 2) cands.push({ key: k, acc: a });
    }
  }
  const words = [hint, ...hint.split(/\s+/)].filter((p) => p.length >= 2);
  const probes = [...new Set(words.flatMap((w) => [skel(w), skel(stem(w))]))].filter((k) => k.length >= 2);
  for (const key of probes) {
    const exact = cands.find((c) => c.key === key);
    if (exact) return exact.acc;
    // Короткий ключ сравниваем только точно: на двух буквах похожим считается что угодно.
    if (key.length < 3) continue;
    if (key.length >= 4) {
      const pre = cands.find((c) => c.key.startsWith(key) || (c.key.length >= 4 && key.startsWith(c.key)));
      if (pre) return pre.acc;
    }
    const limit = key.length >= 9 ? 2 : key.length >= 5 ? 1 : 0;
    if (!limit) continue;
    let best: { acc: Account; d: number } | null = null;
    for (const c of cands) {
      if (Math.abs(c.key.length - key.length) > limit) continue;
      const d = levenshtein(key, c.key);
      if (d <= limit && (!best || d < best.d)) best = { acc: c.acc, d };
    }
    if (best) return best.acc;
  }
  return null;
}

/** Сначала счета нужной валюты, потом все: «на тенге» не должно попасть в юаневый кошелёк. */
function pick(accounts: Account[], hint: string | null, currency: Currency | null): Account | null {
  if (!hint) return null;
  const pools = currency ? [accounts.filter((a) => a.currency === currency), accounts] : [accounts];
  for (const pool of pools) {
    if (!pool.length) continue;
    const hit = matchAccount(pool, hint);
    if (hit) return hit;
  }
  return null;
}

export async function accountsOf(userId: string): Promise<Account[]> {
  return check(
    await db.from("accounts").select("*").eq("user_id", userId).eq("is_archived", false).order("sort"),
  ) as Account[];
}

/**
 * Счёт, названный в обычной фразе о трате или доходе: «обед 35 с вичата».
 * Хвост «с <счёта>» убираем из текста: он про счёт, а не про то, что куплено.
 */
export function accountHint(
  text: string,
  accounts: Account[],
): { account: Account | null; text: string } {
  const paid = text.match(/(?:^|\s)(?:с|со|из|with|from)\s+(.+)$/iu);
  const tail = hintOf(paid?.[1]);
  if (tail && !spokenCurrency(tail.text)) {
    const acc = matchAccount(accounts, tail.text);
    // Режем, только если после предлога ничего, кроме названия счёта, не осталось:
    // иначе из фразы пропало бы «вчера» или что-то важное.
    if (acc) {
      const cut = tail.taken === tail.total ? text.slice(0, paid!.index).trim() : text;
      return { account: acc, text: cut || text };
    }
  }
  const prep = hint(text.match(/(?:^|\s)(?:на|в|во|to)\s+(.+)$/iu)?.[1]);
  if (prep && !spokenCurrency(prep)) {
    const acc = matchAccount(accounts, prep);
    if (acc) return { account: acc, text };
  }
  // Название счёта без предлога засчитываем только при точном совпадении слова.
  const titles = new Map<string, Account>();
  for (const a of accounts) {
    for (const w of a.title.split(/\s+/)) {
      const k = skel(w);
      if (k.length >= 4 && !titles.has(k)) titles.set(k, a);
    }
  }
  for (const w of text.split(/\s+/)) {
    const acc = titles.get(skel(w.replace(/[«»"'.,!?;:()]/g, "")));
    if (acc) return { account: acc, text };
  }
  return { account: null, text };
}

// ------------------------------------------------------------ запись ---

/**
 * Записать перевод, если фраза о нём и нашлись два разных своих счёта.
 * null — не перевод: пусть фразу разбирают обычные траты и доходы.
 */
export async function handleTransfer(user: User, text: string): Promise<string | null> {
  const p = parseTransfer(text);
  return p ? await applyTransfer(user, p) : null;
}

/** Записать разобранный перевод. null — счета не сошлись, фраза не перевод. */
export async function applyTransfer(user: User, p: ParsedTransfer): Promise<string | null> {
  const accounts = await accountsOf(user.id);
  if (accounts.length < 2) return null;

  const base = userCurrency(user) as Currency;
  let from = pick(accounts, p.fromHint, p.fromCurrency);
  let to = pick(accounts, p.toHint, p.toCurrency);
  // Валюта, названная словом, важнее валюты по умолчанию.
  const fromCur = (p.fromCurrency ?? (from?.currency as Currency | undefined) ?? base);
  const toCur = (p.toCurrency ?? (to?.currency as Currency | undefined) ?? null);
  from ??= await defaultAccount(user.id, fromCur);
  if (!to && toCur && toCur !== fromCur) to = await defaultAccount(user.id, toCur);
  if (!from || !to || from.id === to.id) return null;

  const date = shiftDate(localNow(user.tz).date, -p.daysAgo);
  // Сумму называют в валюте фразы, а счёт может быть в другой — приводим к валюте счёта.
  const fromAmount = await convert(p.fromAmount, fromCur, from.currency, date);
  const toAmount = p.toAmount != null
    ? await convert(p.toAmount, toCur ?? (to.currency as Currency), to.currency, date)
    : undefined;

  const { id } = await createTransfer(user, {
    fromAccountId: from.id,
    toAccountId: to.id,
    fromAmount,
    toAmount,
    date,
  });
  const view = await transferCard(user, id);
  if (!view) return null;
  const when = p.daysAgo === 1
    ? ` (${t(user, "вчера")})`
    : p.daysAgo === 2
    ? ` (${t(user, "позавчера")})`
    : "";
  await send(user.tg_id, view.text + when, view.keyboard);
  return view.summary + when;
}

type TransferRow = {
  id: string;
  from_account_id: string;
  to_account_id: string;
  from_amount: number;
  to_amount: number;
  occurred_at: string;
};

async function loadTransfer(user: User, id: string) {
  const row = check(
    await db.from("transfers").select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
  ) as TransferRow | null;
  if (!row) return null;
  // Выбирать можно только из живых счетов, а показывать нужно и архивный: перевод мог
  // прийти из приложения или из импорта.
  const [accounts, sides] = await Promise.all([
    accountsOf(user.id),
    db.from("accounts").select("*").eq("user_id", user.id)
      .in("id", [row.from_account_id, row.to_account_id]),
  ]);
  const both = check(sides) as Account[];
  const byId = (accId: string) => both.find((a) => a.id === accId) ?? null;
  return { row, accounts, from: byId(row.from_account_id), to: byId(row.to_account_id) };
}

/** Карточка перевода: суммы, счета, курс сделки и кнопки правки. */
export async function transferCard(
  user: User,
  id: string,
): Promise<{ text: string; keyboard: Keyboard; summary: string } | null> {
  const v = await loadTransfer(user, id);
  if (!v?.from || !v?.to) return null;
  const l = lang(user);
  const money = `−${fmtMoney(Number(v.row.from_amount), v.from.currency, l)} → +${
    fmtMoney(Number(v.row.to_amount), v.to.currency, l)
  }`;
  const names = `${esc(t(user, v.from.title))} → ${esc(t(user, v.to.title))}`;
  // Курс сделки считаем из самих сумм: он почти всегда отличается от биржевого.
  const rate = v.from.currency !== v.to.currency && Number(v.row.to_amount) > 0
    ? "\n" + t(user, "курс {rate}", {
      rate: `${fmtMoney(1, v.to.currency, l)} = ${
        fmtMoney(Number(v.row.from_amount) / Number(v.row.to_amount), v.from.currency, l)
      }`,
    })
    : "";
  return {
    text: `🔄 <b>${t(user, "Перевод")}</b> ${money}\n${names}${rate}`,
    keyboard: transferKeyboard(user, id),
    // Короткая строка без разметки: её показывает уведомление «Команд» на iPhone.
    summary: `${t(user, "Перевод")} ${money}, ${t(user, v.from.title)} → ${t(user, v.to.title)}`,
  };
}

function transferKeyboard(user: User, id: string): Keyboard {
  return [
    [
      { text: t(user, "Откуда"), callback_data: `tf:${id}` },
      { text: t(user, "Куда"), callback_data: `tt:${id}` },
    ],
    [{ text: "↩️ " + t(user, "Отменить"), callback_data: `td:${id}` }],
  ];
}

function grid(buttons: { text: string; callback_data: string }[], perRow: number): Keyboard {
  const rows: Keyboard = [];
  for (let i = 0; i < buttons.length; i += perRow) rows.push(buttons.slice(i, i + perRow));
  return rows;
}

/**
 * Кнопки под переводом: tf/tt — показать счета, tfs/tts — выбрать (индексом, данные колбэка
 * ограничены 64 байтами), tb — назад, td — удалить.
 */
export async function handleTransferCallback(
  user: User,
  messageId: number | undefined,
  type: string,
  id: string,
  index?: string,
): Promise<string | undefined> {
  if (type === "td") {
    const { count } = await db.from("transfers").delete({ count: "exact" })
      .eq("id", id).eq("user_id", user.id);
    if (messageId && count) await edit(user.tg_id, messageId, t(user, "↩️ <s>перевод отменён</s>"));
    return count ? t(user, "Перевод удалён") : t(user, "Уже удалена");
  }

  const v = await loadTransfer(user, id);
  if (!v) return t(user, "Запись не найдена");
  const show = async (keyboard?: Keyboard) => {
    const fresh = await transferCard(user, id);
    if (!messageId || !fresh) return;
    await edit(user.tg_id, messageId, fresh.text, keyboard ?? fresh.keyboard);
  };

  if (type === "tf" || type === "tt") {
    const side = type === "tf" ? "tfs" : "tts";
    await show([
      ...grid(
        v.accounts.map((a, i) => ({
          text: `${t(user, a.title)} (${a.currency})`,
          callback_data: `${side}:${id}:${i}`,
        })),
        2,
      ),
      [{ text: t(user, "Назад"), callback_data: `tb:${id}` }],
    ]);
    return;
  }
  if ((type === "tfs" || type === "tts") && index !== undefined) {
    const acc = v.accounts[Number(index)];
    if (!acc) return t(user, "Счёт не найден");
    const other = type === "tfs" ? v.row.to_account_id : v.row.from_account_id;
    if (acc.id === other) return t(user, "Счёт тот же самый");
    const date = localNow(user.tz, new Date(v.row.occurred_at)).date;
    const patch: Record<string, unknown> = type === "tfs"
      ? { from_account_id: acc.id }
      : { to_account_id: acc.id };
    // Валюта стороны сменилась — пересчитываем её сумму по курсу дня: прежняя цифра
    // относилась к другой валюте и после замены счёта означала бы не то.
    const oldCur = type === "tfs" ? v.from?.currency : v.to?.currency;
    if (oldCur && oldCur !== acc.currency) {
      const amount = Number(type === "tfs" ? v.row.from_amount : v.row.to_amount);
      const value = await convert(amount, oldCur, acc.currency, date);
      patch[type === "tfs" ? "from_amount" : "to_amount"] = value;
    }
    check(await db.from("transfers").update(patch).eq("id", id).eq("user_id", user.id));
    await show();
    return t(user, acc.title);
  }
  if (type === "tb") {
    await show();
    return;
  }
}

// ------------------------------------------------------- правка фразой ---

const DELETE_WORDS =
  /(удали|удалить|сотри|убери|отмени|delete|remove (it|that|this|last)|undo last)/i;
const SIDE_WORD =
  /^(пришл\S*|получил\S*|получилось|вышл\S*|дошл\S*|зачислил\S*|стало|got|received|arrived|ушл\S*|списал\S*|отправил\S*|отдал\S*|снял\S*|sent|withdrew|debited)$/i;
const SENT_WORD = /^(ушл|списал|отправил|отдал|снял|sent|withdrew|debited)/i;

/**
 * Короткая поправка одной стороны: «пришло 690», «ушло 50000 тенге».
 * Ровно слово, число и (необязательно) валюта — «пришло 500 от мамы» это уже доход,
 * а не правка перевода.
 */
function shortCorrection(phrase: string): "from" | "to" | null {
  const w = phrase.replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
  if (w.length < 2 || w.length > 3) return null;
  if (!SIDE_WORD.test(w[0]) || !/^\d+(?:[.,]\d{1,2})?$/.test(w[1])) return null;
  if (w[2] && !spokenCurrency(w[2])) return null;
  return SENT_WORD.test(w[0]) ? "from" : "to";
}

/**
 * Правка последнего перевода фразой: «не 690, а 685», «пришло 685», «удали».
 * Работает, только пока перевод — самая свежая денежная запись: иначе правку разбирает
 * editbot, который правит операции.
 */
export async function handleTransferEdit(user: User, text: string): Promise<string | null> {
  const phrase = text.trim().replace(/\s+/g, " ");
  if (phrase.length > 140) return null;
  const short = shortCorrection(phrase);
  if (!short && !looksLikeEdit(phrase)) return null;

  const [trRes, txRes] = await Promise.all([
    db.from("transfers").select("*").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(1),
    db.from("transactions").select("created_at").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(1),
  ]);
  const row = (check(trRes) as (TransferRow & { created_at: string })[])[0];
  if (!row) return null;
  const tx = (check(txRes) as { created_at: string }[])[0];
  if (tx && tx.created_at > row.created_at) return null;

  if (!short && DELETE_WORDS.test(phrase) && !/\d/.test(phrase)) {
    check(await db.from("transfers").delete().eq("id", row.id).eq("user_id", user.id));
    const done = t(user, "↩️ Перевод отменён.");
    await send(user.tg_id, done);
    return done;
  }

  const numbers = [...normalize(phrase).matchAll(/\d+(?:[.,]\d{1,2})?/g)]
    .map((m) => Number(m[0].replace(",", ".")))
    .filter((v) => v > 0 && v <= 1e9);
  if (!numbers.length) return null;
  // «не 690, а 685»: первое число — то, что было, последнее — новое.
  const value = numbers[numbers.length - 1];
  const was = numbers.length > 1 ? numbers[0] : null;

  const from = Number(row.from_amount), to = Number(row.to_amount);
  let side: "from" | "to";
  if (short) side = short;
  else if (was != null && Math.abs(was - from) < 0.01) side = "from";
  else if (was != null && Math.abs(was - to) < 0.01) side = "to";
  // «поменяй на 685» сразу после перевода — про полученную сумму: именно её чаще правят,
  // и уводить такую правку в давнюю трату было бы хуже всего.
  else side = "to";

  check(
    await db.from("transfers").update(side === "from" ? { from_amount: value } : { to_amount: value })
      .eq("id", row.id).eq("user_id", user.id),
  );
  const card = await transferCard(user, row.id);
  if (!card) return null;
  await send(user.tg_id, card.text, card.keyboard);
  return card.summary;
}
