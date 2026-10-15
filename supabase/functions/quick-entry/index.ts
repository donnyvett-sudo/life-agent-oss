// Быстрая запись с iPhone: «Команды» диктуют фразу и шлют её сюда. Авторизация — личный токен (X-Token).
// Ответ {reply} Shortcuts показывает уведомлением; запись с кнопками приходит и в Telegram.
import { check, db, type User, userCurrency } from "../_shared/db.ts";
import { authRequest, flagQueryToken } from "../_shared/tokens.ts";
import { logEntry } from "../_shared/moneybot.ts";
import { t } from "../_shared/i18n.ts";
import { type Currency, isLunch } from "../_shared/parse.ts";
import { parseSpoken, parseSpokenAI, spokenCurrency } from "../_shared/spoken.ts";
import { accountHint, accountsOf, applyTransfer, handleTransfer } from "../_shared/transferbot.ts";
import { limitText, takeAi } from "../_shared/quota.ts";
import { sendSupplementReminder } from "../_shared/supplements.ts";
import { localNow } from "../_shared/time.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(flagQueryToken(async (req) => {
  if (req.method !== "POST") return json({ ok: false, reply: "POST only" }, 405);
  const auth = await authRequest(req, "ingest");
  if ("error" in auth) return auth.error;
  const user = auth.user;

  const raw = await req.text();
  let text = raw;
  try {
    const body = JSON.parse(raw);
    text = typeof body === "string" ? body : String(body.text ?? "");
  } catch { /* обычный текст */ }
  text = text.trim().slice(0, 300);
  if (!text) return json({ ok: false, reply: t(user, "Пустая фраза") }, 400);

  try {
    const base = userCurrency(user) as Currency;
    // Перевод между своими счетами — раньше трат: «перекинул 50000 тенге с Каспи на вичат».
    const moved = await handleTransfer(user, text);
    if (moved !== null) return json({ ok: true, count: 1, reply: moved });

    const accounts = await accountsOf(user.id);
    const named = accounts.length > 1 ? accountHint(text, accounts) : { account: null, text };
    let entries = parseSpoken(named.text, base);
    if (!entries.length) {
      // Разбор моделью тратит дневной лимит ИИ; без лимита остаётся только точный формат.
      if (!(await takeAi(user))) return json({ ok: false, reply: limitText(user) });
      const ai = await parseSpokenAI(text, base).catch(() => ({ entries: [], transfer: null }));
      if (ai.transfer) {
        const done = await applyTransfer(user, ai.transfer);
        if (done !== null) return json({ ok: true, count: 1, reply: done });
      }
      entries = ai.entries;
    }
    if (!entries.length) {
      return json({
        ok: false,
        reply: t(user, "Не нашёл сумму в «{text}». Скажи, например: такси 18.", { text }),
      });
    }
    const lines: string[] = [];
    let lunch = false;
    for (const raw of entries) {
      // Валюта названного счёта сильнее валюты по умолчанию: «пополнил Kaspi на 20000» — тенге.
      const e = named.account && !spokenCurrency(text)
        ? { ...raw, currency: named.account.currency as Currency }
        : raw;
      const { summary } = await logEntry(user, text, e, e.daysAgo, "shortcut", named.account?.id);
      lines.push(summary);
      lunch ||= e.daysAgo === 0 && isLunch(e, localNow(user.tz).minutes);
    }
    if (lunch) await sendSupplementReminder(user, "lunch", "meal");
    return json({ ok: true, count: entries.length, reply: lines.join("\n") });
  } catch (e) {
    console.error("quick-entry", e);
    return json({ ok: false, reply: t(user, "Не записалось, ошибка на сервере. Попробуй ещё раз.") }, 500);
  }
}));
