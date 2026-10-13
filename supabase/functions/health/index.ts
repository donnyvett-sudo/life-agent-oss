// Проверка живости снаружи (GitHub Actions раз в 6 часов). Авторизация —
// личный токен владельца в X-Token. Отдаёт 503, если что-то сломано:
// внешняя проверка падает и GitHub присылает письмо, даже когда бот молчит.
import { check, db, type User } from "../_shared/db.ts";
import { health, lastTick } from "../_shared/health.ts";

Deno.serve(async (req) => {
  const token = req.headers.get("x-token") ?? new URL(req.url).searchParams.get("token");
  if (!token || token.length < 32) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const user = check(
    await db.from("users").select("*").eq("ingest_token", token).eq("is_allowed", true).maybeSingle(),
  ) as User | null;
  if (!user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const tick = await lastTick();
  const h = await health(user);
  return Response.json(
    { ok: h.ok, problems: h.problems, lastTick: tick.at, lastTickMin: tick.ageMin, facts: h.facts },
    { status: h.ok ? 200 : 503 },
  );
});
