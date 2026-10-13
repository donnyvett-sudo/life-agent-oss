// Показать, как выглядят сообщения коуча, не дожидаясь их времени и ничего не отправляя.
// Запуск: npx deno@2 run -A scripts/preview-messages.ts [morning|evening|weekly|all]
//
// Читает боевые данные и печатает текст в терминал. В Telegram ничего не уходит,
// в базу ничего не пишется: утренний разбор ночи (штрафы, серия) не вызывается —
// если ночь ещё не разобрана, скрипт об этом предупредит.

const REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? (() => { throw new Error("set SUPABASE_PROJECT_REF"); })();

async function run(cmd: string, args: string[]): Promise<string> {
  const out = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`${cmd}: ${new TextDecoder().decode(out.stderr).slice(0, 300)}`);
  return new TextDecoder().decode(out.stdout);
}

// Ключ service_role берётся из Supabase CLI (нужен `npx supabase login`) и нигде не печатается.
const keys = JSON.parse(
  await run("npx", ["-y", "supabase", "projects", "api-keys", "--project-ref", REF, "-o", "json"]),
) as { name: string; api_key: string }[];
Deno.env.set("SUPABASE_URL", `https://${REF}.supabase.co`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", keys.find((k) => k.name === "service_role")!.api_key);

const { db, check } = await import("../supabase/functions/_shared/db.ts");
const coach = await import("../supabase/functions/_shared/coach.ts");
const study = await import("../supabase/functions/_shared/study.ts");
const { localNow } = await import("../supabase/functions/_shared/time.ts");
type User = import("../supabase/functions/_shared/db.ts").User;

const what = Deno.args[0] ?? "all";
const user = check(
  await db.from("users").select("*").eq("is_allowed", true).order("created_at").limit(1).single(),
) as User;
const today = localNow(user.tz).date;

/** HTML Telegram → читаемый текст для терминала. */
const plain = (s: string) =>
  s.replace(/<b>|<\/b>/g, "").replace(/<i>|<\/i>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function show(title: string, msgs: ({ text: string; keyboard?: unknown } | null)[]) {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
  for (const m of msgs) {
    if (!m) continue;
    console.log(plain(m.text));
    if (m.keyboard) console.log(`[кнопки: ${JSON.stringify(m.keyboard).slice(0, 160)}]`);
    console.log("-".repeat(60));
  }
}

if (what === "morning" || what === "all") {
  const s = await coach.getSleep(user.id, today);
  const lines = ["☀️ Утро."];
  if (s) {
    lines.push(coach.sleepLine(user, s));
    if (user.state.last_eval_night === s.night_date) {
      const { verdict, notes } = coach.judgeNight(s, user.settings.sleep.bed, user.tz);
      lines.push(...notes, `(вердикт ночи: ${verdict}, серия: ${user.state.sleep_streak ?? 0})`);
    } else {
      lines.push("(ночь ещё не разобрана: штраф или награда появятся в настоящем сообщении)");
    }
  } else lines.push("Данных сна пока нет. Придут — разберу ночь отдельным сообщением.");

  const lunch = check(
    await db.from("supplements").select("name").eq("user_id", user.id).eq("slot", "lunch")
      .eq("active", true).order("sort"),
  ) as { name: string }[];
  if (lunch.length) lines.push(`💊 С обедом: ${lunch.map((x) => x.name).join(", ")}. Запиши обед — напомню.`);
  for (const d of await coach.openDebts(user.id)) lines.push(`⚖️ Долг: ${d.title}.`);

  show("УТРО (07:15)", [{ text: lines.join("\n") }, await study.morningStudy(user)]);
}

if (what === "evening" || what === "all") {
  show("ВЕЧЕР (22:00)", [{ text: await coach.eveningHeader(user) }, await study.eveningStudy(user)]);
}

if (what === "weekly" || what === "all") {
  show("НЕДЕЛЯ (вс 21:00)", [await coach.weeklyMessage(user)]);
  console.log("К этому тексту в боевом сообщении Gemini добавляет один вывод-абзац.");
}
