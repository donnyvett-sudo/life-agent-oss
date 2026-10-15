// Personal API tokens: stored as SHA-256, with a scope, a label and revocation.
// Falls back to users.ingest_token (new users, old clients) and moves such a token into api_tokens on first use.
import { check, db, type User } from "./db.ts";

export type Scope = "app" | "study" | "ingest";
export const SCOPES: readonly string[] = ["*", "app", "study", "ingest"];

export type TokenRow = {
  id: string;
  user_id: string;
  hash: string;
  label: string;
  scopes: string[];
  revoked_at: string | null;
  last_used_at: string | null;
};

/** Everything the check needs from the database, so it can be tested with a fake. */
export interface TokenStore {
  byHash(hash: string): Promise<TokenRow | null>;
  user(id: string): Promise<User | null>;
  legacyUser(token: string): Promise<User | null>;
  adopt(userId: string, hash: string): Promise<void>;
  touch(id: string): Promise<void>;
  failuresSince(ipHash: string, sinceIso: string): Promise<number>;
  recordFailure(ipHash: string): Promise<void>;
}

export const LIMIT = { failures: 20, windowMin: 10 };
const TOUCH_EVERY_MS = 60_000;

export function tokenShaped(token: string | null | undefined): token is string {
  return typeof token === "string" && token.length >= 32 && token.length <= 200;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function scopeOk(scopes: string[], need: Scope): boolean {
  return scopes.includes("*") || scopes.includes(need);
}

export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class AuthError extends Error {
  constructor(public status: 401 | 403 | 429, message: string) {
    super(message);
  }
}

/** Looks the token up. Throws AuthError (401 unknown/revoked, 403 wrong scope, 429 too many failures). */
export async function authToken(
  store: TokenStore,
  token: string | null | undefined,
  need: Scope,
  ipHash: string,
  now: Date = new Date(),
): Promise<User> {
  const since = new Date(now.getTime() - LIMIT.windowMin * 60_000).toISOString();
  if ((await store.failuresSince(ipHash, since)) >= LIMIT.failures) throw new AuthError(429, "too many attempts");
  const fail = async (status: 401 | 403, msg: string): Promise<never> => {
    await store.recordFailure(ipHash).catch(() => {});
    throw new AuthError(status, msg);
  };
  if (!tokenShaped(token)) return fail(401, "unauthorized");
  const hash = await sha256Hex(token);

  const row = await store.byHash(hash);
  if (row) {
    if (row.revoked_at) return fail(401, "unauthorized");
    if (!scopeOk(row.scopes, need)) throw new AuthError(403, "token scope");
    const user = await store.user(row.user_id);
    if (!user?.is_allowed) return fail(401, "unauthorized");
    const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
    if (now.getTime() - last > TOUCH_EVERY_MS) await store.touch(row.id).catch(() => {});
    return user;
  }
  // Not in api_tokens: a user created after the migration, or a client using the original token.
  const legacy = await store.legacyUser(token);
  if (!legacy?.is_allowed) return fail(401, "unauthorized");
  await store.adopt(legacy.id, hash).catch(() => {});
  return legacy;
}

/** The real store (service role). */
export const dbStore: TokenStore = {
  async byHash(hash) {
    return check(await db.from("api_tokens").select("*").eq("hash", hash).maybeSingle()) as TokenRow | null;
  },
  async user(id) {
    return check(await db.from("users").select("*").eq("id", id).maybeSingle()) as User | null;
  },
  async legacyUser(token) {
    return check(await db.from("users").select("*").eq("ingest_token", token).maybeSingle()) as User | null;
  },
  async adopt(userId, hash) {
    await db.from("api_tokens").upsert({ user_id: userId, hash, label: "legacy", scopes: ["*"] }, { onConflict: "hash", ignoreDuplicates: true });
  },
  async touch(id) {
    await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", id);
  },
  async failuresSince(ipHash, sinceIso) {
    const { count } = await db.from("auth_failures").select("ip_hash", { count: "exact", head: true })
      .eq("ip_hash", ipHash).gte("at", sinceIso);
    return count ?? 0;
  },
  async recordFailure(ipHash) {
    await db.from("auth_failures").insert({ ip_hash: ipHash });
    if (Math.random() < 0.02) {  // now and then drop old rows
      await db.from("auth_failures").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
    }
  },
};

/** Salted hash of the caller's address: enough to count attempts, no raw addresses stored. */
export async function ipHashOf(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const salt = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  return (await sha256Hex(salt + "|" + ip)).slice(0, 32);
}

/** Token from the X-Token header; ?token= still works but is flagged as deprecated. */
export function tokenFrom(req: Request): { token: string | null; fromQuery: boolean } {
  const h = req.headers.get("x-token");
  if (h) return { token: h, fromQuery: false };
  const q = new URL(req.url).searchParams.get("token");
  return { token: q, fromQuery: q !== null };
}

/** Authenticates a request for a function. Returns the user or a ready error Response. */
export async function authRequest(req: Request, need: Scope): Promise<{ user: User } | { error: Response }> {
  try {
    const { token } = tokenFrom(req);
    return { user: await authToken(dbStore, token, need, await ipHashOf(req)) };
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: Response.json({ ok: false, error: e.message }, { status: e.status }) };
    }
    throw e;
  }
}

/** Wraps a handler: a call that used ?token= gets a Deprecation header (and a log line). */
export function flagQueryToken(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    if (!req.headers.get("x-token") && new URL(req.url).searchParams.has("token")) {
      console.warn("token in the query string is deprecated; use the X-Token header", new URL(req.url).pathname);
      const h = new Headers(res.headers);
      h.set("Deprecation", "true");
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  };
}

// ---------------------------------------------------------------- management (bot commands)

export async function listTokens(userId: string) {
  return check(
    await db.from("api_tokens").select("label, scopes, created_at, last_used_at, revoked_at").eq("user_id", userId)
      .order("created_at"),
  ) as Pick<TokenRow, "label" | "scopes" | "last_used_at" | "revoked_at">[] & { created_at: string }[];
}

export async function issueToken(userId: string, label: string, scopes: string[]): Promise<string> {
  const token = newToken();
  check(await db.from("api_tokens").insert({ user_id: userId, hash: await sha256Hex(token), label, scopes }));
  return token;
}

/** Marks a token revoked. Returns false when there is no such active token. */
export async function revokeToken(userId: string, label: string): Promise<boolean> {
  const { data } = await db.from("api_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId).eq("label", label).is("revoked_at", null).select("id");
  return (data?.length ?? 0) > 0;
}
