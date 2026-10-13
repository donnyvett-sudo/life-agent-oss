import { assertEquals } from "jsr:@std/assert@1";
import { parseBudget } from "./budget.ts";

Deno.test("parseBudget: категория и сумма", () => {
  assertEquals(parseBudget("Еда 1500"), { name: "Еда", amount: 1500 });
  assertEquals(parseBudget("  транспорт  300,5 "), { name: "транспорт", amount: 300.5 });
  assertEquals(parseBudget("на кафе 400"), { name: "кафе", amount: 400 });
});

Deno.test("parseBudget: общий лимит", () => {
  assertEquals(parseBudget("всего 6000"), { name: null, amount: 6000 });
  assertEquals(parseBudget("total 6000"), { name: null, amount: 6000 });
  assertEquals(parseBudget("6000"), { name: null, amount: 6000 });
});

Deno.test("parseBudget: ноль снимает лимит, мусор не проходит", () => {
  assertEquals(parseBudget("Еда 0"), { name: "Еда", amount: 0 });
  assertEquals(parseBudget("Еда"), null);
  assertEquals(parseBudget(""), null);
});
