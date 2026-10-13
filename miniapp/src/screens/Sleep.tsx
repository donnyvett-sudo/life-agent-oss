import { t } from "../i18n";
import { useMemo, useState } from "react";
import type { Night, SleepHistory } from "../api";
import { clockDiff, dayLabel, duration, durationShort, fromMin, toMin } from "../format";
import { haptic } from "../tg";
import { ErrorBox, Figure, Head, Loading, PanelHead, Verdict } from "../ui";
import { useLoad } from "../useLoad";

const W = 340, H = 150, PAD_L = 34, PAD_R = 4, PAD_T = 10, PAD_B = 20;
const PLOT_W = W - PAD_L - PAD_R, PLOT_H = H - PAD_T - PAD_B;

export function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Столбик со скруглённым верхом (4px) и прямым низом у базовой линии. */
export function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export default function Sleep() {
  const [days, setDays] = useState(14);
  const { data, error, reload } = useLoad<SleepHistory>(`/sleep?days=${days}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const view = useMemo(() => {
    if (!data) return null;
    const byDate = new Map(data.nights.map((n) => [n.date, n]));
    const dates = Array.from({ length: data.days }, (_, i) => shift(data.today, i - data.days + 1));
    const target = toMin(data.target.bed);
    const targetSleep = (toMin(data.target.wake) - target + 1440) % 1440;
    const n = data.nights.length;
    const avgSleep = n ? data.nights.reduce((a, x) => a + x.asleepMin, 0) / n : null;
    const avgBedDiff = n ? data.nights.reduce((a, x) => a + clockDiff(toMin(x.bed), target), 0) / n : null;
    const good = data.nights.filter((x) => x.verdict === "good").length;
    return { byDate, dates, target, targetSleep, n, avgSleep, avgBedDiff, good };
  }, [data]);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!data || !view) return <Loading />;

  const pick = (date: string) => {
    haptic();
    setSelected(date);
  };
  const current: Night | undefined = view.byDate.get(selected ?? "") ?? data.nights[data.nights.length - 1];

  const step = PLOT_W / view.dates.length;
  const barW = Math.max(3, step - 2); // зазор 2px между столбиками
  const cx = (i: number) => PAD_L + i * step + step / 2;

  const maxMin = 600; // шкала длительности: 0…10 ч
  const yDur = (min: number) => PAD_T + PLOT_H - (Math.min(min, maxMin) / maxMin) * PLOT_H;
  const lo = -120, hi = 240; // засыпание: от 2 ч раньше до 4 ч позже цели
  const yBed = (diff: number) => PAD_T + ((Math.max(lo, Math.min(hi, diff)) - lo) / (hi - lo)) * PLOT_H;

  // Подписи дат каждые 7 дней, от сегодняшнего.
  const xLabels = view.dates.map((d, i) => ({ d, i })).filter(({ i }) => (view.dates.length - 1 - i) % 7 === 0);
  const xAxis = xLabels.map(({ d, i }) => (
    <text key={d} className="axis" x={cx(i)} y={H - 5} textAnchor="middle">{dayLabel(d, false)}</text>
  ));

  return (
    <>
      <Head
        eyebrow={t("Цель {bed}–{wake}", { bed: data.target.bed, wake: data.target.wake })}
        title={t("Сон")}
        right={
          <div className="seg">
            {[14, 30].map((d) => (
              <button
                key={d}
                className={days === d ? "on" : undefined}
                aria-pressed={days === d}
                onClick={() => {
                  haptic();
                  setDays(d);
                  setSelected(null);
                }}
              >
                {t("{n} дней", { n: d })}
              </button>
            ))}
          </div>
        }
      />

      <div className="tiles">
        <div className="tile">
          <div className="meta">{t("Средний сон")}</div>
          <div className="tile-value">{view.avgSleep == null ? "–" : durationShort(view.avgSleep)}</div>
        </div>
        <div className="tile">
          <div className="meta">{t("Засыпание")}</div>
          <div className="tile-value">{view.avgBedDiff == null ? "–" : fromMin(view.target + view.avgBedDiff)}</div>
        </div>
        <div className="tile">
          <div className="meta">{t("В режиме")}</div>
          <div className="tile-value">
            {view.n ? t("{good} из {all}", { good: view.good, all: view.n }) : "–"}
          </div>
        </div>
      </div>

      {view.n === 0
        ? (
          <section className="panel">
            <p className="muted" style={{ margin: 0 }}>
              {t("Данных пока нет. Передачу сна с iPhone настраивает команда /shortcut в боте.")}
            </p>
          </section>
        )
        : (
          <>
            <section className="panel">
              <PanelHead title={t("Длительность")} meta={t("цель {v}", { v: duration(view.targetSleep) })} />
              <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={t("Длительность сна по ночам")}>
                {[0, 4, 8].map((h) => (
                  <g key={h}>
                    <line className="grid" x1={PAD_L} x2={W - PAD_R} y1={yDur(h * 60)} y2={yDur(h * 60)} />
                    <text className="axis" x={PAD_L - 6} y={yDur(h * 60) + 3} textAnchor="end">{h}{t("ч")}</text>
                  </g>
                ))}
                {view.dates.map((d, i) => {
                  const n = view.byDate.get(d);
                  if (!n) return null;
                  return (
                    <g key={d} className="hit-area" onClick={() => pick(d)}>
                      <rect x={PAD_L + i * step} y={PAD_T} width={step} height={PLOT_H} fill="transparent" />
                      <path
                        d={barPath(PAD_L + i * step + (step - barW) / 2, yDur(n.asleepMin), barW, yDur(0) - yDur(n.asleepMin))}
                        className={current?.date === d ? "bar active" : "bar"}
                      >
                        <title>{`${dayLabel(d)}: ${duration(n.asleepMin)}`}</title>
                      </path>
                    </g>
                  );
                })}
                <line className="target" x1={PAD_L} x2={W - PAD_R} y1={yDur(view.targetSleep)} y2={yDur(view.targetSleep)} />
                {xAxis}
              </svg>
              <p className="chart-note">{t("Пунктир: цель. Нажми на столбик, чтобы открыть ночь.")}</p>
            </section>

            <section className="panel">
              <PanelHead title={t("Засыпание")} meta={t("цель {v}", { v: data.target.bed })} />
              <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={t("Время засыпания по ночам")}>
                {[-120, 0, 120, 240].map((diff) => (
                  <g key={diff}>
                    <line className={diff === 0 ? "target" : "grid"} x1={PAD_L} x2={W - PAD_R} y1={yBed(diff)} y2={yBed(diff)} />
                    <text className="axis" x={PAD_L - 6} y={yBed(diff) + 3} textAnchor="end">
                      {fromMin(view.target + diff)}
                    </text>
                  </g>
                ))}
                {view.dates.map((d, i) => {
                  const n = view.byDate.get(d);
                  if (!n) return null;
                  const active = current?.date === d;
                  return (
                    <g key={d} className="hit-area" onClick={() => pick(d)}>
                      <rect x={PAD_L + i * step} y={PAD_T} width={step} height={PLOT_H} fill="transparent" />
                      <circle
                        cx={cx(i)}
                        cy={yBed(clockDiff(toMin(n.bed), view.target))}
                        r={active ? 5.5 : 4}
                        className={active ? "dot active" : "dot"}
                      >
                        <title>{`${dayLabel(d)}: ${n.bed}`}</title>
                      </circle>
                    </g>
                  );
                })}
                {xAxis}
              </svg>
              <p className="chart-note">{t("Время идёт сверху вниз: точки ниже пунктира означают засыпание позже цели.")}</p>
            </section>

            {current && <NightPanel night={current} />}

            <section className="panel">
              <button className="link" onClick={() => setShowTable((v) => !v)}>
                {showTable ? t("Скрыть таблицу") : t("Все ночи таблицей")}
              </button>
              {showTable && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("Ночь")}</th>
                      <th>{t("Сон")}</th>
                      <th>{t("Время")}</th>
                      <th>{t("Итог")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.nights].reverse().map((n) => (
                      <tr
                        key={n.date}
                        tabIndex={0}
                        onClick={() => pick(n.date)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(n.date))}
                      >
                        <td>{dayLabel(n.date)}</td>
                        <td className="mono">{duration(n.asleepMin)}</td>
                        <td className="mono">{n.bed}–{n.wake}</td>
                        <td><Verdict verdict={n.verdict} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
    </>
  );
}

function NightPanel({ night }: { night: Night }) {
  return (
    <section className="panel">
      <PanelHead title={dayLabel(night.date)} meta={`${night.bed}–${night.wake}`} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <Figure minutes={night.asleepMin} />
        <Verdict verdict={night.verdict} />
      </div>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>{t("Глубокий")}<b>{duration(night.deepMin)}</b></span>
        <span>REM<b>{duration(night.remMin)}</b></span>
        <span>{t("Основной")}<b>{duration(night.coreMin)}</b></span>
        <span>{t("Пробуждения")}<b>{duration(night.awakeMin)}</b></span>
      </div>
      {night.notes.map((n) => <p key={n} className="remark">{n}</p>)}
    </section>
  );
}
