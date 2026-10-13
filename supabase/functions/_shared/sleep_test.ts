import { assertEquals } from "jsr:@std/assert@1";
import { mainNights, parseManualSleep, parseSamples, stageOf, summarize, summarizeAll } from "./sleep.ts";

Deno.test("stageOf ru/en", () => {
  assertEquals(stageOf("Asleep Core"), "core");
  assertEquals(stageOf("Глубокий сон"), "deep");
  assertEquals(stageOf("Быстрый сон"), "rem");
  assertEquals(stageOf("Бодрствование"), "awake");
  assertEquals(stageOf("В кровати"), "inbed");
  assertEquals(stageOf("Сон"), "asleep");
});

Deno.test("summarize: main block, duplicates, nap ignored", () => {
  const text = [
    "2026-09-17T15:00:00+08:00;2026-09-17T15:40:00+08:00;Asleep Core", // дневной сон
    "2026-09-18T01:40:00+08:00;2026-09-18T03:00:00+08:00;Asleep Core",
    "2026-09-18T03:00:00+08:00;2026-09-18T04:00:00+08:00;Asleep Deep",
    "2026-09-18T04:00:00+08:00;2026-09-18T04:10:00+08:00;Awake",
    "2026-09-18T04:10:00+08:00;2026-09-18T07:00:00+08:00;Asleep REM",
    "2026-09-18T01:40:00+08:00;2026-09-18T04:00:00+08:00;Asleep", // дубль с телефона
  ].join("\n");
  const s = summarize(parseSamples({ text }))!;
  assertEquals(s.bed_at.toISOString(), "2026-09-17T17:40:00.000Z");
  assertEquals(s.wake_at.toISOString(), "2026-09-17T23:00:00.000Z");
  assertEquals(s.asleep_min, 310);
  assertEquals(s.deep_min, 60);
  assertEquals(s.awake_min, 10);
});

Deno.test("summarizeAll: две ночи, берём последнюю, а не самую длинную", () => {
  const text = [
    "2026-09-21T03:20:00+08:00;2026-09-21T11:20:00+08:00;Asleep Core", // вчера, 8 ч
    "2026-09-22T02:00:00+08:00;2026-09-22T07:30:00+08:00;Asleep Core", // сегодня, 5 ч 30 м
    "2026-09-22T13:00:00+08:00;2026-09-22T14:00:00+08:00;Asleep Core", // дневной сон
  ].join("\n");
  const all = summarizeAll(parseSamples({ text }));
  assertEquals(all.length, 2);
  assertEquals(all.map((s) => s.asleep_min), [480, 330]);
  assertEquals(summarize(parseSamples({ text }))!.asleep_min, 330);
});

Deno.test("summarizeAll: короткая ночь не теряется", () => {
  const text = "2026-09-22T04:00:00+08:00;2026-09-22T06:00:00+08:00;Asleep Core";
  assertEquals(summarize(parseSamples({ text }))!.asleep_min, 120);
});

Deno.test("parseSamples: garbage skipped", () => {
  assertEquals(parseSamples({ text: "foo\n;;" }).length, 0);
  assertEquals(parseSamples(null).length, 0);
});

Deno.test("parseManualSleep: время и «вчера»", () => {
  assertEquals(parseManualSleep("00:10 08:40"), { bedMin: 10, wakeMin: 520, daysBack: 0 });
  assertEquals(parseManualSleep("вчера 23.40 7:00"), { bedMin: 1420, wakeMin: 420, daysBack: 1 });
  assertEquals(parseManualSleep("лёг в 1:05, встал в 9:30"), { bedMin: 65, wakeMin: 570, daysBack: 0 });
  assertEquals(parseManualSleep("08:40"), null);
  assertEquals(parseManualSleep("25:00 08:40"), null);
  assertEquals(parseManualSleep(""), null);
});

Deno.test("mainNights: дневной сон не вытесняет ночь той же даты", () => {
  const night = (bed: string, wake: string, min: number) => ({
    bed_at: new Date(bed),
    wake_at: new Date(wake),
    asleep_min: min,
    in_bed_min: null,
    deep_min: 0,
    rem_min: 0,
    core_min: 0,
    awake_min: 0,
  });
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const out = mainNights([
    night("2026-09-22T23:00:00Z", "2026-09-23T07:00:00Z", 480),
    night("2026-09-23T14:00:00Z", "2026-09-23T17:30:00Z", 210),
    night("2026-09-24T00:00:00Z", "2026-09-24T06:00:00Z", 360),
  ], dateOf);
  assertEquals(out.map((n) => n.asleep_min), [480, 360]);
});
