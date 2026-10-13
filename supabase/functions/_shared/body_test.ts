import { assertEquals } from "jsr:@std/assert@1";
import { parseBody, parseWeight } from "./body.ts";

const TODAY = "2026-09-22";

Deno.test("parseBody: одна запись из Shortcuts", () => {
  assertEquals(parseBody({ date: "2026-09-21", steps: 8432, weightKg: 71.4, restingHr: 58 }, TODAY), [
    { local_date: "2026-09-21", steps: 8432, weight_kg: 71.4, resting_hr: 58 },
  ]);
});

Deno.test("parseBody: без даты — сегодняшний день", () => {
  assertEquals(parseBody({ steps: "5 200" }, TODAY), [
    { local_date: TODAY, steps: 5200, weight_kg: null, resting_hr: null },
  ]);
});

Deno.test("parseBody: текстом, по строке на день", () => {
  const text = "2026-09-20;7100;71,8;60\n2026-09-21;8432;;58";
  assertEquals(parseBody({ text }, TODAY), [
    { local_date: "2026-09-20", steps: 7100, weight_kg: 71.8, resting_hr: 60 },
    { local_date: "2026-09-21", steps: 8432, weight_kg: null, resting_hr: 58 },
  ]);
});

Deno.test("parseBody: пустой день не записываем", () => {
  // День без данных — не день без движения: ноль шагов испортил бы среднее.
  assertEquals(parseBody({ date: "2026-09-21", steps: "", weightKg: "" }, TODAY), []);
  assertEquals(parseBody({ text: "\n\n" }, TODAY), []);
});

Deno.test("parseBody: невозможные значения отбрасываем, остальное берём", () => {
  assertEquals(parseBody({ date: "2026-09-21", steps: 8000, weightKg: 7, restingHr: 900 }, TODAY), [
    { local_date: "2026-09-21", steps: 8000, weight_kg: null, resting_hr: null },
  ]);
  assertEquals(parseBody({ date: "вчера", steps: 8000 }, TODAY), []);
});

Deno.test("parseBody: значения из «Здоровья» с разрядами и единицами", () => {
  // Запятая в «8,432» — разряды, в «71,4» — дробь: различаем по трём цифрам.
  assertEquals(parseBody({ steps: "8,432 steps", weightKg: "71,4 кг", restingHr: "58 BPM" }, TODAY), [
    { local_date: TODAY, steps: 8432, weight_kg: 71.4, resting_hr: 58 },
  ]);
  assertEquals(parseBody({ steps: "шаги" }, TODAY), []);
});

Deno.test("parseBody: список образцов вместо числа сводим сами", () => {
  // Так «Здоровье» отвечает, когда в команде не выставлено «Вычислить».
  assertEquals(
    parseBody({ steps: "4 200\n3 100\n1 132", restingHr: "56\n60", weightKg: "71,8\n71,4" }, TODAY),
    [{ local_date: TODAY, steps: 8432, weight_kg: 71.4, resting_hr: 58 }],
  );
});

Deno.test("parseBody: dayShift вместо даты — день считает сервер", () => {
  assertEquals(parseBody({ dayShift: -1, steps: 8432 }, TODAY)[0].local_date, "2026-09-21");
  // Вперёд и глубоко в прошлое не пускаем, мусор — это сегодня.
  assertEquals(parseBody({ dayShift: 5, steps: 8432 }, TODAY)[0].local_date, TODAY);
  assertEquals(parseBody({ dayShift: -90, steps: 8432 }, TODAY)[0].local_date, "2026-09-15");
  assertEquals(parseBody({ dayShift: "вчера", steps: 8432 }, TODAY)[0].local_date, TODAY);
  // Явная дата сильнее сдвига: так присылают задним числом.
  assertEquals(parseBody({ dayShift: -1, date: "2026-09-10", steps: 8432 }, TODAY)[0].local_date, "2026-09-10");
});

Deno.test("parseBody: повтор дня — побеждает последняя строка", () => {
  const text = "2026-09-21;7000;;\n2026-09-21;9000;;";
  assertEquals(parseBody({ text }, TODAY)[0].steps, 9000);
});

Deno.test("parseWeight: только короткая фраза про вес", () => {
  assertEquals(parseWeight("вес 71.4"), 71.4);
  assertEquals(parseWeight("Вешу 71,4 кг"), 71.4);
  assertEquals(parseWeight("weight 71"), 71);
  assertEquals(parseWeight("вес рюкзака 7"), null);
  assertEquals(parseWeight("вес 7"), null);
  assertEquals(parseWeight("сколько я вешу?"), null);
});
