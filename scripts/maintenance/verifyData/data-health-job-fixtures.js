/**
 * verify-data-health-job.js の入力（日付・被覆の行・偽の呼び出し）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { TABLE_ROWS_TABLES } from "../../lib/dataHealth/functions.js";

export const show = (v) => JSON.stringify(v);
export const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

// ---------------------------------------------------------------------------
// (f) 実行
// ---------------------------------------------------------------------------
export const TARGET = "2026-09-22"; // 評価の終端は 09-21
export const NOW = new Date("2026-09-21T21:35:00Z"); // 06:35 JST（09-22）

// 関数の結果（日別の行）を作るヘルパ。全て満たす日を基準にする
export const coverageRow = (d, over = {}) => ({
  d,
  total: 100,
  excluded: 0,
  denom: 100,
  result: 100,
  rank_denom: 100,
  rank4_6: 100,
  actual_course: 100,
  winning_technique: 100,
  race_stage: 100,
  st_row: 100,
  st_value: 100,
  exhibition_row: 100,
  exhibition_time: 100,
  odds: 100,
  odds_all: 100,
  trifecta_all: 100,
  trio_all: 100,
  exacta_all: 100,
  quinella_all: 100,
  wide_all: 100,
  ...over,
});
export const dates = [
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
  "2026-09-21",
];
export const ALL_TABLES_OK = Object.fromEntries(
  TABLE_ROWS_TABLES.map((t) => [t, true]),
);
/** 鮮度の関数の、全項目が ok の戻り値 */
export const allFresh = (items) =>
  Object.fromEntries(
    items.map((i) => [
      i.key,
      { applicable: true, ok: true, observed: "2026-09-21T16:00:00+00:00" },
    ]),
  );
export function makeCaller({
  coverage = dates.map((d) => coverageRow(d)),
  tableRows = {
    ...ALL_TABLES_OK,
    race_special_notes: false,
    race_series: false,
    racer_period_stats: false,
  },
  fail = {},
  overrides = {},
} = {}) {
  const calls = [];
  const fn = async (f, args) => {
    calls.push({ name: f.name, args });
    if (fail[f.name]) throw new Error(fail[f.name]);
    if (overrides[f.name]) return overrides[f.name];
    if (f.name === "data_health_coverage") return coverage;
    if (f.name === "data_health_table_rows") return tableRows;
    if (f.items) return allFresh(f.items);
    return [];
  };
  fn.calls = calls;
  return fn;
}
