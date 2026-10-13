// Разбор сна из iOS «Команд» (Health → Sleep Analysis). Чистые функции, без БД.

export type Stage = "inbed" | "awake" | "deep" | "rem" | "core" | "asleep";
export type Sample = { start: Date; end: Date; stage: Stage };

export type SleepSummary = {
  bed_at: Date;
  wake_at: Date;
  asleep_min: number;
  in_bed_min: number | null;
  deep_min: number;
  rem_min: number;
  core_min: number;
  awake_min: number;
};

/** Значения Sleep Analysis на английском и русском iOS. */
export function stageOf(value: string): Stage | null {
  const v = value.toLowerCase();
  if (/(awake|бодрств)/.test(v)) return "awake";
  if (/(in ?bed|в кровати|в постели)/.test(v)) return "inbed";
  if (/(deep|глубок)/.test(v)) return "deep";
  if (/(rem|быстр)/.test(v)) return "rem";
  if (/(core|ядро|основн|легк|лёгк)/.test(v)) return "core";
  if (/(asleep|сон|спит)/.test(v)) return "asleep";
  return null;
}

type RawSample = { start?: unknown; end?: unknown; value?: unknown };

/**
 * Принимает { samples: [{start, end, value}] } или { text: "start;end;value\n..." }
 * (Shortcuts проще собрать текстом). Даты — ISO 8601.
 */
export function parseSamples(body: unknown): Sample[] {
  const b = (body ?? {}) as { samples?: RawSample[]; text?: string };
  let raw: RawSample[] = [];
  if (Array.isArray(b.samples)) raw = b.samples;
  else if (typeof b.text === "string") {
    raw = b.text.split(/\r?\n/).map((line) => {
      const [start, end, ...rest] = line.split(/[;|\t]/).map((s) => s.trim());
      return { start, end, value: rest.join(" ") };
    });
  }
  const out: Sample[] = [];
  for (const r of raw) {
    const start = new Date(String(r.start ?? ""));
    const end = new Date(String(r.end ?? ""));
    const stage = stageOf(String(r.value ?? ""));
    if (!stage || isNaN(+start) || isNaN(+end) || end <= start) continue;
    out.push({ start, end, stage });
  }
  return out;
}

export type ManualSleep = { bedMin: number; wakeMin: number; daysBack: number };

const toMin = (h: string, m: string) => Number(h) * 60 + Number(m);

/**
 * Ручной ввод ночи: «/sleep 00:10 08:40», «вчера 23.40 7:00».
 * Возвращает минуты от полуночи и сколько дней назад ночь (0 — сегодняшнее утро).
 */
export function parseManualSleep(text: string): ManualSleep | null {
  const m = text.match(/(\d{1,2})[:.](\d{2})\D+(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const bedMin = toMin(m[1], m[2]);
  const wakeMin = toMin(m[3], m[4]);
  if (Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
  return { bedMin, wakeMin, daysBack: /(вчера|yesterday)/i.test(text) ? 1 : 0 };
}

type Interval = [number, number];

function union(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const minutes = (list: Interval[]) => list.reduce((acc, [s, e]) => acc + (e - s), 0) / 60_000;

function clip(list: Interval[], [from, to]: Interval): Interval[] {
  return list
    .map(([s, e]) => [Math.max(s, from), Math.min(e, to)] as Interval)
    .filter(([s, e]) => e > s);
}

const MAX_GAP_MS = 2 * 60 * 60_000;
/** Короче трёх часов — это дневной сон, а не ночь. */
const NIGHT_MIN_MS = 3 * 60 * 60_000;

/**
 * Все ночи в присланных данных, по возрастанию. Объединяем «спящие» интервалы
 * (часы и телефон пишут дубли), склеиваем разрывы < 2 ч и отбрасываем дневной сон.
 * Если ни один блок не дотянул до ночи — возвращаем самый длинный, чтобы короткая
 * ночь всё же записалась.
 */
export function summarizeAll(samples: Sample[]): SleepSummary[] {
  const asleepStages: Stage[] = ["deep", "rem", "core", "asleep"];
  const asleep = union(
    samples.filter((s) => asleepStages.includes(s.stage)).map((s) => [+s.start, +s.end]),
  );
  if (asleep.length === 0) return [];

  const blocks: Interval[] = [];
  for (const [s, e] of asleep) {
    const last = blocks[blocks.length - 1];
    if (last && s - last[1] < MAX_GAP_MS) last[1] = Math.max(last[1], e);
    else blocks.push([s, e]);
  }
  let nights = blocks.filter(([s, e]) => e - s >= NIGHT_MIN_MS);
  if (nights.length === 0) nights = [blocks.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))];

  return nights.map((main) => {
    const of = (stage: Stage) =>
      minutes(clip(union(samples.filter((s) => s.stage === stage).map((s) => [+s.start, +s.end])), main));
    const inBed = union(samples.filter((s) => s.stage === "inbed").map((s) => [+s.start, +s.end]))
      .filter(([s, e]) => e > main[0] && s < main[1]);

    return {
      bed_at: new Date(main[0]),
      wake_at: new Date(main[1]),
      asleep_min: Math.round(minutes(clip(asleep, main))),
      in_bed_min: inBed.length ? Math.round(minutes(inBed)) : null,
      deep_min: Math.round(of("deep")),
      rem_min: Math.round(of("rem")),
      core_min: Math.round(of("core")),
      awake_min: Math.round(of("awake")),
    };
  });
}

/**
 * Ночь привязана к дате пробуждения, и на одну дату может прийти два блока:
 * ночь и долгий дневной сон после неё. Оставляем на дату самый длинный —
 * иначе трёхчасовой дневной сон затрёт восьмичасовую ночь.
 */
export function mainNights(nights: SleepSummary[], dateOf: (d: Date) => string): SleepSummary[] {
  const best = new Map<string, SleepSummary>();
  for (const n of nights) {
    const date = dateOf(n.wake_at);
    const prev = best.get(date);
    if (!prev || n.asleep_min > prev.asleep_min) best.set(date, n);
  }
  return [...best.values()].sort((a, b) => +a.wake_at - +b.wake_at);
}

/**
 * Последняя ночь в данных. Раньше брали самый длинный блок — и когда часы
 * синхронизировались с опозданием и присылали две ночи, свежая короткая ночь
 * проигрывала вчерашней длинной.
 */
export function summarize(samples: Sample[]): SleepSummary | null {
  const all = summarizeAll(samples);
  return all.length ? all[all.length - 1] : null;
}
