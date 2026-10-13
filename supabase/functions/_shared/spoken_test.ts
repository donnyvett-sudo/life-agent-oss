import { assertEquals } from "jsr:@std/assert@1";
import { looksLikeMoney, parseSpoken } from "./spoken.ts";

const one = (t: string) => {
  const r = parseSpoken(t);
  assertEquals(r.length, 1, t);
  return r[0];
};

Deno.test("spoken: typical phrases", () => {
  assertEquals(one("Потратил 35 юаней на обед"), { kind: "expense", amount: 35, currency: "CNY", note: "обед", daysAgo: 0 });
  assertEquals(one("такси 18").note, "такси");
  assertEquals(one("Заплатил 1500 тенге за подписку").currency, "KZT");
  assertEquals(one("Заплатил 1500 тенге за подписку").note, "подписку");
  assertEquals(one("кофе в лакин 25,5").amount, 25.5);
  assertEquals(one("кофе в лакин 25,5").note, "кофе лакин");
  assertEquals(one("20 долларов ChatGPT").currency, "USD");
  assertEquals(one("Вчера потратил 40 на продукты").daysAgo, 1);
});

Deno.test("spoken: income", () => {
  const e = one("Получил стипендию 3000 тенге");
  assertEquals([e.kind, e.currency, e.note], ["income", "KZT", "стипендию"]);
  assertEquals(one("пришло 500 от мамы").kind, "income");
});

Deno.test("spoken: пополнение и деньги от людей", () => {
  assertEquals(one("мне скинули 5000 тенге от мамы").kind, "income");
  assertEquals(one("мне скинули 5000 тенге от мамы").note, "мамы");
  assertEquals(one("пополнил счёт на 20000 тенге").kind, "income");
  assertEquals(one("прислали 300 юаней").kind, "income");
  assertEquals(looksLikeMoney("мне скинули 5000 тенге"), true);
  assertEquals(looksLikeMoney("пополнил счёт на 20000"), true);
});

Deno.test("spoken: several entries", () => {
  const r = parseSpoken("такси 18 и кофе 25, обед 35");
  assertEquals(r.map((e) => [e.note, e.amount]), [["такси", 18], ["кофе", 25], ["обед", 35]]);
  // «и» без второго числа — одна запись.
  assertEquals(parseSpoken("хлеб и молоко 12").length, 1);
});

Deno.test("spoken: not money", () => {
  assertEquals(parseSpoken("привет как дела"), []);
  assertEquals(looksLikeMoney("лёг вчера в 1"), false);
  assertEquals(looksLikeMoney("потратил 35 на обед"), true);
});

Deno.test("spoken: валюта пользователя по умолчанию", () => {
  assertEquals(parseSpoken("потратил 35 на обед", "KZT")[0].currency, "KZT");
  assertEquals(parseSpoken("потратил 35 юаней на обед", "KZT")[0].currency, "CNY");
});
