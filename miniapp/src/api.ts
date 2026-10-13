import type { Lang } from "./i18n";
import { initData } from "./tg";

// Set VITE_API_URL in miniapp/.env (https://<ref>.supabase.co/functions/v1/api).
const API: string = import.meta.env.VITE_API_URL ?? "";

declare global {
  interface Window {
    __LIFE_TOKEN__?: string;
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isMock = import.meta.env.DEV && new URLSearchParams(location.search).has("mock");

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isMock) {
    const { MOCK } = await import("./mock");
    const key = path.split("?")[0];
    // На запись мок отвечает тем же объектом, что и на чтение: иначе экран остаётся без данных.
    return (MOCK[key] ?? MOCK[`/${key.split("/")[1]}`] ?? MOCK["/today"]) as T;
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      // В Mac-приложении Life Desk Telegram нет: оболочка кладёт личный токен в window.__LIFE_TOKEN__.
      ...(window.__LIFE_TOKEN__ ? { "X-Token": window.__LIFE_TOKEN__ } : { "X-Telegram-Init-Data": initData() }),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText);
  return json as T;
}

// ------------------------------------------------------------------ типы API ---

export type Slot = "morning" | "lunch" | "evening";
export type Verdict = "good" | "meh" | "bad";

export type Night = {
  date: string;
  bed: string;
  wake: string;
  asleepMin: number;
  deepMin: number | null;
  remMin: number | null;
  coreMin: number | null;
  awakeMin: number | null;
  verdict: Verdict;
  notes: string[];
};

export type Schedule = {
  morning: string;
  lunch_fallback: string;
  evening: string;
  lights_out: string;
  weekly: string;
  weekly_dow: number;
};

export type Today = {
  date: string;
  today: string;
  minDate: string;
  time: string;
  schedule: Schedule;
  sleepTarget: { bed: string; wake: string };
  supplements: {
    id: string;
    name: string;
    slot: Slot;
    status: "taken" | "skipped" | null;
    daysLeft: number | null;
    canRefill: boolean;
  }[];
  sleep: Night | null;
  body: {
    steps: number | null;
    restingHr: number | null;
    stepGoal: number;
    weightKg: number | null;
    weightDate: string | null;
  };
  // Панели главного экрана: home — что показывать и в каком порядке, allPanels — что вообще есть.
  home: string[];
  allPanels: string[];
  classes: { id: string; course: string | null; kind: string; title: string | null; start: string; end: string; room: string | null }[];
  habits: { id: string; title: string; note: string | null; done: boolean; due: boolean; streak: number }[];
  study: { id: string; kind: "assignment" | "exam"; course: string | null; title: string; date: string | null; note: string | null }[];
  milestones: { id: string; title: string; project: string; date: string | null }[];
  streak: number;
  cheatToday: boolean;
  debts: { id: string; title: string }[];
  rewards: { id: string; title: string }[];
  spending: {
    totals: { currency: string; amount: number }[];
    items: { id: string; note: string; category: string | null; amount: number; currency: string; time: string }[];
  };
};

export type SleepHistory = {
  target: { bed: string; wake: string };
  today: string;
  days: number;
  nights: Night[];
};

export type SupplementSettings = {
  id: string;
  name: string;
  slot: Slot;
  active: boolean;
  unitsPerIntake: number;
  unitsPerPack: number | null;
  unitsLeft: number | null;
};

export type Profile = {
  about: string;
  name: string;
  currency: Currency;
  github: "own" | "server" | "none";
  githubLogin: string | null;
};

export type Settings = {
  tz: string;
  lang: Lang;
  profile: Profile;
  schedule: Schedule;
  sleep: { bed: string; wake: string };
  coach: { frequency: "quiet" | "normal" | "active" };
  ai: { left: number; limit: number };
  supplements: SupplementSettings[];
};

export type Currency = "CNY" | "KZT" | "USD";

export type FinAccount = {
  id: string;
  title: string;
  currency: Currency;
  balance: number;
  balanceCny: number;
  balanceDisplay: number;
  openingBalance: number;
  isDefault: boolean;
  inTotal: boolean;
  isArchived: boolean;
};

export type FinTransaction = {
  id: string;
  kind: "expense" | "income";
  amount: number;
  currency: Currency;
  amountCny: number | null;
  amountDisplay: number;
  note: string | null;
  categoryId: string | null;
  accountId: string | null;
  date: string;
  time: string | null;
};

export type FinTransfer = {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  toAmount: number;
  note: string | null;
  date: string;
};

export type Finance = {
  month: string;
  currency: Currency;
  prev: string;
  next: string | null;
  expense: number;
  income: number;
  byCategory: { id: string | null; title: string; amount: number }[];
  accounts: FinAccount[];
  totalCny: number;
  total: number;
  categories: { id: string; kind: "expense" | "income"; title: string }[];
  transactions: FinTransaction[];
  transfers: FinTransfer[];
};

export type BudgetRow = {
  id: string;
  categoryId: string | null;
  title: string;
  amount: number;
  currency: Currency;
  spent: number;
  pct: number;
};

export type Subscription = {
  note: string;
  amount: number;
  currency: Currency;
  period: "week" | "month" | "quarter" | "year";
  count: number;
  last: string;
  next: string;
  perMonth: number;
  overdue: boolean;
};

export type CourseRef = { id: string; short: string; aiPolicy: string } | null;

export type StudyAssignment = {
  id: string;
  course: CourseRef;
  title: string;
  details: string | null;
  dueDate: string | null;
  dueNote: string | null;
  done: boolean;
  fromStudyAgent: boolean;
};

export type StudyExam = {
  id: string;
  course: CourseRef;
  kind: "quiz" | "final" | "presentation" | "other";
  title: string;
  topic: string | null;
  date: string | null;
  dateTo: string | null;
  tentative: boolean;
  notes: string | null;
  fromStudyAgent: boolean;
};

export type Study = {
  today: string;
  week: string;
  thisWeek: string;
  courses: { id: string; short: string; title: string; aiPolicy: string }[];
  assignments: StudyAssignment[];
  recentlyDone: StudyAssignment[];
  exams: StudyExam[];
  sessions: { id: string; course: CourseRef; kind: string; title: string | null; date: string; start: string; end: string; room: string | null }[];
  focus: {
    weekMin: number;
    todayMin: number;
    byCourse: { course: CourseRef; minutes: number }[];
    running: { id: string; plannedMin: number; startedAt: string; course: CourseRef } | null;
  };
  cards: { total: number; due: number; byBox: number[]; reviewedWeek: number; correctWeek: number };
};

export type Milestone = {
  id: string;
  title: string;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
};

export type Project = {
  id: string;
  title: string;
  goal: string | null;
  status: "idea" | "active" | "paused" | "done";
  repo: string | null;
  dueDate: string | null;
  milestones: Milestone[];
};

export type Career = {
  today: string;
  projects: Project[];
  github: { from: string; days: { date: string; count: number }[]; streak: number; weekActive: number } | null;
};

export type Habit = {
  id: string;
  title: string;
  kind: "daily" | "weekly" | "interval";
  target: number;
  days: number[] | null;
  note: string | null;
  isHard: boolean;
  active: boolean;
  due: boolean;
  doneToday: boolean;
  streak: number;
  weekDone: number;
  lastDone: string | null;
  dates: string[];
};

export type Habits = {
  today: string;
  from: string;
  habits: Habit[];
  dueCount: number;
};


export type MealItem = { name: string; grams: number; kcal: number; p: number; f: number; c: number };
export type Macros = { kcal: number; protein: number; fat: number; carbs: number };
export type Meal = Macros & {
  id: string;
  time: string;
  title: string;
  items: MealItem[];
  confidence: number | null;
  status: "pending" | "confirmed";
  source: string;
  corrected: boolean;
};
export type FoodDay = { date: string; today: string; targets: Macros; totals: Macros; meals: Meal[] };
export type FoodHistory = {
  today: string;
  days: number;
  targets: Macros;
  series: (Macros & { date: string; meals: number })[];
  weights: { date: string; kg: number; avg: number }[];
  tdee: { tdee: number; slopeKgPerWeek: number; avgKcal: number } | null;
};
export type Dish = { key: string; name: string; grams: number; kcal: number; protein: number; fat: number; carbs: number; uses: number };
