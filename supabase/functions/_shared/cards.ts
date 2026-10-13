// Карточки: одна маленькая сессия в день (до 15 повторений, до 5 новых слов, 1–2 ситуации).
// Слово приходит голосом, значение выбирается из четырёх кнопок. После сессии — шэдоуинг.
// Рутина детерминированная; Gemini только придумывает ситуации и дополняет /card без ханзи.
import { pinyin } from "npm:pinyin-pro@3";
import { claimEvent } from "./coach.ts";
import { check, db, type User } from "./db.ts";
import { generate } from "./gemini.ts";
import { t } from "./i18n.ts";
import { limitText, takeAi } from "./quota.ts";
import { edit, editCaption, esc, type Keyboard, send, sendVoice } from "./telegram.ts";
import { localNow, shiftDate } from "./time.ts";

export type Card = {
  id: string; deck: string; front: string; reading: string | null; meaning: string; example: string | null;
  box: number; next_review: string; status: "new" | "learning" | "archived"; intro_order: number | null;
  audio_file_id: string | null;
};
/** Ситуация: вопрос по-английски, варианты ханзи, индекс верного. */
export type Situation = { q: string; opts: string[]; a: number };
type Session = {
  date: string; queue: string[]; pos: number; right: number;
  fresh: string[]; sits: Situation[]; done?: boolean;
};

export const MAX_REVIEWS = 15;
export const MAX_NEW = 5;
const INTERVALS = [1, 3, 7, 14, 30]; // дней для коробок 1…5
/** Колода для слов, добавленных из бота: синк Study Agent её не трогает. */
export const MY_DECK = "chinese-my";
export const CHECKIN_FROM = "2026-09-29";
export const CHECKIN_DATE = "2026-10-12";

// ------------------------------------------------------------ чистые ---

/** Что показать сегодня: самые давние повторения и новые слова по порядку ввода. */
export function pickSession(cards: Card[], today: string): { reviews: Card[]; fresh: Card[] } {
  const live = cards.filter((c) => c.status !== "archived");
  const reviews = live.filter((c) => c.status === "learning" && c.next_review <= today)
    .sort((a, b) => a.next_review.localeCompare(b.next_review) || a.box - b.box)
    .slice(0, MAX_REVIEWS);
  const fresh = live.filter((c) => c.status === "new")
    .sort((a, b) => (a.intro_order ?? 1e9) - (b.intro_order ?? 1e9))
    .slice(0, MAX_NEW);
  return { reviews, fresh };
}

export function nextBox(box: number, correct: boolean, today: string): { box: number; next: string } {
  const b = correct ? Math.min(5, box + 1) : 1;
  return { box: b, next: shiftDate(today, INTERVALS[b - 1]) };
}

export function shuffle<T>(xs: T[], rand = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isVerb = (m: string) => /^to\s/i.test(m.trim());
const isCyr = (m: string) => /[а-яё]/i.test(m);

/**
 * Три неверных значения: без повторов и без верного. Предпочтение — та же колода, тот же
 * алфавит (русское значение среди английских выдало бы ответ) и та же часть речи («to …» — глагол).
 */
export function pickDistractors(
  card: { meaning: string; deck?: string },
  pool: { meaning: string; deck?: string }[],
  n = 3,
  rand = Math.random,
): string[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const seen = new Set([norm(card.meaning)]);
  const scored: { m: string; s: number }[] = [];
  for (const p of pool) {
    const k = norm(p.meaning);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const s = (p.deck === card.deck ? 8 : 0) + (isCyr(p.meaning) === isCyr(card.meaning) ? 4 : 0) +
      (isVerb(p.meaning) === isVerb(card.meaning) ? 2 : 0) + rand();
    scored.push({ m: p.meaning.trim(), s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.m);
}

export const hasHanzi = (s: string) => /\p{Script=Han}/u.test(s);
/** Что читать вслух: только китайский текст («有点儿 + adj» → «有点儿»). */
export const sayable = (s: string) => (s.match(/[\p{Script=Han}，。？！、]+/gu) ?? []).join("，");
export const toPinyin = (s: string) => pinyin(s).replace(/\s+([，。？！、,.?!])/g, "$1");

/** Время сессии: за 30 минут до первой пары, без пар — 08:00. */
export function sessionTime(firstClassMin: number | null): string {
  const m = firstClassMin === null ? 8 * 60 : Math.max(0, firstClassMin - 30);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type CardInput = { front: string; reading: string | null; meaning: string; example?: string | null };

/**
 * Строка карточки: «请假 отпроситься» или «请假 | qǐngjià | отпроситься».
 * Без разделителей первое слово — лицевая сторона, остальное — значение:
 * угадывать пиньинь по виду слова нельзя, значение бывает и латиницей.
 */
export function parseCardInput(line: string): CardInput | null {
  const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return { front: parts[0], reading: parts[1], meaning: parts.slice(2).join(", ") };
  if (parts.length === 2) return { front: parts[0], reading: null, meaning: parts[1] };
  const m = line.trim().match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  return { front: m[1], reading: null, meaning: m[2].replace(/^[—–-]\s*/, "").trim() };
}

/** /card: строки с ханзи разбираем сами, строки без ханзи («остановите здесь») отдаём Gemini. */
export function splitCardInput(text: string): { typed: CardInput[]; ask: string[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    typed: lines.filter(hasHanzi).map(parseCardInput).filter((c): c is CardInput => !!c?.meaning),
    ask: lines.filter((l) => !hasHanzi(l)).slice(0, 5),
  };
}

const jsonOf = (out: string) => {
  try {
    return JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] ?? "null");
  } catch {
    return null;
  }
};

/** Ответ Gemini на /card без ханзи → карточки. Без ханзи или значения — мимо. */
export function parseFilled(out: string): CardInput[] {
  const cards = (jsonOf(out)?.cards ?? []) as Record<string, unknown>[];
  if (!Array.isArray(cards)) return [];
  return cards.flatMap((c) => {
    const front = String(c.hanzi ?? "").trim().slice(0, 100);
    const meaning = String(c.meaning ?? "").trim().slice(0, 300);
    if (!hasHanzi(front) || !meaning) return [];
    const example = String(c.example ?? "").trim();
    return [{
      front,
      reading: String(c.pinyin ?? "").trim().slice(0, 100) || toPinyin(front),
      meaning,
      example: hasHanzi(example) ? example.slice(0, 300) : null,
    }];
  });
}

/** Ответ Gemini с ситуациями → до двух карточек с перемешанными вариантами. */
export function parseSituations(out: string, rand = Math.random): Situation[] {
  const items = (jsonOf(out)?.items ?? []) as Record<string, unknown>[];
  if (!Array.isArray(items)) return [];
  return items.flatMap((it) => {
    const q = String(it.situation ?? "").trim().slice(0, 200);
    const right = String(it.right ?? "").trim().slice(0, 30);
    const wrong = [...new Set((Array.isArray(it.wrong) ? it.wrong : []).map((w) => String(w).trim().slice(0, 30)))]
      .filter((w) => hasHanzi(w) && w !== right).slice(0, 3);
    if (!q || !hasHanzi(right) || wrong.length < 3) return [];
    const opts = shuffle([right, ...wrong], rand);
    return [{ q, opts, a: opts.indexOf(right) }];
  }).slice(0, 2);
}

// ---------------------------------------------------------- озвучка ---

// ponytail: голос Google Translate — неофициальный, но без ключа и квоты и сразу в MP3.
// Закроют — Gemini TTS, но его PCM придётся кодировать в MP3, а это секунды CPU на фразу.
async function tts(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(
    `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-CN&client=tw-ob&q=${encodeURIComponent(text.slice(0, 200))}`,
    { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Пустой кадр MP3 в формате ответа TTS (MPEG-2 Layer III, 64 кбит/с, 24 кГц, моно): 576 отсчётов = 24 мс.
const FRAME = 192;
export function silence(sec: number): Uint8Array<ArrayBuffer> {
  const n = Math.round(sec / 0.024);
  const out = new Uint8Array(n * FRAME);
  for (let i = 0; i < n; i++) out.set([0xff, 0xf3, 0x84, 0xc4], i * FRAME);
  return out;
}

/** Каждая фраза дважды, после каждого раза пауза, чтобы повторить вслух. */
export function shadowTrack(clips: Uint8Array[], pauseSec = 3): Uint8Array<ArrayBuffer> {
  const gap = silence(pauseSec);
  const parts = clips.flatMap((c) => [c, gap, c, gap]);
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Голосовое с подписью. Без голоса (TTS упал) — текстом, если fallback, иначе молча. */
async function sendSpoken(
  user: User,
  say: string,
  caption: string,
  keyboard?: Keyboard,
  card?: Card,
  fallback = true,
) {
  try {
    if (!say) throw new Error("nothing to say");
    const { fileId } = await sendVoice(user.tg_id, card?.audio_file_id ?? await tts(say), caption, keyboard);
    if (card && !card.audio_file_id && fileId) {
      await db.from("flashcards").update({ audio_file_id: fileId }).eq("id", card.id);
    }
  } catch (e) {
    console.warn("voice", String(e));
    if (fallback) await send(user.tg_id, caption, keyboard);
  }
}

// ----------------------------------------------------------- сессия ---

async function saveSession(user: User, s: Session | null) {
  user.state = { ...user.state, cards: s };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
}

const todays = (user: User): Session | null => {
  const s = user.state.cards as Session | null;
  return s?.date === localNow(user.tz).date ? s : null;
};

/** Для утренней и вечерней сводки: сессия готова, сделана или её нет вовсе. */
export async function cardsStatus(user: User): Promise<"ready" | "done" | null> {
  if (todays(user)?.done) return "done";
  const today = localNow(user.tz).date;
  const { count } = await db.from("flashcards").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).or(`status.eq.new,and(status.eq.learning,next_review.lte.${today})`);
  return count ? "ready" : null;
}

async function ensureSession(user: User): Promise<Session | null> {
  const cur = todays(user);
  if (cur) return cur;
  const today = localNow(user.tz).date;
  const cards = check(
    await db.from("flashcards").select("*").eq("user_id", user.id).neq("status", "archived"),
  ) as Card[];
  const { reviews, fresh } = pickSession(cards, today);
  if (!reviews.length && !fresh.length) return null;
  const known = [...cards.filter((c) => c.status === "learning"), ...fresh];
  const sits = await makeSituations(user, known).catch((e) => {
    console.warn("situations", String(e));
    return [];
  });
  const s: Session = {
    date: today,
    queue: [...reviews, ...fresh].map((c) => c.id).concat(sits.map((_, i) => `s${i}`)),
    pos: 0,
    right: 0,
    fresh: fresh.map((c) => c.id),
    sits,
  };
  await saveSession(user, s);
  return s;
}

const SITUATION_PROMPT =
  "You write quiz items for a beginner Mandarin learner (HSK 1-2) who wants everyday speaking. " +
  "Make 2 items. Each item: a short everyday situation in English, one sentence, second person " +
  '(like "You\'re in a taxi and want to stop here."); the one natural Chinese phrase to say there ' +
  "(2-10 characters); and 3 plausible but wrong phrases of similar length. Build the phrases mostly " +
  "from the learner's words below. Hanzi only, no pinyin. Return ONLY JSON: " +
  '{"items":[{"situation":"...","right":"...","wrong":["...","...","..."]}]}';

async function makeSituations(user: User, words: Card[]): Promise<Situation[]> {
  if (words.length < 3 || !(await takeAi(user))) return [];
  const list = words.slice(0, 40).map((w) => `${sayable(w.front)} (${w.meaning})`).join("; ");
  return parseSituations(await generate(SITUATION_PROMPT, [{ role: "user", text: list }], 800));
}

/**
 * /cards, утренняя отправка и вечерний второй шанс. Сессия на день одна: повторный вызов
 * продолжает с того места, где остановились.
 */
export async function startCards(user: User, mode: "manual" | "auto" | "evening" = "manual") {
  const s = await ensureSession(user);
  if (!s) {
    if (mode === "manual") await send(user.tg_id, t(user, "На сегодня карточек нет."));
    return;
  }
  if (s.done) {
    if (mode === "manual") await send(user.tg_id, "🃏 " + t(user, "Сессия на сегодня пройдена. Следующая завтра."));
    return;
  }
  const n = s.queue.length - s.pos;
  await send(
    user.tg_id,
    "🃏 " + (mode === "evening"
      ? t(user, "Сегодняшняя сессия карточек ещё ждёт: {n} шт.", { n })
      : s.pos
      ? t(user, "Продолжаем: осталось {n}.", { n })
      : t(user, "Сессия на сегодня: {n} карточек, пара минут. Выбирай значение кнопкой.", { n })),
  );
  await sendItem(user, s);
}

async function sendItem(user: User, s: Session) {
  const id = s.queue[s.pos];
  const progress = `<i>${s.pos + 1}/${s.queue.length}</i>`;
  if (id.startsWith("s")) {
    const i = Number(id.slice(1));
    const sit = s.sits[i];
    await send(
      user.tg_id,
      `💬 ${esc(sit.q)}   ${progress}`,
      sit.opts.map((h, j) => [{ text: `${h}  ${toPinyin(h)}`.slice(0, 60), callback_data: `fc:q:${i}-${j}` }]),
    );
    return;
  }
  const c = check(await db.from("flashcards").select("*").eq("id", id).maybeSingle()) as Card | null;
  if (!c || c.status === "archived") return await advance(user, s, false); // карточку убрали посреди дня
  const pool = check(
    await db.from("flashcards").select("meaning,deck").eq("user_id", user.id).neq("id", c.id),
  ) as { meaning: string; deck: string }[];
  const opts = shuffle([
    { text: c.meaning, ok: true },
    ...pickDistractors(c, pool).map((m) => ({ text: m, ok: false })),
  ]);
  await sendSpoken(
    user,
    sayable(c.front),
    `<b>${esc(c.front)}</b>  ${esc(c.reading ?? "")}   ${progress}`,
    opts.map((o) => [{ text: o.text.slice(0, 60), callback_data: `fc:${o.ok ? "y" : "n"}:${c.id}` }]),
    c,
  );
}

async function advance(user: User, s: Session, correct: boolean) {
  const next: Session = { ...s, pos: s.pos + 1, right: s.right + (correct ? 1 : 0) };
  if (next.pos < next.queue.length) {
    await saveSession(user, next);
    await sendItem(user, next);
    return;
  }
  await saveSession(user, { ...next, done: true });
  await claimEvent(user, "cards_done", next.date); // по этим отметкам считается чек-ин
  await send(
    user.tg_id,
    "🃏 " + t(user, "Готово: {right} из {all}. На сегодня всё.", { right: next.right, all: next.queue.length }),
  );
  await sendShadowing(user, next.fresh);
}

/** Одно голосовое: примеры к новым словам дня, каждый дважды с паузой на повтор. */
async function sendShadowing(user: User, ids: string[]) {
  if (!ids.length) return;
  const rows = check(
    await db.from("flashcards").select("id,example").eq("user_id", user.id).in("id", ids),
  ) as { id: string; example: string | null }[];
  const lines = rows.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .map((r) => sayable(r.example ?? "")).filter(Boolean).slice(0, 5);
  if (!lines.length) return;
  try {
    const clips = await Promise.all(lines.map(tts));
    await sendVoice(
      user.tg_id,
      shadowTrack(clips),
      "🗣 " + t(user, "Повторяй вслух: каждая фраза звучит дважды, после неё пауза.") + "\n\n" +
        lines.map((l) => `${esc(l)}\n<i>${esc(toPinyin(l))}</i>`).join("\n"),
    );
  } catch (e) {
    console.warn("shadowing", String(e));
  }
}

type CbMessage = { message_id: number; voice?: unknown };

const editAny = (user: User, m: CbMessage, text: string) =>
  m.voice ? editCaption(user.tg_id, m.message_id, text) : edit(user.tg_id, m.message_id, text);

function reveal(c: Card): string {
  return [
    `<b>${esc(c.front)}</b>  ${esc(c.reading ?? "")}`,
    esc(c.meaning),
    c.example ? `\n${esc(c.example)}\n<i>${esc(toPinyin(c.example))}</i>` : "",
  ].filter(Boolean).join("\n");
}

/** fc:y|n:<id> — ответ на слово, fc:q:<i>-<j> — на ситуацию, fc:u:<id> — отменить /card. */
export async function handleCardCallback(
  user: User,
  msg: CbMessage | undefined,
  action: string,
  arg: string,
): Promise<string | undefined> {
  if (action === "q") return await answerSituation(user, msg, arg);
  if (action === "u") return await undoCard(user, arg);
  if (action !== "y" && action !== "n") return t(user, "Эта карточка устарела: /cards");

  const c = check(
    await db.from("flashcards").select("*").eq("id", arg).eq("user_id", user.id).maybeSingle(),
  ) as Card | null;
  if (!c || c.status === "archived") return t(user, "Карточка не найдена");
  const correct = action === "y";
  const { box, next } = nextBox(c.box, correct, localNow(user.tz).date);
  const { count } = await db.from("flashcards").update({ box, next_review: next, status: "learning" }, { count: "exact" })
    .eq("id", c.id).eq("box", c.box).eq("next_review", c.next_review); // защита от двойного нажатия
  if (!count) return t(user, "Уже отмечено");
  check(await db.from("flashcard_reviews").insert({ user_id: user.id, card_id: c.id, correct, box_after: box }));
  if (msg) await editAny(user, msg, `${correct ? "✅" : "❌"} ${reveal(c)}`);

  const s = todays(user);
  if (s && !s.done && s.queue[s.pos] === c.id) await advance(user, s, correct);
  return correct ? t(user, "Верно") : t(user, "Повторим");
}

async function answerSituation(user: User, msg: CbMessage | undefined, arg: string) {
  const [i, j] = arg.split("-").map(Number);
  const s = todays(user);
  const sit = s?.sits[i];
  if (!s || !sit || s.done || s.queue[s.pos] !== `s${i}`) return t(user, "Уже отмечено");
  const ok = j === sit.a;
  const right = sit.opts[sit.a];
  // Не Лейтнер: только отметка, что ответ был.
  check(await db.from("flashcard_reviews").insert({ user_id: user.id, correct: ok, note: sit.q }));
  const line = `<b>${esc(right)}</b>  ${esc(toPinyin(right))}`;
  if (msg) await editAny(user, msg, `💬 ${esc(sit.q)}\n${ok ? "✅" : "❌"} ${line}`);
  await sendSpoken(user, right, line, undefined, undefined, false);
  await advance(user, s, ok);
  return ok ? t(user, "Верно") : t(user, "Повторим");
}

// -------------------------------------------------------------- /card ---

export async function nextIntroOrder(userId: string): Promise<number> {
  const { data } = await db.from("flashcards").select("intro_order").eq("user_id", userId)
    .not("intro_order", "is", null).order("intro_order", { ascending: false }).limit(1).maybeSingle();
  return ((data as { intro_order: number } | null)?.intro_order ?? 0) + 1;
}

const FILL_PROMPT =
  "Переведи каждую строку на путунхуа для начинающего (HSK 1–2): самая обиходная фраза, как говорят вслух. " +
  "Верни ТОЛЬКО JSON: " +
  '{"cards":[{"hanzi":"…","pinyin":"с тонами","meaning":"short English meaning","example":"короткое простое предложение ханзи"}]} ' +
  "— по одной карточке на строку, в том же порядке.";

/** /card: одно или несколько слов по строке; строка без ханзи — Gemini подберёт китайский. */
export async function addCards(user: User, text: string): Promise<{ text: string; keyboard?: Keyboard }> {
  const { typed, ask } = splitCardInput(text);
  if (!typed.length && !ask.length) {
    return {
      text: t(user, "Формат: <code>/card 请假 отпроситься</code>. Пиньинь можно отдельно: <code>请假 | qǐngjià | отпроситься</code>. Несколько слов — по одному в строке.") +
        "\n" + t(user, "Можно и по-русски: <code>/card остановите здесь</code>, китайский подберу сам."),
    };
  }
  let filled: CardInput[] = [];
  if (ask.length) {
    if (!(await takeAi(user))) return { text: limitText(user) };
    filled = await generate(FILL_PROMPT, [{ role: "user", text: ask.join("\n").slice(0, 500) }], 800)
      .then(parseFilled).catch(() => []);
    if (!filled.length && !typed.length) {
      return { text: t(user, "Не получилось подобрать китайский. Попробуй ещё раз или напиши с ханзи: <code>/card 请假 отпроситься</code>") };
    }
  }
  const cards = [...typed, ...filled].map((c) => ({ ...c, front: c.front.slice(0, 100) }));
  const existing = check(
    await db.from("flashcards").select("front").eq("user_id", user.id).in("front", cards.map((c) => c.front)),
  ) as { front: string }[];
  const have = new Set(existing.map((r) => r.front));
  const fresh = cards.filter((c) => !have.has(c.front));
  if (!fresh.length) return { text: t(user, "Такие карточки уже есть.") };

  const order = await nextIntroOrder(user.id);
  const rows = check(
    await db.from("flashcards").insert(fresh.map((c, i) => ({
      user_id: user.id,
      deck: MY_DECK,
      front: c.front,
      reading: c.reading?.slice(0, 100) ?? null,
      meaning: c.meaning.slice(0, 300),
      example: c.example ?? null,
      status: "new",
      intro_order: order + i,
      next_review: localNow(user.tz).date,
    }))).select("id,front"),
  ) as { id: string; front: string }[];
  const skipped = cards.length - fresh.length;
  return {
    text: [
      t(user, "Добавил, слово придёт в одной из ближайших сессий:"),
      ...fresh.map((c) =>
        `<b>${esc(c.front)}</b>  ${esc(c.reading ?? "")} — ${esc(c.meaning)}` +
        (c.example ? `\n<i>${esc(c.example)}</i>` : "")
      ),
      skipped ? t(user, "Уже были: {n}.", { n: skipped }) : "",
    ].filter(Boolean).join("\n"),
    keyboard: rows.map((r) => [{ text: `${t(user, "Отменить")}: ${r.front}`.slice(0, 60), callback_data: `fc:u:${r.id}` }]),
  };
}

async function undoCard(user: User, id: string): Promise<string> {
  const { count } = await db.from("flashcards").delete({ count: "exact" })
    .eq("id", id).eq("user_id", user.id).eq("status", "new");
  return count ? t(user, "Карточка убрана") : t(user, "Уже не убрать: слово в изучении");
}

// ------------------------------------------------------------ чек-ин ---

/** День 14: сколько дней сессия пройдена, сколько слов в изучении, и вопрос, что мешает. */
export async function cardsCheckin(user: User) {
  const [doneRes, learningRes] = await Promise.all([
    db.from("reminders").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      .eq("kind", "cards_done").gte("local_date", CHECKIN_FROM).lte("local_date", CHECKIN_DATE),
    db.from("flashcards").select("id", { count: "exact", head: true }).eq("user_id", user.id)
      .eq("status", "learning"),
  ]);
  user.state = { ...user.state, checkin: "cards" };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
  await send(
    user.tg_id,
    "🃏 " + t(user, "Две недели карточек: сессия пройдена в {done} из 14 дней, слов в изучении: {n}.", {
      done: doneRes.count ?? 0,
      n: learningRes.count ?? 0,
    }) + "\n\n" + t(user, "Что раздражает или не работает? Ответь одним сообщением, я сохраню."),
  );
}

/** Ответ на чек-ин: следующее обычное сообщение сохраняется целиком. true — сообщение забрали. */
export async function checkinAnswer(user: User, text: string): Promise<boolean> {
  const topic = user.state.checkin as string | undefined;
  if (!topic) return false;
  check(await db.from("feedback").insert({ user_id: user.id, topic, text: text.slice(0, 4000) }));
  user.state = { ...user.state, checkin: null };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
  await send(user.tg_id, t(user, "Записал, спасибо."));
  return true;
}
