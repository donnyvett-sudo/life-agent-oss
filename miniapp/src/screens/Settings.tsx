import { getLang, type Lang, setLang, t } from "../i18n";
import { ChevronRight, Clock, GitBranch, Languages, Moon, Palette, Pill, MessageSquare, ShieldCheck, UserRound } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import {
  api,
  type Currency,
  type Schedule,
  type Settings as SettingsData,
  type Slot,
  type SupplementSettings,
} from "../api";
import { haptic } from "../tg";
import { type ThemeMode, useTheme } from "../theme";
import { ErrorBox, Head, Loading, Nav, PanelHead } from "../ui";
import { useLoad } from "../useLoad";

const SLOT_LABEL = (): Record<Slot, string> => ({ morning: t("Утро"), lunch: t("С обедом"), evening: t("Вечер") });
const DOW = () => [t("Вс"), t("Пн"), t("Вт"), t("Ср"), t("Чт"), t("Пт"), t("Сб")];
const FREQ = () => [
  { id: "quiet", label: t("Тихо"), hint: t("Только утро, итоги дня и неделя. Без напоминания об отбое и без повторов.") },
  { id: "normal", label: t("Обычно"), hint: t("Всё по расписанию и один повтор, если на напоминание нет ответа.") },
  { id: "active", label: t("Активно"), hint: t("Пока как «Обычно». Позже коуч будет писать сам чаще.") },
] as const;
const THEMES = (): { id: ThemeMode; label: string }[] => [
  { id: "system", label: t("Системная") },
  { id: "light", label: t("Светлая") },
  { id: "dark", label: t("Тёмная") },
];
const CURRENCIES = (): { id: Currency; label: string }[] => [
  { id: "CNY", label: t("¥ юань") },
  { id: "KZT", label: t("₸ тенге") },
  { id: "USD", label: t("$ доллар") },
];
// Материковые зоны от UTC-9 до UTC+12: по одному-двум городам на смещение, без островной экзотики.
// Смещение считаем на лету, чтобы летнее время не врало.
const ZONE_IDS = [
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Bogota",
  "America/Halifax",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Kyiv",
  "Africa/Cairo",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Asia/Tehran",
  "Asia/Dubai",
  "Europe/Samara",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Karachi",
  "Asia/Yekaterinburg",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Omsk",
  "Asia/Bangkok",
  "Asia/Novosibirsk",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Irkutsk",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Yakutsk",
  "Australia/Brisbane",
  "Asia/Vladivostok",
  "Australia/Sydney",
  "Asia/Magadan",
  "Pacific/Auckland",
  "Asia/Kamchatka",
  "UTC",
] as const;

const ZONE_NAMES = (): Record<string, string> => ({
  "America/Anchorage": t("США, Анкоридж"),
  "America/Los_Angeles": t("США, Лос-Анджелес"),
  "America/Denver": t("США, Денвер"),
  "America/Chicago": t("США, Чикаго"),
  "America/Mexico_City": t("Мексика, Мехико"),
  "America/New_York": t("США, Нью-Йорк"),
  "America/Bogota": t("Колумбия, Богота"),
  "America/Halifax": t("Канада, Галифакс"),
  "America/Sao_Paulo": t("Бразилия, Сан-Паулу"),
  "America/Argentina/Buenos_Aires": t("Аргентина, Буэнос-Айрес"),
  "Europe/London": t("Великобритания, Лондон"),
  "Europe/Lisbon": t("Португалия, Лиссабон"),
  "Europe/Berlin": t("Германия, Берлин"),
  "Europe/Warsaw": t("Польша, Варшава"),
  "Europe/Kyiv": t("Украина, Киев"),
  "Africa/Cairo": t("Египет, Каир"),
  "Europe/Moscow": t("Россия, Москва"),
  "Europe/Istanbul": t("Турция, Стамбул"),
  "Asia/Tehran": t("Иран, Тегеран"),
  "Asia/Dubai": t("ОАЭ, Дубай"),
  "Europe/Samara": t("Россия, Самара"),
  "Asia/Almaty": t("Казахстан, Астана"),
  "Asia/Tashkent": t("Узбекистан, Ташкент"),
  "Asia/Karachi": t("Пакистан, Карачи"),
  "Asia/Yekaterinburg": t("Россия, Екатеринбург"),
  "Asia/Kolkata": t("Индия, Дели"),
  "Asia/Dhaka": t("Бангладеш, Дакка"),
  "Asia/Omsk": t("Россия, Омск"),
  "Asia/Bangkok": t("Таиланд, Бангкок"),
  "Asia/Novosibirsk": t("Россия, Новосибирск"),
  "Asia/Shanghai": t("Китай, Шанхай"),
  "Asia/Singapore": t("Сингапур"),
  "Asia/Irkutsk": t("Россия, Иркутск"),
  "Asia/Tokyo": t("Япония, Токио"),
  "Asia/Seoul": t("Корея, Сеул"),
  "Asia/Yakutsk": t("Россия, Якутск"),
  "Australia/Brisbane": t("Австралия, Брисбен"),
  "Asia/Vladivostok": t("Россия, Владивосток"),
  "Australia/Sydney": t("Австралия, Сидней"),
  "Asia/Magadan": t("Россия, Магадан"),
  "Pacific/Auckland": t("Новая Зеландия, Окленд"),
  "Asia/Kamchatka": t("Россия, Камчатка"),
  UTC: "UTC",
});

/** Смещение зоны сейчас, в минутах от UTC. */
function offsetMinutes(id: string): number {
  try {
    const name = new Intl.DateTimeFormat("en-GB", { timeZone: id, timeZoneName: "longOffset" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return 0;
  }
}

const offsetLabel = (min: number) => {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  const mm = a % 60;
  return `UTC${sign}${Math.floor(a / 60)}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
};

const ZONES = () =>
  ZONE_IDS
    .map((id) => ({ id, offset: offsetMinutes(id), name: ZONE_NAMES()[id] ?? id }))
    .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name))
    .map((z) => ({ id: z.id as string, label: `${offsetLabel(z.offset)} · ${z.name}` }));

const LANGS: { id: Lang; label: string }[] = [
  { id: "ru", label: "Русский" },
  { id: "en", label: "English" },
];

const ABOUT_MAX = 400;

type Draft = Pick<SettingsData, "schedule" | "sleep" | "coach"> & {
  tz: string;
  name: string;
  about: string;
  currency: Currency;
};
const pickDraft = (d: SettingsData): Draft => ({
  tz: d.tz,
  name: d.profile.name,
  about: d.profile.about,
  currency: d.profile.currency,
  schedule: d.schedule,
  sleep: d.sleep,
  coach: d.coach,
});

export default function Settings() {
  const { data, setData, error, reload } = useLoad<SettingsData>("/settings");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingLang, setSavingLang] = useState(false);
  const [adding, setAdding] = useState(false);
  const [theme, setTheme] = useTheme();
  const { openLegal } = useContext(Nav);

  useEffect(() => {
    if (!data) return;
    setDraft(pickDraft(data));
    setLang(data.lang);
  }, [data]);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data || !draft) return <Loading />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(pickDraft(data));
  const setTime = (group: "schedule" | "sleep", key: string, value: string) =>
    setDraft({ ...draft, [group]: { ...draft[group], [key]: value } });

  // Язык сохраняем сразу: он меняет и приложение, и меню команд бота.
  async function changeLang(l: Lang) {
    if (l === getLang() || savingLang) return;
    haptic();
    setLang(l);
    setSavingLang(true);
    try {
      setData(await api<SettingsData>("PUT", "/settings", { lang: l }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingLang(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const { tz, name, about, currency, ...rest } = draft!;
      setData(
        await api<SettingsData>("PUT", "/settings", { ...rest, tz, profile: { about, name, currency } }),
      );
      haptic("success");
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const times: { key: keyof Schedule; label: string }[] = [
    { key: "morning", label: t("Утренний разбор") },
    { key: "lunch_fallback", label: t("Добавки, если обед не записан") },
    { key: "evening", label: t("Итоги дня и магний") },
    { key: "lights_out", label: t("Напоминание об отбое") },
  ];

  return (
    <>
      <Head eyebrow={t("Местное время {tz}", { tz: data.tz })} title={t("Настройки")} />

      <section className="panel">
        <PanelHead icon={<UserRound size={18} aria-hidden />} title={t("Профиль")} />
        <label className="field">
          <span>{t("Имя или псевдоним")}</span>
          <input
            value={draft.name}
            maxLength={40}
            placeholder={t("Как к тебе обращаться")}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("Часовой пояс")}</span>
          <select value={draft.tz} onChange={(e) => setDraft({ ...draft, tz: e.target.value })}>
            {(ZONES().some((z) => z.id === draft.tz) ? ZONES() : [{ id: draft.tz, label: draft.tz }, ...ZONES()])
              .map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("Валюта по умолчанию")}</span>
          <select
            value={draft.currency}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value as Currency })}
          >
            {CURRENCIES().map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <p className="help">{t("Суммы без валюты («обед 35») записываются в ней. Другая валюта — словом: «обед 35 тенге».")}</p>
        <div className="field stack">
          <span>{t("Что коучу знать о тебе")}</span>
          <textarea
            className="text"
            rows={3}
            maxLength={ABOUT_MAX}
            placeholder={t("Например: второй курс, работаю по выходным, коплю на поездку, тренируюсь трижды в неделю.")}
            value={draft.about}
            onChange={(e) => setDraft({ ...draft, about: e.target.value })}
          />
        </div>
        <p className="help">{t("Уходит в каждый запрос к коучу. Не пиши сюда лишнего: адрес, документы, чужие данные.")}</p>
      </section>

      <section className="panel">
        <PanelHead icon={<Languages size={18} aria-hidden />} title={t("Язык")} />
        <div className="seg wide">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={getLang() === l.id ? "on" : undefined}
              aria-pressed={getLang() === l.id}
              disabled={savingLang}
              onClick={() => changeLang(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="help">{t("Язык приложения и бота: кнопки, напоминания и ответы коуча.")}</p>
      </section>

      <GithubPanel data={data} onSaved={setData} />

      <section className="panel">
        <PanelHead icon={<Palette size={18} aria-hidden />} title={t("Оформление")} />
        <div className="seg wide">
          {THEMES().map((x) => (
            <button
              key={x.id}
              className={theme === x.id ? "on" : undefined}
              aria-pressed={theme === x.id}
              onClick={() => {
                haptic();
                setTheme(x.id);
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <p className="help">{t("Системная повторяет тему Telegram. Выбор хранится на этом устройстве.")}</p>
      </section>

      <section className="panel">
        <PanelHead icon={<Moon size={18} aria-hidden />} title={t("Режим сна")} />
        <label className="field">
          <span>{t("Отбой")}</span>
          <input type="time" value={draft.sleep.bed} onChange={(e) => setTime("sleep", "bed", e.target.value)} />
        </label>
        <label className="field">
          <span>{t("Подъём")}</span>
          <input type="time" value={draft.sleep.wake} onChange={(e) => setTime("sleep", "wake", e.target.value)} />
        </label>
        <p className="help">{t("С отбоя до подъёма бот ничего не присылает.")}</p>
      </section>

      <section className="panel">
        <PanelHead icon={<Clock size={18} aria-hidden />} title={t("Расписание")} />
        {times.map((row) => (
          <label key={row.key} className="field">
            <span>{row.label}</span>
            <input
              type="time"
              value={String(draft.schedule[row.key])}
              onChange={(e) => setTime("schedule", row.key, e.target.value)}
            />
          </label>
        ))}
        <label className="field">
          <span>{t("Недельный разбор")}</span>
          <span className="field-pair">
            <select
              value={draft.schedule.weekly_dow}
              aria-label={t("День недели")}
              onChange={(e) =>
                setDraft({ ...draft, schedule: { ...draft.schedule, weekly_dow: Number(e.target.value) } })}
            >
              {DOW().map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
            <input
              type="time"
              aria-label={t("Время")}
              value={draft.schedule.weekly}
              onChange={(e) => setTime("schedule", "weekly", e.target.value)}
            />
          </span>
        </label>
      </section>

      <section className="panel">
        <PanelHead icon={<MessageSquare size={18} aria-hidden />} title={t("Коуч")} />
        <div className="seg wide">
          {FREQ().map((f) => (
            <button
              key={f.id}
              className={draft.coach.frequency === f.id ? "on" : undefined}
              aria-pressed={draft.coach.frequency === f.id}
              onClick={() => setDraft({ ...draft, coach: { ...draft.coach, frequency: f.id } })}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="help">{FREQ().find((f) => f.id === draft.coach.frequency)?.hint}</p>
        <p className="help">
          {t("Обращений к ИИ сегодня осталось: {left} из {limit}. Записи, отметки и напоминания от лимита не зависят.", {
            left: data.ai.left,
            limit: data.ai.limit,
          })}
        </p>
      </section>

      {dirty && (
        <div className="savebar">
          <span className="grow">{t("Есть несохранённые изменения")}</span>
          <button className="btn ghost" onClick={() => setDraft(pickDraft(data))}>{t("Отменить")}</button>
          <button className="btn" disabled={saving} onClick={save}>{saving ? t("Сохраняю") : t("Сохранить")}</button>
        </div>
      )}

      <section className="panel">
        <PanelHead icon={<Pill size={18} aria-hidden />} title={t("Добавки")} />
        {data.supplements.filter((s) => s.active).map((s) => (
          <SupplementEditor key={s.id} supp={s} onSaved={setData} />
        ))}
        {adding
          ? (
            <SupplementEditor
              onSaved={(d) => {
                setData(d);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )
          : <button className="btn ghost full" onClick={() => setAdding(true)}>{t("Добавить добавку")}</button>}
        {data.supplements.some((s) => !s.active) && (
          <>
            <div className="sub-title">{t("Скрытые")}</div>
            {data.supplements.filter((s) => !s.active).map((s) => (
              <div key={s.id} className="line">
                <div className="grow muted">{t(s.name)}</div>
                <button
                  className="link"
                  onClick={async () =>
                    setData(await api<SettingsData>("PATCH", `/supplements/${s.id}`, { active: true }))}
                >
                  {t("Вернуть")}
                </button>
              </div>
            ))}
          </>
        )}
        <p className="help">{t("Размер банки нужен, чтобы бот предупредил за 5 дней до конца. Дозировки не подсказываю: это к врачу.")}</p>
      </section>

      <section className="panel">
        <PanelHead icon={<ShieldCheck size={18} aria-hidden />} title={t("Данные и правила")} />
        <button className="line line-button" onClick={openLegal}>
          <div className="grow">
            <div>{t("Политика и условия")}</div>
            <div className="hint">{t("Что хранится, что уходит в Gemini, как удалить аккаунт")}</div>
          </div>
          <ChevronRight size={18} className="muted" aria-hidden />
        </button>
        <p className="help">{t("Удалить аккаунт со всеми данными — команда /delete в боте.")}</p>
      </section>
    </>
  );
}

/**
 * Токен GitHub вводится здесь, а не в чате: в переписке он остался бы навсегда.
 * Владельцу серверный токен засчитывается как подключение, но заменить его можно так же.
 */
function GithubPanel({ data, onSaved }: { data: SettingsData; onSaved: (d: SettingsData) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const { github, githubLogin } = data.profile;

  async function run(fn: () => Promise<SettingsData>) {
    setBusy(true);
    try {
      onSaved(await fn());
      setToken("");
      haptic("success");
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <PanelHead icon={<GitBranch size={18} aria-hidden />} title="GitHub" />
      {github === "own" && (
        <div className="line">
          <div className="grow">
            <div>{githubLogin ? t("Подключён аккаунт {login}", { login: githubLogin }) : t("Подключён")}</div>
            <div className="hint">{t("Коммиты за полгода видны на вкладке «Дело»")}</div>
          </div>
          <button className="link" disabled={busy} onClick={() => run(() => api<SettingsData>("DELETE", "/settings/github"))}>
            {t("Отключить")}
          </button>
        </div>
      )}
      {github === "server" && <p className="help">{t("Работает серверный токен. Можно заменить своим.")}</p>}
      <div className="field stack">
        <span>{github === "own" ? t("Заменить токен") : t("Токен доступа")}</span>
        <input
          className="text"
          type="password"
          autoComplete="off"
          placeholder="ghp_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <button
        className="btn full"
        disabled={busy || token.trim().length < 20}
        onClick={() => run(() => api<SettingsData>("PUT", "/settings/github", { token: token.trim() }))}
      >
        {busy ? t("Проверяю") : t("Подключить")}
      </button>
      <p className="help">
        {t("Нужен classic token с правом read:user на github.com/settings/tokens. Он хранится в базе бота и используется только для графика твоих коммитов.")}
      </p>
    </section>
  );
}

function SupplementEditor({ supp, onSaved, onCancel }: {
  supp?: SupplementSettings;
  onSaved: (d: SettingsData) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(!supp);
  const [f, setF] = useState({
    name: supp?.name ?? "",
    slot: supp?.slot ?? ("lunch" as Slot),
    unitsPerIntake: String(supp?.unitsPerIntake ?? 1),
    unitsPerPack: supp?.unitsPerPack == null ? "" : String(supp.unitsPerPack),
    unitsLeft: supp?.unitsLeft == null ? "" : String(supp.unitsLeft),
  });
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  async function run(fn: () => Promise<SettingsData>) {
    setBusy(true);
    try {
      onSaved(await fn());
      haptic("success");
      if (supp) setOpen(false);
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(() =>
      api<SettingsData>(supp ? "PATCH" : "POST", supp ? `/supplements/${supp.id}` : "/supplements", {
        name: f.name,
        slot: f.slot,
        unitsPerIntake: num(f.unitsPerIntake) ?? 1,
        unitsPerPack: num(f.unitsPerPack),
        // Размер банки задан, а остаток нет: считаем банку новой.
        unitsLeft: num(f.unitsLeft) ?? (supp?.unitsLeft == null ? num(f.unitsPerPack) : null),
      })
    );

  if (!open && supp) {
    const stock = supp.unitsPerPack
      ? supp.unitsLeft != null
        ? t("банка {pack}, осталось {left}", { pack: supp.unitsPerPack, left: supp.unitsLeft })
        : t("банка {pack}", { pack: supp.unitsPerPack })
      : t("размер банки не задан");
    return (
      <button className="line line-button" onClick={() => setOpen(true)}>
        <div className="grow">
          <div>{t(supp.name)}</div>
          <div className="hint">{SLOT_LABEL()[supp.slot]}, {stock}</div>
        </div>
        <ChevronRight size={18} className="muted" aria-hidden />
      </button>
    );
  }

  return (
    <div className="editor">
      <label className="field">
        <span>{t("Название")}</span>
        <input className="text" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Когда")}</span>
        <select value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value as Slot })}>
          {(Object.keys(SLOT_LABEL()) as Slot[]).map((s) => <option key={s} value={s}>{SLOT_LABEL()[s]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t("Штук за приём")}</span>
        <input inputMode="decimal" value={f.unitsPerIntake} onChange={(e) => setF({ ...f, unitsPerIntake: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Штук в банке")}</span>
        <input inputMode="numeric" placeholder={t("нет")} value={f.unitsPerPack} onChange={(e) => setF({ ...f, unitsPerPack: e.target.value })} />
      </label>
      <label className="field">
        <span>{t("Осталось сейчас")}</span>
        <input inputMode="decimal" placeholder={t("нет")} value={f.unitsLeft} onChange={(e) => setF({ ...f, unitsLeft: e.target.value })} />
      </label>
      <div className="editor-actions">
        {supp && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => run(() => api<SettingsData>("DELETE", `/supplements/${supp.id}`))}
          >
            {t("Скрыть")}
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => (supp ? setOpen(false) : onCancel?.())}>{t("Отмена")}</button>
        <button className="btn" disabled={busy || !f.name.trim()} onClick={save}>{t("Сохранить")}</button>
      </div>
    </div>
  );
}
