// Бэкенд Mini App. Авторизация — подпись Telegram initData в заголовке X-Telegram-Init-Data,
// а вне Telegram (Mac-приложение Life Desk) — личный токен users.ingest_token в X-Token.
// Сами маршруты живут в _shared/app/routes.ts: тем же кодом пользуется чат-агент.
import { HttpError } from "../_shared/app/finance.ts";
import { route } from "../_shared/app/routes.ts";
import { verifyInitData } from "../_shared/initdata.ts";
import type { User } from "../_shared/db.ts";
import { findByToken, findUser } from "../_shared/users.ts";
import { MINIAPP_URL } from "../_shared/config.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const MINIAPP_ORIGIN = MINIAPP_URL ? new URL(MINIAPP_URL).origin : "http://localhost:5173";
const ORIGINS = [MINIAPP_ORIGIN, "http://localhost:5173", "lifedesk://app"];

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type, x-telegram-init-data, x-token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
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
  const user = await findByToken(req.headers.get("x-token"));
  if (!user) throw new HttpError(401, "unauthorized");
  return user;
}
