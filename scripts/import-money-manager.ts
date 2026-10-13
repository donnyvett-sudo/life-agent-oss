// Разовый импорт истории из бэкапа Money Manager (.mmbackup = 8 байт заголовка + ZIP с SQLite).
// Запуск: npx deno@2 run -A scripts/import-money-manager.ts imports/<файл>.mmbackup
// Повторный запуск безопасен: всё пишется upsert-ом по external_id («mm:<uid>»).
// Ключ service_role берётся из Supabase CLI (нужен `npx supabase login`) и нигде не печатается.

const REF = Deno.env.get("SUPABASE_PROJECT_REF") ?? (() => { throw new Error("set SUPABASE_PROJECT_REF"); })();
const TZ_OFFSET = "+08:00"; // даты в бэкапе без времени — ставим полдень по Шанхаю

const file = Deno.args[0];
if (!file) throw new Error("укажи путь к .mmbackup");

async function run(cmd: string, args: string[]): Promise<string> {
  const out = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  if (!out.success) throw new Error(`${cmd}: ${new TextDecoder().decode(out.stderr).slice(0, 300)}`);
  return new TextDecoder().decode(out.stdout);
}

// --- ключ и клиент ------------------------------------------------------------
const keys = JSON.parse(await run("npx", ["-y", "supabase", "projects", "api-keys", "--project-ref", REF, "-o", "json"])) as {
  name: string;
  api_key: string;
}[];
Deno.env.set("SUPABASE_URL", `https://${REF}.supabase.co`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", keys.find((k) => k.name === "service_role")!.api_key);

const { db, check } = await import("../supabase/functions/_shared/db.ts");
const fin = await import("../supabase/functions/_shared/finance.ts");

// --- распаковка ----------------------------------------------------------------
const tmp = await Deno.makeTempDir();
const bytes = await Deno.readFile(file);
await Deno.writeFile(`${tmp}/mm.zip`, bytes.subarray(8));
await run("unzip", ["-o", "-q", `${tmp}/mm.zip`, "-d", tmp]);
const DB = `${tmp}/MyFinance.db`;

// deno-lint-ignore no-explicit-any
async function q<T = any>(sql: string): Promise<T[]> {
  const out = await run("sqlite3", ["-json", DB, sql]);
  return out.trim() ? JSON.parse(out) : [];
}

const owner = check(await db.from("users").select("id").eq("is_owner", true).single()) as { id: string };
const userId = owner.id;
const ext = (uid: string) => `mm:${uid}`;
const money = (cents: number | string | null) => Math.round(Number(cents ?? 0)) / 100;
const noon = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00${TZ_OFFSET}`).toISOString();

async function batches<T>(rows: T[], fn: (chunk: T[]) => Promise<void>, size = 400) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// --- счета ---------------------------------------------------------------------
type MmAccount = {
  uid: string; title: string; currencyCode: string; ignoreInBalance: number;
  isActive: number; isRemoved: number; isArchived: number; position: number;
};
const mmAccounts = await q<MmAccount>(`select uid,title,currencyCode,ignoreInBalance,isActive,isRemoved,isArchived,position from account`);

// Основной счёт валюты — самый используемый за последние 90 дней (из учитываемых в балансе).
const usage = await q<{ acc: string; n: number }>(`
  select l.otherUid acc, count(*) n from "transaction" t
  join sync_link l on l.entityType='Transaction' and l.entityUid=t.uid and l.otherType='Account' and l.isRemoved=0
  where t.isRemoved=0 and t.date >= date('now','-90 days') group by 1`);
const used = new Map(usage.map((u) => [u.acc, u.n]));
const defaults = new Set<string>();
for (const cur of ["CNY", "KZT", "USD"]) {
  const best = mmAccounts
    .filter((a) => a.currencyCode === cur && !a.isRemoved && !a.isArchived && !a.ignoreInBalance)
    .sort((a, b) => (used.get(b.uid) ?? 0) - (used.get(a.uid) ?? 0))[0] ??
    mmAccounts.filter((a) => a.currencyCode === cur && !a.isRemoved)[0];
  if (best) defaults.add(best.uid);
}

check(
  await db.from("accounts").upsert(
    mmAccounts.map((a) => ({
      user_id: userId,
      external_id: ext(a.uid),
      title: a.title?.trim() || `Счёт ${a.currencyCode}`,
      currency: a.currencyCode,
      in_total: !a.ignoreInBalance,
      is_archived: Boolean(a.isRemoved || a.isArchived || a.isActive === 0),
      is_default: defaults.has(a.uid),
      sort: a.position ?? 0,
    })),
    { onConflict: "user_id,external_id" },
  ),
);
const accRows = check(await db.from("accounts").select("id,external_id,currency").eq("user_id", userId)) as {
  id: string; external_id: string | null; currency: string;
}[];
const accId = new Map(accRows.filter((a) => a.external_id).map((a) => [a.external_id!.slice(3), a.id]));
console.log(`счета: ${mmAccounts.length}`);

// --- категории -----------------------------------------------------------------
const cats = await fin.ensureCategories(userId);
const mmCats = await q<{ uid: string; title: string; type: string; isRemoved: number }>(
  `select uid,title,type,isRemoved from category`,
);
const catId = new Map<string, string>();
for (const c of mmCats) {
  const kind = c.type === "Income" ? "income" : "expense";
  const title = (c.title ?? "").trim();
  const def = fin.CATEGORY_DEFS.find((d) => d.kind === kind && d.mm?.includes(title));
  let target = cats.find((x) => x.kind === kind && x.code === (def?.code ?? ""));
  // Удалённые в Money Manager категории не заводим: их редкие операции уйдут в «Прочее».
  if (!target && c.isRemoved) target = cats.find((x) => x.kind === kind && x.code === "other");
  if (!target) {
    // Своя категория из Money Manager, которой нет в словаре.
    target = check(
      await db.from("categories").upsert(
        { user_id: userId, kind, title, external_id: ext(c.uid), sort: 100 },
        { onConflict: "user_id,external_id" },
      ).select("*").single(),
    ) as typeof cats[number];
  }
  catId.set(c.uid, target.id);
}
const otherId = (kind: string) => cats.find((x) => x.kind === kind && x.code === "other")!.id;

// --- операции ------------------------------------------------------------------
type MmTx = {
  uid: string; type: string; date: string; comment: string | null;
  def: number; real: number | null; realCur: string | null; acc: number | null; accCur: string | null;
  account: string | null; category: string | null;
};
const txs = await q<MmTx>(`
  select t.uid, t.type, t.date, t.comment,
         t.amountInDefaultCurrency def, t.amountInRealCurrency real, t.realCurrencyCode realCur,
         t.amountInAccountCurrency acc, t.accountCurrencyCode accCur,
         (select otherUid from sync_link l where l.entityType='Transaction' and l.entityUid=t.uid and l.otherType='Account' and l.isRemoved=0 limit 1) account,
         (select otherUid from sync_link l where l.entityType='Transaction' and l.entityUid=t.uid and l.otherType='Category' and l.isRemoved=0 limit 1) category
  from "transaction" t where t.isRemoved=0`);
const accCurrency = new Map(mmAccounts.map((a) => [a.uid, a.currencyCode]));

const txRows = txs.map((t) => {
  const kind = t.type === "Income" ? "income" : "expense";
  const hasReal = Boolean(t.realCur);
  const currency = t.realCur || t.accCur || accCurrency.get(t.account ?? "") || "CNY";
  const amount = money(hasReal ? t.real : t.acc);
  const amountAccount = money(t.acc != null && String(t.acc) !== "" ? t.acc : t.real);
  return {
    user_id: userId,
    external_id: ext(t.uid),
    kind,
    amount,
    currency,
    amount_account: amountAccount,
    amount_cny: money(t.def),
    note: t.comment?.trim() || null,
    raw_text: null,
    occurred_at: noon(t.date),
    account_id: t.account ? accId.get(t.account) ?? null : null,
    category_id: (t.category && catId.get(t.category)) || otherId(kind),
    source: "import",
  };
}).filter((t) => t.amount > 0);

await batches(txRows, async (chunk) => {
  check(await db.from("transactions").upsert(chunk, { onConflict: "user_id,external_id" }));
});
console.log(`операции: ${txRows.length} (расходы ${txRows.filter((t) => t.kind === "expense").length}, доходы ${txRows.filter((t) => t.kind === "income").length})`);

// --- переводы ------------------------------------------------------------------
const trs = await q<{
  uid: string; date: string; comment: string | null; fromAmount: number; toAmount: number | null;
  fromAcc: string; toAcc: string;
}>(`
  select f.uid, f.date, f.comment, f.fromAmount, f.toAmount,
         (select otherUid from sync_link l where l.entityType='Transfer' and l.entityUid=f.uid and l.otherType='FromAccount' and l.isRemoved=0 limit 1) fromAcc,
         (select otherUid from sync_link l where l.entityType='Transfer' and l.entityUid=f.uid and l.otherType='ToAccount' and l.isRemoved=0 limit 1) toAcc
  from transfer f where f.isRemoved=0`);
const trRows = trs
  .filter((f) => accId.get(f.fromAcc) && accId.get(f.toAcc) && f.fromAcc !== f.toAcc)
  .map((f) => ({
    user_id: userId,
    external_id: ext(f.uid),
    from_account_id: accId.get(f.fromAcc)!,
    to_account_id: accId.get(f.toAcc)!,
    from_amount: money(f.fromAmount),
    to_amount: money(f.toAmount != null && String(f.toAmount) !== "" && Number(f.toAmount) > 0 ? f.toAmount : f.fromAmount),
    note: f.comment?.trim() || null,
    occurred_at: noon(f.date),
  }));
await batches(trRows, async (chunk) => {
  check(await db.from("transfers").upsert(chunk, { onConflict: "user_id,external_id" }));
});
console.log(`переводы: ${trRows.length} из ${trs.length}`);

// --- правила автокатегорий из истории ---------------------------------------------
// Описание встречалось ≥ 2 раз и ≥ 60% раз в одной категории → правило.
const stats = new Map<string, Map<string, number>>();
for (const t of txRows) {
  if (!t.note || !t.category_id) continue;
  const key = `${t.kind}|${fin.normalizeNote(t.note)}`;
  if (!key.split("|")[1]) continue;
  const m = stats.get(key) ?? new Map<string, number>();
  m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1);
  stats.set(key, m);
}
const rules = [...stats].flatMap(([key, m]) => {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const [cat, n] = [...m].sort((a, b) => b[1] - a[1])[0];
  const [kind, keyword] = key.split("|");
  return total >= 2 && n / total >= 0.6 ? [{ user_id: userId, kind, keyword, category_id: cat, hits: n }] : [];
});
await batches(rules, async (chunk) => {
  check(await db.from("category_rules").upsert(chunk, { onConflict: "user_id,kind,keyword" }));
});
console.log(`правила категорий: ${rules.length}`);

// --- старые записи бота (этап 1) без счёта и суммы в юанях -------------------------
const user = check(await db.from("users").select("tz").eq("id", userId).single()) as { tz: string };
const legacy = check(
  await db.from("transactions").select("id,kind,note,amount,currency").eq("user_id", userId).is("amount_cny", null),
) as { id: string; kind: "expense" | "income"; note: string | null }[];
for (const t of legacy) {
  const acc = await fin.defaultAccount(userId, (t as unknown as { currency: string }).currency);
  const cat = await fin.resolveCategory(userId, t.kind, t.note ?? "");
  check(await db.from("transactions").update({ account_id: acc?.id ?? null, category_id: cat?.id ?? null }).eq("id", t.id));
  await fin.recalcTransaction(userId, user.tz, t.id);
}
console.log(`дополнены записи бота: ${legacy.length}`);

// --- сверка балансов с Money Manager ------------------------------------------------
const stored = await q<{ uid: string; value: number }>(`select uid, value from account_balance`);
const { data: balances } = await db.rpc("account_balances", { p_user: userId });
const byId = new Map((balances as { account_id: string; balance: number }[]).map((b) => [b.account_id, Number(b.balance)]));
let mismatches = 0;
for (const s of stored) {
  const id = accId.get(s.uid);
  if (!id) continue;
  // Записи бота после выгрузки тоже меняют баланс — сверяем только импортированное.
  const { data: botRows } = await db.from("transactions").select("kind,amount_account").eq("account_id", id).neq("source", "import");
  const botDelta = (botRows ?? []).reduce((a, r) => a + (r.kind === "income" ? 1 : -1) * Number(r.amount_account ?? 0), 0);
  const diff = Math.round(((byId.get(id) ?? 0) - botDelta - money(s.value)) * 100) / 100;
  if (diff !== 0) {
    mismatches++;
    console.log(`  расхождение на счёте ${accCurrency.get(s.uid)}: ${diff}`);
  }
}
console.log(mismatches ? `балансы: расхождений ${mismatches}` : "балансы совпадают с Money Manager");
await Deno.remove(tmp, { recursive: true });
