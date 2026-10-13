import { assertEquals } from "jsr:@std/assert@1";
import { isLunch, parseEntry } from "./parse.ts";

Deno.test("parseEntry: expenses", () => {
  assertEquals(parseEntry("обед 35"), { kind: "expense", note: "обед", amount: 35, currency: "CNY" });
  assertEquals(parseEntry("такси 18,5")?.amount, 18.5);
  assertEquals(parseEntry("обед 45 тенге")?.currency, "KZT");
  assertEquals(parseEntry("обед 45тг")?.currency, "KZT");
  assertEquals(parseEntry("35 обед")?.note, "обед");
  assertEquals(parseEntry("20$ подписка")?.currency, "USD");
  assertEquals(parseEntry("$20 подписка")?.amount, 20);
  assertEquals(parseEntry("подписка 20 $")?.currency, "USD");
});

Deno.test("parseEntry: income", () => {
  assertEquals(parseEntry("+3000 стипендия")?.kind, "income");
  assertEquals(parseEntry("стипендия 3000")?.kind, "income");
  assertEquals(parseEntry("+50 долг вернули")?.note, "долг вернули");
});

Deno.test("parseEntry: пополнение и приход", () => {
  // Глагол прихода съедается: название записи — счёт или источник, а не «пополнил».
  assertEquals(parseEntry("пополнил Kaspi на 20000"), {
    kind: "income",
    note: "Kaspi",
    amount: 20000,
    currency: "CNY",
  });
  assertEquals(parseEntry("закинул на карту 5000 тенге")?.kind, "income");
  assertEquals(parseEntry("вернули долг 2000")?.note, "долг");
  assertEquals(parseEntry("вернули долг 2000")?.kind, "income");
  assertEquals(parseEntry("скинули 500 юаней")?.kind, "income");
  // «Я вернул долг» — трата: приходом считаем только «вернули».
  assertEquals(parseEntry("вернул долг 2000")?.kind, "expense");
});

Deno.test("parseEntry: not an entry", () => {
  assertEquals(parseEntry("лёг вчера поздно в 1"), null);
  // Дату понимает только живой разбор — там она станет daysAgo, а не частью названия.
  assertEquals(parseEntry("вчера обед 35"), null);
  assertEquals(parseEntry("в 22 часа"), null);
  assertEquals(parseEntry("привет"), null);
});

Deno.test("isLunch", () => {
  assertEquals(isLunch(parseEntry("обед 35")!, 9 * 60), true);
  assertEquals(isLunch(parseEntry("кафе 30")!, 12 * 60), true);
  assertEquals(isLunch(parseEntry("кафе 30")!, 19 * 60), false);
  assertEquals(isLunch(parseEntry("такси 18")!, 12 * 60), false);
  assertEquals(isLunch(parseEntry("+35 обед")!, 12 * 60), false);
});

Deno.test("parseEntry: валюта пользователя по умолчанию", () => {
  assertEquals(parseEntry("обед 35", "KZT")?.currency, "KZT");
  // Явная валюта в тексте сильнее настройки.
  assertEquals(parseEntry("обед 35 юаней", "KZT")?.currency, "CNY");
  assertEquals(parseEntry("20$ подписка", "KZT")?.currency, "USD");
  assertEquals(parseEntry("обед 35")?.currency, "CNY");
});
