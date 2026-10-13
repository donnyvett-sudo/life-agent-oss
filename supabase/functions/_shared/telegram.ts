import { type Lang, t } from "./i18n.ts";
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;

export type InlineButton = { text: string; callback_data?: string; web_app?: { url: string } };
export type Keyboard = InlineButton[][];

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(`telegram ${method}: ${json.description}`);
    // 403: бота заблокировали или аккаунт удалён — писать дальше бесполезно.
    if (json.error_code === 403) err.name = "BotBlocked";
    throw err;
  }
  return json.result as T;
}

export async function send(chatId: number, text: string, keyboard?: Keyboard) {
  const msg = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  return msg.message_id;
}

/** Переслать фото по file_id: доказательство обещания уходит другу. */
export async function sendPhoto(chatId: number, fileId: string, caption: string, keyboard?: Keyboard) {
  const msg = await call<{ message_id: number }>("sendPhoto", {
    chat_id: chatId,
    photo: fileId,
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  return msg.message_id;
}

/** Файл вложением: выгрузка данных. Только multipart, JSON-тело файл не примет. */
export async function sendDocument(chatId: number, name: string, content: string, caption?: string) {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("document", new Blob([content], { type: "application/octet-stream" }), name);
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram sendDocument: ${json.description}`);
}

/** Голосовое: файл (MP3) или file_id уже загруженного. Возвращает file_id — по нему шлём повторно без загрузки. */
export async function sendVoice(
  chatId: number,
  voice: Uint8Array<ArrayBuffer> | string,
  caption?: string,
  keyboard?: Keyboard,
): Promise<{ messageId: number; fileId: string }> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  if (keyboard) form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  if (typeof voice === "string") form.append("voice", voice);
  else form.append("voice", new Blob([voice], { type: "audio/mpeg" }), "voice.mp3");
  const res = await fetch(`${API}/sendVoice`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram sendVoice: ${json.description}`);
  return { messageId: json.result.message_id, fileId: json.result.voice?.file_id ?? json.result.audio?.file_id };
}

/** Подпись под голосовым (у него нет текста, editMessageText не подходит). */
export async function editCaption(chatId: number, messageId: number, caption: string, keyboard?: Keyboard) {
  try {
    await call("editMessageCaption", {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (e) {
    console.warn(String(e));
  }
}

export async function edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (e) {
    // «message is not modified» и удалённые сообщения — не критично.
    console.warn(String(e));
  }
}

export async function dropKeyboard(chatId: number, messageId: number) {
  try {
    await call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    console.warn(String(e));
  }
}

export async function answerCallback(id: string, text?: string) {
  try {
    await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  } catch (e) {
    console.warn(String(e));
  }
}

export const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export async function typing(chatId: number) {
  try {
    await call("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (e) {
    console.warn(String(e));
  }
}

const COMMANDS: [string, string][] = [
  ["app", "Открыть приложение"],
  ["food", "Еда за сегодня"],
  ["today", "Добавки за сегодня"],
  ["sleep", "Последняя ночь"],
  ["study", "Дедлайны и контрольные"],
  ["focus", "Фокус-сессия: /focus 25"],
  ["cards", "Повторить карточки"],
  ["promise", "Дать слово другу"],
  ["budget", "Лимиты трат на месяц"],
  ["subs", "Подписки и регулярные списания"],
  ["month", "Итоги месяца"],
  ["shortcut", "Передача сна с iPhone"],
  ["export", "Копия всех данных файлом"],
  ["help", "Справка"],
];

/** Кнопка меню чата → Mini App, и список команд на языке этого чата. Идемпотентно. */
export async function setupChat(chatId: number, appUrl: string, l: Lang = "ru") {
  try {
    await call("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "web_app", text: t(l, "Открыть"), web_app: { url: appUrl } },
    });
    // Команды ставим для конкретного чата: у разных людей разные языки.
    await call("setMyCommands", {
      scope: { type: "chat", chat_id: chatId },
      commands: COMMANDS.map(([command, description]) => ({ command, description: t(l, description) })),
    });
  } catch (e) {
    console.warn(String(e));
  }
}

export async function setKeyboard(chatId: number, messageId: number, keyboard: Keyboard) {
  try {
    await call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (e) {
    console.warn(String(e));
  }
}

/** Скачать файл Telegram (голосовое и т.п.). */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const f = await call<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: f.file_path };
}
