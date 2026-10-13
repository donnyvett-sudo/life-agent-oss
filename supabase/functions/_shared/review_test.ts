import { assertEquals } from "jsr:@std/assert@1";
import { delta, monthName, monthRange, movers, prevMonth, seasonEndedWith, shiftMonth } from "./review.ts";

Deno.test("monthRange: длина месяца, включая високосный февраль", () => {
  assertEquals(monthRange("2026-09"), { from: "2026-09-01", to: "2026-09-30" });
  assertEquals(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assertEquals(monthRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
});

Deno.test("prevMonth и shiftMonth: через границу года", () => {
  assertEquals(prevMonth("2026-01"), "2025-12");
  assertEquals(shiftMonth("2026-01", -2), "2025-11");
  assertEquals(shiftMonth("2025-11", 3), "2026-02");
  assertEquals(monthName("2026-09"), "сентябрь");
});

Deno.test("seasonEndedWith: сезон закрывается каждым третьим месяцем", () => {
  assertEquals(seasonEndedWith("2026-02")?.months, ["2025-12", "2026-01", "2026-02"]);
  assertEquals(seasonEndedWith("2026-08")?.name, "лето");
  assertEquals(seasonEndedWith("2026-09"), null);
});

Deno.test("delta: мелкие колебания не показываем", () => {
  assertEquals(delta(120, 100), "+20 %");
  assertEquals(delta(80, 100), "−20 %");
  assertEquals(delta(102, 100), "");
  // Сравнивать не с чем — молчим, а не пишем «+100 %».
  assertEquals(delta(120, 0), "");
});

Deno.test("movers: мелкие категории не считаем выросшими", () => {
  const now: [string, number][] = [["Кафе", 1400], ["Такси", 120], ["Книги", 30]];
  const was: [string, number][] = [["Кафе", 900], ["Такси", 400], ["Книги", 3]];
  assertEquals(movers(now, was), [
    { title: "Такси", pct: -70, now: 120 },
    { title: "Кафе", pct: 56, now: 1400 },
  ]);
});
