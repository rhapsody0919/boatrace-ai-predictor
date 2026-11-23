/**
 * 指標の定義: 大分類「選手の力」（ADR-0108、設計 docs/design/indicator-parts/plan.md §3、族は catalog.md）。
 * 1つの指標＝1つの定義。画面・AI 用コピーは行の計算・最良の判定・書き方を自前で持たず、この定義を通す。
 *
 * 今の定義は、データ出走表の3行（全国勝率・当地勝率・全国2連率）を見た目を変えずに移した物（段1の最初）。
 * 値はどれも公式の出走表の列（players、src/services の取得そのまま）。
 */
import { toNumber } from "./raceIndicatorText.js";

/** players（6艇）から艇番ごとの { value, n, hidden } を作る。出走表の値なので母数は持たない */
const perBoatFromPlayers = (players, pick) =>
  new Map(
    (players ?? []).map((p) => [
      p.number,
      { value: toNumber(pick(p)), n: null, hidden: false },
    ]),
  );

export const RACER_POWER_INDICATORS = [
  {
    id: "racer.winRate.official",
    family: "F-001",
    category: "racerPower",
    kind: "official",
    subject: "racer",
    scenes: ["race", "racer"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowWinRate",
      short: "review.cols.winRate",
      hint: "winRate",
    },
    sources: ["players"],
    window: "公式の出走表（最新の期）",
    format: "formatWinRate",
    compare: { direction: "max", digits: 2, minN: null },
    select: ({ players }) => perBoatFromPlayers(players, (p) => p.winRate),
    detailTab: null,
    adornment: "gradeBadge",
  },
  {
    id: "racer.localWinRate.official",
    family: "F-002",
    category: "racerPower",
    kind: "official",
    subject: "racer",
    scenes: ["race"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowLocalWinRate",
      short: "review.cols.localWinRate",
      hint: "localWinRate",
    },
    sources: ["players"],
    window: "公式の出走表（当地）",
    format: "formatWinRate",
    compare: { direction: "max", digits: 2, minN: null },
    select: ({ players }) => perBoatFromPlayers(players, (p) => p.localWinRate),
    detailTab: "racecard",
    adornment: null,
  },
  {
    id: "racer.twoRate.official",
    family: "F-003",
    category: "racerPower",
    kind: "official",
    subject: "racer",
    scenes: ["race", "racer"],
    shape: "perBoat",
    text: {
      label: "dataTable.rowTwoRate",
      short: "review.cols.twoRate",
      hint: "twoRate",
    },
    sources: ["players"],
    window: "公式の出走表（最新の期）",
    format: "rateParts",
    compare: { direction: "max", digits: 1, minN: null },
    select: ({ players }) => perBoatFromPlayers(players, (p) => p.global2Rate),
    detailTab: "racecard",
    adornment: null,
  },
];
