import { assertEquals } from "jsr:@std/assert@1";
import { dayStreak, type Habit, habitLabel, type HabitLog, isDue, weekCount, weekStart } from "./habits.ts";

const habit = (p: Partial<Habit>): Habit => ({
  id: "h1",
  title: "Спорт",
  kind: "daily",
  target: 1,
  days: null,
  note: null,
  is_hard: false,
  active: true,
  sort: 0,
  ...p,
});
const logs = (...dates: string[]): HabitLog[] =>
  dates.map((local_date) => ({ habit_id: "h1", local_date, amount: 1 }));

Deno.test("weekStart: неделя от понедельника", () => {
  assertEquals(weekStart("2026-09-20"), "2026-09-14"); // воскресенье → к прошлому пн
  assertEquals(weekStart("2026-09-14"), "2026-09-14");
  assertEquals(weekStart("2026-09-17"), "2026-09-14");
});

Deno.test("isDue daily: дни недели и уже отмеченный день", () => {
  const h = habit({});
  assertEquals(isDue(h, [], "2026-09-18"), true);
  assertEquals(isDue(h, logs("2026-09-18"), "2026-09-18"), false);
  // 2026-09-18 — пятница (5), 2026-09-19 — суббота (6)
  const workdays = habit({ days: [1, 2, 3, 4, 5] });
  assertEquals(isDue(workdays, [], "2026-09-18"), true);
  assertEquals(isDue(workdays, [], "2026-09-19"), false);
});

Deno.test("isDue weekly: нужна, пока норма не закрыта", () => {
  const h = habit({ kind: "weekly", target: 3 });
  assertEquals(isDue(h, logs("2026-09-14", "2026-09-16"), "2026-09-18"), true);
  assertEquals(isDue(h, logs("2026-09-14", "2026-09-16", "2026-09-17"), "2026-09-18"), false);
  // прошлая неделя в норму этой не идёт
  assertEquals(isDue(h, logs("2026-09-09", "2026-09-10", "2026-09-11"), "2026-09-18"), true);
});

Deno.test("isDue interval: не реже чем раз в N дней", () => {
  const h = habit({ kind: "interval", target: 3, title: "Позвонить домой" });
  assertEquals(isDue(h, [], "2026-09-18"), true);
  assertEquals(isDue(h, logs("2026-09-16"), "2026-09-18"), false);
  assertEquals(isDue(h, logs("2026-09-15"), "2026-09-18"), true);
});

Deno.test("weekCount считает только текущую неделю", () => {
  const h = habit({ kind: "weekly", target: 3 });
  assertEquals(weekCount(logs("2026-09-13", "2026-09-14", "2026-09-17"), h, "2026-09-18"), 2);
});

Deno.test("dayStreak: пустое сегодня серию не рвёт", () => {
  const h = habit({});
  assertEquals(dayStreak(h, logs("2026-09-16", "2026-09-17"), "2026-09-18"), 2);
  assertEquals(dayStreak(h, logs("2026-09-16", "2026-09-17", "2026-09-18"), "2026-09-18"), 3);
  assertEquals(dayStreak(h, logs("2026-09-15", "2026-09-17"), "2026-09-18"), 1);
  assertEquals(dayStreak(h, logs("2026-09-14"), "2026-09-18"), 0);
  // недельные и «по дням» серией в днях не меряются
  assertEquals(dayStreak(habit({ kind: "weekly" }), logs("2026-09-17"), "2026-09-18"), 0);
});

Deno.test("habitLabel", () => {
  assertEquals(habitLabel(habit({})), "каждый день");
  assertEquals(habitLabel(habit({ days: [1, 3] })), "по дням: пн, ср");
  assertEquals(habitLabel(habit({ kind: "weekly", target: 3 })), "3 раза в неделю");
  assertEquals(habitLabel(habit({ kind: "interval", target: 3 })), "не реже чем раз в 3 дн.");
});
