// Webhook Telegram. Авторизация — заголовок X-Telegram-Bot-Api-Secret-Token.
import {
  evaluateNight,
  getSleep,
  lateSleepMessages,
  type Outgoing,
  reevaluateNight,
  resolveLedger,
  sleepLine,
} from "../_shared/coach.ts";
import { sendBackup } from "../_shared/backup.ts";
import { budgetCommand } from "../_shared/budget.ts";
import { careerOverview, markMilestoneDone } from "../_shared/career.ts";
import { habitsOverview, toggleHabit } from "../_shared/habits.ts";
import { check, db, type User, userCurrency } from "../_shared/db.ts";
import { handleEdit } from "../_shared/editbot.ts";
import {
  handlePromiseCallback,
  inWizard,
  promisePhoto,
  promisesOverview,
  promiseText,
  startPromise,
} from "../_shared/promises.ts";
import { fmtNum, parseWeight, saveWeight } from "../_shared/body.ts";
import { handleEntryCallback, logEntry } from "../_shared/moneybot.ts";
import type { Account } from "../_shared/finance.ts";
import {
  accountHint,
  accountsOf,
  applyTransfer,
  handleTransfer,
  handleTransferCallback,
  handleTransferEdit,
  looksLikeTransfer,
} from "../_shared/transferbot.ts";
import { addCards, checkinAnswer, handleCardCallback, startCards } from "../_shared/cards.ts";
import {
  markAssignmentDone,
  startFocus,
  stopFocus,
  studyOverview,
} from "../_shared/study.ts";
import { type Currency, isLunch, type ParsedEntry, parseEntry } from "../_shared/parse.ts";
import { looksLikeMoney, parseSpoken, parseSpokenAI, spokenCurrency } from "../_shared/spoken.ts";
import {
  handleSupplementAction,
  refillSupplement,
  sendSupplementReminder,
  todaySummary,
} from "../_shared/supplements.ts";
import { coachReply } from "../_shared/chat.ts";
import { confirmAgent, undoAgent } from "../_shared/agent.ts";
import { moneyAnswer } from "../_shared/spend.ts";
import { subsOverview } from "../_shared/subs.ts";
import { issueToken, listTokens, revokeToken, SCOPES } from "../_shared/tokens.ts";
import { lastSeasonReview, monthReview } from "../_shared/review.ts";
import { lang, type Lang, langFromLocale, t } from "../_shared/i18n.ts";
import { limitText, takeAi } from "../_shared/quota.ts";
import { INVITE_DAYS, MINIAPP_URL } from "../_shared/config.ts";
import {
  createInvite,
  deleteAccount,
  friends,
  inviteLink,
  pendingInvites,
  revokeInvite,
  setAllowed,
} from "../_shared/invites.ts";
import { consentText, deleteWarning } from "../_shared/legal.ts";
import { transcribe } from "../_shared/gemini.ts";
import {
  answerCallback,
  downloadFile,
  edit,
  esc,
  type Keyboard,
  send,
  setKeyboard,
  setupChat,
  typing,
  deleteMessage,
} from "../_shared/telegram.ts";
import { addMin, dayBounds, fmtDuration, localNow, shiftDate } from "../_shared/time.ts";
import { parseManualSleep } from "../_shared/sleep.ts";
import { acceptInvite, findUser, registerOnStart } from "../_shared/users.ts";
import { foodOverview, mealAction, mealEditAnswer, mealPhoto, mealText, parseEatText } from "../_shared/food.ts";

const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

/** Валюта пользователя: суммы без валютного слова считаются в ней. */
const cur = (u: User) => userCurrency(u) as Currency;

type TgUser = { id: number; first_name?: string; username?: string; language_code?: string };
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  photo?: { file_id: string; file_size?: number; width: number }[];
  caption?: string;
};
type TgCallback = {
  id: string;
  from: TgUser;
  message?: TgMessage & { reply_markup?: { inline_keyboard: Keyboard } };
  data?: string;
};
type Update = { update_id: number; message?: TgMessage; callback_query?: TgCallback };

const HELP = [
  "<b>Что я понимаю</b>",
  "• расход: <code>обед 35</code>, <code>такси 18</code>, <code>обед 45 тенге</code>, <code>20$ подписка</code>",
  "• доход: <code>+3000 стипендия</code>, <code>мне скинули 5000 тенге</code>, <code>пополнил Kaspi на 20000</code>",
  "• перевод между своими счетами: <code>перекинул 50000 тенге с Каспи на вичат, получил 690 юаней</code>",
  "  категорию и счёт подберу сам, поправить можно кнопками — запомню",
  "  после обеда сразу напомню про добавки",
  "• голосовое — расшифрую и пойму так же, как текст",
  "• /study — дедлайны и контрольные",
  "• /work — проекты, вехи и активность на GitHub",
  "• /habits — привычки, спорт и звонки родным",
  "• /promise — дать слово другу, /promises — открытые обещания",
  "• /focus 25 — фокус-сессия (минуты и код курса необязательны)",
  "• /cards — карточки на сегодня; <code>/card 请假 отпроситься</code> или <code>/card остановите здесь</code> — добавить слово",
  "• /budget — лимиты трат на месяц; <code>/budget Еда 1500</code> — поставить",
  "• /subs — подписки и регулярные списания",
  "• /month — итоги месяца, /season — итоги сезона",
  "• /app — приложение (или кнопка «Открыть» слева от поля ввода)",
  "• фото еды или <code>/eat 2 яйца и банан</code> — посчитаю КБЖУ; /food — итог дня",
  "• /today — добавки за сегодня",
  "• /sleep — последняя ночь; <code>/sleep 00:10 08:40</code> — записать ночь руками",
  "• /shortcut — настройка передачи сна с iPhone",
  "• /tokens, /newtoken, /revoke — личные токены доступа",
  "• /export — копия всех данных файлом; <code>/export csv</code> — операции таблицей",
  "• /delete — удалить аккаунт и все данные",
  "• /help — эта справка",
  "• всё остальное — разговор с коучем",
];

const OWNER_HELP = [
  "",
  "<b>Только у тебя</b>",
  "• /invite — ссылка-приглашение на одного человека",
  "• /friends — кто зашёл, отключить или отозвать ссылку",
];

const help = (user: User) =>
  (user.is_owner ? [...HELP, ...OWNER_HELP] : HELP).map((line) => t(user, line)).join("\n");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json() as Update;
  try {
    // Написал боту — значит, разблокировал: планировщик снова может ему писать.
    const from = update.message?.from ?? update.callback_query?.from;
    if (from) await db.from("users").update({ blocked_at: null }).eq("tg_id", from.id).not("blocked_at", "is", null);
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (e) {
    // Всегда 200, иначе Telegram будет ретраить апдейт бесконечно.
    console.error("update", update.update_id, e);
  }
  return new Response("ok");
});

async function onMessage(msg: TgMessage) {
  if (msg.chat.type !== "private" || !msg.from) return;
  if (!msg.text) {
    const u = await findUser(msg.from.id);
    if (!u?.is_allowed) return;
    if (msg.voice) {
      const voice = msg.voice;
      background(() => onVoice(u, voice));
    } else if (msg.photo?.length) {
      const photo = msg.photo;
      const caption = msg.caption;
      background(() => onPhoto(u, photo, caption));
    }
    return;
  }
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    // До регистрации языка в базе нет — берём язык клиента Telegram.
    const l0: Lang = langFromLocale(msg.from.language_code);
    const r = await registerOnStart(msg.from, text);
    if (r.kind === "closed") {
      await send(msg.chat.id, t(l0, "Бот закрытый: вход только по приглашению."));
      return;
    }
    if (r.kind === "blocked") {
      await send(msg.chat.id, t(l0, "Доступ закрыт."));
      return;
    }
    // Ссылка-приглашение: сначала согласие, в базу пишем только после «Согласен».
    if (r.kind === "consent") {
      await send(msg.chat.id, consentText(l0), [[
        { text: t(l0, "Согласен"), callback_data: `ok:${r.code}` },
        { text: t(l0, "Отказаться"), callback_data: "no" },
      ]]);
      return;
    }
    await setupChat(msg.chat.id, MINIAPP_URL, lang(r.user));
    // Ссылка t.me/<бот>?start=cards из приложения сразу запускает повторение.
    if (r.kind === "known" && text.includes("cards")) {
      background(() => startCards(r.user));
      return;
    }
    await send(
      msg.chat.id,
      r.kind === "owner"
        ? t(r.user, "Готово, {name}. Это твой бот: ты владелец.", {
          name: esc(r.user.first_name ?? ""),
        }) + "\n" +
          t(r.user, "Добавки и расписание настраиваются в приложении: Настройки.") + "\n\n" + help(r.user)
        : t(r.user, "На месте.") + "\n\n" + help(r.user),
    );
    return;
  }

  const user = await findUser(msg.from.id);
  if (!user?.is_allowed) return;

  if (text.startsWith("/app")) {
    await setupChat(msg.chat.id, MINIAPP_URL, lang(user));
    await send(msg.chat.id, t(user, "Приложение: сегодня, сон, настройки."), [[
      { text: "📱 " + t(user, "Открыть"), web_app: { url: MINIAPP_URL } },
    ]]);
    return;
  }
  if (text.startsWith("/today")) {
    await send(msg.chat.id, `<b>${t(user, "Добавки сегодня")}</b>\n${await todaySummary(user)}`);
    return;
  }
  if (text.startsWith("/sleep")) {
    const args = text.slice("/sleep".length).trim();
    const msgs = args ? await manualSleep(user, args) : await lastSleep(user);
    for (const m of msgs) await send(msg.chat.id, m.text, m.keyboard);
    return;
  }
  const cmd = text.split(/\s+/)[0].split("@")[0];
  if (cmd === "/tokens") {
    await send(msg.chat.id, await tokensText(user));
    return;
  }
  if (cmd === "/newtoken" || cmd === "/revoke") {
    await tokenCommand(user, msg.chat.id, cmd, text.split(/\s+/).slice(1));
    return;
  }
  if (text.startsWith("/shortcut")) {
    await send(msg.chat.id, shortcutHelp(user));
    return;
  }
  if (text.startsWith("/invite")) {
    await sendInvite(user, text.slice("/invite".length).trim());
    return;
  }
  if (text.startsWith("/promises")) {
    const o = await promisesOverview(user);
    await send(user.tg_id, o.text, o.keyboard);
    return;
  }
  if (text.startsWith("/promise")) {
    const o = await startPromise(user);
    await send(user.tg_id, o.text, o.keyboard);
    return;
  }
  if (text.startsWith("/friends")) {
    const o = await friendsOverview(user);
    await send(user.tg_id, o.text, o.keyboard);
    return;
  }
  if (text.startsWith("/delete")) {
    if (user.is_owner) {
      await send(user.tg_id, t(user, "Владельца не удаляю: на нём держится бот и приглашения друзей."));
      return;
    }
    await send(user.tg_id, deleteWarning(user), [[
      { text: t(user, "Удалить всё"), callback_data: "del" },
      { text: t(user, "Отмена"), callback_data: "nodel" },
    ]]);
    return;
  }
  if (text.startsWith("/food")) {
    await send(msg.chat.id, await foodOverview(user));
    return;
  }
  if (text.startsWith("/eat")) {
    const what = parseEatText(text);
    if (!what) {
      await send(msg.chat.id, t(user, "Напиши, что съел: /eat 2 яйца и банан. Или пришли фото еды."));
      return;
    }
    background(() => mealText(user, what));
    return;
  }
  if (text.startsWith("/study")) {
    const o = await studyOverview(user);
    await send(msg.chat.id, o.text, o.keyboard);
    return;
  }
  if (text.startsWith("/work")) {
    const o = await careerOverview(user);
    await send(msg.chat.id, o.text, o.keyboard);
    return;
  }
  if (text.startsWith("/habits")) {
    const o = await habitsOverview(user);
    await send(msg.chat.id, o.text, o.keyboard);
    return;
  }
  if (text.startsWith("/focus")) {
    await startFocus(user, text.replace(/^\/focus\S*/, ""));
    return;
  }
  // Обе команды могут ждать Gemini (ситуации, перевод с русского) — в фоне, чтобы Telegram не ретраил.
  if (text.startsWith("/cards")) {
    background(() => startCards(user));
    return;
  }
  if (text.startsWith("/card")) {
    background(async () => {
      const o = await addCards(user, text.slice("/card".length).trim());
      await send(msg.chat.id, o.text, o.keyboard);
    });
    return;
  }
  if (text.startsWith("/subs")) {
    await send(msg.chat.id, await subsOverview(user));
    return;
  }
  if (text.startsWith("/budget")) {
    await send(msg.chat.id, await budgetCommand(user, text.slice("/budget".length)));
    return;
  }
  if (text.startsWith("/month")) {
    const arg = text.slice("/month".length).trim();
    await typing(msg.chat.id);
    await send(msg.chat.id, await monthReview(user, /^\d{4}-\d{2}$/.test(arg) ? arg : undefined));
    return;
  }
  if (text.startsWith("/season")) {
    await typing(msg.chat.id);
    await send(msg.chat.id, await lastSeasonReview(user));
    return;
  }
  if (text.startsWith("/export")) {
    const csv = /csv/i.test(text);
    await send(msg.chat.id, t(user, "Собираю файл…"));
    await sendBackup(user, csv ? "csv" : "json");
    return;
  }
  if (text.startsWith("/help")) {
    await send(msg.chat.id, help(user));
    return;
  }

  if (text.startsWith("/") && !parseEntry(text, cur(user))) {
    await send(msg.chat.id, help(user));
    return;
  }
  await handleText(user, text);
}

/** Запись (расход/доход) или разговор с коучем. */
async function handleText(user: User, text: string) {
  // После ✏️ под карточкой еды следующее сообщение — правка.
  if (user.state.meal_edit && await mealEditAnswer(user, text)) return;
  // Бот задал вопрос (чек-ин карточек) — следующее сообщение и есть ответ.
  if (await checkinAnswer(user, text)) return;
  // Мастер обещания ждёт одну строку — она не трата и не вопрос коучу.
  if (inWizard(user)) {
    const step = await promiseText(user, text);
    if (step) {
      await send(user.tg_id, step.text, step.keyboard);
      return;
    }
  }
  // Перевод между своими счетами разбираем раньше правок и трат: «перекинул 50000 тенге
  // с Каспи на WeChat» — не расход «Каспи» и не команда «поменяй».
  if ((await handleTransfer(user, text)) !== null) return;
  // Пока перевод — самая свежая запись, «не 690, а 685» относится к нему, а не к давней трате.
  if ((await handleTransferEdit(user, text)) !== null) return;
  // Правка идёт первой: «поменяй на 25» — это не новая трата.
  const edited = await handleEdit(user, text);
  if (edited !== null) {
    if (edited) await send(user.tg_id, edited);
    return;
  }
  // Вес — раньше трат: иначе «вес 71.4» уйдёт в расходы с названием «вес».
  const kg = parseWeight(text);
  if (kg !== null) {
    await saveWeight(user, kg);
    await send(user.tg_id, t(user, "Вес {kg} кг записан.", { kg: fmtNum(user, kg, 1) }));
    return;
  }
  // Еда словами: только по явному «съел …», чтобы не принять разговор за запись.
  const eaten = parseEatText(text);
  if (eaten) {
    background(() => mealText(user, eaten));
    return;
  }
  // Счета читаем из базы, только если во фразе есть число: разговор с коучем запросов не стоит.
  const named = /\d/.test(text) ? await namedAccount(user, text) : { account: null, text };
  const entry = parseEntry(named.text, cur(user));
  if (entry) {
    const e = onAccount(entry, text, named.account);
    await logEntry(user, text, e, 0, "bot", named.account?.id);
    if (isLunch(e, localNow(user.tz).minutes)) await sendSupplementReminder(user, "lunch", "meal");
    return;
  }
  // Вопрос про деньги считаем сами: точные цифры, лимит ИИ не тратится.
  const money = await moneyAnswer(user, text);
  if (money) {
    await send(user.tg_id, money);
    return;
  }
  // Живая фраза: «потратил 35 на обед», «вчера такси 18 и кофе 25».
  if (looksLikeMoney(text) || looksLikeTransfer(text)) {
    let spoken = parseSpoken(named.text, cur(user));
    // Разбор фразы моделью — тоже обращение к ИИ. Нет лимита — ниже ответит coachReply с текстом лимита.
    if (!spoken.length && await takeAi(user)) {
      const ai = await parseSpokenAI(text, cur(user)).catch(() => ({ entries: [], transfer: null }));
      // Одно обращение к модели отвечает и за перевод, и за траты.
      if (ai.transfer && (await applyTransfer(user, ai.transfer)) !== null) return;
      spoken = ai.entries;
    }
    if (spoken.length) {
      let lunch = false;
      for (const raw of spoken) {
        const e = onAccount(raw, text, named.account);
        await logEntry(user, text, e, e.daysAgo, "bot", named.account?.id);
        lunch ||= e.daysAgo === 0 && isLunch(e, localNow(user.tz).minutes);
      }
      if (lunch) await sendSupplementReminder(user, "lunch", "meal");
      return;
    }
  }
  // Ответ Gemini может занять десятки секунд — отвечаем Telegram сразу, коуча считаем в фоне,
  // иначе Telegram не дождётся webhook и пришлёт апдейт повторно.
  background(async () => {
    await typing(user.tg_id);
    const out = await coachReply(user, text);
    await send(user.tg_id, out.text, out.keyboard);
  });
}

/**
 * Счёт, названный во фразе: «обед 35 с вичата» ляжет на WeChat, а не на основной счёт.
 * Возвращает ещё и фразу без хвоста про счёт — из неё получится чистое название записи.
 */
async function namedAccount(user: User, text: string): Promise<{ account: Account | null; text: string }> {
  const accounts = await accountsOf(user.id);
  return accounts.length > 1 ? accountHint(text, accounts) : { account: null, text };
}

/**
 * Валюта записи, когда в фразе её не назвали: валюта названного счёта.
 * «Пополнил Kaspi на 20000» — это тенге, а не юани по умолчанию.
 */
function onAccount<T extends ParsedEntry>(e: T, text: string, account: Account | null): T {
  return account && !spokenCurrency(text) ? { ...e, currency: account.currency as Currency } : e;
}

/** Фото — доказательство обещания, если бот его ждёт; иначе это еда. */
async function onPhoto(user: User, photo: NonNullable<TgMessage["photo"]>, caption?: string) {
  const best = photo.reduce((a, b) => (b.width > a.width ? b : a));
  if (await promisePhoto(user, best.file_id)) return;
  await mealPhoto(user, photo, caption);
}

async function onVoice(user: User, voice: NonNullable<TgMessage["voice"]>) {
  if (voice.duration > 120) {
    await send(user.tg_id, t(user, "Голосовые до 2 минут."));
    return;
  }
  if (!(await takeAi(user))) {
    await send(user.tg_id, limitText(user));
    return;
  }
  await typing(user.tg_id);
  let text: string;
  try {
    const { bytes } = await downloadFile(voice.file_id);
    text = (await transcribe(bytes, voice.mime_type ?? "audio/ogg")).trim();
  } catch (e) {
    console.error("voice", e);
    await send(user.tg_id, t(user, "Не удалось расшифровать: Gemini не ответил. Попробуй ещё раз или текстом."));
    return;
  }
  if (!text) {
    await send(user.tg_id, t(user, "В голосовом не слышно речи."));
    return;
  }
  await send(user.tg_id, `🎙 «${esc(text)}»`);
  await handleText(user, text);
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function background(task: () => Promise<void>) {
  const p = task().catch((e) => console.error("background", e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
}

async function onCallback(cb: TgCallback) {
  const [type, a, b] = (cb.data ?? "").split(":");

  // Согласие приходит от человека, которого ещё нет в базе, — до проверки доступа.
  if (type === "ok" && a) {
    await onConsent(cb, a);
    return;
  }
  if (type === "no") {
    await answerCallback(cb.id);
    const l = langFromLocale(cb.from.language_code);
    if (cb.message) await edit(cb.from.id, cb.message.message_id, t(l, "Понял. Ничего не сохранил."));
    return;
  }

  const user = await findUser(cb.from.id);
  if (!user?.is_allowed || !cb.data) {
    await answerCallback(cb.id);
    return;
  }
  let reply: string | undefined;

  if (type === "del" || type === "nodel") {
    await onDeleteCallback(cb, user, type === "del");
    return;
  }
  if ((type === "fd" || type === "fe") && a) {
    const changed = user.is_owner ? await setAllowed(user.id, a, type === "fe") : null;
    reply = changed ? (type === "fe" ? t(user, "Доступ вернул") : t(user, "Доступ закрыт")) : t(user, "Не вышло");
    if (changed && cb.message) {
      const o = await friendsOverview(user);
      await edit(user.tg_id, cb.message.message_id, o.text, o.keyboard);
    }
    await answerCallback(cb.id, reply);
    return;
  }
  if (type === "fr" && a) {
    const ok = user.is_owner && (await revokeInvite(user.id, a));
    if (ok && cb.message) {
      const o = await friendsOverview(user);
      await edit(user.tg_id, cb.message.message_id, o.text, o.keyboard);
    }
    await answerCallback(cb.id, ok ? t(user, "Ссылка отозвана") : t(user, "Не вышло"));
    return;
  }

  if (type === "s" && (a === "t" || a === "z" || a === "k") && b) {
    reply = await handleSupplementAction(user, a, b);
  } else if (type === "r" && a) {
    reply = await refillSupplement(user, a);
    if (cb.message) await edit(user.tg_id, cb.message.message_id, `🔄 ${esc(reply)}`);
  } else if ((type === "p" || type === "g") && a) {
    reply = await resolveLedger(user, a, type === "p" ? "penalty" : "reward");
    if (cb.message && reply !== t(user, "Уже закрыто")) {
      await edit(user.tg_id, cb.message.message_id, type === "p" ? t(user, "✅ Долг закрыт.") : t(user, "🎁 Чит-вечер сегодня."));
    }
  } else if (type === "x" && a) {
    const { count } = await db.from("transactions").delete({ count: "exact" })
      .eq("id", a).eq("user_id", user.id);
    reply = count ? t(user, "Запись удалена") : t(user, "Уже удалена");
    if (cb.message && count) {
      await edit(user.tg_id, cb.message.message_id, t(user, "↩️ <s>запись отменена</s>"));
    }
  } else if (type === "ml" && a && b) {
    const out = await mealAction(user, a, b, cb.message?.message_id);
    reply = out.toast;
    if (cb.message && out.text) await edit(user.tg_id, cb.message.message_id, out.text, out.keyboard);
  } else if (type === "hw" && a) {
    reply = await markAssignmentDone(user, a);
    if (cb.message && reply !== t(user, "Уже отмечено")) {
      // Убираем нажатую кнопку, остальные оставляем.
      await setKeyboard(user.tg_id, cb.message.message_id, (cb.message.reply_markup?.inline_keyboard ?? [])
        .filter((row) => !row.some((btn) => btn.callback_data === cb.data)));
    }
  } else if (type === "ms" && a) {
    reply = await markMilestoneDone(user, a);
    if (cb.message && reply !== t(user, "Уже отмечено")) {
      await setKeyboard(user.tg_id, cb.message.message_id, (cb.message.reply_markup?.inline_keyboard ?? [])
        .filter((row) => !row.some((btn) => btn.callback_data === cb.data)));
    }
  } else if (type === "h" && a) {
    reply = await toggleHabit(user, a);
    if (cb.message && reply.startsWith(t(user, "Отмечено"))) {
      await setKeyboard(user.tg_id, cb.message.message_id, (cb.message.reply_markup?.inline_keyboard ?? [])
        .filter((row) => !row.some((btn) => btn.callback_data === cb.data)));
    }
  } else if ((type === "ay" || type === "an") && a) {
    const out = await confirmAgent(user, a, type === "ay");
    reply = out.text;
    if (cb.message) await setKeyboard(user.tg_id, cb.message.message_id, []);
    if (out.keyboard) await send(user.tg_id, out.text, out.keyboard);
  } else if (type === "az" && a) {
    reply = await undoAgent(user, a);
    if (cb.message) await setKeyboard(user.tg_id, cb.message.message_id, []);
  } else if (type === "fs" && a) {
    reply = await stopFocus(user, a);
  } else if (type === "fc" && a === "go") {
    background(() => startCards(user));
  } else if (type === "fc" && a && b) {
    reply = await handleCardCallback(user, cb.message, a, b);
    if (a === "u" && cb.message) {
      await setKeyboard(user.tg_id, cb.message.message_id, (cb.message.reply_markup?.inline_keyboard ?? [])
        .filter((row) => !row.some((btn) => btn.callback_data === cb.data)));
    }
  } else if (type.startsWith("pr")) {
    reply = await handlePromiseCallback(user, type, a ?? "", b);
  } else if (["tf", "tt", "tfs", "tts", "tb", "td"].includes(type) && a) {
    reply = await handleTransferCallback(user, cb.message?.message_id, type, a, b);
  } else if (["c", "a", "cs", "as", "b", "n"].includes(type) && a) {
    reply = await handleEntryCallback(user, cb.message?.message_id, type, a, b);
  }
  await answerCallback(cb.id, reply);
}

const shortDate = (iso: string, tz: string) => localNow(tz, new Date(iso)).date.slice(5).split("-").reverse().join(".");

/** Новая одноразовая ссылка. Заметка после команды помогает не путать, кому какая. */
async function sendInvite(user: User, note: string) {
  if (!user.is_owner) {
    await send(user.tg_id, t(user, "Приглашения раздаёт владелец бота."));
    return;
  }
  const inv = await createInvite(user, note || undefined);
  const others = (await pendingInvites(user.id)).filter((i) => i.id !== inv.id);
  const lines = [
    t(user, "<b>Ссылка на одного человека</b>"),
    inv.note ? esc(inv.note) : null,
    `<code>${inviteLink(inv.code)}</code>`,
    t(user, "Сгорит {date} или после первого входа.", { date: shortDate(inv.expires_at, user.tz) }),
  ].filter(Boolean) as string[];

  if (others.length) {
    lines.push("", t(user, "<b>Ещё не использованы</b>"));
    for (const i of others) {
      lines.push(inviteLine(user, i));
    }
    lines.push(t(user, "Отозвать: /friends"));
  }
  await send(user.tg_id, lines.join("\n"));
}

const inviteLine = (user: User, i: { code: string; note: string | null; expires_at: string }) =>
  t(user, "<code>{code}</code> — {note}, до {date}", {
    code: i.code,
    note: i.note ? esc(i.note) : t(user, "без заметки"),
    date: shortDate(i.expires_at, user.tz),
  });

async function friendsOverview(user: User): Promise<Outgoing> {
  if (!user.is_owner) return { text: t(user, "Список друзей видит владелец бота.") };
  const [list, pend] = await Promise.all([friends(user.id), pendingInvites(user.id)]);
  if (!list.length && !pend.length) {
    return {
      text: t(user, "Друзей нет. Ссылка на одного человека — /invite, живёт {days} дней.", {
        days: INVITE_DAYS,
      }),
    };
  }

  const lines: string[] = [];
  const keyboard: Keyboard = [];
  if (list.length) {
    lines.push(t(user, "<b>Друзья</b>"));
    for (const f of list) {
      const name = f.first_name ?? t(user, "без имени");
      lines.push(`${esc(name)}${f.is_allowed ? "" : t(user, " — доступ закрыт")}`);
      keyboard.push([{
        text: f.is_allowed
          ? t(user, "Отключить {name}", { name })
          : t(user, "Вернуть {name}", { name }),
        callback_data: `${f.is_allowed ? "fd" : "fe"}:${f.id}`,
      }]);
    }
  }
  if (pend.length) {
    if (lines.length) lines.push("");
    lines.push(t(user, "<b>Ссылки без ответа</b>"));
    for (const i of pend) {
      lines.push(inviteLine(user, i));
      keyboard.push([{ text: t(user, "Отозвать {code}", { code: i.code }), callback_data: `fr:${i.code}` }]);
    }
  }
  return { text: lines.join("\n"), keyboard };
}

/** Подтверждение удаления. Владельца не удаляем: на нём висят приглашения друзей. */
async function onDeleteCallback(cb: TgCallback, user: User, confirmed: boolean) {
  if (!confirmed) {
    await answerCallback(cb.id);
    if (cb.message) await edit(user.tg_id, cb.message.message_id, t(user, "Отменил, всё на месте."));
    return;
  }
  if (user.is_owner) {
    await answerCallback(cb.id, t(user, "Владельца не удаляю"));
    return;
  }
  const invitedBy = user.invited_by;
  const name = user.first_name ?? t(user, "без имени");
  await deleteAccount(user);
  await answerCallback(cb.id);
  if (cb.message) await edit(user.tg_id, cb.message.message_id, t(user, "Удалил. Данных больше нет."));
  if (invitedBy) {
    const { data } = await db.from("users").select("tg_id").eq("id", invitedBy).maybeSingle();
    const owner = data as { tg_id: number } | null;
    if (owner) {
      const ownerUser = await findUser(owner.tg_id);
      await send(owner.tg_id, t(ownerUser ?? "ru", "{name} удалил аккаунт.", { name: esc(name) }));
    }
  }
}

/** Друг нажал «Согласен»: заводим аккаунт и говорим владельцу, кто пришёл. */
async function onConsent(cb: TgCallback, code: string) {
  const { user, invite } = await acceptInvite(cb.from, code);
  if (!user) {
    const l = langFromLocale(cb.from.language_code);
    await answerCallback(cb.id, t(l, "Ссылка уже использована"));
    if (cb.message) await edit(cb.from.id, cb.message.message_id, t(l, "Ссылка уже использована или просрочена."));
    return;
  }
  await answerCallback(cb.id);
  if (cb.message) await edit(cb.from.id, cb.message.message_id, t(user, "Согласие принято."));
  await setupChat(cb.from.id, MINIAPP_URL, lang(user));
  await send(
    user.tg_id,
    t(user, "Готово, {name}.", { name: esc(user.first_name ?? "") }) + "\n" +
      t(user, "Начни с приложения: часовой пояс, режим сна и счёт для трат. Добавки и привычки заведёшь там же.") +
      "\n\n" + help(user),
  );
  if (invite) {
    const { data } = await db.from("users").select("tg_id").eq("id", invite.created_by).maybeSingle();
    const owner = data as { tg_id: number } | null;
    if (owner) {
      const ownerUser = await findUser(owner.tg_id);
      await send(
        owner.tg_id,
        t(ownerUser ?? "ru", "Зашёл по приглашению: {name}{note}.", {
          name: esc(user.first_name ?? t(ownerUser ?? "ru", "без имени")),
          note: invite.note ? ` (${esc(invite.note)})` : "",
        }),
      );
    }
  }
}

async function lastSleep(user: User): Promise<Outgoing[]> {
  const today = localNow(user.tz).date;
  const s = (await getSleep(user.id, today)) ?? (await getSleep(user.id, shiftDate(today, -1)));
  if (!s) return [{ text: t(user, "Данных сна нет. Настрой передачу: /shortcut") }];
  // Сегодняшняя ночь: если ещё не разобрана — разбор (и штраф/награда) здесь же.
  if (s.night_date === today) return await lateSleepMessages(user, s);
  return [{ text: t(user, "Ночь на {date}.", { date: s.night_date }) + " " + sleepLine(user, s) }];
}

const MIN_NIGHT = 60;
const MAX_NIGHT = 16 * 60;

/** «/sleep 00:10 08:40» — ночь руками, когда часы не отдали данные в Health. */
async function manualSleep(user: User, args: string): Promise<Outgoing[]> {
  const m = parseManualSleep(args);
  if (!m) {
    return [{
      text: t(user, "Формат: <code>/sleep 00:10 08:40</code> — когда лёг и когда встал. Для позапрошлой ночи добавь «вчера»."),
    }];
  }
  const now = localNow(user.tz);
  // Без даты считаем ночь ближайшей к сегодняшнему утру: подъём в будущем — значит, это вчера.
  let wakeDate = shiftDate(now.date, -m.daysBack);
  if (!m.daysBack && m.wakeMin > now.minutes) wakeDate = shiftDate(now.date, -1);
  const bedDate = m.bedMin >= m.wakeMin ? shiftDate(wakeDate, -1) : wakeDate;
  const bedAt = addMin(dayBounds(bedDate, user.tz).from, m.bedMin);
  const wakeAt = addMin(dayBounds(wakeDate, user.tz).from, m.wakeMin);
  const asleep = Math.round((wakeAt.getTime() - bedAt.getTime()) / 60_000);
  if (asleep < MIN_NIGHT || asleep > MAX_NIGHT) {
    return [{
      text: t(user, "Получилась ночь {total} — проверь время.", { total: fmtDuration(user, asleep) }),
    }];
  }

  check(
    await db.from("sleep_sessions").upsert({
      user_id: user.id,
      night_date: wakeDate,
      bed_at: bedAt.toISOString(),
      wake_at: wakeAt.toISOString(),
      asleep_min: asleep,
      in_bed_min: asleep,
      deep_min: 0,
      rem_min: 0,
      core_min: 0,
      awake_min: 0,
      source: "manual",
      raw: { manual: true },
    }, { onConflict: "user_id,night_date" }),
  );
  const s = await getSleep(user.id, wakeDate);
  if (!s) return [{ text: t(user, "Не вышло записать ночь.") }];

  // Ночь уже разбирали (например, по неполным данным с часов) — пересматриваем со снятием штрафа.
  const ev = user.state.last_eval_night === wakeDate
    ? await reevaluateNight(user, s)
    : await evaluateNight(user, s);
  const head = t(user, "Ночь на {date} записана руками.", { date: wakeDate }) + " " + sleepLine(user, s);
  return [{ text: [head, ...ev.lines].join("\n") }, ...ev.extras];
}

const LABEL_RE = /^[A-Za-z0-9_-]{1,24}$/;

async function tokensText(user: User): Promise<string> {
  const rows = await listTokens(user.id) as unknown as {
    label: string;
    scopes: string[];
    last_used_at: string | null;
    revoked_at: string | null;
  }[];
  if (!rows.length) return t(user, "Токенов нет. Создать: /newtoken метка [app|study|ingest|*]");
  const lines = rows.map((r) => {
    const used = r.last_used_at ? r.last_used_at.slice(0, 16).replace("T", " ") + " UTC" : t(user, "не использовался");
    const state = r.revoked_at ? " · " + t(user, "отозван") : "";
    return `• <code>${r.label}</code> · ${r.scopes.join(",")} · ${used}${state}`;
  });
  return [t(user, "<b>Токены доступа</b> (значений здесь не показываю)"), ...lines, "",
    t(user, "Новый: /newtoken метка [app|study|ingest|*] · отозвать: /revoke метка")].join("\n");
}

async function tokenCommand(user: User, chatId: number, cmd: string, args: string[]) {
  const label = args[0] ?? "";
  if (!LABEL_RE.test(label)) {
    await send(chatId, t(user, "Метка: латиница, цифры, - и _, до 24 символов. Например: /newtoken desk app"));
    return;
  }
  if (cmd === "/revoke") {
    const ok = await revokeToken(user.id, label);
    await send(chatId, ok ? t(user, "Токен «{label}» отозван.", { label }) : t(user, "Активного токена «{label}» нет.", { label }));
    return;
  }
  const scope = args[1] ?? "app";
  if (!SCOPES.includes(scope)) {
    await send(chatId, t(user, "Доступ: app (приложение), study (синхронизация учёбы), ingest (Команды iPhone) или *."));
    return;
  }
  let token: string;
  try {
    token = await issueToken(user.id, label, [scope]);
  } catch {
    await send(chatId, t(user, "Метка «{label}» уже занята (в том числе отозванным токеном). Выбери другую.", { label }));
    return;
  }
  const id = await send(chatId, [
    t(user, "<b>Новый токен «{label}»</b> ({scope}). Показываю один раз:", { label, scope }),
    `<code>${token}</code>`,
    t(user, "Скопируй сейчас: сообщение удалится через минуту. Токен — как пароль."),
  ].join("\n"));
  // The message with the value goes away on its own (the webhook invocation is kept alive for it).
  background(async () => {
    await new Promise((r) => setTimeout(r, 60_000));
    await deleteMessage(chatId, id);
  });
}

function shortcutHelp(user: User): string {
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  return [
    t(user, "<b>Команды iPhone → бот</b>"),
    "",
    t(user, "<b>Токен</b> (заголовок <code>X-Token</code>, один для обеих команд):"),
    `<code>${user.ingest_token}</code>`,
    "",
    t(user, "<b>Сон</b>: POST на"),
    `<code>${base}/sleep-webhook</code>`,
    t(user, "Инструкция: docs/shortcut-sleep.md"),
    "",
    t(user, "<b>Трата голосом</b>: «Продиктовать текст» → POST JSON {text} на"),
    `<code>${base}/quick-entry</code>`,
    t(user, "Инструкция: docs/shortcut-quick-entry.md"),
    "",
    t(user, "<b>Шаги, вес, пульс покоя</b>: POST JSON {date, steps, weightKg, restingHr} на"),
    `<code>${base}/body-webhook</code>`,
    t(user, "Инструкция: docs/shortcut-body.md"),
    "",
    t(user, "⚠️ Токен — как пароль, никому не пересылай."),
    t(user, "Для новых команд лучше отдельный токен: /newtoken метка ingest (список: /tokens, отозвать: /revoke)."),
  ].join("\n");
}
