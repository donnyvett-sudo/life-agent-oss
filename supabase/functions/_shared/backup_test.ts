import { assertEquals } from "jsr:@std/assert@1";
import { type Backup, transactionsCsv } from "./backup.ts";

const backup = (transactions: unknown[]): Backup => ({
  exportedAt: "2026-09-22T00:00:00.000Z",
  user: {},
  data: {
    accounts: [{ id: "a1", title: "Alipay" }],
    categories: [{ id: "c1", title: "Еда, кафе" }],
    transactions,
  },
});

Deno.test("transactionsCsv: шапка, порядок по дате и имена вместо id", () => {
  const csv = transactionsCsv(backup([
    {
      occurred_at: "2026-09-02T10:00:00Z",
      kind: "expense",
      amount: 18,
      currency: "CNY",
      amount_cny: 18,
      note: "Taxi",
      category_id: null,
      account_id: "a1",
    },
    {
      occurred_at: "2026-09-01T10:00:00Z",
      kind: "expense",
      amount: 35,
      currency: "CNY",
      amount_cny: 35,
      note: "Lunch",
      category_id: "c1",
      account_id: "a1",
    },
  ]));
  assertEquals(csv.split("\n"), [
    "date,kind,amount,currency,amount_cny,note,category,account",
    "2026-09-01T10:00:00Z,expense,35,CNY,35,Lunch,\"Еда, кафе\",Alipay",
    "2026-09-02T10:00:00Z,expense,18,CNY,18,Taxi,,Alipay",
  ]);
});

Deno.test("transactionsCsv: пустые значения и кавычки внутри заметки", () => {
  const csv = transactionsCsv(backup([{
    occurred_at: "2026-09-01T10:00:00Z",
    kind: "income",
    amount: 3000,
    currency: "CNY",
    amount_cny: null,
    note: 'Кафе "Весна"',
    category_id: null,
    account_id: null,
  }]));
  assertEquals(csv.split("\n")[1], '2026-09-01T10:00:00Z,income,3000,CNY,,"Кафе ""Весна""",,');
});
