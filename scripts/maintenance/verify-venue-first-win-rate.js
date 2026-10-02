#!/usr/bin/env node
/**
 * 会場別1号艇勝率の集計（scripts/lib/venueFirstWinRate.js、BOA-303）の母数の数え方を検証する。DB接続は不要。
 *
 * 分析ツールの「1号艇勝率ランキング」は、日次バッチが保存した勝率と母数を読むだけになった。
 * 母数の数え方が崩れると、ランキングの「消化レース数」と勝率が黙ってずれるので、ここで止める。
 */
import { aggregateFirstWinRate } from "../lib/venueFirstWinRate.js";

const races = [
  // 桐生: 1着1号艇・1着3号艇・返還ありで1着1号艇（数える）
  { venue_code: 1, race_results: [{ rank1: 1, race_status: null }] },
  { venue_code: 1, race_results: { rank1: 3, race_status: "normal" } },
  {
    venue_code: 1,
    race_results: [{ rank1: 1, race_status: "partial_refund" }],
  },
  // 桐生: 不成立・rank1 NULL・結果の行なしは数えない
  { venue_code: 1, race_results: [{ rank1: 1, race_status: "no_race" }] },
  { venue_code: 1, race_results: [{ rank1: null, race_status: null }] },
  { venue_code: 1, race_results: [] },
  { venue_code: 1, race_results: null },
  // 戸田: 1件だけ
  { venue_code: 2, race_results: [{ rank1: 2, race_status: null }] },
];

const got = Object.fromEntries(aggregateFirstWinRate(races));
const expected = {
  1: { raceCount: 3, firstWins: 2 },
  2: { raceCount: 1, firstWins: 0 },
};

if (JSON.stringify(got) !== JSON.stringify(expected)) {
  console.error("❌ 1号艇勝率の母数の数え方が違う");
  console.error(`  期待: ${JSON.stringify(expected)}`);
  console.error(`  実際: ${JSON.stringify(got)}`);
  process.exit(1);
}
console.log(
  "✅ 1号艇勝率の母数（不成立・rank1 NULL・結果なしを除き、返還は数える）",
);
