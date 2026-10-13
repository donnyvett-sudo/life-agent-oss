import { assertEquals } from "jsr:@std/assert@1";
import { isQuiet, localNow } from "./time.ts";

Deno.test("localNow Shanghai", () => {
  const n = localNow("Asia/Shanghai", new Date("2026-09-18T16:30:00Z"));
  assertEquals(n, { date: "2026-09-19", hhmm: "00:30", minutes: 30, dow: 6 });
});

Deno.test("isQuiet", () => {
  assertEquals(isQuiet(23 * 60 + 5, "23:00", "07:00"), true);
  assertEquals(isQuiet(6 * 60, "23:00", "07:00"), true);
  assertEquals(isQuiet(22 * 60 + 45, "23:00", "07:00"), false);
  assertEquals(isQuiet(7 * 60, "23:00", "07:00"), false);
});
