import { assertEquals } from "jsr:@std/assert@1";
import { AGENT_PROMPT, AGENT_TOOLS, tableOf } from "./agent.ts";

const ID = "11111111-2222-3333-4444-555555555555";

Deno.test("tableOf: путь → таблица, id и действие", () => {
  assertEquals(tableOf("/transactions"), { table: "transactions", id: null, action: null });
  assertEquals(tableOf(`/transactions/${ID}`), { table: "transactions", id: ID, action: null });
  assertEquals(tableOf(`/supplements/${ID}/log`), { table: "supplements", id: ID, action: "/log" });
  assertEquals(tableOf(`/supplements/${ID}/refill?date=2026-09-21`), {
    table: "supplements",
    id: ID,
    action: "/refill",
  });
  assertEquals(tableOf(`/budgets/${ID}`), { table: "budgets", id: ID, action: null });
  assertEquals(tableOf("/finance?month=2026-09"), { table: null, id: null, action: null });
});

Deno.test("в подсказке модели описаны все пути, которые умеем отменять", () => {
  const paths = ["/transactions", "/transfers", "/accounts", "/categories", "/supplements", "/assignments", "/exams", "/projects", "/milestones", "/habits", "/budgets"];
  assertEquals(paths.filter((p) => !AGENT_PROMPT.includes(p)), []);
});

Deno.test("у инструментов схема, которую понимает Gemini", () => {
  assertEquals(AGENT_TOOLS.map((x) => x.name), ["api", "find"]);
  for (const tool of AGENT_TOOLS) {
    const p = tool.parameters as { type: string; properties: Record<string, unknown>; required: string[] };
    assertEquals(p.type, "object");
    assertEquals(Object.keys(p.properties).length > 0, true);
    // Обязательные поля должны существовать в схеме, иначе модель получит отказ API.
    assertEquals(p.required.filter((k) => !(k in p.properties)), []);
  }
});
