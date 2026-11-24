/**
 * 指標の定義: 大分類「直前（展示・気象・調整）」（ADR-0108、設計 docs/design/indicator-parts/plan.md §3、族は catalog.md）。
 * 直前情報タブの展示タイム・展示ST の行を、見た目を変えずに移した物（段1）。どちらも小さいほど良く、主語は艇番。
 * 書き方の特別な字（展示ST の「.14」「F.01」、展示が無いときの括弧の過去平均）は、今は見せ方の層に残す。
 */
import { toNumber } from "./raceIndicatorText.js";

export const BEFORE_RACE_INDICATORS = [
  {
    id: "boat.exhibitionTime.today",
    family: "F-053",
    category: "beforeRace",
    kind: "official",
    subject: "boat",
    scenes: ["race"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowExhibition",
      short: "review.cols.exhibition",
      hint: "exhibition",
    },
    sources: ["race.exhibitionTime"],
    window: "このレースの展示",
    format: "fixed",
    compare: { direction: "min", digits: 2, minN: null },
    select: ({ analysis }) =>
      new Map(
        (analysis?.exhibitionTime ?? []).map((r) => [
          r.boat_number,
          { value: toNumber(r.exhibition_time), n: null, hidden: false },
        ]),
      ),
    detailTab: "extrend",
    adornment: null,
  },
  {
    id: "boat.exhibitionSt.today",
    family: "F-055",
    category: "beforeRace",
    kind: "official",
    subject: "boat",
    scenes: ["race"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowExSt",
      short: "review.cols.exSt",
      hint: "exSt",
    },
    sources: ["race.stPredictability"],
    window: "このレースの展示",
    format: "fixed",
    compare: { direction: "min", digits: 2, minN: null },
    // 展示でフライング・出遅れした艇（F.01 等）は値を持たせない。印を外した正の数のままだと、
    // F の艇が一番早く見えて金枠が付いた（BOA-759）。次に早い艇が最良になる（今までどおり）
    select: ({ analysis }) =>
      new Map(
        (analysis?.stPredictability ?? []).map((r) => [
          r.boat_number,
          {
            value: r.exhibition_start_flag ? null : toNumber(r.exhibition_st),
            n: null,
            hidden: false,
          },
        ]),
      ),
    detailTab: "st",
    adornment: null,
  },
];
