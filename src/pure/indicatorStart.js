/**
 * 指標の定義: 大分類「スタート」（ADR-0108、設計 docs/design/indicator-parts/plan.md §3、族は catalog.md）。
 * データ出走表の平均ST（公式・直近30走）と ST安定度（展示STと本番STのズレ）の行を、見た目を変えずに移した物（段1）。
 * どれも小さいほど良い。
 */
import { toNumber } from "./raceIndicatorText.js";

const perBoat = (rows, boatOf, valueOf) =>
  new Map(
    (rows ?? []).map((r) => [
      boatOf(r),
      { value: valueOf(r), n: null, hidden: false },
    ]),
  );

export const START_INDICATORS = [
  {
    id: "racer.avgSt.official",
    family: "F-019",
    category: "start",
    kind: "official",
    subject: "racer",
    scenes: ["race", "racer"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowAvgSt",
      short: "review.cols.avgSt",
      hint: "avgSt",
    },
    sources: ["race.officialAvgSt"],
    // 公式の出走表と同じ期（期の決め方は getRaceOfficialAvgSt。期間は「?」に出す、BOA-815）
    window: "公式の期別成績（勝率と同じ期）",
    format: "fixed",
    compare: { direction: "min", digits: 2, minN: null },
    select: ({ analysis }) =>
      perBoat(
        analysis?.officialAvgSt?.rows,
        (r) => r.boatNumber,
        (r) => toNumber(r.avgSt),
      ),
    detailTab: "racecard",
    adornment: null,
  },
  {
    id: "racer.avgSt.last30",
    family: "F-020",
    category: "start",
    kind: "aggregate",
    subject: "racer",
    scenes: ["race"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowAvgSt30",
      short: "review.cols.avgSt30",
      hint: "avgSt30",
    },
    sources: ["race.st30"],
    window: "直近30走（v16 の st_mean30）",
    format: "fixed",
    compare: { direction: "min", digits: 3, minN: null },
    select: ({ analysis }) =>
      perBoat(
        analysis?.st30,
        (r) => r.boatNumber,
        (r) => toNumber(r.st30),
      ),
    detailTab: "racecard",
    adornment: null,
  },
  {
    id: "racer.exStGap.past",
    family: "F-025",
    category: "start",
    kind: "aggregate",
    subject: "racer",
    scenes: ["race"],
    shape: "perBoat",
    text: { label: "dataTable.rowSt", short: "review.cols.st", hint: "st" },
    sources: ["race.stPredictability"],
    // 画面の名前は「ST安定度」。中身は展示STと本番STのズレの平均（get_race_st_predictability、BOA-153）。期間は未確認
    window: "過去の展示STと本番STのズレの平均（期間は未確認）",
    format: "fixed",
    compare: { direction: "min", digits: 2, minN: null },
    // 走数0の艇は値を持たない（比べない）
    select: ({ analysis }) =>
      perBoat(
        analysis?.stPredictability,
        (r) => r.boat_number,
        (r) => (r.sample_count > 0 ? toNumber(r.avg_deviation) : null),
      ),
    detailTab: "st",
    adornment: null,
  },
];
