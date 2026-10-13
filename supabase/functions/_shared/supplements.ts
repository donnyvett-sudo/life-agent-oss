import { check, db, type Reminder, type Supplement, type User } from "./db.ts";
import { LOW_STOCK_DAYS, REPEAT_AFTER_MIN, SNOOZE_MIN } from "./config.ts";
import { dropKeyboard, edit, esc, type Keyboard, send } from "./telegram.ts";
import { addMin, fmtTime, localNow } from "./time.ts";
import { t } from "./i18n.ts";

export type Slot = Supplement["slot"];

// Названия слотов — ключи перевода.
const SLOT_TITLE: Record<Slot, string> = {
  morning: "Утренние добавки",
  lunch: "Добавки к обеду",
  evening: "Вечер: магний",
};

export async function slotSupplements(userId: string, slot: Slot): Promise<Supplement[]> {
  return check(
    await db.from("supplements").select("*").eq("user_id", userId).eq("slot", slot)
      .eq("active", true).order("sort"),
  ) as Supplement[];
}

const kindOf = (slot: Slot) => `supp_${slot}`;
const slotOf = (kind: string) => kind.replace("supp_", "") as Slot;

function keyboard(user: User, reminderId: string): Keyboard {
  return [[
    { text: "✅ " + t(user, "Выпито"), callback_data: `s:t:${reminderId}` },
    { text: "⏰ " + t(user, "{n} мин", { n: SNOOZE_MIN }), callback_data: `s:z:${reminderId}` },
    { text: "❌ " + t(user, "Пропуск"), callback_data: `s:k:${reminderId}` },
  ]];
}

export type SendReason = "meal" | "scheduled" | "fallback" | "repeat";

/**
 * Отправить (или повторить) напоминание о добавках слота на сегодня.
 * Идемпотентно: одна запись reminders на (user, slot, день); повторно шлём только по reason=repeat.
 * Возвращает true, если сообщение ушло.
 */
export async function sendSupplementReminder(
  user: User,
  slot: Slot,
  reason: SendReason,
  customLead?: string,
): Promise<boolean> {
  const supps = await slotSupplements(user.id, slot);
  if (supps.length === 0) return false;

  const today = localNow(user.tz).date;
  const kind = kindOf(slot);
  await db.from("reminders").upsert(
    { user_id: user.id, kind, local_date: today },
    { onConflict: "user_id,kind,local_date", ignoreDuplicates: true },
  );
  const rem = check(
    await db.from("reminders").select("*").eq("user_id", user.id).eq("kind", kind)
      .eq("local_date", today).single(),
  ) as Reminder;

  if (rem.status !== "pending") return false;
  if (rem.attempts > 0 && reason !== "repeat") return false;

  // Всё уже отмечено за сегодня (например, через Mini App) — закрываем.
  const logged = check(
    await db.from("supplement_logs").select("supplement_id").eq("user_id", user.id)
      .eq("local_date", today).in("supplement_id", supps.map((s) => s.id)),
  ) as { supplement_id: string }[];
  if (logged.length >= supps.length) {
    await db.from("reminders").update({ status: "done", next_at: null }).eq("id", rem.id);
    return false;
  }

  const names = supps.map((s) => esc(t(user, s.name))).join(", ");
  const lead = customLead ?? {
    meal: t(user, "Обед записан. Теперь добавки:"),
    scheduled: `${t(user, SLOT_TITLE[slot])}:`,
    fallback: t(user, "14:30, обеда в тратах нет. Добавки всё равно нужны с едой:"),
    repeat: t(user, "Повторяю. Добавки не отмечены:"),
  }[reason];
  const text = customLead ? `${lead}\n<b>${names}</b>` : `💊 ${lead}\n<b>${names}</b>`;

  if (rem.tg_message_id) await dropKeyboard(user.tg_id, rem.tg_message_id);
  const messageId = await send(user.tg_id, text, keyboard(user, rem.id));

  const attempts = rem.attempts + 1;
  const repeatAfter = REPEAT_AFTER_MIN[kind as keyof typeof REPEAT_AFTER_MIN] ?? 30;
  check(
    await db.from("reminders").update({
      attempts,
      tg_message_id: messageId,
      // Шапку (итоги дня) сохраняем, чтобы не потерять её при нажатии кнопки.
      ...(customLead ? { payload: { ...rem.payload, lead: customLead } } : {}),
      next_at: attempts < 2 ? addMin(new Date(), repeatAfter).toISOString() : null,
    }).eq("id", rem.id),
  );
  return true;
}

/** Кнопки ✅ / ⏰ / ❌ под напоминанием. Возвращает текст для answerCallbackQuery. */
export async function handleSupplementAction(
  user: User,
  action: "t" | "z" | "k",
  reminderId: string,
): Promise<string> {
  const rem = check(
    await db.from("reminders").select("*").eq("id", reminderId).eq("user_id", user.id)
      .maybeSingle(),
  ) as Reminder | null;
  if (!rem) return t(user, "Напоминание не найдено");
  if (rem.status !== "pending") return t(user, "Уже отмечено");

  const slot = slotOf(rem.kind);
  const supps = await slotSupplements(user.id, slot);
  const names = supps.map((s) => esc(t(user, s.name))).join(", ");
  const chat = user.tg_id;
  const lead = typeof rem.payload?.lead === "string" ? `${rem.payload.lead}\n` : "";

  if (action === "z") {
    const at = addMin(new Date(), SNOOZE_MIN);
    check(
      await db.from("reminders").update({ attempts: 0, next_at: at.toISOString() })
        .eq("id", rem.id),
    );
    if (rem.tg_message_id) {
      await edit(
        chat,
        rem.tg_message_id,
        `${lead}💊 ${names}\n⏰ ` + t(user, "Напомню в {time}", { time: fmtTime(at, user.tz) }),
      );
    }
    return t(user, "Ок, через {n} минут", { n: SNOOZE_MIN });
  }

  const status = action === "t" ? "taken" : "skipped";
  check(
    await db.from("supplement_logs").upsert(
      supps.map((s) => ({
        user_id: user.id,
        supplement_id: s.id,
        local_date: rem.local_date,
        status,
      })),
      { onConflict: "supplement_id,local_date" },
    ),
  );
  check(
    await db.from("reminders").update({
      status: action === "t" ? "done" : "skipped",
      next_at: null,
    }).eq("id", rem.id),
  );
  if (rem.tg_message_id) {
    await edit(
      chat,
      rem.tg_message_id,
      lead +
        (action === "t"
          ? "✅ " + t(user, "Выпито: {names}", { names })
          : "❌ " + t(user, "Пропуск: {names}", { names })),
    );
  }
  if (action === "t") await consumeStock(user, supps);
  return action === "t" ? t(user, "Записано") : t(user, "Пропуск записан");
}

async function consumeStock(user: User, supps: Supplement[]) {
  for (const s of supps) {
    if (s.units_left == null) continue;
    const left = Math.max(0, Number(s.units_left) - Number(s.units_per_intake));
    const daysLeft = Math.floor(left / Number(s.units_per_intake));
    const warn = daysLeft <= LOW_STOCK_DAYS && !s.low_stock_warned;
    check(
      await db.from("supplements").update({
        units_left: left,
        ...(warn ? { low_stock_warned: true } : {}),
      }).eq("id", s.id),
    );
    if (warn) {
      await send(
        user.tg_id,
        "⚠️ " + t(user, "<b>{name}</b>: осталось на {n} дн. Пора купить.", {
          name: esc(t(user, s.name)),
          n: daysLeft,
        }),
        s.units_per_pack
          ? [[{ text: "🔄 " + t(user, "Новая банка"), callback_data: `r:${s.id}` }]]
          : undefined,
      );
    }
  }
}

export async function refillSupplement(user: User, supplementId: string): Promise<string> {
  const s = check(
    await db.from("supplements").select("*").eq("id", supplementId).eq("user_id", user.id)
      .maybeSingle(),
  ) as Supplement | null;
  if (!s || !s.units_per_pack) return t(user, "Не нашёл банку");
  check(
    await db.from("supplements").update({
      units_left: Number(s.units_left ?? 0) + s.units_per_pack,
      low_stock_warned: false,
    }).eq("id", s.id),
  );
  return `${t(user, s.name)}: +${s.units_per_pack}`;
}

/** Сводка по добавкам за сегодня для /today. */
export async function todaySummary(user: User): Promise<string> {
  const today = localNow(user.tz).date;
  const supps = check(
    await db.from("supplements").select("*").eq("user_id", user.id).eq("active", true)
      .order("sort"),
  ) as Supplement[];
  const logs = check(
    await db.from("supplement_logs").select("supplement_id,status").eq("user_id", user.id)
      .eq("local_date", today),
  ) as { supplement_id: string; status: string }[];
  const byId = new Map(logs.map((l) => [l.supplement_id, l.status]));
  const icon = (id: string) =>
    byId.get(id) === "taken" ? "✅" : byId.get(id) === "skipped" ? "❌" : "▫️";
  return supps.map((s) => {
    const stock = s.units_left != null
      ? " · " + t(user, "осталось {n} дн.", {
        n: Math.floor(Number(s.units_left) / Number(s.units_per_intake)),
      })
      : "";
    return `${icon(s.id)} ${esc(t(user, s.name))}${stock}`;
  }).join("\n");
}

/**
 * Отметка из Mini App: taken / skipped / null (снять отметку) за сегодня.
 * Держит в согласии остаток банки и напоминание в чате.
 */
export async function logSupplement(
  user: User,
  supplementId: string,
  status: "taken" | "skipped" | null,
  date?: string,
): Promise<void> {
  const s = check(
    await db.from("supplements").select("*").eq("id", supplementId).eq("user_id", user.id)
      .maybeSingle(),
  ) as Supplement | null;
  if (!s) throw new Error("supplement not found");

  // Отметка задним числом (забыл отметить вчера) — тот же механизм, другая дата.
  const today = date ?? localNow(user.tz).date;
  const prev = check(
    await db.from("supplement_logs").select("status").eq("supplement_id", s.id)
      .eq("local_date", today).maybeSingle(),
  ) as { status: string } | null;
  if ((prev?.status ?? null) === status) return;

  if (status) {
    check(
      await db.from("supplement_logs").upsert(
        { user_id: user.id, supplement_id: s.id, local_date: today, status },
        { onConflict: "supplement_id,local_date" },
      ),
    );
  } else {
    check(await db.from("supplement_logs").delete().eq("supplement_id", s.id).eq("local_date", today));
  }

  // Остаток: списываем при «выпито», возвращаем, если отметку «выпито» сняли.
  if (status === "taken") await consumeStock(user, [s]);
  else if (prev?.status === "taken" && s.units_left != null) {
    check(
      await db.from("supplements").update({
        units_left: Number(s.units_left) + Number(s.units_per_intake),
      }).eq("id", s.id),
    );
  }

  // Все добавки слота отмечены — закрываем напоминание в чате.
  const supps = await slotSupplements(user.id, s.slot);
  const logged = check(
    await db.from("supplement_logs").select("supplement_id").eq("user_id", user.id)
      .eq("local_date", today).in("supplement_id", supps.map((x) => x.id)),
  ) as unknown[];
  const rem = check(
    await db.from("reminders").select("*").eq("user_id", user.id).eq("kind", kindOf(s.slot))
      .eq("local_date", today).eq("status", "pending").maybeSingle(),
  ) as Reminder | null;
  if (rem && logged.length >= supps.length) {
    check(await db.from("reminders").update({ status: "done", next_at: null }).eq("id", rem.id));
    if (rem.tg_message_id) {
      const lead = typeof rem.payload?.lead === "string" ? `${rem.payload.lead}\n` : "";
      await edit(user.tg_id, rem.tg_message_id, `${lead}📱 ` + t(user, "Отмечено в приложении."));
    }
  }
}
