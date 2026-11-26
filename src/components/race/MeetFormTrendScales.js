/** MeetFormTrendCard の表示の値の計算（描画しない）。座標は共通の推移の図（TrendChart）が持つ */

export const ROW_KEYS = ["day", "race", "frame", "course", "value", "finish"];

/** 選んだ指標・艇と、会場平均・図に渡す艇ごとの点を決める */
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
  const avgValues =
    showAvg && selected ? selected.runs.map((r) => avgOf(r.date)) : [];
  const seriesByBoat = new Map(
    model.boats
      .filter((b) => b.runs.length > 0)
      .map((b) => [b.boat, b.runs.map((r) => pointOf(r, metric))]),
  );
  return { metric, selected, showAvg, avgOf, avgValues, seriesByBoat };
};

// 図の点。吹き出しの run は TrendTooltip の形（会場は raceId の 11〜12 文字目）
const pointOf = (r, metric) => ({
  raceId: r.raceId,
  date: r.date,
  value: r.values[metric],
  mark: r.finish,
  gapDays: null,
  meetRun: r,
  run: {
    raceId: r.raceId,
    date: r.date,
    venueCode: r.raceId.slice(11, 13),
    raceNo: r.raceNo,
    boatNumber: r.boatNumber,
    entryCourse: r.course,
    finishRank: typeof r.finish === "number" ? r.finish : null,
    finishMark: typeof r.finish === "number" ? null : r.finish,
  },
});
