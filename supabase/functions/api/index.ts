// Бэкенд Mini App. Авторизация — подпись Telegram initData в заголовке X-Telegram-Init-Data,
// а вне Telegram (Mac-приложение Life Desk) — личный токен users.ingest_token в X-Token.
// Сами маршруты живут в _shared/app/routes.ts: тем же кодом пользуется чат-агент.
import { HttpError } from "../_shared/app/finance.ts";
import { route } from "../_shared/app/routes.ts";
import { verifyInitData } from "../_shared/initdata.ts";
import type { User } from "../_shared/db.ts";
import { findUser } from "../_shared/users.ts";
import { AuthError, authToken, dbStore, ipHashOf } from "../_shared/tokens.ts";
import { MINIAPP_URL } from "../_shared/config.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const MINIAPP_ORIGIN = MINIAPP_URL ? new URL(MINIAPP_URL).origin : "http://localhost:5173";
const ORIGINS = [MINIAPP_ORIGIN, "http://localhost:5173", "lifedesk://app"];

/** An unknown Origin gets no Allow-Origin header (a browser then refuses to read the answer).
 *  Requests without an Origin (the Mac app, scripts) are not browsers and are not affected. */
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "content-type, x-telegram-init-data, x-token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const known = ORIGINS.includes(req.headers.get("origin") ?? "");
    return new Response(null, { status: known ? 204 : 403, headers: cors(req) });
  }
  try {
    const user = await authUser(req);

    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*?\/api/, "") || "/";
    const body = ["POST", "PUT", "PATCH"].includes(req.method)
      ? await req.json().catch(() => ({}))
      : {};
    const data = await route(user, req.method, path, url.searchParams, body);
    return Response.json(data ?? { ok: true }, { headers: cors(req) });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    // 500 — детали остаются в логе: текст ошибки БД клиенту ни к чему.
    const message = status === 500 ? "internal error" : e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, {
      status,
      headers: cors(req),
    });
  }
});

/** initData, если он есть (Telegram); иначе личный токен (Life Desk). Оба пути — только is_allowed. */
async function authUser(req: Request): Promise<User> {
  const initData = req.headers.get("x-telegram-init-data") ?? "";
  if (initData) {
    const tg = await verifyInitData(initData, BOT_TOKEN);
    if (!tg) throw new HttpError(401, "bad initData");
    const user = await findUser(tg.id);
    if (!user?.is_allowed) throw new HttpError(403, "not allowed");
    return user;
  }
  try {
    return await authToken(dbStore, req.headers.get("x-token"), "app", await ipHashOf(req));
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(e.status, e.message);
    throw e;
  }
}
