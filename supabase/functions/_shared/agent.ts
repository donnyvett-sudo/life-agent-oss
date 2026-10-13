/**
 * Агент чата: коуч сам ходит в те же маршруты, что и Mini App (_shared/app/routes.ts),
 * поэтому проверки, пересчёт валют и права — одни и те же.
 * Удаления и большие правки просят подтверждение, последнее изменение можно отменить кнопкой.
 */
import { check, db, type User } from "./db.ts";
import { askParts, type Content, type Part, type Tool, toContents, type Turn } from "./gemini.ts";
import { HttpError } from "./app/finance.ts";
import { route } from "./app/routes.ts";
import { t } from "./i18n.ts";
import type { Keyboard } from "./telegram.ts";

const MAX_STEPS = 4; // ходов модели за одно сообщение
const MAX_WRITES = 3; // изменений без подтверждения
const RESULT_CHARS = 2500; // сколько данных отдаём модели обратно

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// Путь → таблица: нужно, чтобы снять состояние до правки и уметь её отменить.
const TABLES: Record<string, string> = {
  "/transactions": "transactions",
  "/transfers": "transfers",
  "/accounts": "accounts",
  "/categories": "categories",
  "/budgets": "budgets",
  "/supplements": "supplements",
  "/assignments": "assignments",
  "/exams": "exams",
  "/projects": "projects",
  "/milestones": "milestones",
  "/habits": "habits",
  "/body": "body_days",
  "/meals": "meal_logs",
  "/cards": "flashcards",
};

type Find = { cols: string; text: string; alt?: string; order: string; desc?: boolean };

const FIND: Record<string, Find> = {
  transactions: { cols: "id,kind,note,amount,currency,occurred_at,category_id,account_id", text: "note", order: "occurred_at", desc: true },
  transfers: { cols: "id,note,from_amount,to_amount,occurred_at", text: "note", order: "occurred_at", desc: true },
  accounts: { cols: "id,title,currency,is_archived", text: "title", order: "sort" },
  categories: { cols: "id,title,kind,is_archived", text: "title", order: "sort" },
  supplements: { cols: "id,name,slot,active,units_left", text: "name", order: "sort" },
  courses: { cols: "id,short,title,ai_policy", text: "title", order: "sort" },
  assignments: { cols: "id,title,course_id,due_date,status", text: "title", order: "due_date", desc: true },
  exams: { cols: "id,title,course_id,kind,date,topic", text: "title", order: "date", desc: true },
  projects: { cols: "id,title,status,repo,due_date", text: "title", order: "sort" },
  milestones: { cols: "id,title,project_id,status,due_date", text: "title", order: "sort" },
  habits: { cols: "id,title,kind,target,active", text: "title", order: "sort" },
  flashcards: { cols: "id,deck,front,reading,meaning,box,next_review", text: "front", alt: "meaning", order: "created_at", desc: true },
  promises: { cols: "id,title,due_date,status", text: "title", order: "due_date", desc: true },
};

/** Что делать, чтобы вернуть запись как было. */
type Undo = { table: string; op: "insert" | "update" | "delete"; id?: string; row?: Record<string, unknown> };
type Pending = { method: string; path: string; body: unknown };
type AgentState = { ts: number; undo?: Undo[]; pending?: Pending; what?: string };

export const AGENT_TOOLS: Tool[] = [
  {
    name: "api",
    description:
      "Данные человека: GET — посмотреть, POST — создать, PATCH/PUT — изменить, DELETE — удалить. " +
      "Перед правкой или удалением найди id через find.",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"] },
        path: { type: "string", description: "Например /today, /finance?month=2026-09, /transactions/<id>" },
        body: { type: "string", description: "JSON с полями записи для POST/PATCH/PUT" },
      },
      required: ["method", "path"],
    },
  },
  {
    name: "find",
    description: "Найти записи и их id по куску названия. Без query — последние записи.",
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", enum: Object.keys(FIND) },
        query: { type: "string", description: "Часть названия или заметки" },
        limit: { type: "integer", description: "Сколько записей, по умолчанию 10" },
      },
      required: ["table"],
    },
  },
];

/** Шпаргалка по маршрутам: без неё модель выдумывает пути и поля. */
export const AGENT_PROMPT = `
Инструменты: find (найти id) и api (посмотреть и изменить данные). Ты не просто советуешь — делаешь.
Просят записать, исправить, отметить, удалить — сделай сам через api, потом коротко скажи, что вышло.
Не спрашивай подтверждения: на удаление и на большие правки бот сам покажет кнопку.
Не выдумывай id: сначала find или GET. В датах формат YYYY-MM-DD, день сегодняшний бери из фактов.

Маршруты api (path — method — поля body):
- /today?date= — GET. /sleep?days= — GET.
- /settings — GET, PUT {tz, lang, profile:{about,name,currency}, schedule:{...}, sleep:{bed,wake}, coach:{frequency}}
- /home — PUT {panels: [...]} — какие панели показывать на главном экране приложения и в каком порядке.
  Годятся только: sleep, body, supplements, spending, classes, habits, study, milestones.
  Текущий набор лежит в /today в поле home; меняя его, бери оттуда и правь, а не собирай заново.
- /supplements — POST {name, slot: morning|lunch|evening, unitsPerIntake, unitsPerPack, unitsLeft}; /supplements/<id> — PATCH те же поля, DELETE (убрать из списка)
- /supplements/<id>/log — POST {status: taken|skipped|null, date}; /supplements/<id>/refill — POST (новая банка)
- /ledger/<id>/done — POST (закрыть долг); /ledger/<id>/use — POST (использовать награду)
- /finance?month=YYYY-MM — GET (счета, категории, траты за месяц)
- /transactions — POST {amount, currency, kind: expense|income, note, date, categoryId, accountId}; /transactions/<id> — PATCH те же поля, DELETE
- /transfers — POST {fromAccountId, toAccountId, fromAmount, toAmount, date, note}; /transfers/<id> — DELETE
- /accounts, /accounts/<id> — POST/PATCH {title, currency, openingBalance, isDefault, inTotal, isArchived}
- /categories, /categories/<id> — POST/PATCH {title, kind: expense|income, isArchived}
- /budgets — GET (лимиты трат на месяц с расходом), POST {categoryId, amount} (categoryId null — общий лимит на месяц);
  /budgets/<id> — DELETE. Лимит один на категорию, повторный POST его перезаписывает.
- /subscriptions — GET (регулярные списания, найденные в истории; их не заводят руками, только смотрят)
- /study?week=YYYY-MM-DD — GET (расписание, задания, экзамены)
- /assignments, /assignments/<id> — POST/PATCH {courseId, title, dueDate, dueNote, details, done}; DELETE
- /exams, /exams/<id> — POST/PATCH {courseId, kind: exam|quiz|test|project, title, topic, date, dateTo, tentative, notes}; DELETE
- /focus — POST {courseId, minutes} (запустить фокус-сессию)
- /cards — POST {front, reading, meaning, example, deck}; /cards/<id> — PATCH те же поля, DELETE
  Карточки для зубрёжки, в основном китайские слова. Просят «добавь слово» — заводи карточку сам:
  front — иероглифы, reading — пиньинь с тонами, meaning — короткий перевод, example — фраза с переводом.
  Прогресс повторения (box, next_review) не трогай: он считается по ответам.
- /career — GET; /projects, /projects/<id> — POST/PATCH {title, goal, status, repo, dueDate}; DELETE
- /milestones, /milestones/<id> — POST/PATCH {projectId, title, dueDate, done}; DELETE
- /habits — GET; /habits, /habits/<id> — POST/PATCH {title, kind: build|quit, target, days, note, isHard, active}; DELETE
- /habits/<id>/toggle — POST {date, done}
- /food?date=YYYY-MM-DD — GET (еда за день: приёмы, итоги КБЖУ, цели); /food/history?days=28 — GET (дни, вес, оценка расхода)
- /meals — POST {title, kcal, protein, fat, carbs, date} (приём пищи руками; фото и «съел …» считает бот сам); /meals/<id> — PATCH те же поля или {items: [{name, grams, kcal, p, f, c}], status}; DELETE
- /food/targets — PUT {kcal, protein, fat, carbs} (дневные цели)
- /body — PUT {weightKg, date} (вес; шаги и пульс покоя приходят из «Здоровья», руками их не пишем)`;

const stateOf = (user: User): AgentState | null => (user.state.agent as AgentState | undefined) ?? null;

async function saveState(user: User, agent: AgentState | null) {
  const state = { ...user.state, agent: agent ?? undefined };
  if (!agent) delete state.agent;
  check(await db.from("users").update({ state }).eq("id", user.id));
  user.state = state;
}

export function tableOf(path: string): { table: string | null; id: string | null; action: string | null } {
  const clean = path.replace(/\?.*$/, "");
  const id = clean.match(UUID)?.[0] ?? null;
  const base = clean.replace(/\/[0-9a-f-]{36}.*$/, "");
  const action = id ? clean.slice(clean.indexOf(id) + id.length) || null : null;
  return { table: TABLES[base] ?? null, id, action };
}

async function rowOf(table: string, user: User, id: string) {
  const res = await db.from(table).select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  return (res.data as Record<string, unknown> | null) ?? null;
}

/** Последняя запись таблицы: по ней узнаём id только что созданного. */
async function newestId(table: string, user: User): Promise<string | null> {
  const res = await db.from(table).select("id").eq("user_id", user.id)
    .order("created_at", { ascending: false }).limit(1);
  const rows = res.data as { id: string }[] | null;
  return rows?.[0]?.id ?? null;
}

async function callRoute(user: User, method: string, path: string, body: unknown) {
  const [p, qs] = path.split("?");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return await route(user, method, p.startsWith("/") ? p : `/${p}`, new URLSearchParams(qs ?? ""), b);
}

/** Один вызов api: правка через маршруты Mini App плюс запись того, как её отменить. */
async function callApi(
  user: User,
  args: { method?: string; path?: string; body?: unknown },
  undo: Undo[],
): Promise<Record<string, unknown>> {
  const method = String(args.method ?? "GET").toUpperCase();
  const path = String(args.path ?? "");
  let body: unknown = args.body;
  if (typeof body === "string") {
    try {
      body = body.trim() ? JSON.parse(body) : {};
    } catch {
      return { error: "body не разобрался как JSON" };
    }
  }
  if (!path.startsWith("/")) return { error: "path должен начинаться с /" };
  if (path.startsWith("/settings/github")) return { error: "GitHub подключается только в приложении" };

  const write = method !== "GET";
  const { table, id, action } = tableOf(path);
  // Отметки (/log, /toggle) меняют не саму запись, а журнал — их отменой не считаем.
  const trackable = write && table && (!action || action === "/refill");
  const before = trackable && id ? await rowOf(table!, user, id) : null;
  const lastBefore = trackable && method === "POST" && !id ? await newestId(table!, user) : null;

  try {
    const data = await callRoute(user, method, path, body);
    if (trackable && table) {
      if (method === "DELETE" && before) undo.push({ table, op: "insert", row: before });
      else if (before) undo.push({ table, op: "update", id: id!, row: before });
      else if (method === "POST" && !id) {
        const made = await newestId(table, user);
        if (made && made !== lastBefore) undo.push({ table, op: "delete", id: made });
      }
    }
    return { ok: true, data: trim(data) };
  } catch (e) {
    if (e instanceof HttpError) return { error: e.message };
    console.warn("agent api", method, path, e);
    return { error: String(e) };
  }
}

async function callFind(user: User, args: { table?: string; query?: string; limit?: number }) {
  const table = String(args.table ?? "");
  const f = FIND[table];
  if (!f) return { error: `нет таблицы ${table}, доступны: ${Object.keys(FIND).join(", ")}` };
  let q = db.from(table).select(f.cols).eq("user_id", user.id);
  const query = String(args.query ?? "").trim();
  // В карточках ищут и по иероглифу, и по переводу — смотрим оба столбца.
  const safe = query.replace(/[,()*]/g, " ").trim();
  if (safe) q = f.alt ? q.or(`${f.text}.ilike.%${safe}%,${f.alt}.ilike.%${safe}%`) : q.ilike(f.text, `%${safe}%`);
  const res = await q.order(f.order, { ascending: !f.desc }).limit(Math.min(Number(args.limit) || 10, 25));
  if (res.error) return { error: res.error.message };
  return { rows: res.data };
}

function trim(data: unknown): unknown {
  const s = JSON.stringify(data ?? null);
  return s.length <= RESULT_CHARS ? data : `${s.slice(0, RESULT_CHARS)}…(обрезано)`;
}

/** Короткое описание отложенного действия — его человек видит на кнопке подтверждения. */
function describe(method: string, path: string): string {
  const { table } = tableOf(path);
  return `${method} ${table ?? path}`;
}

export type AgentResult = { text: string; keyboard?: Keyboard };

/**
 * Один ответ коуча: модель может сделать несколько вызовов подряд,
 * но не больше MAX_STEPS ходов и MAX_WRITES изменений без подтверждения.
 */
export async function agentReply(user: User, system: string, turns: Turn[]): Promise<AgentResult> {
  const contents: Content[] = toContents(turns);
  const undo: Undo[] = [];
  let pending: Pending | null = null;
  let writes = 0;
  let text = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const parts = await askParts(system, contents, AGENT_TOOLS, 900);
    const said = parts.map((p) => p.text ?? "").join("").trim();
    if (said) text = said;
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) break;

    contents.push({ role: "model", parts });
    const answers: Part[] = [];
    for (const c of calls) {
      const name = String(c.functionCall.name ?? "");
      const args = (c.functionCall.args ?? {}) as Record<string, unknown>;
      let out: Record<string, unknown>;
      if (name === "find") {
        out = await callFind(user, args);
      } else if (name !== "api") {
        out = { error: `нет инструмента ${name}` };
      } else {
        const method = String(args.method ?? "GET").toUpperCase();
        const path = String(args.path ?? "");
        // Удаление и длинная череда правок — только с кнопкой подтверждения.
        if (method !== "GET" && (method === "DELETE" || writes >= MAX_WRITES) && !pending) {
          pending = { method, path, body: args.body ?? null };
          out = { pending: true, note: "человеку показана кнопка подтверждения, скажи словами, что именно сделаешь" };
        } else if (method !== "GET" && pending) {
          out = { error: "сначала дождись подтверждения предыдущего действия" };
        } else {
          if (method !== "GET") writes++;
          out = await callApi(user, args, undo);
        }
      }
      answers.push({ functionResponse: { name, response: out } });
    }
    contents.push({ role: "user", parts: answers });
    // Ходы кончились, а модель всё зовёт инструменты — просим ответить словами.
    if (step === MAX_STEPS - 1) {
      contents.push({ role: "user", parts: [{ text: "Хватит вызовов. Ответь человеку текстом, что сделано." }] });
      const last = await askParts(system, contents, [], 400);
      text = last.map((p) => p.text ?? "").join("").trim() || text;
    }
  }

  if (pending) {
    const ts = Date.now();
    await saveState(user, { ts, pending, what: describe(pending.method, pending.path) });
    return {
      text: text || t(user, "Готов выполнить. Подтверди."),
      keyboard: [[
        { text: t(user, "Да, сделай"), callback_data: `ay:${ts.toString(36)}` },
        { text: t(user, "Отмена"), callback_data: `an:${ts.toString(36)}` },
      ]],
    };
  }
  if (undo.length) {
    const ts = Date.now();
    await saveState(user, { ts, undo });
    return {
      text: text || t(user, "Готово."),
      keyboard: [[{ text: t(user, "Отменить"), callback_data: `az:${ts.toString(36)}` }]],
    };
  }
  if (stateOf(user)) await saveState(user, null);
  return { text };
}

/** Кнопка «Отменить»: возвращаем записи в прежний вид. */
export async function undoAgent(user: User, key: string): Promise<string> {
  const st = stateOf(user);
  if (!st?.undo?.length || st.ts.toString(36) !== key) return t(user, "Отменять уже нечего");
  // В обратном порядке: сначала снимаем последнюю правку.
  for (const u of [...st.undo].reverse()) {
    if (u.op === "delete" && u.id) await db.from(u.table).delete().eq("id", u.id).eq("user_id", user.id);
    else if (u.op === "update" && u.id && u.row) await db.from(u.table).update(u.row).eq("id", u.id).eq("user_id", user.id);
    else if (u.op === "insert" && u.row) await db.from(u.table).insert(u.row);
  }
  await saveState(user, null);
  return t(user, "Вернул как было");
}

/** Кнопки под отложенным действием: выполнить или забыть. */
export async function confirmAgent(user: User, key: string, yes: boolean): Promise<AgentResult> {
  const st = stateOf(user);
  if (!st?.pending || st.ts.toString(36) !== key) return { text: t(user, "Уже неактуально") };
  await saveState(user, null);
  if (!yes) return { text: t(user, "Отменил") };
  const undo: Undo[] = [];
  const out = await callApi(user, st.pending, undo);
  if (out.error) return { text: t(user, "Не вышло: {error}", { error: String(out.error) }) };
  if (!undo.length) return { text: t(user, "Сделал") };
  const ts = Date.now();
  await saveState(user, { ts, undo });
  return {
    text: t(user, "Сделал"),
    keyboard: [[{ text: t(user, "Отменить"), callback_data: `az:${ts.toString(36)}` }]],
  };
}
