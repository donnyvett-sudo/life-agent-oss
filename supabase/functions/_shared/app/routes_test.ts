import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import type { User } from "../db.ts";
import { route, supplementFields } from "./routes.ts";
import { currency, HttpError, monthBounds, occurredAt, positive } from "./finance.ts";
import { habitRow } from "./habits.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const user = { id: ID, tz: "Asia/Shanghai" } as unknown as User;
const q = new URLSearchParams();

/** Ошибку с нужным кодом ищем по полю status: сообщение — для логов, код — для приложения. */
function status(fn: () => unknown): number {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 0;
}

Deno.test("route: незнакомый путь и чужой метод — 404, до базы дело не доходит", async () => {
  for (const [method, path] of [["GET", "/nope"], ["POST", "/today"], ["PUT", "/habits"]]) {
    const e = await assertRejects(() => route(user, method, path, q, {}));
    assertEquals((e as HttpError).status, 404);
  }
});

Deno.test("route: id в пути — только uuid", async () => {
  // Кривой id не должен уходить в запрос: postgres на нём падает с 500 вместо 404.
  for (const bad of ["/habits/123", "/habits/' or 1=1", `/habits/${ID}x`]) {
    const e = await assertRejects(() => route(user, "DELETE", bad, q, {}));
    assertEquals((e as HttpError).status, 404);
  }
});

Deno.test("supplementFields: новая добавка требует название", () => {
  assertEquals(status(() => supplementFields({}, false)), 400);
  assertEquals(status(() => supplementFields({ name: "   " }, false)), 400);
  assertEquals(supplementFields({ name: " Омега-3 " }, false), { name: "Омега-3", slot: "lunch" });
});

Deno.test("supplementFields: правка меняет только присланное", () => {
  assertEquals(supplementFields({ active: false }, true), { active: false });
  assertEquals(status(() => supplementFields({ slot: "night" }, true)), 400);
  assertEquals(status(() => supplementFields({ unitsPerPack: 30.5 }, true)), 400);
  assertEquals(status(() => supplementFields({ unitsPerIntake: 0 }, true)), 400);
  assertEquals(status(() => supplementFields({ unitsLeft: -1 }, true)), 400);
});

Deno.test("supplementFields: новый остаток снимает предупреждение о конце банки", () => {
  assertEquals(supplementFields({ unitsLeft: 60 }, true), { units_left: 60, low_stock_warned: false });
  // Банку можно и «забыть»: null — остаток не считаем.
  assertEquals(supplementFields({ unitsPerPack: null }, true), { units_per_pack: null });
});

Deno.test("positive и currency: подпускаем только осмысленные значения", () => {
  assertEquals(positive("35.456", "amount"), 35.46);
  for (const bad of [0, -5, "abc", 1e10]) assertEquals(status(() => positive(bad, "amount")), 400);
  assertEquals(currency("CNY"), "CNY");
  assertEquals(status(() => currency("BTC")), 400);
});

Deno.test("occurredAt: дата из формы — полдень по местному времени", () => {
  assertEquals(occurredAt(undefined, "Asia/Shanghai"), undefined);
  assertEquals(status(() => occurredAt("21.09.2026", "Asia/Shanghai")), 400);
  // 2026-09-21 в Шанхае начинается в 16:00 UTC предыдущего дня, полдень — в 04:00 UTC.
  assertEquals(occurredAt("2026-09-21", "Asia/Shanghai"), "2026-09-21T04:00:00.000Z");
});

Deno.test("monthBounds: соседние месяцы через границу года", () => {
  const dec = monthBounds("2026-12", "Asia/Shanghai");
  assertEquals([dec.prev, dec.next], ["2026-11", "2027-01"]);
  const jan = monthBounds("2026-01", "Asia/Shanghai");
  assertEquals([jan.prev, jan.next], ["2025-12", "2026-02"]);
  assertEquals(jan.from.toISOString(), "2025-12-31T16:00:00.000Z");
});

Deno.test("habitRow: значения по умолчанию — ежедневная, норма 1", () => {
  assertEquals(habitRow(user, { title: " Зал " }), {
    user_id: ID,
    title: "Зал",
    kind: "daily",
    target: 1,
    days: null,
    note: null,
    is_hard: false,
    active: true,
    sort: 0,
  });
});

Deno.test("habitRow: дни недели только у ежедневной, без повторов и мусора", () => {
  assertEquals(habitRow(user, { title: "Стирка", days: [0, 7, 3, 3, -1] }).days, [0, 3]);
  assertEquals(habitRow(user, { title: "Зал", kind: "weekly", target: 3, days: [1, 2] }).days, null);
});

Deno.test("habitRow: норма в разумных пределах, название и заметка обрезаются", () => {
  assertEquals(habitRow(user, { title: "x", target: 99 }).target, 30);
  assertEquals(habitRow(user, { title: "x", target: 0 }).target, 1);
  assertEquals(habitRow(user, { title: "я".repeat(200) }).title.length, 120);
  assertEquals(habitRow(user, { title: "x", note: " ".repeat(3) }).note, null);
});

Deno.test("habitRow: без названия и с неизвестным видом не записываем", () => {
  assertThrows(() => habitRow(user, {}), HttpError);
  assertEquals(status(() => habitRow(user, { title: "x", kind: "monthly" })), 400);
});
