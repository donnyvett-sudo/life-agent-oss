import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://x");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
const { parseMeal, totals, scale, pickPhoto, mealCard, DEFAULT_TARGETS, parseEatText, applyEdit, resolveDishes, estimateTdee, normName } = await import("./food.ts");

const chicken = { name: "курица", grams: 180, kcal: 297, p: 47, f: 11, c: 0 };
const rice = { name: "рис", grams: 200, kcal: 260, p: 5, f: 1, c: 57 };

Deno.test("parseMeal: блюдо, скрытое масло, итог", () => {
  const m = parseMeal(JSON.stringify({
    not_food: false,
    title: "Курица с рисом",
    items: [chicken, rice],
    hidden_oil_kcal: 90,
    confidence: 0.7,
  }))!;
  assertEquals(m.items.length, 3);
  assertEquals(m.items[2].kcal, 90);
  assertEquals(totals(m.items).kcal, 297 + 260 + 90);
  assertEquals(m.confidence, 0.7);
});

Deno.test("parseMeal: не еда и мусор → null", () => {
  assertEquals(parseMeal('{"not_food":true,"title":"","items":[],"confidence":1}'), null);
  assertEquals(parseMeal("не json"), null);
  assertEquals(parseMeal('{"not_food":false,"items":[]}'), null);
});

Deno.test("parseMeal: ккал, не сходящиеся с БЖУ, исправляются по БЖУ", () => {
  const m = parseMeal({ items: [{ name: "х", grams: 100, kcal: 900, p: 10, f: 10, c: 10 }], confidence: 2 })!;
  assertEquals(m.items[0].kcal, 4 * 10 + 9 * 10 + 4 * 10);
  assertEquals(m.confidence, 1);
});

Deno.test("parseMeal: отрицательные и нечисловые значения обнуляются", () => {
  const m = parseMeal({ items: [{ name: "х", grams: -5, kcal: "abc", p: 1, f: 0, c: 0 }], confidence: 0.5 })!;
  assertEquals(m.items[0].grams, 0);
  assertEquals(m.items[0].kcal, 4);
});

Deno.test("scale: ½ и ×1.5 меняют граммы и КБЖУ вместе", () => {
  const half = scale([chicken, rice], 0.5);
  assertEquals(half[0].grams, 90);
  assertEquals(totals(half).kcal, Math.round(297 * 0.5) + Math.round(260 * 0.5));
  assertEquals(scale([rice], 1.5)[0].c, 85.5);
});

Deno.test("pickPhoto: берём превью около 800 px, а не самое большое", () => {
  assertEquals(pickPhoto([{ width: 90 }, { width: 320 }, { width: 800 }, { width: 1280 }]).width, 800);
  assertEquals(pickPhoto([{ width: 90 }, { width: 320 }]).width, 320);
});

Deno.test("mealCard: остаток за день и сверх цели", () => {
  // deno-lint-ignore no-explicit-any
  const user = { settings: { lang: "ru" } } as any;
  const meal = { id: "m1", title: "Обед", items: [chicken, rice], confidence: 0.8, status: "pending" };
  const day = { kcal: 557, protein: 52, fat: 12, carbs: 57 };
  const card = mealCard(user, meal, day, DEFAULT_TARGETS);
  assertEquals(card.text.includes("557 ккал"), true);
  assertEquals(card.text.includes("Осталось за день: 1693 ккал, белка 98 г"), true);
  assertEquals(card.keyboard[0].map((b) => b.callback_data), ["ml:ok:m1", "ml:half:m1", "ml:x15:m1", "ml:ed:m1", "ml:del:m1"]);
  const over = mealCard(user, { ...meal, status: "confirmed" }, { ...day, kcal: 2500 }, DEFAULT_TARGETS);
  assertEquals(over.text.includes("Сверх цели на 250 ккал"), true);
  assertEquals(over.keyboard[0].length, 4);
});

Deno.test("parseEatText: только явное «съел …» и /eat", () => {
  assertEquals(parseEatText("/eat 2 яйца и банан"), "2 яйца и банан");
  assertEquals(parseEatText("съел борщ"), "борщ");
  assertEquals(parseEatText("Пообедал рисом с курицей"), "рисом с курицей");
  assertEquals(parseEatText("поел"), null);
  assertEquals(parseEatText("елка стоит 50"), null);
  assertEquals(parseEatText("обед 35"), null);
});

Deno.test("applyEdit: граммы названной позиции, множитель, не понял → null", () => {
  const items = [chicken, rice];
  const a = applyEdit(items, "риса было 300 г")!;
  assertEquals(a[1].grams, 300);
  assertEquals(a[1].kcal, 390);
  assertEquals(a[0], chicken);
  assertEquals(applyEdit(items, "курицы 90г")![0].kcal, Math.round(297 / 2));
  assertEquals(applyEdit(items, "×2")![0].grams, 360);
  assertEquals(applyEdit(items, "половина")![1].grams, 100);
  // Название не опознано, позиций две — гадать нельзя.
  assertEquals(applyEdit(items, "было 300 г"), null);
  assertEquals(applyEdit(items, "он был вкусный"), null);
  // Одна позиция — граммы относятся к ней.
  assertEquals(applyEdit([rice], "250 г")![0].grams, 250);
});

Deno.test("resolveDishes: словарь без ИИ, неизвестное блюдо → null", () => {
  const dishes = [
    { name_norm: "рис", name: "Рис", grams: 200, kcal: 260, protein: 5, fat: 1, carbs: 57, uses: 3 },
    { name_norm: "борщ", name: "Борщ", grams: 300, kcal: 150, protein: 6, fat: 6, carbs: 18, uses: 2 },
  ];
  const m = resolveDishes("рис, 2 борщ", dishes)!;
  assertEquals(m.items.map((i) => [i.name, i.grams, i.kcal]), [["Рис", 200, 260], ["Борщ", 600, 300]]);
  assertEquals(resolveDishes("рис 100 г", dishes)!.items[0].kcal, 130);
  assertEquals(resolveDishes("борщ x1.5", dishes)!.items[0].grams, 450);
  assertEquals(resolveDishes("рис и пицца", dishes), null);
  assertEquals(resolveDishes("", dishes), null);
});

Deno.test("normName: регистр, ё, пунктуация", () => {
  assertEquals(normName("  Ёжик-Рис!! "), "ежик рис");
});

Deno.test("estimateTdee: достаточно данных и вес падает — расход выше калорий", () => {
  const days = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, kcal: 2000 }));
  // -0.1 кг в день ≈ -770 ккал/день дефицита.
  const w = Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-${String(i * 3 + 1).padStart(2, "0")}`, kg: 80 - 0.3 * i }));
  const r = estimateTdee(days, w)!;
  assertEquals(r.tdee, 2770);
  assertEquals(r.slopeKgPerWeek, -0.7);
  // Мало дней еды, мало взвешиваний или короткий отрезок — оценки нет.
  assertEquals(estimateTdee(days.slice(0, 5), w), null);
  assertEquals(estimateTdee(days, w.slice(0, 3)), null);
  assertEquals(estimateTdee(days, w.map((x, i) => ({ ...x, date: `2026-09-0${(i % 5) + 1}` }))), null);
});
