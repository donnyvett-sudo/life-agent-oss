import { t } from "../i18n";
import { ChevronLeft, ChevronRight, Plus, Utensils } from "lucide-react";
import { useState } from "react";
import { api, type Dish, type FoodDay, type FoodHistory, type Macros } from "../api";
import { dayLabel, fullDay, number, shiftDay } from "../format";
import { confirm, haptic } from "../tg";
import { DateJump, ErrorBox, Head, Loading, PanelHead } from "../ui";
import { useLoad } from "../useLoad";
import { AddMeal, MealEditor, TargetsEditor } from "./FoodEditors";
import { barPath, shift } from "./Sleep";

const W = 340, H = 150, PAD_L = 34, PAD_R = 4, PAD_T = 10, PAD_B = 20;
const PLOT_W = W - PAD_L - PAD_R, PLOT_H = H - PAD_T - PAD_B;

const pct = (v: number, goal: number) => Math.max(0, Math.min(100, goal > 0 ? (v / goal) * 100 : 0));

export default function Food() {
  const [date, setDate] = useState<string | null>(null); // null — сегодня
  const [span, setSpan] = useState(28);
  const day = useLoad<FoodDay>(`/food${date ? `?date=${date}` : ""}`);
  const hist = useLoad<FoodHistory>(`/food/history?days=${span}`);
  const dishes = useLoad<{ dishes: Dish[] }>("/dishes");
  const [open, setOpen] = useState<string | null>(null); // id приёма, "add" или "targets"
  const [showDishes, setShowDishes] = useState(false);
  const [busy, setBusy] = useState(false);

  const data = day.data;
  if (day.error) return <ErrorBox message={day.error} retry={day.reload} />;
  if (!data) return <Loading />;

  const isToday = data.date === data.today;
  const go = (d: string) => {
    haptic();
    setDate(d === data.today ? null : d);
    setOpen(null);
    window.scrollTo(0, 0);
  };
  const saved = (d: FoodDay) => {
    day.setData(d);
    setOpen(null);
    hist.reload();
    dishes.reload();
  };
  const quick = async (d: Dish) => {
    setBusy(true);
    try {
      saved(
        await api<FoodDay>("POST", "/meals", {
          date: data.date,
          title: d.name,
          items: [{ name: d.name, grams: d.grams, kcal: d.kcal, p: d.protein, f: d.fat, c: d.carbs }],
        }),
      );
      haptic("success");
    } catch (e) {
      haptic("error");
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const { totals, targets } = data;
  const over = totals.kcal > targets.kcal;
  const top = (dishes.data?.dishes ?? []).slice(0, 8);
  const macros: [string, keyof Macros][] = [[t("Белки"), "protein"], [t("Жиры"), "fat"], [t("Углеводы"), "carbs"]];

  return (
    <>
      <Head eyebrow={fullDay(data.date)} title={t("Еда")} />

      <div className="month-nav">
        <button className="icon-btn" aria-label={t("Предыдущий день")} onClick={() => go(shiftDay(data.date, -1))}>
          <ChevronLeft size={20} aria-hidden />
        </button>
        <span className="nav-center">
          <DateJump value={data.date} max={data.today} label={t("Выбрать день")} onPick={go}>
            <span className="mono">{dayLabel(data.date)}</span>
          </DateJump>
          {!isToday && <button className="link" onClick={() => go(data.today)}>{t("Сегодня")}</button>}
        </span>
        <button className="icon-btn" aria-label={t("Следующий день")} disabled={isToday} onClick={() => go(shiftDay(data.date, 1))}>
          <ChevronRight size={20} aria-hidden />
        </button>
      </div>

      <section className="panel">
        <PanelHead
          icon={<Utensils size={18} aria-hidden />}
          title={t("Итог дня")}
          meta={over ? t("сверх на {n}", { n: totals.kcal - targets.kcal }) : t("осталось {n}", { n: targets.kcal - totals.kcal })}
        />
        <span className="figure" aria-label={`${totals.kcal} ${t("ккал")}`}>
          {number(totals.kcal)}<span className="u">/ {number(targets.kcal)} {t("ккал")}</span>
        </span>
        <div className="meter" role="img" aria-label={`${Math.round(pct(totals.kcal, targets.kcal))}%`}>
          <i style={{ width: `${pct(totals.kcal, targets.kcal)}%`, ...(over ? { background: "var(--warn)" } : {}) }} />
        </div>
        {macros.map(([label, k]) => (
          <div key={k} className="macro">
            <div className="cat-top">
              <span className="grow">{label}</span>
              <span className="amount">{number(totals[k])} / {number(targets[k])} {t("г")}</span>
            </div>
            <span className="cat-bar"><i style={{ width: `${pct(totals[k], targets[k])}%` }} /></span>
          </div>
        ))}
        {open === "targets"
          ? <TargetsEditor targets={targets} onSaved={saved} onCancel={() => setOpen(null)} />
          : <button className="link" onClick={() => setOpen("targets")}>{t("Цели на день")}</button>}
      </section>

      <section className="panel">
        <PanelHead title={t("Приёмы пищи")} meta={data.meals.length || undefined} />
        {!data.meals.length && (
          <p className="muted" style={{ margin: "0 0 8px" }}>
            {isToday
              ? t("Пока пусто. Пришли боту фото еды или напиши «съел …».")
              : t("В этот день ничего не записано.")}
          </p>
        )}
        {data.meals.map((m) => (
          <div key={m.id}>
            <button
              className="line-button line"
              aria-expanded={open === m.id}
              onClick={() => {
                haptic();
                setOpen(open === m.id ? null : m.id);
              }}
            >
              <span className="due" style={{ width: 44, textAlign: "left" }}>{m.time}</span>
              <span className="grow">
                {m.status === "pending" && <i className="pending-dot" title={t("Не подтверждено")} />}
                {m.title}
                <div className="hint">
                  {t("Б")} {Math.round(m.protein)} · {t("Ж")} {Math.round(m.fat)} · {t("У")} {Math.round(m.carbs)}
                  {m.confidence !== null && m.confidence < 0.5 && <span className="warn"> · {t("оценка неточная")}</span>}
                </div>
              </span>
              <span className="amount">{m.kcal}</span>
            </button>
            {open === m.id && <MealEditor meal={m} onSaved={saved} onCancel={() => setOpen(null)} />}
          </div>
        ))}
        {top.length > 0 && open !== "add" && (
          <>
            <div className="sub-title">{t("Из моих блюд")}</div>
            <div className="chips">
              {top.map((d) => (
                <button key={d.key} className="btn ghost" disabled={busy} onClick={() => quick(d)} title={`${d.grams} ${t("г")} · ${d.kcal} ${t("ккал")}`}>
                  {d.name}
                </button>
              ))}
            </div>
          </>
        )}
        {open === "add"
          ? <AddMeal date={data.date} onSaved={saved} onCancel={() => setOpen(null)} />
          : (
            <button className="add-panel" onClick={() => setOpen("add")}>
              <Plus size={18} aria-hidden /> {t("Добавить приём пищи")}
            </button>
          )}
      </section>

      <Trend hist={hist.data} error={hist.error} retry={hist.reload} span={span} setSpan={setSpan} go={go} current={data.date} />

      <section className="panel">
        <button className="link" onClick={() => setShowDishes((v) => !v)}>
          {showDishes ? t("Скрыть мои блюда") : t("Мои блюда ({n})", { n: dishes.data?.dishes.length ?? 0 })}
        </button>
        {showDishes && (
          <div style={{ marginTop: 6 }}>
            {!dishes.data?.dishes.length && <p className="help">{t("Появятся, когда подтвердишь первый приём пищи.")}</p>}
            {dishes.data?.dishes.map((d) => (
              <div key={d.key} className="line">
                <span className="grow">
                  {d.name}
                  <div className="hint">{d.grams} {t("г")} · {d.kcal} {t("ккал")} · {t("Б")} {Math.round(d.protein)} · {t("Ж")} {Math.round(d.fat)} · {t("У")} {Math.round(d.carbs)}</div>
                </span>
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!(await confirm(t("Убрать «{name}» из блюд?", { name: d.name })))) return;
                    try {
                      dishes.setData(await api("DELETE", `/dishes/${encodeURIComponent(d.key)}`));
                    } catch (e) {
                      alert(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  {t("Убрать")}
                </button>
              </div>
            ))}
            <p className="help">{t("Бот узнаёт эти блюда сразу, без обращения к ИИ: «рис, борщ 200 г».")}</p>
          </div>
        )}
      </section>
    </>
  );
}

function Trend({ hist, error, retry, span, setSpan, go, current }: {
  hist: FoodHistory | null;
  error: string | null;
  retry: () => void;
  span: number;
  setSpan: (n: number) => void;
  go: (d: string) => void;
  current: string;
}) {
  if (error) return <ErrorBox message={error} retry={retry} />;
  if (!hist) return null;

  const logged = hist.series.filter((d) => d.meals > 0);
  const avgKcal = logged.length ? Math.round(logged.reduce((a, d) => a + d.kcal, 0) / logged.length) : null;
  const avgProt = logged.length ? Math.round(logged.reduce((a, d) => a + d.protein, 0) / logged.length) : null;
  const last = hist.weights[hist.weights.length - 1];

  const step = PLOT_W / hist.series.length;
  const barW = Math.max(3, step - 2);
  const maxKcal = Math.max(hist.targets.kcal * 1.25, ...hist.series.map((d) => d.kcal), 1);
  const y = (v: number) => PAD_T + PLOT_H - (Math.min(v, maxKcal) / maxKcal) * PLOT_H;
  const ticks = [0, 1000, 2000].filter((v) => v <= maxKcal);
  const xs = hist.series.map((d, i) => ({ d, i })).filter(({ i }) => (hist.series.length - 1 - i) % 7 === 0);

  // Вес: масштаб по самим данным, иначе при 80 кг линия лежит плоско.
  const kgs = hist.weights.flatMap((w) => [w.kg, w.avg]);
  const lo = Math.floor(Math.min(...kgs, 1e9) - 0.5), hi = Math.ceil(Math.max(...kgs, -1e9) + 0.5);
  const first = hist.series[0].date;
  const wx = (d: string) => PAD_L + ((Date.parse(d) - Date.parse(first)) / 86_400_000 + 0.5) * step;
  const wy = (kg: number) => PAD_T + PLOT_H - ((kg - lo) / Math.max(hi - lo, 1)) * PLOT_H;

  return (
    <>
      <section className="panel">
        <PanelHead
          title={t("Калории")}
          meta={
            <span className="seg">
              {[7, 28].map((d) => (
                <button key={d} className={span === d ? "on" : undefined} aria-pressed={span === d} onClick={() => { haptic(); setSpan(d); }}>
                  {t("{n} дней", { n: d })}
                </button>
              ))}
            </span>
          }
        />
        {logged.length === 0
          ? <p className="muted" style={{ margin: 0 }}>{t("Данных пока нет. Пришли боту фото первого приёма пищи.")}</p>
          : (
            <>
              <div className="tiles">
                <div className="tile">
                  <div className="meta">{t("В среднем")}</div>
                  <div className="tile-value">{avgKcal == null ? "–" : number(avgKcal)}</div>
                </div>
                <div className="tile">
                  <div className="meta">{t("Белок, г")}</div>
                  <div className="tile-value">{avgProt ?? "–"}</div>
                </div>
                <div className="tile">
                  <div className="meta">{t("Вес")}</div>
                  <div className="tile-value">{last ? `${number(last.avg, 1)}` : "–"}</div>
                </div>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={t("Калории по дням")}>
                {ticks.map((v) => (
                  <g key={v}>
                    <line className="grid" x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} />
                    <text className="axis" x={PAD_L - 6} y={y(v) + 3} textAnchor="end">{v}</text>
                  </g>
                ))}
                {hist.series.map((d, i) => d.meals > 0 && (
                  <g key={d.date} className="hit-area" onClick={() => go(d.date)}>
                    <rect x={PAD_L + i * step} y={PAD_T} width={step} height={PLOT_H} fill="transparent" />
                    <path
                      d={barPath(PAD_L + i * step + (step - barW) / 2, y(d.kcal), barW, y(0) - y(d.kcal))}
                      className={`bar${d.kcal > hist.targets.kcal ? " over" : ""}${d.date === current ? " active" : ""}`}
                    >
                      <title>{`${dayLabel(d.date)}: ${d.kcal}`}</title>
                    </path>
                  </g>
                ))}
                <line className="target" x1={PAD_L} x2={W - PAD_R} y1={y(hist.targets.kcal)} y2={y(hist.targets.kcal)} />
                {xs.map(({ d, i }) => (
                  <text key={d.date} className="axis" x={PAD_L + i * step + step / 2} y={H - 5} textAnchor="middle">{dayLabel(d.date, false)}</text>
                ))}
              </svg>
              <p className="chart-note">{t("Пунктир: цель. Жёлтые столбики выше цели. Нажми на столбик, чтобы открыть день.")}</p>
            </>
          )}
      </section>

      {hist.weights.length >= 2 && (
        <section className="panel">
          <PanelHead title={t("Вес")} meta={t("кг, среднее за 7 дней")} />
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={t("Вес по дням")}>
            {[lo, Math.round((lo + hi) / 2), hi].map((v) => (
              <g key={v}>
                <line className="grid" x1={PAD_L} x2={W - PAD_R} y1={wy(v)} y2={wy(v)} />
                <text className="axis" x={PAD_L - 6} y={wy(v) + 3} textAnchor="end">{v}</text>
              </g>
            ))}
            {hist.weights.map((w) => <circle key={w.date} className="raw-dot" cx={wx(w.date)} cy={wy(w.kg)} r={2.5}><title>{`${dayLabel(w.date)}: ${w.kg}`}</title></circle>)}
            <polyline className="avg-line" points={hist.weights.map((w) => `${wx(w.date)},${wy(w.avg)}`).join(" ")} />
            {[0, Math.floor(hist.series.length / 2), hist.series.length - 1].map((i) => (
              <text key={i} className="axis" x={PAD_L + i * step + step / 2} y={H - 5} textAnchor="middle">{dayLabel(shift(first, i), false)}</text>
            ))}
          </svg>
        </section>
      )}

      <section className="panel">
        <PanelHead title={t("Твой расход калорий")} />
        {hist.tdee
          ? (
            <>
              <span className="figure">{number(hist.tdee.tdee)}<span className="u">{t("ккал в день")}</span></span>
              <p className="help">
                {t("Оценка по тренду веса за 4 недели: ты ешь в среднем {kcal}, вес меняется на {kg} кг в неделю.", {
                  kcal: number(hist.tdee.avgKcal),
                  kg: `${hist.tdee.slopeKgPerWeek > 0 ? "+" : ""}${number(hist.tdee.slopeKgPerWeek, 2)}`,
                })}
              </p>
            </>
          )
          : (
            <p className="muted" style={{ margin: 0 }}>
              {t("Появится после 10 дней с записями еды и 6 взвешиваний за 2 недели. Вес пиши ботом: «вес 71.4».")}
            </p>
          )}
      </section>
    </>
  );
}
