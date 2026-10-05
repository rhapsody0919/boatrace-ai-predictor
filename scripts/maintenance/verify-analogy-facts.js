/**
 * BOA-271 アナロジー・ファインダー v16 の定義の固定データ検査（ci）。
 *
 * 1. 優勝戦・準優勝戦の判定 v2（tasks T1-1）: 固定の82件（scripts/ml/analogy/testdata/stage-rule-v2-cases.json）で、
 *    src/constants/raceStageConfig.js の getRaceStageCategory が expected_category と一致すること。
 *    バッジ（getRaceStageKey）と今節の得点の除外（seriesPoints.js の classifyStage）が同じ判定に従うこと。
 *    Python 側（features.py の round_from_stage）は scripts/ml/analogy/tests/test_features.py が同じ82件で検査する
 *
 * 使い方: node scripts/maintenance/verify-analogy-facts.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getRaceStageCategory,
  getRaceStageKey,
} from "../../src/constants/raceStageConfig.js";
import { classifyStage } from "../../src/components/race/seriesPoints.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(
  __dirname,
  "../ml/analogy/testdata/stage-rule-v2-cases.json",
);

let failures = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  failures += 1;
  console.error(
    `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---- 1. 優勝戦・準優勝戦の判定 v2 ----------------------------------------
const { cases } = JSON.parse(fs.readFileSync(CASES, "utf8"));
check("固定データの件数", cases.length, 82);
for (const c of cases) {
  const category = getRaceStageCategory(c.stage)?.key ?? null;
  check(`種別 ${c.stage}`, category, c.expected_category);
  const roundKey = ["final", "semifinal"].includes(c.expected_category)
    ? c.expected_category
    : null;
  check(`バッジ ${c.stage}`, getRaceStageKey(c.stage), roundKey);
  if (roundKey)
    check(`今節の得点から除く ${c.stage}`, classifyStage(c.stage), "excluded");
}

// 旧判定から変わる本体の6レースの名前（analysis/t1/t1-1-stage-rule.json の v2.d）
for (const [stage, key] of [
  ["準決勝戦", "semifinal"],
  ["決勝戦", "final"],
  ["王将位決定戦", "final"],
  ["県内選手権優", "final"],
  ["賞金女王決定", "final"],
]) {
  check(`v2 で変わる名前のバッジ ${stage}`, getRaceStageKey(stage), key);
  check(
    `v2 で変わる名前の今節の得点 ${stage}`,
    classifyStage(stage),
    "excluded",
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log(
  `✅ 優勝戦・準優勝戦の判定 v2: ${cases.length} 件と旧判定から変わる5種の名前が一致`,
);
