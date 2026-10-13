import { assertEquals } from "jsr:@std/assert@1";
import { bones, levenshtein, matchKnown, skel, translateWords } from "./naming.ts";

Deno.test("скелет сводит кириллицу и латиницу", () => {
  assertEquals(skel("Магнолия"), skel("Magnolia"));
  assertEquals(skel("макдональдс"), skel("McDonalds"));
  assertEquals(skel("Метро"), skel("Metro"));
});

Deno.test("разные названия не склеиваются", () => {
  assertEquals(skel("Mom") === skel("Dad"), false);
  assertEquals(skel("Bus") === skel("Bike"), false);
});

Deno.test("расстояние Левенштейна", () => {
  assertEquals(levenshtein("kofe", "kofe"), 0);
  assertEquals(levenshtein("makdonalds", "mkdonalds"), 1);
  assertEquals(levenshtein("taksi", "taxi"), 2);
});

Deno.test("обычные слова уходят в английский", () => {
  assertEquals(translateWords("чай"), "Tea");
  assertEquals(translateWords("обед"), "Lunch");
  assertEquals(translateWords("такси"), "Taxi");
  assertEquals(translateWords("снеки"), "Snacks");
  // Нишевое название остаётся как есть.
  assertEquals(translateWords("апа дамеш"), "апа дамеш");
});

Deno.test("совпадение с историей", () => {
  const known = ["Magnolia", "McDonalds", "Metro", "Luckin", "Snacks"]
    .map((canonical) => ({ skel: skel(canonical), canonical }));

  assertEquals(matchKnown("магнолия", known), { canonical: "Magnolia", sure: true });
  assertEquals(matchKnown("Макдональдс", known), { canonical: "McDonalds", sure: true });
  assertEquals(matchKnown("метро", known), { canonical: "Metro", sure: true });
  assertEquals(matchKnown("снекс", known)?.canonical, "Snacks");
  // «Лакин» и «Luckin» — одна буква разницы, узнаём с оговоркой.
  assertEquals(matchKnown("Лакин", known)?.canonical, "Luckin");
  assertEquals(matchKnown("Апа Дамеш", known), null);
});

Deno.test("только согласные — крайний случай", () => {
  assertEquals(bones("Snacks"), "snks");
  assertEquals(bones("снекс"), "snks");
});
