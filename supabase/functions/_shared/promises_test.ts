import { assertEquals } from "jsr:@std/assert@1";
import type { User } from "./db.ts";
import { inWizard, sleepTarget, streakOf, weekKey } from "./promises.ts";

Deno.test("цель сна — окно минус час, но не меньше пяти часов", () => {
  assertEquals(sleepTarget("23:30", "07:30"), 420);
  assertEquals(sleepTarget("01:00", "05:00"), 300);
});

Deno.test("серия считается до первого провала", () => {
  assertEquals(streakOf([{ status: "kept" }, { status: "kept" }, { status: "broken" }]), 2);
  assertEquals(streakOf([{ status: "broken" }, { status: "kept" }]), 0);
  assertEquals(streakOf([]), 0);
});

Deno.test("ключ недели — понедельник", () => {
  // Вето одно в неделю: у всех дней одной недели ключ совпадает.
  assertEquals(weekKey("UTC").length, 10);
  assertEquals(new Date(`${weekKey("Asia/Shanghai")}T00:00:00Z`).getUTCDay(), 1);
});

Deno.test("мастер активен, пока нет текста обещания", () => {
  const u = (state: Record<string, unknown>) => ({ state } as unknown as User);
  assertEquals(inWizard(u({})), false);
  assertEquals(inWizard(u({ promise: { to: "x" } })), true);
  assertEquals(inWizard(u({ promise: { to: "x", title: "бегать" } })), false);
});
