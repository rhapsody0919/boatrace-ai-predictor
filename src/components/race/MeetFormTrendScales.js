/** MeetFormTrendCard の座標・表示の値の計算（描画しない） */
import { domainOf } from "./meetFormTrend";

export const ROW_KEYS = ["day", "race", "frame", "course", "value", "finish"];

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

/** 選んだ指標・艇と、値域・会場平均・描く順を決める */
export const deriveView = (model, metricKey, boat, venueDailyAvg) => {
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
  const drawOrder = [...model.boats].sort(
    (a, b) =>
      Number(a.boat === selected?.boat) - Number(b.boat === selected?.boat),
  );
  return { metric, selected, showAvg, avgOf, domain, drawOrder };
};

/** 幅と値域から、描く座標の関数を作る */
export const chartScales = (width, maxRuns, domain) => {
  const L = layoutFor(width || 360);
  const W = Math.max(width, 280);
  const H = L.chartHeight + ROW_KEYS.length * L.rowHeight + 8;
  const plotLeft = L.left + L.inset;
  const plotWidth = W - plotLeft - L.right;
  const x = (i) =>
    plotLeft + (maxRuns <= 1 ? plotWidth / 2 : (plotWidth * i) / (maxRuns - 1));
  const y = (v) =>
    L.top +
    (L.chartHeight - L.top - L.bottom) *
      ((v - domain.lo) / (domain.hi - domain.lo));
  const ticks = domain
    ? [0, 1, 2, 3, 4].map((k) => domain.lo + ((domain.hi - domain.lo) * k) / 4)
    : [];
  return { L, W, H, x, y, ticks };
};
