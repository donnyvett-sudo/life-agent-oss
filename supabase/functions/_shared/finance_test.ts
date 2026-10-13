import { assertEquals } from "jsr:@std/assert@1";
import { CATEGORY_DEFS, normalizeNote } from "./finance.ts";

const codeOf = (kind: string, note: string) =>
  CATEGORY_DEFS.find((d) => d.kind === kind && d.words?.test(note))?.code ?? "other";

Deno.test("normalizeNote", () => {
  assertEquals(normalizeNote("  Кофе + сэндвич x2 "), "кофе + сэндвич x");
  assertEquals(normalizeNote("Ёлка 2"), "елка");
});

Deno.test("dictionary categories", () => {
  assertEquals(codeOf("expense", "такси"), "transport");
  assertEquals(codeOf("expense", "обед"), "cafe");
  assertEquals(codeOf("expense", "столовая"), "canteen");
  assertEquals(codeOf("expense", "вода"), "groceries");
  assertEquals(codeOf("expense", "подписка"), "subscriptions");
  assertEquals(codeOf("expense", "что-то"), "other");
  assertEquals(codeOf("income", "стипендия"), "salary");
  assertEquals(codeOf("income", "мама"), "allowance");
});

Deno.test("every Money Manager category is mapped", () => {
  const mm = ["Eating out", "Groceries", "Home", "Health", "Transportation", "Leisure", "Study", "Communications",
    "Travel", "Needed Stuff to Buy", "Subscriptions", "Canteen", "Investment", "Gifts", "Look", "Workout", ""];
  for (const t of mm) assertEquals(Boolean(CATEGORY_DEFS.find((d) => d.kind === "expense" && d.mm?.includes(t))), true, t);
});

Deno.test("cyrillic word boundaries", () => {
  assertEquals(codeOf("expense", "барбер"), "look");
  assertEquals(codeOf("expense", "бар"), "leisure");
  assertEquals(codeOf("income", "зп"), "salary");
});
