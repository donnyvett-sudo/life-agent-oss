import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type Card,
  MAX_NEW,
  MAX_REVIEWS,
  nextBox,
  parseCardInput,
  parseFilled,
  parseSituations,
  pickDistractors,
  pickSession,
  sayable,
  sessionTime,
  shadowTrack,
  silence,
  splitCardInput,
} from "./cards.ts";

const TODAY = "2026-09-29";
let n = 0;
const card = (p: Partial<Card>): Card => ({
  id: `c${n++}`, deck: "chinese1", front: "上车", reading: null, meaning: "m", example: null,
  box: 1, next_review: TODAY, status: "learning", intro_order: null, audio_file_id: null, ...p,
});

Deno.test("pickSession: не больше 15 повторений, самые давние первыми", () => {
  const due = Array.from({ length: 40 }, (_, i) => card({ next_review: `2026-09-${String(28 - (i % 20)).padStart(2, "0")}` }));
  const { reviews } = pickSession([...due, card({ next_review: "2026-09-30" })], TODAY);
  assertEquals(reviews.length, MAX_REVIEWS);
  assertEquals(reviews[0].next_review, "2026-09-09");
  assert(reviews.every((c, i) => i === 0 || reviews[i - 1].next_review <= c.next_review));
  assert(reviews.every((c) => c.next_review <= TODAY));
});

Deno.test("pickSession: 5 новых по порядку ввода, без порядка — в конце", () => {
  const fresh = [7, 3, 1, 9, 2, 5].map((o) => card({ status: "new", intro_order: o, front: `n${o}` }));
  const { fresh: got } = pickSession([card({ status: "new", front: "late" }), ...fresh], TODAY);
  assertEquals(got.length, MAX_NEW);
  assertEquals(got.map((c) => c.front), ["n1", "n2", "n3", "n5", "n7"]);
  // Новые — не повторения, даже если дата повторения прошла.
  assertEquals(pickSession(fresh, TODAY).reviews, []);
});

Deno.test("pickSession: архив не показывается", () => {
  const got = pickSession([
    card({ status: "archived" }),
    card({ status: "archived", next_review: "2026-01-01" }),
  ], TODAY);
  assertEquals(got, { reviews: [], fresh: [] });
});

Deno.test("nextBox: верно — коробка выше, ошибка — в первую", () => {
  assertEquals(nextBox(1, true, TODAY), { box: 2, next: "2026-10-02" });
  assertEquals(nextBox(5, true, TODAY), { box: 5, next: "2026-10-29" });
  assertEquals(nextBox(4, false, TODAY), { box: 1, next: "2026-09-30" });
});

Deno.test("pickDistractors: без повторов и без верного ответа", () => {
  const pool = [
    { meaning: "to get on a vehicle (vo)" },
    { meaning: "To get on a vehicle (vo) " },
    { meaning: "taxi" },
    { meaning: "taxi" },
    { meaning: "subway" },
    { meaning: "bus" },
    { meaning: "" },
  ];
  for (let i = 0; i < 20; i++) {
    const got = pickDistractors({ meaning: "to get on a vehicle (vo)" }, pool);
    assertEquals(got.length, 3);
    assertEquals(new Set(got).size, 3);
    assert(!got.some((m) => m.toLowerCase().startsWith("to get on")));
  }
  // Мало вариантов — сколько есть, но не больше.
  assertEquals(pickDistractors({ meaning: "a" }, [{ meaning: "a" }, { meaning: "b" }]), ["b"]);
});

Deno.test("pickDistractors: глагол к глаголу, та же колода", () => {
  const pool = [
    { meaning: "taxi", deck: "chinese1" },
    { meaning: "to walk", deck: "chinese1" },
    { meaning: "to sit", deck: "chinese1" },
    { meaning: "to change", deck: "chinese1" },
    { meaning: "to run", deck: "other" },
  ];
  const got = pickDistractors({ meaning: "to get off", deck: "chinese1" }, pool);
  assertEquals(got.sort(), ["to change", "to sit", "to walk"]);
});

Deno.test("/card: строка без ханзи уходит на перевод, с ханзи разбирается как раньше", () => {
  assertEquals(splitCardInput("остановите здесь"), { typed: [], ask: ["остановите здесь"] });
  assertEquals(splitCardInput("请假 отпроситься\n  \nгде метро?"), {
    typed: [{ front: "请假", reading: null, meaning: "отпроситься" }],
    ask: ["где метро?"],
  });
  // Ханзи без значения — не карточка и не повод звать Gemini.
  assertEquals(splitCardInput("请假"), { typed: [], ask: [] });
});

Deno.test("/card: ответ Gemini превращается в карточку", () => {
  const out = 'Вот: {"cards":[{"hanzi":"请停这儿","pinyin":"qǐng tíng zhèr","meaning":"please stop here",' +
    '"example":"师傅，请停这儿。"},{"hanzi":"stop","meaning":"x"},{"hanzi":"好","meaning":""}]}';
  assertEquals(parseFilled(out), [{
    front: "请停这儿",
    reading: "qǐng tíng zhèr",
    meaning: "please stop here",
    example: "师傅，请停这儿。",
  }]);
  assertEquals(parseFilled("не json"), []);
  // Без пиньиня подставляем свой.
  assertEquals(parseFilled('{"cards":[{"hanzi":"地铁","meaning":"subway"}]}')[0].reading, "dì tiě");
});

Deno.test("parseCardInput: старые форматы", () => {
  assertEquals(parseCardInput("请假 — отпроситься с работы"), { front: "请假", reading: null, meaning: "отпроситься с работы" });
  assertEquals(parseCardInput("请假 | qǐngjià | отпроситься"), { front: "请假", reading: "qǐngjià", meaning: "отпроситься" });
  assertEquals(parseCardInput("请假"), null);
});

Deno.test("parseSituations: верный вариант среди четырёх, мусор отбрасывается", () => {
  const out = JSON.stringify({
    items: [
      { situation: "You're in a taxi and want to stop here.", right: "停这儿", wrong: ["上车", "换线", "上车", "打车"] },
      { situation: "Too few options", right: "走", wrong: ["坐"] },
      { situation: "No hanzi", right: "stop", wrong: ["上车", "换线", "打车"] },
    ],
  });
  const got = parseSituations(out);
  assertEquals(got.length, 1);
  assertEquals(got[0].opts.length, 4);
  assertEquals(got[0].opts[got[0].a], "停这儿");
  assertEquals(new Set(got[0].opts).size, 4);
});

Deno.test("sessionTime: за 30 минут до первой пары, иначе 08:00", () => {
  assertEquals(sessionTime(null), "08:00");
  assertEquals(sessionTime(8 * 60), "07:30");
  assertEquals(sessionTime(10 * 60 + 15), "09:45");
});

Deno.test("озвучка: только китайский текст, паузы из пустых кадров", () => {
  assertEquals(sayable("有点儿 + adj"), "有点儿");
  assertEquals(sayable("了 (end of sentence)"), "了");
  assertEquals(silence(3).length, 125 * 192);
  const clip = new Uint8Array([1, 2, 3]);
  // Фраза, пауза, фраза, пауза.
  assertEquals(shadowTrack([clip], 3).length, 2 * (3 + 125 * 192));
});
