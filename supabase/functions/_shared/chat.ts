// Разговор с коучем. В Gemini уходит минимум: сводные цифры дня, без имён и идентификаторов.
import { getSleep, openDebts } from "./coach.ts";
import { careerFacts } from "./career.ts";
import { habitFacts } from "./habits.ts";
import { studyFacts } from "./study.ts";
import { check, db, type User } from "./db.ts";
import { generate, GeminiError, type Turn } from "./gemini.ts";
import { AGENT_PROMPT, type AgentResult, agentReply } from "./agent.ts";
import { financeFacts } from "./spend.ts";
import { bodyFacts } from "./body.ts";
import { mealFacts } from "./food.ts";
import { linkFacts } from "./links.ts";
import { lang, t } from "./i18n.ts";
import { limitText, takeAi } from "./quota.ts";
import { esc } from "./telegram.ts";
import { fmtDuration, fmtTime, isQuiet, localNow, shiftDate } from "./time.ts";

const HISTORY = 10;

const LANG_LINE: Record<string, string> = {
  ru: "Отвечай по-русски.",
  en: "Отвечай только по-английски (English), даже если факты ниже написаны по-русски.",
};

const BASE_PROMPT = `Ты — личный коуч в Telegram. О человеке известно только то, что есть в фактах ниже.
Сферы: сон, добавки и здоровье, финансы, учёба, свои проекты, привычки и образ жизни.

Стиль: прямо, по фактам и цифрам, без морали и без сюсюканья. {lang}
Коротко: 1–5 предложений, если не просят подробнее. Обычный текст, без заголовков и таблиц;
**жирным** — только главное. Эмодзи — не больше одного.
Обращайся на «ты» и без форм рода: «ложись», «пора спать», а не «готов/готова», «сделал/сделала».

Правила:
- Не давай медицинских советов по дозировкам добавок.
- Курсы с запретом ИИ (см. факты): не решай, не подсказывай и не проверяй их задания — коротко откажи.
  Курсы «только своя работа»: объясняй и разбирай тему, но не пиши готовое решение для сдачи.
- Штрафы и награды назначает система. Не придумывай новые и не рассказывай заранее, какие бывают.
- Не выдумывай данные: в фактах ниже сводка, подробности бери инструментами.
- Если сейчас после отбоя — главный совет: спать, разговор завтра.`;

const REDUCED = `
Урезанный режим: у пользователя открытый долг (штраф). Отвечай максимум 1–2 предложениями,
сначала напомни про долг, без развёрнутых советов, пока долг не закрыт.`;

async function facts(user: User): Promise<{ text: string; reduced: boolean }> {
  const now = localNow(user.tz);
  const { bed, wake } = user.settings.sleep;

  // Все запросы независимы — параллельно, это заметно быстрее.
  const [sToday, sYesterday, suppsRes, logsRes, money, debts, study, career, habits, body, links, meals] = await Promise.all([
    getSleep(user.id, now.date),
    getSleep(user.id, shiftDate(now.date, -1)),
    db.from("supplements").select("id,name").eq("user_id", user.id).eq("active", true),
    db.from("supplement_logs").select("supplement_id,status").eq("user_id", user.id)
      .eq("local_date", now.date),
    financeFacts(user),
    openDebts(user.id),
    studyFacts(user),
    careerFacts(user),
    habitFacts(user),
    bodyFacts(user),
    linkFacts(user),
    mealFacts(user),
  ]);
  const supps = check(suppsRes) as { id: string; name: string }[];
  const logs = check(logsRes) as { supplement_id: string; status: string }[];

  const lines: string[] = [];
  const name = (user.settings.profile?.name || user.first_name || "").trim();
  if (name) lines.push(t(user, "Имя человека: {name}. Обращайся по имени, но не в каждом сообщении.", { name }));
  const about = user.settings.profile?.about?.trim();
  if (about) lines.push(t(user, "О человеке (с его слов): {about}", { about }));
  lines.push(
    t(user, "Сейчас: {date}, {time} ({tz}). Цель сна: {bed}–{wake}.", {
      date: now.date,
      time: now.hhmm,
      tz: user.tz,
      bed,
      wake,
    }) + (isQuiet(now.minutes, bed, wake) ? " " + t(user, "Сейчас после отбоя.") : ""),
  );

  const s = sToday ?? sYesterday;
  lines.push(
    s
      ? t(user, "Последняя ночь ({date}): засыпание {bed}, подъём {wake}, сон {total}.", {
        date: s.night_date,
        bed: fmtTime(new Date(s.bed_at), user.tz),
        wake: fmtTime(new Date(s.wake_at), user.tz),
        total: fmtDuration(user, s.asleep_min),
      })
      : t(user, "Данных сна нет."),
  );
  lines.push(t(user, "Ночей подряд в режиме: {n}.", { n: Number(user.state.sleep_streak ?? 0) }));

  const st = new Map(logs.map((l) => [l.supplement_id, l.status]));
  const mark = (s?: string) =>
    s === "taken" ? t(user, "выпито") : s === "skipped" ? t(user, "пропуск") : t(user, "не отмечено");
  lines.push(
    t(user, "Добавки сегодня: ") +
      supps.map((x) => `${x.name} — ${mark(st.get(x.id))}`).join("; ") + ".",
  );

  lines.push(...money);

  lines.push(...study, ...career, ...habits, ...body, ...meals);
  // Связи между модулями: коуч должен опираться на посчитанное, а не угадывать.
  if (links.length) lines.push(t(user, "Замечено по истории: ") + links.join(" "));
  if (debts.length) {
    lines.push(t(user, "Открытые долги: {list}.", { list: debts.map((d) => d.title).join("; ") }));
  }
  if (user.state.cheat_date === now.date) lines.push(t(user, "Сегодня активирован чит-вечер."));

  return { text: lines.join("\n"), reduced: debts.length > 0 };
}

/** Markdown от модели → безопасный HTML для Telegram. */
export function toTelegramHtml(md: string): string {
  return esc(md)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .slice(0, 4000);
}

export async function coachReply(user: User, text: string): Promise<AgentResult> {
  if (!(await takeAi(user))) return { text: limitText(user) };

  const [inserted, historyRes, { text: factText, reduced }] = await Promise.all([
    db.from("messages").insert({ user_id: user.id, role: "user", text }),
    db.from("messages").select("role,text").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(HISTORY),
    facts(user),
  ]);
  check(inserted);
  // История без только что записанного сообщения (гонка) — его добавляем явно.
  const history = (check(historyRes) as { role: "user" | "coach"; text: string }[]).reverse();
  if (history[history.length - 1]?.text !== text || history[history.length - 1]?.role !== "user") {
    history.push({ role: "user", text });
  }
  const base = BASE_PROMPT.replace("{lang}", LANG_LINE[lang(user)]);
  const system = `${base}${reduced ? REDUCED : ""}\n${AGENT_PROMPT}\n\nФакты:\n${factText}`;
  const turns: Turn[] = history.map((m) => ({
    role: m.role === "coach" ? "model" : "user",
    text: m.text,
  }));

  let out: AgentResult;
  try {
    out = await agentReply(user, system, turns);
  } catch (e) {
    console.error("coach", e);
    if (e instanceof GeminiError && e.kind === "nokey") return { text: t(user, "Коуч ещё не подключён (нет ключа Gemini).") };
    if (e instanceof GeminiError && e.kind === "rate") return { text: t(user, "Gemini перегружен (лимит бесплатного тарифа). Попробуй через минуту.") };
    return { text: t(user, "Коуч сейчас недоступен. Траты и отметки работают как обычно.") };
  }
  if (!out.text) return { text: t(user, "Коуч сейчас недоступен. Траты и отметки работают как обычно.") };

  check(await db.from("messages").insert({ user_id: user.id, role: "coach", text: out.text }));
  return { text: toTelegramHtml(out.text), keyboard: out.keyboard };
}

/** Короткий вывод к сводке. Без ключа/при ошибке — пусто, сводка уйдёт и так. */
async function takeaway(user: User, stats: string, task: string): Promise<string> {
  if (!(await takeAi(user))) return "";
  try {
    const out = await generate(
      `${BASE_PROMPT.replace("{lang}", LANG_LINE[lang(user)])}\n\nЗадача: ${task}`,
      [{ role: "user", text: stats.replace(/<[^>]+>/g, "") }],
    );
    return toTelegramHtml(out);
  } catch (e) {
    console.warn("takeaway", e);
    return "";
  }
}

export const weeklyTakeaway = (user: User, stats: string) =>
  takeaway(user, stats, "по недельной сводке дай 2–3 предложения вывода и одно конкретное действие на следующую неделю.");

/** Месяц — о направлении, а не о мелочах: просим смотреть на сдвиги, а не на цифры. */
export const monthTakeaway = (user: User, stats: string) =>
  takeaway(
    user,
    stats,
    "по итогам месяца дай 3–4 предложения: что сдвинулось к лучшему, что просело и одна главная цель на следующий месяц. Опирайся на сравнение с прошлым месяцем, а не на абсолютные цифры.",
  );
