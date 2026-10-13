import { assertEquals } from "jsr:@std/assert@1";
import { type DayRow, findLinks } from "./links.ts";

const day = (i: number, p: Partial<DayRow> = {}): DayRow => ({
  date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`,
  sleepMin: 450,
  bedDiff: 0,
  nextBedDiff: 0,
  spend: 100,
  focus: 60,
  cards: 20,
  habits: 2,
  commits: 5,
  ...p,
});

/** Восемь коротких ночей с большими тратами против восьми обычных. */
const sleepVsSpend = () => [
  ...Array.from({ length: 8 }, (_, i) => day(i, { sleepMin: 330, spend: 200 })),
  ...Array.from({ length: 8 }, (_, i) => day(i + 8, { sleepMin: 470, spend: 100 })),
];

Deno.test("findLinks: после коротких ночей траты выше", () => {
  const links = findLinks(sleepVsSpend());
  const spend = links.find((l) => l.kind === "sleep_spend");
  assertEquals(spend?.pct, 100);
  assertEquals(spend?.days, 8);
});

Deno.test("findLinks: мало дней — не связь", () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => day(i, { sleepMin: 330, spend: 200 })),
    ...Array.from({ length: 12 }, (_, i) => day(i + 3, { sleepMin: 470, spend: 100 })),
  ];
  assertEquals(findLinks(rows).filter((l) => l.kind === "sleep_spend"), []);
});

Deno.test("findLinks: разница в пределах разброса не считается", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => day(i, { sleepMin: 330, spend: 105 })),
    ...Array.from({ length: 8 }, (_, i) => day(i + 8, { sleepMin: 470, spend: 100 })),
  ];
  assertEquals(findLinks(rows).filter((l) => l.kind === "sleep_spend"), []);
});

Deno.test("findLinks: ночи без данных пропускаем, а не считаем хорошими", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => day(i, { sleepMin: null, spend: 900 })),
    ...Array.from({ length: 8 }, (_, i) => day(i + 8, { sleepMin: 470, spend: 100 })),
  ];
  assertEquals(findLinks(rows).filter((l) => l.kind === "sleep_spend"), []);
});

Deno.test("findLinks: в дни с фокусом отбой раньше", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => day(i, { focus: 50, nextBedDiff: 10 })),
    ...Array.from({ length: 8 }, (_, i) => day(i + 8, { focus: 0, nextBedDiff: 80 })),
  ];
  const bed = findLinks(rows).find((l) => l.kind === "focus_bed");
  assertEquals(bed?.yes, 10);
  assertEquals(bed?.no, 80);
});

Deno.test("findLinks: сильная связь идёт первой", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => day(i, { sleepMin: 330, spend: 130, focus: 5 })),
    ...Array.from({ length: 8 }, (_, i) => day(i + 8, { sleepMin: 470, spend: 100, focus: 60 })),
  ];
  assertEquals(findLinks(rows)[0].kind, "sleep_focus");
});
