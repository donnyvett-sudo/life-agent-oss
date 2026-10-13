import { assertEquals } from "jsr:@std/assert@1";
import { type Charge, detect } from "./subs.ts";

const charge = (date: string, amount: number, note: string, currency = "CNY"): Charge => ({
  date,
  amount,
  currency,
  note,
});

Deno.test("detect: ежемесячное списание с плавающей датой", () => {
  const subs = detect([
    charge("2026-06-03", 35.9, "PingAn"),
    charge("2026-07-02", 35.9, "PingAn"),
    charge("2026-08-04", 35.9, "PingAn"),
    charge("2026-09-03", 35.9, "PingAn"),
  ], "2026-09-22");
  assertEquals(subs.length, 1);
  assertEquals(subs[0].period, "month");
  assertEquals(subs[0].amount, 35.9);
  assertEquals(subs[0].count, 4);
  assertEquals(subs[0].next, "2026-10-03");
  assertEquals(subs[0].overdue, false);
});

Deno.test("detect: разовые покупки в одном месте подпиской не считаются", () => {
  const subs = detect([
    charge("2026-09-01", 35, "Lunch"),
    charge("2026-09-02", 42, "Lunch"),
    charge("2026-09-05", 38, "Lunch"),
    charge("2026-09-11", 40, "Lunch"),
  ], "2026-09-22");
  assertEquals(subs, []);
});

Deno.test("detect: годовая подписка считается по месяцам", () => {
  const subs = detect([
    charge("2024-02-10", 120, "iCloud", "USD"),
    charge("2025-02-11", 120, "iCloud", "USD"),
    charge("2026-02-10", 120, "iCloud", "USD"),
  ], "2026-09-22");
  assertEquals(subs.length, 1);
  assertEquals(subs[0].period, "year");
  assertEquals(subs[0].perMonth, 10);
});

Deno.test("detect: списание перестало приходить — помечаем", () => {
  const subs = detect([
    charge("2026-04-05", 25, "Spotify"),
    charge("2026-05-05", 25, "Spotify"),
    charge("2026-06-05", 25, "Spotify"),
  ], "2026-09-22");
  assertEquals(subs.length, 1);
  assertEquals(subs[0].overdue, true);
  assertEquals(subs[0].last, "2026-06-05");
});

Deno.test("detect: разные написания одного места — одна подписка", () => {
  const subs = detect([
    charge("2026-06-03", 60, "Мегого"),
    charge("2026-07-03", 60, "Megogo"),
    charge("2026-08-03", 60, "megogo"),
  ], "2026-09-22");
  assertEquals(subs.length, 1);
  assertEquals(subs[0].note, "megogo");
});
