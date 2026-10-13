import { assertEquals } from "jsr:@std/assert@1";
import { clockDiff, dayBounds } from "./time.ts";

// judgeNight тянет db.ts (env) — проверяем чистую арифметику, на которой он стоит.
Deno.test("clockDiff across midnight", () => {
  assertEquals(clockDiff(100, 23 * 60), 160); // 01:40 vs 23:00
  assertEquals(clockDiff(22 * 60 + 30, 23 * 60), -30);
});

Deno.test("dayBounds Shanghai", () => {
  const { from, to } = dayBounds("2026-09-18", "Asia/Shanghai");
  assertEquals(from.toISOString(), "2026-09-17T16:00:00.000Z");
  assertEquals(to.toISOString(), "2026-09-18T16:00:00.000Z");
});

import { toTelegramHtml } from "./chat.ts";
Deno.test("toTelegramHtml", () => {
  assertEquals(toTelegramHtml("**Спать.** a<b\n* пункт"), "<b>Спать.</b> a&lt;b\n• пункт");
});
