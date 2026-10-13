// Полнота английского словаря: забытый ключ иначе молча останется русским.
// Запуск: node scripts/check-i18n.mjs (входит в npm run build).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, а не pathname: в пути проекта есть пробел.
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const CALLS = [
  /\bt\(\s*"((?:[^"\\]|\\.)*)"/g,
  // t(условие ? "одно" : "другое"): ключей два, оба должны быть в словаре.
  /\bt\(\s*[^,()"]*\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
  /\bplural\(\s*[^,]+?,\s*"((?:[^"\\]|\\.)*)"/g,
];

async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...await files(path));
    else if (/\.tsx?$/.test(e.name) && !e.name.startsWith("i18n")) out.push(path);
  }
  return out;
}

const { EN } = await import("../src/i18n_en.ts").catch(async () => {
  // Node не читает TypeScript напрямую: достаём словарь регуляркой.
  const text = await readFile(join(SRC, "i18n_en.ts"), "utf8");
  const en = {};
  // Ключи в словаре могут быть с \uXXXX и \": раскодируем так же, как это сделал бы JS.
  const decode = (raw) => {
    try { return JSON.parse(`"${raw}"`); } catch { return raw; }
  };
  for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)":\s*$|^\s*"((?:[^"\\]|\\.)*)":\s*"/gm)) {
    en[decode(m[1] ?? m[2])] = true;
  }
  return { EN: en };
});

const missing = [];
for (const path of await files(SRC)) {
  const text = await readFile(path, "utf8");
  for (const re of CALLS) {
    for (const m of text.matchAll(re)) {
      for (const key of m.slice(1).filter(Boolean)) {
        if (!EN[key] && !missing.includes(key)) missing.push(key);
      }
    }
  }
}

if (missing.length) {
  console.error(`Нет английского перевода (${missing.length}):`);
  for (const k of missing) console.error("  " + k);
  process.exit(1);
}
console.log("Английский словарь полон.");
