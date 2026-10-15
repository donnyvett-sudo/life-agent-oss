// Приём шагов, веса и пульса покоя из iOS «Команд». Авторизация — личный токен
// пользователя (users.ingest_token) в заголовке X-Token (или ?token=).
// Ответ {reply} Shortcuts показывает уведомлением.
import { bodyOn, fmtNum, parseBody, saveBody, STEP_GOAL } from "../_shared/body.ts";
import { check, db, type User } from "../_shared/db.ts";
import { authRequest, flagQueryToken } from "../_shared/tokens.ts";
import { t } from "../_shared/i18n.ts";
import { localNow } from "../_shared/time.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(flagQueryToken(async (req) => {
  if (req.method !== "POST") return json({ ok: false, reply: "POST only" }, 405);

  const auth = await authRequest(req, "ingest");
  if ("error" in auth) return auth.error;
  const user = auth.user;

  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { text: raw };
  }

  // Лог нужен для настройки команды на iPhone: видно, что именно отдало «Здоровье».
  console.log("body payload", raw.slice(0, 300));

  const today = localNow(user.tz).date;
  const rows = parseBody(payload, today);
  if (!rows.length) {
    return json({ ok: false, reply: t(user, "Данных о теле нет: «Здоровье» ничего не отдало.") }, 422);
  }
  await saveBody(user, rows);

  // В ответе — последний присланный день: команда запускается утром за вчера.
  const last = rows[rows.length - 1];
  const saved = (await bodyOn(user, last.local_date)) ?? last;
  const parts: string[] = [];
  if (saved.steps !== null) {
    parts.push(t(user, "{n} шагов", { n: fmtNum(user, saved.steps) }));
  }
  if (saved.weight_kg !== null) {
    parts.push(t(user, "вес {kg} кг", { kg: fmtNum(user, Number(saved.weight_kg), 1) }));
  }
  if (saved.resting_hr !== null) {
    parts.push(t(user, "пульс покоя {n}", { n: saved.resting_hr }));
  }

  // Чего не пришло — называем прямо в уведомлении: иначе пустое поле замечаешь
  // через неделю, когда в приложении обнаруживается дыра.
  const missing: string[] = [];
  if (saved.steps === null) missing.push(t(user, "шагов"));
  if (saved.resting_hr === null) missing.push(t(user, "пульса покоя"));
  const hint = missing.length
    ? " " + t(user, "Без {list} — проверь фильтр в команде.", { list: missing.join(" и ") })
    : "";

  return json({
    ok: true,
    days: rows.length,
    date: last.local_date,
    goal: STEP_GOAL,
    reply: t(user, "Записал за {date}: {list}.", { date: last.local_date, list: parts.join(", ") }) + hint,
  });
}));
