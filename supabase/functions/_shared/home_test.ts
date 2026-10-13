import { assertEquals } from "jsr:@std/assert@1";
import type { User } from "./db.ts";
import { DEFAULT_HOME, homePanels, HOME_PANELS } from "./app/home.ts";

const user = (home?: unknown) => ({ settings: home === undefined ? {} : { home } }) as unknown as User;

Deno.test("панели: по умолчанию экран прежний", () => {
  assertEquals(homePanels(user()), DEFAULT_HOME);
  // Чужое значение в настройках не должно опустошать экран.
  assertEquals(homePanels(user("sleep")), DEFAULT_HOME);
  assertEquals(homePanels(user(null)), DEFAULT_HOME);
});

Deno.test("панели: порядок сохраняется, мусор выбрасывается", () => {
  assertEquals(homePanels(user(["spending", "body"])), ["spending", "body"]);
  assertEquals(homePanels(user(["body", "выдумка", "body", "sleep"])), ["body", "sleep"]);
  // Пустой список — осознанный выбор, а не пропущенная настройка.
  assertEquals(homePanels(user([])), []);
  assertEquals(homePanels(user([...HOME_PANELS])).length, HOME_PANELS.length);
});
