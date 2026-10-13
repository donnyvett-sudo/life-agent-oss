// Проверяем, что каждому ключу из кода есть английский перевод: забытая строка
// иначе молча останется русской в английском интерфейсе.
import { assertEquals } from "jsr:@std/assert@1";
import { EN } from "./i18n_en.ts";
import { t } from "./i18n.ts";

const ROOT = new URL("../", import.meta.url);
const CALL = /\bt\(\s*[^,()"]+?,\s*"((?:[^"\\]|\\.)*)"/g;

async function sources(): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(ROOT)) {
    if (entry.isDirectory) {
      const dir = new URL(`${entry.name}/`, ROOT);
      for await (const f of Deno.readDir(dir)) {
        if (f.isFile && f.name.endsWith(".ts") && !f.name.endsWith("_test.ts")) {
          out.push(decodeURIComponent(new URL(f.name, dir).pathname));
        }
      }
    }
  }
  return out;
}

Deno.test("у каждого ключа есть английский перевод", async () => {
  const missing: string[] = [];
  for (const path of await sources()) {
    if (path.endsWith("i18n_en.ts")) continue;
    const text = await Deno.readTextFile(path);
    for (const m of text.matchAll(CALL)) {
      const key = m[1];
      if (!EN[key] && !missing.includes(key)) missing.push(key);
    }
  }
  assertEquals(missing, []);
});

Deno.test("подстановка и запасной русский", () => {
  assertEquals(t("en", "Готово, {name}.", { name: "Alex" }), "Ready, Alex.");
  assertEquals(t("ru", "Готово, {name}.", { name: "Алекс" }), "Готово, Алекс.");
  // Ключа нет в словаре — показываем русскую строку, а не пустоту.
  assertEquals(t("en", "Строка без перевода"), "Строка без перевода");
});
