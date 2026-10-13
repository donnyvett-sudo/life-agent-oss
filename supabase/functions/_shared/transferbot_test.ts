import { assertEquals } from "jsr:@std/assert@1";
import type { Account } from "./finance.ts";
import { accountHint, looksLikeTransfer, matchAccount, parseTransfer } from "./transferbot.ts";

const acc = (title: string, currency: string): Account => ({
  id: title,
  title,
  currency: currency as Account["currency"],
  is_default: false,
  in_total: true,
  is_archived: false,
  sort: 0,
  opening_balance: 0,
});

const ACCOUNTS = [
  acc("WeChat Balance", "CNY"),
  acc("PingAn Bank", "CNY"),
  acc("Kaspi Balance", "KZT"),
  acc("bcc union pay", "KZT"),
  acc("Freedom Gorgeous", "KZT"),
  acc("Broker Account Freedom", "USD"),
];

Deno.test("перевод: две суммы, две валюты, два счёта", () => {
  const p = parseTransfer("Перекинул 50000 тенге с Каспи на вичат, получил 690 юаней")!;
  assertEquals(p.fromAmount, 50000);
  assertEquals(p.fromCurrency, "KZT");
  assertEquals(p.toAmount, 690);
  assertEquals(p.toCurrency, "CNY");
  assertEquals(p.fromHint, "Каспи");
  assertEquals(p.toHint, "вичат");
  assertEquals(p.daysAgo, 0);
});

Deno.test("перевод: разряды пробелом и вчерашняя дата", () => {
  const p = parseTransfer("вчера перевёл 50 000 тенге с каспия на пингане 690 юаней")!;
  assertEquals([p.fromAmount, p.toAmount, p.daysAgo], [50000, 690, 1]);
});

Deno.test("перевод: обмен валюты без названий счетов", () => {
  const p = parseTransfer("обменял 200 долларов на юани")!;
  assertEquals([p.fromAmount, p.fromCurrency, p.toCurrency], [200, "USD", "CNY"]);
  assertEquals([p.fromHint, p.toHint], [null, null]);
});

Deno.test("перевод: курс и комиссия — не суммы перевода", () => {
  const p = parseTransfer("перевёл 50000 тенге с каспи на вичат по курсу 72")!;
  assertEquals([p.fromAmount, p.toAmount], [50000, null]);
  assertEquals(parseTransfer("перевёл 50000 с каспи на вичат, комиссия 500")?.toAmount, null);
});

Deno.test("перевод: приход от человека переводом не считается", () => {
  assertEquals(looksLikeTransfer("мне скинули 5000 тенге"), false);
  assertEquals(looksLikeTransfer("пришло 500 от мамы"), false);
  assertEquals(parseTransfer("мне перевели 3000 тенге"), null);
});

Deno.test("перевод: правки и разговор не перехватываются", () => {
  assertEquals(parseTransfer("поменяй на 25"), null);
  assertEquals(parseTransfer("не 35, а 25"), null);
  assertEquals(parseTransfer("обед 35"), null);
  assertEquals(parseTransfer("переведи мне текст"), null);
  // Счёт не назван — «куда» взять неоткуда, запись уйдёт в обычный расход.
  assertEquals(parseTransfer("перевёл маме 5000 тенге")?.toHint, null);
});

Deno.test("счёт по куску названия", () => {
  const find = (h: string) => matchAccount(ACCOUNTS, h)?.title ?? null;
  assertEquals(find("каспи"), "Kaspi Balance");
  assertEquals(find("Каспия"), "Kaspi Balance");
  assertEquals(find("вичат"), "WeChat Balance");
  assertEquals(find("вичата"), "WeChat Balance");
  assertEquals(find("вечат"), "WeChat Balance");
  assertEquals(find("пинган"), "PingAn Bank");
  assertEquals(find("фридом"), "Freedom Gorgeous");
  assertEquals(find("юнион пэй"), "bcc union pay");
  assertEquals(find("сбербанк"), null);
});

Deno.test("счёт, названный в обычной фразе", () => {
  const paid = accountHint("обед 35 с вичата", ACCOUNTS);
  assertEquals(paid.account?.title, "WeChat Balance");
  // Хвост про счёт уходит из текста: название записи — «обед», а не «обед вичата».
  assertEquals(paid.text, "обед 35");
  assertEquals(accountHint("пополнил Kaspi на 20000", ACCOUNTS).account?.title, "Kaspi Balance");
  // Дата важнее счёта: такой хвост не режем.
  assertEquals(accountHint("обед 35 с вичата вчера", ACCOUNTS).text, "обед 35 с вичата вчера");
  // Обычная трата без счёта остаётся на счёте по умолчанию.
  assertEquals(accountHint("такси 18", ACCOUNTS).account, null);
  assertEquals(accountHint("кофе в лакин 25", ACCOUNTS).account, null);
  assertEquals(accountHint("обед 35 юаней", ACCOUNTS).account, null);
});

Deno.test("перевод: «скинул с ... на ...» — тоже перевод", () => {
  const p = parseTransfer("скинул с бцц на каспи 30000")!;
  assertEquals([p.fromHint, p.toHint, p.fromAmount], ["бцц", "каспи", 30000]);
  // А «скинули мне» — приход от человека, не перекладывание своих денег.
  assertEquals(parseTransfer("мне скинули 30000"), null);
});
