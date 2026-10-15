import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { AuthError, authToken, LIMIT, scopeOk, sha256Hex, tokenFrom, type TokenRow, type TokenStore } from "./tokens.ts";
import type { User } from "./db.ts";

const U = (id: string, allowed = true) => ({ id, is_allowed: allowed }) as unknown as User;
const T1 = "a".repeat(48), T2 = "b".repeat(48), LEG = "c".repeat(48);

async function fake(opts: { rows?: Partial<TokenRow>[]; users?: User[]; legacy?: Record<string, User> } = {}) {
  const rows: TokenRow[] = [];
  for (const r of opts.rows ?? []) {
    rows.push({ id: crypto.randomUUID(), user_id: "u1", hash: "", label: "x", scopes: ["*"], revoked_at: null, last_used_at: null, ...r } as TokenRow);
  }
  const failures: { ip: string; at: number }[] = [];
  const touched: string[] = [], adopted: string[] = [];
  const store: TokenStore = {
    byHash: (h) => Promise.resolve(rows.find((r) => r.hash === h) ?? null),
    user: (id) => Promise.resolve((opts.users ?? [U("u1")]).find((u) => u.id === id) ?? null),
    legacyUser: (t) => Promise.resolve(opts.legacy?.[t] ?? null),
    adopt: (_u, h) => { adopted.push(h); return Promise.resolve(); },
    touch: (id) => { touched.push(id); return Promise.resolve(); },
    failuresSince: (ip, since) => Promise.resolve(failures.filter((f) => f.ip === ip && f.at >= Date.parse(since)).length),
    recordFailure: (ip) => { failures.push({ ip, at: Date.now() }); return Promise.resolve(); },
  };
  return { store, rows, failures, touched, adopted };
}

Deno.test("scopeOk: * fits everything, others only themselves", () => {
  assert(scopeOk(["*"], "ingest"));
  assert(scopeOk(["app"], "app"));
  assert(!scopeOk(["app"], "study"));
  assert(!scopeOk([], "app"));
});

Deno.test("sha256Hex is the usual hex digest", async () => {
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("known token with the right scope returns the user and touches last_used", async () => {
  const f = await fake({ rows: [{ hash: await sha256Hex(T1), scopes: ["app"] }] });
  const u = await authToken(f.store, T1, "app", "ip");
  assertEquals(u.id, "u1");
  assertEquals(f.touched.length, 1);
});

Deno.test("wrong scope is 403 and not counted as a failure", async () => {
  const f = await fake({ rows: [{ hash: await sha256Hex(T1), scopes: ["ingest"] }] });
  const e = await assertRejects(() => authToken(f.store, T1, "app", "ip"), AuthError);
  assertEquals(e.status, 403);
  assertEquals(f.failures.length, 0);
});

Deno.test("revoked, unknown and malformed tokens are 401 and are counted", async () => {
  const f = await fake({ rows: [{ hash: await sha256Hex(T1), revoked_at: "2026-10-01T00:00:00Z" }] });
  for (const t of [T1, T2, "short", null]) {
    const e = await assertRejects(() => authToken(f.store, t, "app", "ip"), AuthError);
    assertEquals(e.status, 401);
  }
  assertEquals(f.failures.length, 4);
});

Deno.test("20 failures in the window block even a good token (429)", async () => {
  const f = await fake({ rows: [{ hash: await sha256Hex(T1) }] });
  for (let i = 0; i < LIMIT.failures; i++) f.failures.push({ ip: "ip", at: Date.now() });
  const e = await assertRejects(() => authToken(f.store, T1, "app", "ip"), AuthError);
  assertEquals(e.status, 429);
  // another address is not affected
  assertEquals((await authToken(f.store, T1, "app", "other")).id, "u1");
});

Deno.test("an original users.ingest_token still works and is adopted into api_tokens", async () => {
  const f = await fake({ legacy: { [LEG]: U("u1") } });
  assertEquals((await authToken(f.store, LEG, "ingest", "ip")).id, "u1");
  assertEquals(f.adopted, [await sha256Hex(LEG)]);
});

Deno.test("a blocked user is refused even with a valid token", async () => {
  const f = await fake({ rows: [{ hash: await sha256Hex(T1), user_id: "u9" }], users: [U("u9", false)] });
  const e = await assertRejects(() => authToken(f.store, T1, "app", "ip"), AuthError);
  assertEquals(e.status, 401);
});

Deno.test("tokenFrom: header wins, query is flagged", () => {
  const a = tokenFrom(new Request("https://x/f?token=q", { headers: { "x-token": "h" } }));
  assertEquals(a, { token: "h", fromQuery: false });
  assertEquals(tokenFrom(new Request("https://x/f?token=q")), { token: "q", fromQuery: true });
  assertEquals(tokenFrom(new Request("https://x/f")), { token: null, fromQuery: false });
});
