// Демо-данные для локального просмотра вёрстки: `npm run dev` → http://localhost:5173/life-coach-app/?mock
// В продакшен-сборку не попадает (import.meta.env.DEV).
import type { BudgetRow, Career, Dish, Finance, FoodDay, FoodHistory, Habits, Settings, SleepHistory, Study, Subscription, Today } from "./api";

function day(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const beds = ["23:05", "00:40", "22:55", "23:20", "01:35", "23:00", "23:10", "22:50", "23:45", "00:10", "23:05", "22:58", "23:30", "23:02"];
const sleeps = [470, 350, 480, 440, 320, 475, 455, 490, 400, 380, 465, 485, 420, 468];

const nights = beds.map((bed, i) => {
  const asleep = sleeps[i];
  const verdict = asleep < 360 || bed.startsWith("01") || bed.startsWith("00:4") ? "bad" : asleep >= 390 && (bed <= "23:20" && bed >= "22") ? "good" : "meh";
  return {
    date: day(i - beds.length + 1),
    bed,
    wake: "07:0" + (i % 6),
    asleepMin: asleep,
    deepMin: 60 + (i % 4) * 10,
    remMin: 90 + (i % 3) * 15,
    coreMin: asleep - 170,
    awakeMin: 12,
    verdict: verdict as "good" | "meh" | "bad",
    notes: verdict === "bad" ? [`Засыпание в ${bed}, на 1 ч 35 м позже цели.`, "Сна 5 ч 20 м. Не планируй сложное после 16:00."] : [],
  };
}).filter((_, i) => i !== 9);

const schedule = { morning: "07:15", lunch_fallback: "14:30", evening: "22:00", lights_out: "22:45", weekly: "21:00", weekly_dow: 0 };

export const MOCK: Record<string, unknown> = {
  "/today": {
    date: day(0),
    today: day(0),
    minDate: day(-60),
    time: "13:05",
    schedule,
    sleepTarget: { bed: "23:00", wake: "07:00" },
    supplements: [
      { id: "1", name: "Fish oil", slot: "lunch", status: "taken", daysLeft: 24, canRefill: true },
      { id: "2", name: "Vitamin D", slot: "lunch", status: null, daysLeft: 4, canRefill: true },
      { id: "3", name: "Vitamin C", slot: "lunch", status: "skipped", daysLeft: null, canRefill: false },
      { id: "4", name: "Magnesium", slot: "evening", status: null, daysLeft: 40, canRefill: true },
    ],
    sleep: nights[nights.length - 1],
    body: { steps: 6480, restingHr: 58, stepGoal: 8000, weightKg: 71.4, weightDate: day(0) },
    streak: 3,
    cheatToday: false,
    // В моке включены все панели: так видно каждую, когда правишь вид экрана.
    home: ["sleep", "body", "supplements", "spending", "classes", "habits", "study", "milestones"],
    allPanels: ["sleep", "body", "supplements", "spending", "classes", "habits", "study", "milestones"],
    classes: [
      { id: "c1", course: "Statistics", kind: "lecture", title: null, start: "08:00", end: "09:40", room: "R101" },
      { id: "c2", course: "Programming", kind: "lab", title: "Loops", start: "10:00", end: "11:40", room: "R102" },
    ],
    habits: [
      { id: "h1", title: "Спорт", note: null, done: false, due: true, streak: 0 },
      { id: "h2", title: "Позвонить домой", note: null, done: true, due: false, streak: 4 },
    ],
    study: [
      { id: "a1", kind: "assignment", course: "Programming", title: "Lab 3", date: day(1), note: null },
      { id: "e1", kind: "exam", course: "Statistics", title: "Quiz 2", date: day(4), note: "quiz" },
    ],
    milestones: [{ id: "m1", title: "First screen", project: "Side project", date: day(6) }],
    debts: [{ id: "d1", title: "40 отжиманий до 20:00" }],
    rewards: [],
    spending: {
      totals: [{ currency: "CNY", amount: 53 }, { currency: "KZT", amount: 1500 }],
      items: [
        { id: "t1", note: "обед", category: "Кафе", amount: 35, currency: "CNY", time: "12:40" },
        { id: "t2", note: "такси", category: "Транспорт", amount: 18, currency: "CNY", time: "09:10" },
        { id: "t3", note: "подписка", category: "Подписки", amount: 1500, currency: "KZT", time: "08:02" },
      ],
    },
  } satisfies Today,
  "/sleep": { target: { bed: "23:00", wake: "07:00" }, today: day(0), days: 14, nights } satisfies SleepHistory,
  "/settings": {
    tz: "Asia/Shanghai",
    lang: (localStorage.getItem("lang") === "en" ? "en" : "ru") as "ru" | "en",
    profile: { about: "", name: "Alex", currency: "CNY", github: "none", githubLogin: null },
    schedule,
    sleep: { bed: "23:00", wake: "07:00" },
    coach: { frequency: "normal" },
    ai: { left: 11, limit: 15 },
    supplements: [
      { id: "1", name: "Fish oil", slot: "lunch", active: true, unitsPerIntake: 1, unitsPerPack: 60, unitsLeft: 24 },
      { id: "2", name: "Vitamin D", slot: "lunch", active: true, unitsPerIntake: 1, unitsPerPack: 90, unitsLeft: 4 },
      { id: "3", name: "Vitamin C", slot: "lunch", active: true, unitsPerIntake: 1, unitsPerPack: null, unitsLeft: null },
      { id: "4", name: "Magnesium", slot: "evening", active: true, unitsPerIntake: 2, unitsPerPack: 120, unitsLeft: 80 },
    ],
  } satisfies Settings,
};

const cats = [
  ["c1", "expense", "Кафе"], ["c2", "expense", "Продукты"], ["c3", "expense", "Транспорт"], ["c4", "expense", "Дом"],
  ["c5", "expense", "Подписки"], ["c6", "expense", "Прочее"], ["i1", "income", "От семьи"], ["i2", "income", "Проценты и кэшбэк"],
] as const;

MOCK["/finance"] = {
  month: day(0).slice(0, 7),
  currency: "CNY",
  total: 5825.6,
  prev: "2026-08",
  next: null,
  expense: 2842.5,
  income: 3200,
  byCategory: [
    { id: "c1", title: "Кафе", amount: 1210 },
    { id: "c2", title: "Продукты", amount: 640.5 },
    { id: "c3", title: "Транспорт", amount: 402 },
    { id: "c4", title: "Дом", amount: 380 },
    { id: "c5", title: "Подписки", amount: 210 },
  ],
  accounts: [
    { id: "a1", title: "Cash", currency: "CNY", balance: 1547.1, balanceCny: 1547.1, balanceDisplay: 1547.1, openingBalance: 0, isDefault: true, inTotal: true, isArchived: false },
    { id: "a2", title: "Card", currency: "CNY", balance: 3.2, balanceCny: 3.2, balanceDisplay: 3.2, openingBalance: 0, isDefault: false, inTotal: true, isArchived: false },
    { id: "a3", title: "Savings", currency: "KZT", balance: 284814, balanceCny: 4275.3, balanceDisplay: 4275.3, openingBalance: 0, isDefault: true, inTotal: true, isArchived: false },
    { id: "a4", title: "USD account", currency: "USD", balance: 764.24, balanceCny: 5131, balanceDisplay: 5131, openingBalance: 0, isDefault: true, inTotal: false, isArchived: false },
    { id: "a5", title: "Old card", currency: "KZT", balance: 0, balanceCny: 0, balanceDisplay: 0, openingBalance: 0, isDefault: false, inTotal: false, isArchived: true },
  ],
  totalCny: 5825.6,
  categories: cats.map(([id, kind, title]) => ({ id, kind, title })),
  transactions: [
    { id: "t1", kind: "expense", amount: 35, currency: "CNY", amountCny: 35, amountDisplay: 35, note: "обед", categoryId: "c1", accountId: "a1", date: day(0), time: "12:40" },
    { id: "t2", kind: "expense", amount: 18, currency: "CNY", amountCny: 18, amountDisplay: 18, note: "такси", categoryId: "c3", accountId: "a1", date: day(0), time: "09:10" },
    { id: "t3", kind: "expense", amount: 1500, currency: "KZT", amountCny: 22.5, amountDisplay: 22.5, note: "подписка", categoryId: "c5", accountId: "a3", date: day(-1), time: "08:02" },
    { id: "t4", kind: "income", amount: 3000, currency: "CNY", amountCny: 3000, amountDisplay: 3000, note: "family", categoryId: "i1", accountId: "a1", date: day(-2), time: null },
    { id: "t5", kind: "expense", amount: 42, currency: "CNY", amountCny: 42, amountDisplay: 42, note: "snacks and drinks", categoryId: "c2", accountId: "a1", date: day(-2), time: null },
  ],
  transfers: [
    { id: "f1", fromAccountId: "a3", toAccountId: "a4", fromAmount: 40000, toAmount: 88, note: null, date: day(-1) },
  ],
} satisfies Finance;

MOCK["/budgets"] = [
  { id: "b0", categoryId: null, title: "Всего за месяц", amount: 4000, currency: "CNY", spent: 2842.5, pct: 71 },
  { id: "b1", categoryId: "c1", title: "Кафе", amount: 1400, currency: "CNY", spent: 1210, pct: 86 },
  { id: "b2", categoryId: "c3", title: "Транспорт", amount: 350, currency: "CNY", spent: 402, pct: 115 },
] satisfies BudgetRow[];

MOCK["/subscriptions"] = [
  { note: "PingAn", amount: 35.9, currency: "CNY", period: "month", count: 6, last: day(-19), next: day(11), perMonth: 35.9, overdue: false },
  { note: "iCloud", amount: 120, currency: "USD", period: "year", count: 3, last: day(-220), next: day(145), perMonth: 10, overdue: false },
  { note: "Spotify", amount: 25, currency: "CNY", period: "month", count: 4, last: day(-98), next: day(-68), perMonth: 25, overdue: true },
] satisfies Subscription[];

MOCK["/finance/sort"] = {
  total: 119,
  items: [
    { id: "s1", kind: "expense", amount: 13100, currency: "KZT", amountCny: 196.5, note: "Emil", categoryId: null, accountId: "a3", date: day(-31) },
    { id: "s2", kind: "expense", amount: 154, currency: "CNY", amountCny: 154, note: null, categoryId: "c9", accountId: "a1", date: day(-33) },
    { id: "s3", kind: "income", amount: 5000, currency: "KZT", amountCny: 75, note: "Ansar", categoryId: "i9", accountId: "a3", date: day(-40) },
    { id: "s4", kind: "expense", amount: 800, currency: "CNY", amountCny: 800, note: "Residence permit for 1 year", categoryId: "c9", accountId: "a1", date: day(-58) },
  ],
  categories: cats.map(([id, kind, title]) => ({ id, kind, title })).filter((c) => c.title !== "Прочее"),
};

const courseRef = (id: string, short: string, aiPolicy = "none") => ({ id, short, aiPolicy });
const PS = courseRef("k1", "Statistics", "banned"), CPP = courseRef("k2", "Programming", "own_work"), CN = courseRef("k3", "Language 1"),
  ME = courseRef("k4", "Engineering"), PL = courseRef("k5", "Physics Lab"), CP = courseRef("k6", "Physics");
// Полдень, а не текущий час: иначе вечером в Шанхае toISOString отдаёт вчерашний день.
const monday = (() => { const d = new Date(); const dow = d.getDay(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return d.toISOString().slice(0, 10); })();
const plus = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

MOCK["/study"] = {
  today: day(0),
  week: monday,
  thisWeek: monday,
  courses: [PS, CPP, CN, ME, PL, CP].map((c) => ({ ...c, title: c.short })),
  assignments: [
    { id: "a1", course: PS, title: "HW1: Problem set 1", details: null, dueDate: day(2), dueNote: "in class", done: false, fromStudyAgent: true },
    { id: "a2", course: CN, title: "Essay: a day in the life", details: null, dueDate: day(3), dueNote: null, done: false, fromStudyAgent: true },
    { id: "a3", course: CPP, title: "Lab 2", details: null, dueDate: day(9), dueNote: "after the session", done: false, fromStudyAgent: true },
    { id: "a4", course: ME, title: "Report 1", details: null, dueDate: day(34), dueNote: null, done: false, fromStudyAgent: true },
    { id: "a5", course: PS, title: "HW2: Problem set 2", details: null, dueDate: null, dueNote: "~2 weeks after HW1", done: false, fromStudyAgent: true },
  ],
  recentlyDone: [{ id: "d1", course: CPP, title: "Lab 1: Setup", details: null, dueDate: day(-10), dueNote: null, done: true, fromStudyAgent: true }],
  exams: [
    { id: "e1", course: PS, kind: "quiz", title: "Quiz 1", topic: "Ch 1–2", date: day(2), dateTo: day(4), tentative: true, notes: null, fromStudyAgent: true },
    { id: "e2", course: ME, kind: "presentation", title: "Project presentation", topic: null, date: day(34), dateTo: null, tentative: true, notes: null, fromStudyAgent: true },
    { id: "e3", course: CPP, kind: "final", title: "Final", topic: null, date: null, dateTo: null, tentative: true, notes: null, fromStudyAgent: true },
  ],
  sessions: [
    { id: "s1", course: CPP, kind: "lecture", title: null, date: monday, start: "14:00", end: "15:45", room: "R103" },
    { id: "s2", course: PS, kind: "lecture", title: null, date: monday, start: "16:00", end: "17:45", room: "R104" },
    { id: "s3", course: CP, kind: "lecture", title: null, date: plus(monday, 1), start: "14:00", end: "15:45", room: "R105" },
    { id: "s4", course: CN, kind: "lecture", title: null, date: plus(monday, 1), start: "16:00", end: "17:45", room: "R106" },
    { id: "s5", course: PL, kind: "lab", title: "Lab 1: Pendulum", date: plus(monday, 3), start: "16:00", end: "18:30", room: "R107" },
  ],
  focus: {
    weekMin: 175, todayMin: 50,
    byCourse: [{ course: PS, minutes: 100 }, { course: CPP, minutes: 50 }, { course: null, minutes: 25 }],
    running: null,
  },
  cards: { total: 79, due: 18, byBox: [52, 15, 8, 4, 0], reviewedWeek: 34, correctWeek: 27 },
} satisfies Study;

const graphFrom = (() => {
  const d = new Date();
  d.setDate(d.getDate() - (26 * 7 - 1));
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
})();

const graphDays = (() => {
  const out: { date: string; count: number }[] = [];
  for (let d = graphFrom; d <= day(0); d = plus(d, 1)) {
    const n = (Date.parse(d) / 86_400_000) % 11;
    out.push({ date: d, count: n < 4 ? 0 : Math.round(n) - 3 });
  }
  return out;
})();

MOCK["/career"] = {
  today: day(0),
  projects: [
    {
      id: "p1",
      title: "Side project",
      goal: "Ship the first version",
      status: "active",
      repo: "your-name/your-repo",
      dueDate: day(21),
      milestones: [
        { id: "m1", title: "Career screen", dueDate: day(1), done: false, doneAt: null },
        { id: "m2", title: "Habits screen", dueDate: day(8), done: false, doneAt: null },
        { id: "m3", title: "Sort old expenses", dueDate: day(-2), done: false, doneAt: null },
        { id: "m4", title: "Import old data", dueDate: day(-9), done: true, doneAt: day(-9) },
      ],
    },
    {
      id: "p2",
      title: "Course project",
      goal: null,
      status: "idea",
      repo: null,
      dueDate: day(34),
      milestones: [{ id: "m5", title: "Pick a topic", dueDate: null, done: false, doneAt: null }],
    },
    {
      id: "p3",
      title: "Study planner",
      goal: "Schedule and tasks without manual entry",
      status: "done",
      repo: null,
      dueDate: null,
      milestones: [],
    },
  ],
  github: { from: graphFrom, days: graphDays, streak: 4, weekActive: 5 },
} satisfies Career;

MOCK["/habits"] = {
  today: day(0),
  from: day(-34),
  habits: [
    {
      id: "h1",
      title: "Зал",
      kind: "weekly",
      target: 3,
      days: null,
      note: "штанга, час",
      isHard: true,
      active: true,
      due: true,
      doneToday: false,
      streak: 0,
      weekDone: 2,
      lastDone: day(-2),
      dates: [day(-2), day(-4), day(-7), day(-9), day(-11), day(-14)],
    },
    {
      id: "h2",
      title: "Позвонить домой",
      kind: "interval",
      target: 3,
      days: null,
      note: "маме",
      isHard: true,
      active: true,
      due: false,
      doneToday: false,
      streak: 0,
      weekDone: 1,
      lastDone: day(-1),
      dates: [day(-1), day(-5), day(-8), day(-12)],
    },
    {
      id: "h3",
      title: "Без телефона за час до сна",
      kind: "daily",
      target: 1,
      days: null,
      note: null,
      isHard: false,
      active: true,
      due: false,
      doneToday: true,
      streak: 4,
      weekDone: 5,
      lastDone: day(0),
      dates: [day(0), day(-1), day(-2), day(-3), day(-6), day(-7)],
    },
    {
      id: "h4",
      title: "Стирка",
      kind: "daily",
      target: 1,
      days: [0],
      note: null,
      isHard: false,
      active: true,
      due: true,
      doneToday: false,
      streak: 0,
      weekDone: 0,
      lastDone: day(-7),
      dates: [day(-7), day(-14)],
    },
    {
      id: "h5",
      title: "Бег утром",
      kind: "daily",
      target: 1,
      days: null,
      note: null,
      isHard: false,
      active: false,
      due: false,
      doneToday: false,
      streak: 0,
      weekDone: 0,
      lastDone: day(-40),
      dates: [],
    },
  ],
  dueCount: 2,
} satisfies Habits;


const targets = { kcal: 2250, protein: 150, fat: 66, carbs: 262 };

MOCK["/food"] = {
  date: day(0),
  today: day(0),
  targets,
  totals: { kcal: 1290, protein: 98, fat: 41, carbs: 140 },
  meals: [
    {
      id: "m1", time: "08:20", title: "Овсянка с бананом", kcal: 380, protein: 12, fat: 8, carbs: 65, confidence: 0.8,
      status: "confirmed", source: "photo", corrected: false,
      items: [
        { name: "овсянка на воде", grams: 250, kcal: 180, p: 6, f: 3, c: 32 },
        { name: "банан", grams: 120, kcal: 105, p: 1.3, f: 0.4, c: 27 },
        { name: "oil", grams: 10, kcal: 90, p: 0, f: 10, c: 0 },
      ],
    },
    {
      id: "m2", time: "12:45", title: "Курица с рисом", kcal: 647, protein: 52, fat: 22, carbs: 57, confidence: 0.4,
      status: "pending", source: "photo", corrected: false,
      items: [
        { name: "курица гриль", grams: 180, kcal: 297, p: 47, f: 11, c: 0 },
        { name: "рис", grams: 200, kcal: 260, p: 5, f: 1, c: 57 },
        { name: "oil", grams: 10, kcal: 90, p: 0, f: 10, c: 0 },
      ],
    },
    {
      id: "m3", time: "16:10", title: "Йогурт", kcal: 263, protein: 34, fat: 11, carbs: 18, confidence: 0.9,
      status: "confirmed", source: "text", corrected: true,
      items: [{ name: "йогурт греческий", grams: 250, kcal: 263, p: 34, f: 11, c: 18 }],
    },
  ],
} satisfies FoodDay;

MOCK["/food/history"] = {
  today: day(0),
  days: 28,
  targets,
  series: Array.from({ length: 28 }, (_, i) => {
    const kcal = i % 9 === 4 ? 0 : 1800 + ((i * 137) % 700);
    return { date: day(i - 27), meals: kcal ? 3 : 0, kcal, protein: kcal ? 90 + (i % 5) * 12 : 0, fat: kcal ? 55 : 0, carbs: kcal ? 210 : 0 };
  }),
  weights: Array.from({ length: 10 }, (_, i) => ({ date: day(i * 3 - 27), kg: 82 - i * 0.25 + (i % 2 ? 0.4 : -0.2), avg: 82 - i * 0.25 })),
  tdee: { tdee: 2690, slopeKgPerWeek: -0.58, avgKcal: 2230 },
} satisfies FoodHistory;

MOCK["/dishes"] = {
  dishes: [
    { key: "рис", name: "Рис", grams: 200, kcal: 260, protein: 5, fat: 1, carbs: 57, uses: 9 },
    { key: "борщ", name: "Борщ", grams: 300, kcal: 150, protein: 6, fat: 6, carbs: 18, uses: 4 },
    { key: "йогурт греческий", name: "Йогурт греческий", grams: 250, kcal: 263, protein: 34, fat: 11, carbs: 18, uses: 3 },
  ] satisfies Dish[],
};
