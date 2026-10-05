/**
 * BOA-271 アナロジー・ファインダー v16 の定義の固定データ検査（ci）。
 *
 * 1. 優勝戦・準優勝戦の判定 v2（tasks T1-1）: 固定の82件（scripts/ml/analogy/testdata/stage-rule-v2-cases.json）で、
 *    src/constants/raceStageConfig.js の getRaceStageCategory が expected_category と一致すること。
 *    バッジ（getRaceStageKey）と今節の得点の除外（seriesPoints.js の classifyStage）が同じ判定に従うこと。
 *    Python 側（features.py の round_from_stage）は scripts/ml/analogy/tests/test_features.py が同じ82件で検査する
 * 2. 展示後の類似レースの並べ直し（tasks T4-1）: src/utils/analogySimilarRerank.js が、Python（v16_similar）の展示後の
 *    表し方での厳密な並び（scripts/ml/analogy/testdata/v16-rerank.json、例のレース）と、順位が完全に一致し、
 *    距離²の差が 1e-5 未満であること。候補が層より少ないときの厳密さの判定
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
import { rerankSimilar } from "../../src/utils/analogySimilarRerank.js";

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

// ---- 2. 展示後の並べ直し ------------------------------------------------
const rerank = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../ml/analogy/testdata/v16-rerank.json"),
    "utf8",
  ),
);
const got = rerankSimilar(rerank.candidates, rerank.today);
check(
  "並べ直しの順位",
  got.neighbors.map((n) => n.race_id),
  rerank.expected.race_ids,
);
const maxDiff = Math.max(
  ...got.neighbors.map((n, i) => Math.abs(n.d2 - rerank.expected.d2[i])),
);
check("並べ直しの距離²の差 < 1e-5", maxDiff < 1e-5, true);
check("候補が層の全件なら厳密", got.exact, true);
// 候補が層の一部（層 100件・候補 3件）: 候補の最後の出走表の距離²が、2件目の展示後の距離²より大きければ厳密
const tiny = {
  n_layer: 100,
  lambda_racecard: 0.1,
  candidates: ["a", "b", "c"],
  d2_racecard: [0.1, 0.2, 0.9],
  venue_match: [true, true, true],
  exhibition: {
    lambda: 0.2,
    columns: [{ feature: "wind_speed", slot: 0, kind: "race_num" }],
    weights: [1],
    norm: { wind_speed: { mean: 0, sd: 1 } },
    values: [[0], [0], [0]],
  },
};
const today0 = { boats: {}, race: { wind_speed: 0 } };
check(
  "厳密（下限 0.9 ≥ 2件目 0.2）",
  rerankSimilar(tiny, today0, 2).exact,
  true,
);
// 展示の列で b・c が遠くなる（b 0.2+1、c 0.9+1）と、2件目は b の 1.2 で、候補の外の下限 0.9 より大きい
check(
  "厳密でない（下限 0.9 < 2件目 1.2）",
  rerankSimilar(
    { ...tiny, exhibition: { ...tiny.exhibition, values: [[0], [1], [1]] } },
    today0,
    2,
  ).exact,
  false,
);

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の不一致`);
  process.exit(1);
}
console.log(
  `✅ 優勝戦・準優勝戦の判定 v2: ${cases.length} 件と旧判定から変わる5種の名前が一致。展示後の並べ直しが Python と一致（距離²の差の最大 ${maxDiff.toExponential(1)}）`,
);
