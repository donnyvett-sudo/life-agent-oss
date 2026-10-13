// Gemini (Google AI Studio, бесплатный тариф). Только коучинг и сводки.
import { GEMINI_MODELS } from "./config.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const KEY = Deno.env.get("GEMINI_API_KEY");
const TIMEOUT_MS = 20_000;
const HEDGE_MS = 5_000;

export class GeminiError extends Error {
  constructor(public kind: "nokey" | "rate" | "api" | "empty", message: string) {
    super(message);
  }
}

export type Turn = { role: "user" | "model"; text: string };

// Коучу не нужны долгие «размышления»: они съедают время и квоту.
const thinking = (m: string) =>
  /^gemini-[3-9]/.test(m)
    ? { thinkingLevel: "minimal" }
    : /^gemini-2\.5-flash/.test(m)
    ? { thinkingBudget: 0 }
    : undefined;

// deno-lint-ignore no-explicit-any
export type Part = Record<string, any>;
export type Content = { role: string; parts: Part[] };
/** Объявление инструмента для модели: имя, зачем он и схема аргументов. */
export type Tool = { name: string; description: string; parameters: Record<string, unknown> };

/** Ходы разговора → contents для Gemini: роли чередуются, первый ход всегда от пользователя. */
export function toContents(turns: Turn[], extraParts: Part[] = []): Content[] {
  const contents: Content[] = [];
  for (const t of turns) {
    const last = contents[contents.length - 1];
    if (last?.role === t.role) last.parts[0].text += `\n\n${t.text}`;
    else contents.push({ role: t.role, parts: [{ text: t.text }] });
  }
  if (contents[0]?.role === "model") contents.unshift({ role: "user", parts: [{ text: "…" }] });
  // Вложения (аудио) — в последний ход пользователя.
  if (extraParts.length) contents[contents.length - 1].parts.push(...extraParts);
  return contents;
}

/** Байты → base64 порциями: spread большого массива роняет стек. */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** `schema` включает JSON-режим Gemini: ответ гарантированно разбирается и холоднее по температуре. */
export async function generate(
  system: string,
  turns: Turn[],
  maxTokens = 2048,
  extraParts: Part[] = [],
  schema?: Record<string, unknown>,
): Promise<string> {
  const parts = await ask(system, toContents(turns, extraParts), { maxTokens, schema });
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new GeminiError("empty", "empty response");
  return text;
}

/**
 * Ответ модели частями: текст и вызовы инструментов. Нужен агенту в чате —
 * он сам решает, что сделать с functionCall, и присылает результат следующим ходом.
 */
export async function askParts(
  system: string,
  contents: Content[],
  tools: Tool[],
  maxTokens = 2048,
): Promise<Part[]> {
  return await ask(system, contents, { maxTokens, tools });
}

async function ask(
  system: string,
  contents: Content[],
  opts: { maxTokens: number; tools?: Tool[]; schema?: Record<string, unknown> },
): Promise<Part[]> {
  if (!KEY) throw new GeminiError("nokey", "GEMINI_API_KEY not set");

  const body = (m: string) =>
    JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      ...(opts.tools?.length ? { tools: [{ function_declarations: opts.tools }] } : {}),
      generationConfig: {
        temperature: opts.schema ? 0.2 : 0.7,
        maxOutputTokens: opts.maxTokens,
        ...(opts.schema ? { responseMimeType: "application/json", responseSchema: opts.schema } : {}),
        ...(thinking(m) ? { thinkingConfig: thinking(m) } : {}),
      },
    });

  // Один запрос к модели: части ответа или null (ошибка / таймаут / отмена).
  const one = async (m: string, abort: AbortSignal): Promise<Part[] | null> => {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}/models/${m}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: body(m),
        signal: AbortSignal.any([abort, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      console.log(`Gemini ${m}: ${res.status} in ${Date.now() - started} ms`);
      if (!res.ok) {
        lastStatus = res.status;
        console.warn(`Gemini ${m}: ${(await res.text()).slice(0, 300)}`);
        return null;
      }
      const json = await res.json() as { candidates?: { content?: { parts?: Part[] } }[] };
      const parts = (json.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought);
      const useful = parts.some((p) => p.functionCall || (p.text ?? "").trim());
      if (!useful) console.warn(`Gemini ${m}: empty response`);
      return useful ? parts : null;
    } catch (e) {
      if (!abort.aborted) {
        lastStatus = 504;
        console.warn(`Gemini ${m}: ${String(e)} after ${Date.now() - started} ms`);
      }
      return null;
    }
  };

  // Подстраховка от перегрузки бесплатного Gemini: если модель молчит HEDGE_MS
  // (или упала), параллельно запускаем следующую. Берём первый успешный ответ, остальные отменяем.
  let lastStatus = 0;
  const abort = new AbortController();
  const result = await new Promise<Part[] | null>((resolve) => {
    let next = 0, running = 0, done = false;
    const launch = () => {
      if (done || next >= GEMINI_MODELS.length) {
        if (!done && running === 0) resolve(null);
        return;
      }
      const m = GEMINI_MODELS[next++];
      running++;
      const hedge = setTimeout(launch, HEDGE_MS);
      one(m, abort.signal).then((parts) => {
        running--;
        clearTimeout(hedge);
        if (done) return;
        if (parts) {
          done = true;
          resolve(parts);
        } else launch();
      });
    };
    launch();
  });
  abort.abort();
  if (result) return result;
  if (lastStatus === 429) throw new GeminiError("rate", "rate limited");
  throw new GeminiError("api", `all models failed, last status ${lastStatus}`);
}

/** Голосовое → текст. В Gemini уходит только аудио. */
export async function transcribe(bytes: Uint8Array, mime = "audio/ogg"): Promise<string> {
  return await generate(
    "Ты расшифровываешь голосовые сообщения. Верни только дословный текст на языке оригинала, " +
      "без пояснений и кавычек. Числа пиши цифрами. Если речи нет, верни пустую строку.",
    [{ role: "user", text: "Расшифруй." }],
    512,
    [{ inline_data: { mime_type: mime, data: toBase64(bytes) } }],
  );
}
