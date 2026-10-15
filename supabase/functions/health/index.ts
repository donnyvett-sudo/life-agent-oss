// Проверка живости снаружи (GitHub Actions раз в 6 часов). Авторизация —
// личный токен владельца в X-Token. Отдаёт 503, если что-то сломано:
// внешняя проверка падает и GitHub присылает письмо, даже когда бот молчит.
import { authRequest, flagQueryToken } from "../_shared/tokens.ts";
import { health, lastTick } from "../_shared/health.ts";

Deno.serve(flagQueryToken(async (req) => {
  const auth = await authRequest(req, "ingest");
  if ("error" in auth) return auth.error;
  const user = auth.user;

  const tick = await lastTick();
  const h = await health(user);
  return Response.json(
    { ok: h.ok, problems: h.problems, lastTick: tick.at, lastTickMin: tick.ageMin, facts: h.facts },
    { status: h.ok ? 200 : 503 },
  );
}));
