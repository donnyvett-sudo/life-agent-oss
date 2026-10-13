// Один счётчик на все обращения к Gemini: разговор, расшифровка голосовых, разбор
// фраз о деньгах, разбор образа, недельный вывод. Бесплатный тариф общий на всех,
// поэтому лимит считаем на человека в его сутках.
import { check, db, type User } from "./db.ts";
import { t } from "./i18n.ts";
import { localNow } from "./time.ts";

export const DAILY_AI = 15;

const usedToday = (user: User, today: string) =>
  user.state.ai_date === today ? Number(user.state.ai_count ?? 0) : 0;

/** Сколько обращений осталось сегодня. */
export function aiLeft(user: User): number {
  return Math.max(0, DAILY_AI - usedToday(user, localNow(user.tz).date));
}

/**
 * Занять одно обращение. false — лимит исчерпан, вызывать Gemini нельзя.
 * Считаем до вызова: лучше не потратить лимит зря, чем уйти в минус при сбое сети.
 */
export async function takeAi(user: User): Promise<boolean> {
  const today = localNow(user.tz).date;
  const used = usedToday(user, today);
  if (used >= DAILY_AI) return false;
  user.state = { ...user.state, ai_date: today, ai_count: used + 1 };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
  return true;
}

// Еда считается отдельно: фото обедов не должны съедать лимит коуча и голоса.
export const DAILY_MEAL_AI = 20;

const mealUsed = (user: User, today: string) =>
  user.state.meal_date === today ? Number(user.state.meal_count ?? 0) : 0;

/** Занять одно обращение к Gemini для еды. false — дневной лимит еды исчерпан. */
export async function takeMealAi(user: User): Promise<boolean> {
  const today = localNow(user.tz).date;
  const used = mealUsed(user, today);
  if (used >= DAILY_MEAL_AI) return false;
  user.state = { ...user.state, meal_date: today, meal_count: used + 1 };
  check(await db.from("users").update({ state: user.state }).eq("id", user.id));
  return true;
}

export const mealLimitText = (user: User): string =>
  t(user, "Лимит ИИ на еду на сегодня исчерпан ({n} обращений). Завтра снова; остальное работает как обычно.", {
    n: DAILY_MEAL_AI,
  });

export const limitText = (user: User): string =>
  t(user, "Лимит ИИ на сегодня исчерпан ({n} обращений). Записи, отметки и напоминания работают как обычно.", {
    n: DAILY_AI,
  });
