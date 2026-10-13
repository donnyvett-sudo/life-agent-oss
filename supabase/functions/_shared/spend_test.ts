import { assertEquals } from "jsr:@std/assert@1";
import { looksLikeMoneyQuestion, parsePeriod } from "./spend.ts";

const T = "2026-09-20";
const p = (s: string) => parsePeriod(s, T);

Deno.test("дни", () => {
  assertEquals(p("сколько я потратил вчера и сегодня"), { from: "2026-09-19", to: T, label: "вчера и сегодня" });
  assertEquals(p("траты за вчера")?.from, "2026-09-19");
  assertEquals(p("сколько ушло позавчера")?.to, "2026-09-18");
});

Deno.test("недели и месяцы", () => {
  assertEquals(p("сколько за неделю"), { from: "2026-09-14", to: T, label: "за неделю" });
  assertEquals(p("расходы в этом месяце")?.from, "2026-09-01");
  assertEquals(p("сколько потратил в прошлом месяце"), {
    from: "2026-08-01",
    to: "2026-08-31",
    label: "в прошлом месяце",
  });
  assertEquals(p("сколько было в июле")?.from, "2026-07-01");
  assertEquals(p("сколько в декабре")?.from, "2025-12-01");
  assertEquals(p("за 10 дней")?.from, "2026-09-11");
});

Deno.test("период не назван", () => {
  assertEquals(p("сколько я потратил"), null);
});

Deno.test("вопрос отличается от записи траты", () => {
  assertEquals(looksLikeMoneyQuestion("сколько я потратил вчера и сегодня и по категориям"), true);
  assertEquals(looksLikeMoneyQuestion("на что ушли деньги за неделю"), true);
  assertEquals(looksLikeMoneyQuestion("потратил 35 на обед"), false);
  assertEquals(looksLikeMoneyQuestion("вчера такси 18 и кофе 25"), false);
  assertEquals(looksLikeMoneyQuestion("как мне лучше спать"), false);
});
