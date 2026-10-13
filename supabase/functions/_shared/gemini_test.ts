import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("GEMINI_API_KEY", "test");
const { generate } = await import("./gemini.ts");

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));

function mockFetch(plan: Record<string, { delay: number; res: () => Response }>) {
  const calls: string[] = [];
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    const m = String(input).match(/models\/([^:]+):/)![1];
    calls.push(m);
    const p = plan[m] ?? { delay: 0, res: () => new Response("", { status: 503 }) };
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(p.res()), p.delay);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }) as typeof fetch;
  return calls;
}

Deno.test("fast primary wins, no hedge", async () => {
  const calls = mockFetch({ "gemini-3.6-flash": { delay: 10, res: () => ok("a") } });
  assertEquals(await generate("s", [{ role: "user", text: "hi" }]), "a");
  assertEquals(calls, ["gemini-3.6-flash"]);
});

Deno.test("primary error → next model immediately", async () => {
  const calls = mockFetch({ "gemini-3.5-flash": { delay: 10, res: () => ok("b") } });
  assertEquals(await generate("s", [{ role: "user", text: "hi" }]), "b");
  assertEquals(calls, ["gemini-3.6-flash", "gemini-3.5-flash"]);
});

Deno.test("slow primary → hedged model answers first", async () => {
  const calls = mockFetch({
    "gemini-3.6-flash": { delay: 15_000, res: () => ok("slow") },
    "gemini-3.5-flash": { delay: 100, res: () => ok("fast") },
  });
  const t = Date.now();
  assertEquals(await generate("s", [{ role: "user", text: "hi" }]), "fast");
  assertEquals(calls.slice(0, 2), ["gemini-3.6-flash", "gemini-3.5-flash"]);
  if (Date.now() - t > 6_000) throw new Error("hedge too slow");
});
