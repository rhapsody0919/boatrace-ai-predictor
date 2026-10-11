/**
 * verify-motor-usage.js - モーターの使用回数と「未使用（新モーター・実績なし）」の判定（src/utils/motorUsage.js、BOA-702）
 *
 *   (a) 使用回数: 会場公式の出走数（race_count）と、自社の出走数（sample_count。世代の始まりから数えているときだけ）の
 *       うち、分かっているものの大きいほう。どれも分からなければ null
 *   (b) 取得失敗の行（venue_stats_failed）の race_count、期間で切り詰めた窓・世代の分からない行の sample_count は使わない
 *   (c) 未使用: 表示する2連率が0で、使用回数が0と分かるときだけ
 *
 * 実行: node scripts/maintenance/verify-motor-usage.js
 */
import { isUnusedMotor, motorUsageCount } from "../../src/utils/motorUsage.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const cases = [
  ["(a) 会場公式の出走数だけ", { race_count: 0 }, 0],
  ["(a) 会場公式の出走数だけ（使用済み）", { race_count: 12 }, 12],
  [
    "(a) 自社の出走数だけ（世代の始まりから）",
    { race_count: null, sample_count: 3, clipped_by_generation: true },
    3,
  ],
  [
    "(a) 両方: 会場公式0・自社2（節の途中の出走は自社だけが数える）→ 大きいほう",
    { race_count: 0, sample_count: 2, clipped_by_generation: true },
    2,
  ],
  [
    "(a) 両方: どちらも0",
    { race_count: 0, sample_count: 0, clipped_by_generation: true },
    0,
  ],
  ["(a) どれも分からない", { race_count: null, sample_count: null }, null],
  ["(a) 行が無い", null, null],
  [
    "(b) 取得失敗の行の race_count は使わない",
    { race_count: 0, venue_stats_failed: true },
    null,
  ],
  [
    "(b) 取得失敗でも、世代の始まりからの自社の数は使う",
    {
      race_count: null,
      venue_stats_failed: true,
      sample_count: 4,
      clipped_by_generation: true,
    },
    4,
  ],
  [
    "(b) 期間で切り詰めた窓（clipped_by_generation=false）の sample_count は使わない",
    { race_count: null, sample_count: 0, clipped_by_generation: false },
    null,
  ],
  [
    "(b) 世代の分からない行（clipped_by_generation なし）の sample_count は使わない",
    { sample_count: 0 },
    null,
  ],
];
for (const [label, row, expected] of cases) {
  const got = motorUsageCount(row);
  check(label, got === expected, `期待 ${expected} / 実際 ${got}`);
}

check(
  "(c) 未使用: 2連率0・使用回数0",
  isUnusedMotor(0, { race_count: 0 }) === true,
);
check(
  "(c) 2連率0でも使用回数1以上なら未使用ではない（本物の0%）",
  isUnusedMotor(0, { race_count: 5 }) === false,
);
check(
  "(c) 使用回数が分からなければ未使用と言わない",
  isUnusedMotor(0, { race_count: null }) === false,
);
check(
  "(c) 2連率が0でなければ未使用ではない",
  isUnusedMotor(12.5, { race_count: 0 }) === false,
);
check(
  "(c) 2連率が無い（null）なら未使用と言わない",
  isUnusedMotor(null, { race_count: 0 }) === false,
);

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nALL OK");
