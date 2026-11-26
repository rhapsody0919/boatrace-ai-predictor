// 選手ページの成績・調子の欄が、調子のカード・全国勝率の推移・条件別の成績の3つがそろうときだけ PC の2列の並びのクラスを持つことを守る（:has() の代わり、2026-11-26）
import assert from "node:assert/strict";
import { racerStatsClassName } from "../../src/components/racer/racerStatsLayout.js";
import { RACER_CONDITION_MIN_RUNS } from "../../src/utils/racerConditionStats.js";

const PAIR = "racer-performance-stats racer-stats-pc-pair";
const PLAIN = "racer-performance-stats";
const run = (weather) => ({
  weather,
  windSpeed: 2,
  waveHeight: 1,
  boatNumber: 1,
  rank1: 1,
  rank2: 2,
  rank3: 3,
});
const runs = (n, weather = "晴") =>
  Array.from({ length: n }, () => run(weather));
const chart = [{ date: "2026-10-01", winRate: 6.5 }];

assert.equal(
  racerStatsClassName(chart, runs(RACER_CONDITION_MIN_RUNS)),
  PAIR,
  "3つそろう",
);
assert.equal(
  racerStatsClassName([], runs(RACER_CONDITION_MIN_RUNS)),
  PLAIN,
  "勝率の推移が無い",
);
assert.equal(
  racerStatsClassName(chart, null),
  PLAIN,
  "履歴が届く前（条件別の成績を出さない）",
);
assert.equal(racerStatsClassName(chart, []), PLAIN, "履歴が空");
assert.equal(
  racerStatsClassName(chart, runs(RACER_CONDITION_MIN_RUNS - 1)),
  PLAIN,
  "どの条件も走数が足りない（条件別の成績を出さない）",
);
assert.equal(
  racerStatsClassName(
    chart,
    runs(RACER_CONDITION_MIN_RUNS, null).map((r) => ({
      ...r,
      windSpeed: null,
      waveHeight: null,
    })),
  ),
  PLAIN,
  "天候の記録が無い走だけ",
);

console.log("verify-racer-stats-layout-class: OK");
