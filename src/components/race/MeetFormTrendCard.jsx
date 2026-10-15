/**
 * MeetFormTrendCard - 直前情報タブ「今節の足の推移と着順」（BOA-885、2026-10-15 承認のモック
 * docs/design/boa-885-meet-exhibition-trend/mock/APPROVED.md）。
 *
 * 6艇の今節の展示（展示タイム・一周・まわり足・直線）を線で重ね、選んだ艇だけ太くして、
 * 点の中に実際の着順を出す。下の行は選んだ艇の日・R・枠・進入・値・着順で、各点の真下にそろえる。
 * 「上がっている」の判定・印は出さない（効き目を確かめていないため。ファン4人の結論）。
 *
 * 全貌動画で撮るので、線・点・チップ・行に data-boat を付ける。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BOAT_COLORS,
  BOAT_LINE_COLORS,
  getBoatChipBackground,
} from "../../utils/colors";
import { buildMeetFormTrend, domainOf, segmentsOf } from "./meetFormTrend";
import InlineFetchError from "../InlineFetchError";
import "./MeetFormTrendCard.css";

const METRIC_LABEL_KEY = {
  exhibition: "beforeInfo.meetFormMetricExhibition",
  lap: "beforeInfo.meetFormMetricLap",
  turn: "beforeInfo.meetFormMetricTurn",
  straight: "beforeInfo.meetFormMetricStraight",
};

/** 1行の高さと、グラフの余白（px）。広い画面は文字を12pxにする（承認範囲の外、APPROVED.md） */
const layoutFor = (width) => {
  const wide = width >= 600;
  return {
    font: wide ? 12 : 10,
    finishFont: wide ? 13 : 11,
    chartHeight: wide ? 280 : 210,
    rowHeight: wide ? 22 : 18,
    left: wide ? 56 : 50,
    right: 12,
    top: 16,
    bottom: 22,
    inset: 14,
  };
};

const ROW_KEYS = ["day", "race", "frame", "course", "value", "finish"];

function MeetFormTrendCard({
  focusedBoat = null,
  onFocusBoat,
  players,
  trendByRacer,
  originalByKey,
  runsByRacer,
  scopedByRacer,
  venueDailyAvg,
  turnTimeDiffers = false,
  finishFailed = false,
  onRetryFinish,
}) {
  const { t } = useTranslation();
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [metricKey, setMetricKey] = useState("exhibition");
  // 選んだ艇はタブをまたいで共有する（?boat=、BOA-492・493）。思考アシスト等から
  // ?tab=beforeInfo&boat=N で開いたときもその艇を強調する。共有が無いとき（直前情報タブを
  // 単独で使う場合）は自分で持つ。まだどの艇も選んでいなければ1号艇
  const [localBoat, setLocalBoat] = useState(null);
  const boat = focusedBoat ?? localBoat ?? 1;
  const selectBoat = (b) => (onFocusBoat ? onFocusBoat(b) : setLocalBoat(b));

  const model = buildMeetFormTrend({
    players,
    trendByRacer,
    originalByKey,
    runsByRacer,
    scopedByRacer,
  });
  // 今節の初戦（前の走が無い）は出さない。表の「今節初戦」に任せる
  const hasData = model.maxRuns > 0 && model.metrics.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!hasData || !el) return undefined;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  if (!hasData) return null;

  const metric = model.metrics.includes(metricKey)
    ? metricKey
    : model.metrics[0];
  const selected =
    model.boats.find((b) => b.boat === boat) ?? model.boats[0] ?? null;
  const showAvg = metric === "exhibition";
  const avgOf = (date) => {
    const v = venueDailyAvg?.[date];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const domain = domainOf([
    ...model.boats.flatMap((b) => b.runs.map((r) => r.values[metric])),
    ...(showAvg && selected ? selected.runs.map((r) => avgOf(r.date)) : []),
  ]);
  const metricLabel = (key) =>
    `${t(METRIC_LABEL_KEY[key])}${turnTimeDiffers && key === "turn" ? " ※" : ""}`;

  const L = layoutFor(width || 360);
  const W = Math.max(width, 280);
  const H = L.chartHeight + ROW_KEYS.length * L.rowHeight + 8;
  const plotLeft = L.left + L.inset;
  const plotWidth = W - plotLeft - L.right;
  const x = (i) =>
    plotLeft +
    (model.maxRuns <= 1
      ? plotWidth / 2
      : (plotWidth * i) / (model.maxRuns - 1));
  const y = (v) =>
    L.top +
    (L.chartHeight - L.top - L.bottom) *
      ((v - domain.lo) / (domain.hi - domain.lo));
  const ticks = domain
    ? [0, 1, 2, 3, 4].map((k) => domain.lo + ((domain.hi - domain.lo) * k) / 4)
    : [];

  const cellText = (run, key) => {
    switch (key) {
      case "day":
        return t("beforeInfo.meetFormDay", {
          day: Number(run.date.slice(8, 10)),
        });
      case "race":
        return t("beforeInfo.meetFormRace", { no: run.raceNo });
      case "frame":
        return run.boatNumber ?? "—";
      case "course":
        return run.course ?? "—";
      case "value":
        return run.values[metric] === null
          ? t("beforeInfo.meetFormNoValue")
          : run.values[metric].toFixed(2);
      default:
        return run.finish ?? "—";
    }
  };

  const drawOrder = [...model.boats].sort(
    (a, b) =>
      Number(a.boat === selected?.boat) - Number(b.boat === selected?.boat),
  );

  return (
    <section className="rbi-card mft-card" data-testid="meet-form-trend">
      <h3 className="rbi-heading">{t("beforeInfo.meetFormTitle")}</h3>
      <div className="mft-metrics" role="tablist">
        {model.metrics.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === metric}
            className={`mft-metric${key === metric ? " is-active" : ""}`}
            onClick={() => setMetricKey(key)}
          >
            {metricLabel(key)}
          </button>
        ))}
      </div>
      <div className="mft-boats">
        {model.boats.map((b) => (
          <button
            key={b.boat}
            type="button"
            data-boat={b.boat}
            aria-pressed={b.boat === selected?.boat}
            aria-label={t("beforeInfo.meetFormBoatLabel", { boat: b.boat })}
            className={`mft-boat${b.boat === selected?.boat ? " is-active" : ""}`}
            style={{
              background: getBoatChipBackground(b.boat),
              color: BOAT_COLORS[b.boat]?.text,
            }}
            onClick={() => selectBoat(b.boat)}
          >
            {b.boat}
          </button>
        ))}
      </div>
      {finishFailed && (
        <InlineFetchError
          message={t("beforeInfo.meetFormFinishFailed")}
          onRetry={onRetryFinish}
        />
      )}
      <div ref={wrapRef} className="mft-chart">
        {width > 0 && domain && selected && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="img"
            aria-label={t("beforeInfo.meetFormChartLabel", {
              metric: metricLabel(metric),
              boat: selected.boat,
            })}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line
                  className="mft-grid"
                  x1={L.left}
                  x2={W - L.right}
                  y1={y(v)}
                  y2={y(v)}
                />
                <text
                  className="mft-axis"
                  x={L.left - 6}
                  y={y(v) + 3}
                  fontSize={L.font}
                  textAnchor="end"
                >
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {Array.from({ length: model.maxRuns }, (_, i) => (
              <text
                key={i}
                className="mft-axis"
                x={x(i)}
                y={L.chartHeight - 6}
                fontSize={L.font}
                textAnchor="middle"
              >
                {t("beforeInfo.meetFormRunN", { n: i + 1 })}
              </text>
            ))}
            {showAvg && (
              <AvgLine
                points={selected.runs.map((r, i) => {
                  const v = avgOf(r.date);
                  return v === null ? null : [x(i), y(v)];
                })}
              />
            )}
            {drawOrder.map((b) => {
              const on = b.boat === selected.boat;
              const vals = b.runs.map((r) => r.values[metric]);
              const color = BOAT_LINE_COLORS[b.boat];
              return (
                <g
                  key={b.boat}
                  data-boat={b.boat}
                  className={on ? "mft-series is-active" : "mft-series"}
                >
                  {segmentsOf(vals).map((s) => (
                    <line
                      key={`${s.from}-${s.to}`}
                      x1={x(s.from)}
                      y1={y(vals[s.from])}
                      x2={x(s.to)}
                      y2={y(vals[s.to])}
                      stroke={color}
                      strokeWidth={on ? 3 : 1.5}
                      strokeDasharray={s.gap ? "3 4" : undefined}
                    />
                  ))}
                  {vals.map((v, i) =>
                    v === null ? null : on ? (
                      <g key={i} data-boat={b.boat}>
                        <circle
                          className="mft-point-active"
                          cx={x(i)}
                          cy={y(v)}
                          r={L.finishFont - 2}
                          stroke={color}
                        />
                        <text
                          className={
                            b.runs[i].finish === 1
                              ? "mft-finish is-win"
                              : "mft-finish"
                          }
                          x={x(i)}
                          y={y(v) + 4}
                          fontSize={L.finishFont}
                          textAnchor="middle"
                        >
                          {b.runs[i].finish ?? "—"}
                        </text>
                      </g>
                    ) : (
                      <circle
                        key={i}
                        cx={x(i)}
                        cy={y(v)}
                        r={2.5}
                        fill={color}
                      />
                    ),
                  )}
                </g>
              );
            })}
            {ROW_KEYS.map((key, j) => {
              const top = L.chartHeight + 8 + j * L.rowHeight;
              const base = top + L.rowHeight - 5;
              return (
                <g
                  key={key}
                  className="mft-row"
                  data-boat={selected.boat}
                  data-row={key}
                >
                  <line className="mft-grid" x1={0} x2={W} y1={top} y2={top} />
                  <text className="mft-axis" x={0} y={base} fontSize={L.font}>
                    {key === "value"
                      ? t(`beforeInfo.meetFormRowValue_${metric}`)
                      : t(`beforeInfo.meetFormRow_${key}`)}
                  </text>
                  {selected.runs.map((run, i) => {
                    const off =
                      key === "course" &&
                      run.course !== null &&
                      run.course !== run.boatNumber;
                    const win = key === "finish" && run.finish === 1;
                    return (
                      <text
                        key={run.raceId}
                        className={[
                          "mft-cell",
                          key === "value" || key === "finish"
                            ? "is-strong"
                            : "",
                          off ? "is-course-off" : "",
                          win ? "is-win" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        x={x(i)}
                        y={base}
                        fontSize={key === "finish" ? L.finishFont : L.font}
                        textAnchor="middle"
                      >
                        {cellText(run, key)}
                      </text>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="rbi-chart-note">
        {t("beforeInfo.meetFormNote")}
        {showAvg ? t("beforeInfo.meetFormNoteAvg") : ""}
      </p>
    </section>
  );
}

/** その日の会場平均の破線。値の無い日は線を切る */
function AvgLine({ points }) {
  const runs = [];
  let cur = [];
  points.forEach((p) => {
    if (p === null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(p);
  });
  if (cur.length) runs.push(cur);
  return runs.map((pts) => (
    <polyline
      key={pts[0].join(",")}
      data-venue-avg
      className="mft-avg"
      points={pts.map((p) => p.join(",")).join(" ")}
    />
  ));
}

export default MeetFormTrendCard;
