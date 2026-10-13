import { assertEquals } from "jsr:@std/assert@1";
import { looksLikeEdit, parseEdit } from "./editbot.ts";

const p = (s: string) => parseEdit(s, "CNY");

Deno.test("сумма", () => {
  assertEquals(p("поменяй на 25")?.actions, [{ op: "amount", value: 25 }]);
  assertEquals(p("исправь сумму на 12.5")?.actions, [{ op: "amount", value: 12.5 }]);
  assertEquals(p("не 35, а 25")?.actions, [{ op: "amount", value: 25 }]);
});

Deno.test("название и категория", () => {
  assertEquals(p("назови это Magnolia")?.actions, [{ op: "note", value: "Magnolia" }]);
  assertEquals(p("это не такси, а автобус")?.actions, [{ op: "label", value: "автобус" }]);
  assertEquals(p("измени категорию на Транспорт")?.actions, [{ op: "category", value: "Транспорт" }]);
});

Deno.test("вид, валюта и дата", () => {
  assertEquals(p("это доход, поменяй")?.actions, [{ op: "kind", value: "income" }]);
  assertEquals(p("исправь, это тенге")?.actions, [{ op: "currency", value: "KZT" }]);
  assertEquals(p("исправь, это было вчера")?.actions, [{ op: "date", daysAgo: 1 }]);
});

Deno.test("удаление и адресация", () => {
  assertEquals(p("удали последнюю")?.actions, [{ op: "delete" }]);
  const t = p("поменяй вчерашний обед на 40");
  assertEquals(t?.target, { daysAgo: 1, note: "обед" });
  assertEquals(t?.actions, [{ op: "amount", value: 40 }]);
});

Deno.test("обычные фразы не считаются правкой", () => {
  assertEquals(looksLikeEdit("обед 35"), false);
  assertEquals(looksLikeEdit("как мне лучше спать"), false);
  assertEquals(p("такси 18"), null);
});
