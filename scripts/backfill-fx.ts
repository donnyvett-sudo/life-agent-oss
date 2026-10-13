// Разовая (и повторяемая) загрузка исторических курсов валют + пересчёт amount_cny.
// Запуск: npx deno@2 run -A scripts/backfill-fx.ts [с-даты] [по-дату]
// По умолчанию: от самой ранней операции до вчера. Повторный запуск безопасен (upsert).
//
// Зачем: рабочий источник (open.er-api.com) отдаёт только сегодняшний курс, поэтому
// у импортированной истории суммы в юанях считались по самому раннему известному курсу.
// Здесь берём бесплатный исторический API без ключа и пересчитываем аналитику.
//
// amount_account НЕ трогаем: это факт списания со счёта, от него зависят сверенные балансы.

const REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? (() => { throw new Error("set SUPABASE_PROJECT_REF"); })();
const CURRENCIES = ["CNY", "KZT", "USD"];
const CONCURRENCY = 8;

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
const { makeConverter } = await import("../supabase/functions/_shared/finance.ts");
const { localNow } = await import("../supabase/functions/_shared/time.ts");

const shiftDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// --- какие даты нужны ---------------------------------------------------------
const earliest = check(
  await db.from("transactions").select("occurred_at").order("occurred_at", { ascending: true }).limit(1),
) as { occurred_at: string }[];
if (!earliest.length) throw new Error("операций нет — нечего пересчитывать");

const from = Deno.args[0] ?? earliest[0].occurred_at.slice(0, 10);
const to = Deno.args[1] ?? shiftDays(new Date().toISOString().slice(0, 10), -1);

const have = new Set(
  (check(
    await db.from("fx_rates").select("date,currency").gte("date", from).lte("date", to),
  ) as { date: string; currency: string }[]).map((r) => `${r.date}|${r.currency}`),
);

const dates: string[] = [];
for (let d = from; d <= to; d = shiftDays(d, 1)) {
  if (!CURRENCIES.every((c) => have.has(`${d}|${c}`))) dates.push(d);
}
console.log(`курсы: ${from} … ${to}, загрузить ${dates.length} дн.`);

// --- загрузка -----------------------------------------------------------------
/** Курсы за 1 USD на дату. Источник без ключа; если дня нет — берём ближайший ранее (до 5 дней). */
async function ratesFor(date: string): Promise<Record<string, number> | null> {
  for (let back = 0; back <= 5; back++) {
    const day = shiftDays(date, -back);
    const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`${day}: HTTP ${res.status}`);
    const json = await res.json() as { usd?: Record<string, number> };
    const usd = json.usd;
    if (!usd) continue;
    const out: Record<string, number> = {};
    for (const c of CURRENCIES) {
      const v = usd[c.toLowerCase()];
      if (!v) return null;
      out[c] = v;
    }
    return out;
  }
  return null;
}

type Row = { date: string; currency: string; per_usd: number };
const rows: Row[] = [];
const missed: string[] = [];
let done = 0;

async function worker(queue: string[]) {
  for (;;) {
    const date = queue.pop();
    if (!date) return;
    try {
      const r = await ratesFor(date);
      if (r) for (const c of CURRENCIES) rows.push({ date, currency: c, per_usd: r[c] });
      else missed.push(date);
    } catch (e) {
      missed.push(date);
      console.warn(`${date}: ${e instanceof Error ? e.message : e}`);
    }
    if (++done % 50 === 0) console.log(`  ${done}/${dates.length}`);
  }
}

const queue = [...dates];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

for (let i = 0; i < rows.length; i += 500) {
  check(await db.from("fx_rates").upsert(rows.slice(i, i + 500), { onConflict: "date,currency" }));
}
console.log(`загружено дней: ${rows.length / CURRENCIES.length}${missed.length ? `, пропущено: ${missed.length}` : ""}`);

// --- пересчёт сумм в юанях ----------------------------------------------------
const user = check(
  await db.from("users").select("id,tz").limit(1).single(),
) as { id: string; tz: string };

const txs = check(
  await db.from("transactions").select("id,amount,currency,amount_cny,occurred_at").neq("currency", "CNY"),
) as { id: string; amount: number; currency: string; amount_cny: number | null; occurred_at: string }[];

const conv = makeConverter();
let changed = 0;
for (const t of txs) {
  const date = localNow(user.tz, new Date(t.occurred_at)).date;
  const cny = await conv(Number(t.amount), t.currency, "CNY", date);
  if (Math.abs(cny - Number(t.amount_cny ?? 0)) < 0.005) continue;
  check(await db.from("transactions").update({ amount_cny: cny }).eq("id", t.id));
  changed++;
}
console.log(`пересчитано операций: ${changed} из ${txs.length} (в валюте, отличной от юаня)`);
