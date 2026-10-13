// Обещания друзьям: даёшь слово другу, бот проверяет и подводит итог.
// Проверка — по данным сна, фото-доказательством или словом друга.
// Штраф за невыполненное выбирает тот, кому обещали; у наказанного одно вето в неделю.
import { check, db, type User } from "./db.ts";
import { type Outgoing, say } from "./coach.ts";
import { esc, type Keyboard, send, sendPhoto } from "./telegram.ts";
import { localNow, shiftDate, toMin } from "./time.ts";
import { t } from "./i18n.ts";

export type Promise_ = {
  id: string;
  user_id: string;
  to_user_id: string;
  title: string;
  check_kind: "photo" | "sleep" | "friend";
  due_date: string;
  status: "open" | "kept" | "broken" | "cancelled";
  proof_file_id: string | null;
  penalty: string | null;
  penalty_id: string | null;
  created_at: string;
};

// Штрафы внутри бота: без денег и без публичности. Значения — ключи перевода.
const PENALTIES = [
  "50 отжиманий",
  "Час без телефона",
  "Лишний блок учёбы 45 минут",
  "Отбой на час раньше",
  "Пробежка 3 км",
];

const BONUS_AT = 5;

const who = (u: User) => esc(u.first_name ?? t(u, "друг"));

/** Круг: владелец и все, кого он пригласил, кроме себя. */
export async function circle(user: User): Promise<User[]> {
  const ownerId = user.is_owner ? user.id : user.invited_by;
  if (!ownerId) return [];
  const rows = check(
    await db.from("users").select("*").or(`id.eq.${ownerId},invited_by.eq.${ownerId}`)
      .eq("is_allowed", true).order("created_at"),
  ) as User[];
  return rows.filter((u) => u.id !== user.id);
}

const byId = async (id: string): Promise<User | null> =>
  check(await db.from("users").select("*").eq("id", id).maybeSingle()) as User | null;

// ------------------------------------------------------------- мастер ---

type Draft = { to?: string; title?: string; due?: string };

const draftOf = (user: User): Draft => (user.state.promise as Draft) ?? {};

async function setDraft(user: User, draft: Draft | null) {
  const state = { ...user.state };
  if (draft) state.promise = draft;
  else delete state.promise;
  user.state = state;
  check(await db.from("users").update({ state }).eq("id", user.id));
}

/** /promise — начать. Если друг один, сразу спрашиваем текст. */
export async function startPromise(user: User): Promise<Outgoing> {
  const people = await circle(user);
  if (!people.length) {
    return {
      text: user.is_owner
        ? t(user, "Обещать пока некому: позови друга — /invite.")
        : t(user, "Обещать пока некому: в боте нет других людей."),
    };
  }
  if (people.length === 1) {
    await setDraft(user, { to: people[0].id });
    return { text: t(user, "Обещание для {name}. Что обещаешь? Напиши одной строкой.", { name: who(people[0]) }) };
  }
  await setDraft(user, {});
  return {
    text: t(user, "Кому обещаешь?"),
    keyboard: people.map((p, i) => [{ text: p.first_name ?? t(user, "друг"), callback_data: `prt:${i}` }]),
  };
}

const dueButtons = (user: User): Keyboard => [[
  { text: t(user, "Сегодня"), callback_data: "prd:0" },
  { text: t(user, "Завтра"), callback_data: "prd:1" },
  { text: t(user, "Через неделю"), callback_data: "prd:7" },
]];

const checkButtons = (user: User): Keyboard => [
  [{ text: t(user, "Проверит друг"), callback_data: "prc:friend" }],
  [{ text: t(user, "Пришлю фото"), callback_data: "prc:photo" }],
  [{ text: t(user, "По данным сна"), callback_data: "prc:sleep" }],
];

/** Текст в чате, когда идёт мастер обещания. null — мастер не активен. */
export async function promiseText(user: User, text: string): Promise<Outgoing | null> {
  const draft = draftOf(user);
  if (!draft.to || draft.title) return null;
  const title = text.trim().slice(0, 120);
  if (title.length < 3) return { text: t(user, "Слишком коротко. Напиши обещание одной строкой.") };
  await setDraft(user, { ...draft, title });
  return {
    text: t(user, "«{title}» — до какого дня?", { title: esc(title) }),
    keyboard: dueButtons(user),
  };
}

/** Активен ли мастер: чтобы обычный текст не ушёл в траты или коучу. */
export const inWizard = (user: User): boolean => {
  const d = draftOf(user);
  return !!d.to && !d.title;
};

async function createPromise(user: User, draft: Draft, kind: Promise_["check_kind"]) {
  const friend = await byId(draft.to!);
  if (!friend) return;
  const row = check(
    await db.from("promises").insert({
      user_id: user.id,
      to_user_id: friend.id,
      title: draft.title,
      check_kind: kind,
      due_date: draft.due,
    }).select("*").single(),
  ) as Promise_;
  await setDraft(user, null);

  const how = (to: User) =>
    kind === "photo"
      ? t(to, "фото-доказательство")
      : kind === "sleep"
      ? t(to, "по данным сна")
      : t(to, "слово {name}", { name: who(friend) });
  await send(
    user.tg_id,
    "🤝 " + t(user, "Обещание для {name}: <b>{title}</b>", { name: who(friend), title: esc(row.title) }) +
      "\n" + t(user, "Срок: {date}. Проверка: {how}.", { date: row.due_date, how: how(user) }),
    [[{ text: t(user, "Отменить"), callback_data: `prx:${row.id}` }]],
  );
  await say(friend, {
    text: "🤝 " +
      t(friend, "{name} обещает: <b>{title}</b>", { name: who(user), title: esc(row.title) }) +
      "\n" + t(friend, "Срок: {date}. Проверка: {how}.", { date: row.due_date, how: how(friend) }),
  });
}

// ------------------------------------------------------------ проверка ---

/** Цель сна на ночь: окно режима минус час запаса, но не меньше пяти часов. */
export function sleepTarget(bed: string, wake: string): number {
  const window = (toMin(wake) - toMin(bed) + 1440) % 1440;
  return Math.max(5 * 60, window - 60);
}

/** Все ли ночи от начала обещания до срока набрали цель сна. */
async function sleptEnough(user: User, p: Promise_): Promise<boolean> {
  const { bed, wake } = user.settings.sleep;
  const targetMin = sleepTarget(bed, wake);
  const from = p.created_at.slice(0, 10);
  const rows = check(
    await db.from("sleep_sessions").select("night_date,asleep_min").eq("user_id", user.id)
      .gte("night_date", from).lte("night_date", p.due_date),
  ) as { night_date: string; asleep_min: number }[];
  if (!rows.length) return false;
  // Нужна каждая ночь периода.
  let need = 0;
  for (let d = from; d <= p.due_date; d = shiftDate(d, 1)) need++;
  return rows.length >= need && rows.every((r) => r.asleep_min >= targetMin);
}

/** Вечерняя проверка обещаний, у которых сегодня срок. */
export async function eveningPromises(user: User): Promise<void> {
  const today = localNow(user.tz).date;
  const rows = check(
    await db.from("promises").select("*").eq("user_id", user.id).eq("status", "open")
      .lte("due_date", today),
  ) as Promise_[];

  for (const p of rows) {
    if (p.check_kind === "sleep") {
      await finish(user, p, await sleptEnough(user, p));
      continue;
    }
    if (p.check_kind === "photo" && !p.proof_file_id) {
      await finish(user, p, false);
      continue;
    }
    // Слово друга: спрашиваем того, кому обещали.
    const friend = await byId(p.to_user_id);
    if (friend) await askFriend(friend, user, p);
  }
}

async function askFriend(friend: User, author: User, p: Promise_) {
  await say(friend, {
    text: t(friend, "Сегодня срок обещания от {name}: <b>{title}</b>", {
      name: who(author),
      title: esc(p.title),
    }) + "\n" + t(friend, "Выполнено?"),
    keyboard: [[
      { text: t(friend, "Да"), callback_data: `pry:${p.id}` },
      { text: t(friend, "Нет"), callback_data: `prn:${p.id}` },
    ]],
  });
}

/** Подвести итог: серия пары, поздравление или выбор штрафа. */
async function finish(author: User, p: Promise_, kept: boolean) {
  check(
    await db.from("promises").update({
      status: kept ? "kept" : "broken",
      resolved_at: new Date().toISOString(),
    }).eq("id", p.id).eq("status", "open"),
  );
  const friend = await byId(p.to_user_id);
  if (!friend) return;

  if (!kept) {
    await send(
      author.tg_id,
      t(author, "Обещание не выполнено: <b>{title}</b>. Штраф выберет {name}.", {
        title: esc(p.title),
        name: who(friend),
      }),
    );
    await say(friend, {
      text: t(friend, "{name} не выполнил обещание: <b>{title}</b>", {
        name: who(author),
        title: esc(p.title),
      }) + "\n" + t(friend, "Выбери штраф."),
      keyboard: [
        ...PENALTIES.map((title, i) => [{ text: t(friend, title), callback_data: `prs:${p.id}:${i}` }]),
        [{ text: t(friend, "Простить"), callback_data: `prf:${p.id}` }],
      ],
    });
    return;
  }

  const streak = await pairStreak(author.id, friend.id);
  const tail = (to: User, other: User) =>
    streak >= 2 ? "\n" + t(to, "Серия с {name}: {n}.", { name: who(other), n: streak }) : "";
  await send(
    author.tg_id,
    "✅ " + t(author, "Обещание выполнено: <b>{title}</b>.", { title: esc(p.title) }) +
      tail(author, friend),
  );
  await say(friend, {
    text: "✅ " +
      t(friend, "{name} выполнил обещание: <b>{title}</b>.", {
        name: who(author),
        title: esc(p.title),
      }) + tail(friend, author),
  });
  if (streak > 0 && streak % BONUS_AT === 0) await bonus(author, friend, streak);
}

/** Сколько обещаний пары подряд выполнено. */
export async function pairStreak(a: string, b: string): Promise<number> {
  const rows = check(
    await db.from("promises").select("status,resolved_at")
      .or(`and(user_id.eq.${a},to_user_id.eq.${b}),and(user_id.eq.${b},to_user_id.eq.${a})`)
      .in("status", ["kept", "broken"]).order("resolved_at", { ascending: false }).limit(50),
  ) as { status: string }[];
  return streakOf(rows);
}

/** Сколько «kept» подряд с конца списка (список — от свежих к старым). */
export function streakOf(rows: { status: string }[]): number {
  let n = 0;
  for (const r of rows) {
    if (r.status !== "kept") break;
    n++;
  }
  return n;
}

async function bonus(a: User, b: User, streak: number) {
  for (const u of [a, b]) {
    const row = check(
      await db.from("coach_ledger").insert({
        user_id: u.id,
        kind: "reward",
        code: "promise_streak",
        title: "Чит-вечер",
        reason: `${streak} обещаний подряд`,
      }).select("id").single(),
    ) as { id: string };
    await send(
      u.tg_id,
      "🎁 " + t(u, "{n} обещаний подряд. Награда — <b>{title}</b>.", {
        n: streak,
        title: t(u, "Чит-вечер"),
      }),
      [[{ text: "🎁 " + t(u, "Использовать сегодня"), callback_data: `g:${row.id}` }]],
    );
  }
}

// -------------------------------------------------------------- штрафы ---

/** Понедельник текущей недели по местному времени — ключ для вето. */
export const weekKey = (tz: string): string => {
  const d = localNow(tz).date;
  const t = new Date(`${d}T00:00:00Z`);
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return t.toISOString().slice(0, 10);
};

async function assignPenalty(p: Promise_, title: string) {
  const author = await byId(p.user_id);
  const friend = await byId(p.to_user_id);
  if (!author || !friend) return;
  const row = check(
    await db.from("coach_ledger").insert({
      user_id: author.id,
      kind: "penalty",
      code: "promise",
      title,
      reason: `обещание: ${p.title}`,
    }).select("id").single(),
  ) as { id: string };
  check(await db.from("promises").update({ penalty: title, penalty_id: row.id }).eq("id", p.id));

  const canVeto = vetoLeft(author);
  await send(
    author.tg_id,
    "⚖️ " + t(author, "{name} назначил штраф: <b>{title}</b>", {
      name: who(friend),
      title: esc(t(author, title)),
    }) + "\n" + t(author, "За обещание «{promise}».", { promise: esc(p.title) }),
    [[
      { text: t(author, "Сделал"), callback_data: `p:${row.id}` },
      ...(canVeto ? [{ text: t(author, "Вето"), callback_data: `prv:${p.id}` }] : []),
    ]],
  );
}

/** Вето — одно в неделю. */
const vetoLeft = (u: User): boolean => u.state.veto_week !== weekKey(u.tz);

// ------------------------------------------------------------- команды ---

/** /promises — открытые обещания в обе стороны. */
export async function promisesOverview(user: User): Promise<Outgoing> {
  const [mine, theirs] = await Promise.all([
    db.from("promises").select("*").eq("user_id", user.id).eq("status", "open").order("due_date"),
    db.from("promises").select("*").eq("to_user_id", user.id).eq("status", "open").order("due_date"),
  ]);
  const my = check(mine) as Promise_[];
  const to = check(theirs) as Promise_[];
  if (!my.length && !to.length) {
    return { text: t(user, "Открытых обещаний нет. Дать слово — /promise."), keyboard: undefined };
  }
  const lines = [t(user, "<b>Обещания</b>")];
  const keyboard: Keyboard = [];
  for (const p of my) {
    lines.push("• " + t(user, "{title} — до {date}", { title: esc(p.title), date: p.due_date }));
    if (p.check_kind === "photo" && !p.proof_file_id) {
      keyboard.push([{
        text: "📷 " + t(user, "Фото: {title}", { title: p.title.slice(0, 20) }),
        callback_data: `prp:${p.id}`,
      }]);
    }
    keyboard.push([{
      text: t(user, "Отменить: {title}", { title: p.title.slice(0, 20) }),
      callback_data: `prx:${p.id}`,
    }]);
  }
  for (const p of to) {
    const author = await byId(p.user_id);
    lines.push("• " + t(user, "{name} обещает: {title} — до {date}", {
      name: who(author!),
      title: esc(p.title),
      date: p.due_date,
    }));
  }
  return { text: lines.join("\n"), keyboard: keyboard.length ? keyboard : undefined };
}

/** Фото прислали как доказательство. true — фото ушло по назначению. */
export async function promisePhoto(user: User, fileId: string): Promise<boolean> {
  const id = user.state.proof_for as string | undefined;
  if (!id) return false;
  const p = check(
    await db.from("promises").select("*").eq("id", id).eq("user_id", user.id).eq("status", "open")
      .maybeSingle(),
  ) as Promise_ | null;
  const state = { ...user.state };
  delete state.proof_for;
  user.state = state;
  check(await db.from("users").update({ state }).eq("id", user.id));
  if (!p) return false;

  check(await db.from("promises").update({ proof_file_id: fileId, proof_at: new Date().toISOString() }).eq("id", p.id));
  const friend = await byId(p.to_user_id);
  if (friend) {
    await sendPhoto(
      friend.tg_id,
      fileId,
      t(friend, "Доказательство от {name}: <b>{title}</b>", { name: who(user), title: esc(p.title) }),
      [[
        { text: t(friend, "Принято"), callback_data: `pry:${p.id}` },
        { text: t(friend, "Не то"), callback_data: `prn:${p.id}` },
      ]],
    );
  }
  await send(user.tg_id, t(user, "Отправил другу."));
  return true;
}

// ------------------------------------------------------------- колбэки ---

export async function handlePromiseCallback(
  user: User,
  type: string,
  a: string,
  b?: string,
): Promise<string | undefined> {
  if (type === "prt") {
    const people = await circle(user);
    const friend = people[Number(a)];
    if (!friend) return t(user, "Не нашёл человека");
    await setDraft(user, { to: friend.id });
    await send(
      user.tg_id,
      t(user, "Обещание для {name}. Что обещаешь? Напиши одной строкой.", { name: who(friend) }),
    );
    return;
  }
  if (type === "prd") {
    const draft = draftOf(user);
    if (!draft.title) return t(user, "Мастер не запущен");
    const due = shiftDate(localNow(user.tz).date, Number(a) || 0);
    await setDraft(user, { ...draft, due });
    await send(user.tg_id, t(user, "Как проверим?"), checkButtons(user));
    return;
  }
  if (type === "prc") {
    const draft = draftOf(user);
    if (!draft.title || !draft.due) return t(user, "Мастер не запущен");
    const kind = (["photo", "sleep", "friend"] as const).find((k) => k === a) ?? "friend";
    await createPromise(user, draft, kind);
    return;
  }

  // Дальше — действия по конкретному обещанию.
  const p = check(await db.from("promises").select("*").eq("id", a).maybeSingle()) as Promise_ | null;
  if (!p) return t(user, "Обещание не найдено");

  if (type === "prx") {
    if (p.user_id !== user.id || p.status !== "open") return t(user, "Уже закрыто");
    check(await db.from("promises").update({ status: "cancelled", resolved_at: new Date().toISOString() }).eq("id", p.id));
    const friend = await byId(p.to_user_id);
    if (friend) {
      await say(friend, {
        text: t(friend, "{name} отменил обещание «{title}».", { name: who(user), title: esc(p.title) }),
      });
    }
    return t(user, "Отменено");
  }
  if (type === "prp") {
    if (p.user_id !== user.id) return t(user, "Это не твоё обещание");
    user.state = { ...user.state, proof_for: p.id };
    check(await db.from("users").update({ state: user.state }).eq("id", user.id));
    await send(user.tg_id, t(user, "Пришли фото для «{title}» следующим сообщением.", { title: esc(p.title) }));
    return;
  }
  if (type === "pry" || type === "prn") {
    if (p.to_user_id !== user.id) return t(user, "Это решает тот, кому обещали");
    if (p.status !== "open") return t(user, "Уже закрыто");
    const author = await byId(p.user_id);
    if (!author) return t(user, "Автор не найден");
    await finish(author, p, type === "pry");
    return type === "pry" ? t(user, "Засчитано") : t(user, "Отмечено");
  }
  if (type === "prs" && b !== undefined) {
    if (p.to_user_id !== user.id) return t(user, "Штраф выбирает тот, кому обещали");
    if (p.penalty) return t(user, "Штраф уже назначен");
    const title = PENALTIES[Number(b)];
    if (!title) return t(user, "Нет такого штрафа");
    await assignPenalty(p, title);
    return t(user, "Назначено: {title}", { title: t(user, title) });
  }
  if (type === "prf") {
    if (p.to_user_id !== user.id) return t(user, "Это решает тот, кому обещали");
    check(await db.from("promises").update({ penalty: "прощено" }).eq("id", p.id));
    const author = await byId(p.user_id);
    if (author) {
      await send(
        author.tg_id,
        t(author, "{name} простил штраф за «{title}».", { name: who(user), title: esc(p.title) }),
      );
    }
    return t(user, "Прощено");
  }
  if (type === "prv") {
    if (p.user_id !== user.id) return t(user, "Вето только у наказанного");
    if (!vetoLeft(user)) return t(user, "Вето на этой неделе уже потрачено");
    if (!p.penalty_id) return t(user, "Штрафа нет");
    check(
      await db.from("coach_ledger").update({ status: "expired", resolved_at: new Date().toISOString() })
        .eq("id", p.penalty_id).eq("user_id", user.id).eq("status", "open"),
    );
    user.state = { ...user.state, veto_week: weekKey(user.tz) };
    check(await db.from("users").update({ state: user.state }).eq("id", user.id));
    const friend = await byId(p.to_user_id);
    if (friend) {
      await say(friend, {
        text: t(friend, "{name} наложил вето на штраф за «{title}». Вето — одно в неделю.", {
          name: who(user),
          title: esc(p.title),
        }),
      });
    }
    return t(user, "Вето принято");
  }
}
