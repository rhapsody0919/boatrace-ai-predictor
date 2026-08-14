/**
 * 逃げ確率キャリブレーション補正のシミュレーション（AI予想モデル大規模改修 Task3, ADR0011 Phase1a）
 *
 * turnPrediction.js のコードを変更せずに、既存 predictions.feature_contributions.turnPrediction.distribution.nige
 * （softmax正規化後の確率）から、逃げのrawProbに補正係数kを掛けた場合の新しい確率を理論的に逆算する。
 *
 * softmaxの数式: scaledProb = rawProb^(1/T)、probability = scaledProb / sum(scaledProbs)
 * rawProb_nige に k を掛けると scaledProb_nige は k^(1/T) 倍になり、他の決まり手のscaledProbは不変。
 * よって既存の distribution.nige（p）だけから、新しい確率を以下で計算できる：
 *   new_p = (k^(1/T) * p) / (k^(1/T) * p + (1 - p))
 *
 * 使い方: node scripts/analysis/simulate-nige-calibration.js
 */

import { fetchAll } from "../lib/supabaseClient.js";

const SOFTMAX_TEMP = 1.5; // scripts/lib/turnPrediction.js と同じ値
const CANDIDATE_FACTORS = [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.0];

function calibrate(p, k) {
  const scaled = Math.pow(k, 1 / SOFTMAX_TEMP) * p;
  return scaled / (scaled + (1 - p));
}

function bucketOf(p) {
  if (p < 0.15) return null; // calibration-report.js側の最小帯に揃える
  if (p < 0.2) return "15-20%";
  if (p < 0.3) return "20-30%";
  if (p < 0.4) return "30-40%";
  if (p < 0.5) return "40-50%";
  if (p < 0.6) return "50-60%";
  return "60%+";
}

async function main() {
  console.log("データ取得中...");
  const predictions = await fetchAll(
    "predictions",
    "race_id, feature_contributions",
    (q) =>
      q.eq("model_id", "standard").not("feature_contributions", "is", null),
  );
  const results = await fetchAll(
    "race_results",
    "race_id, winning_technique",
    (q) => q.not("winning_technique", "is", null),
  );
  const resultMap = new Map(
    results.map((r) => [r.race_id, r.winning_technique]),
  );

  const samples = [];
  for (const p of predictions) {
    const nigeP = p.feature_contributions?.turnPrediction?.distribution?.nige;
    if (nigeP == null) continue;
    const technique = resultMap.get(p.race_id);
    if (!technique) continue;
    samples.push({ p: nigeP, hit: technique === "逃げ" });
  }
  console.log(`${samples.length}件のサンプルを取得\n`);

  console.log(
    "=== 補正係数k別: 全体の平均乖離（|new_p平均 - 実現率|の確率帯別平均） ===\n",
  );

  for (const k of [1.0, ...CANDIDATE_FACTORS]) {
    const buckets = {};
    for (const s of samples) {
      const newP = k === 1.0 ? s.p : calibrate(s.p, k);
      const b = bucketOf(newP);
      if (!b) continue;
      if (!buckets[b]) buckets[b] = { sumP: 0, hit: 0, n: 0 };
      buckets[b].sumP += newP;
      buckets[b].hit += s.hit ? 1 : 0;
      buckets[b].n += 1;
    }
    let totalGap = 0;
    let bucketCount = 0;
    const lines = [];
    for (const [b, v] of Object.entries(buckets)) {
      if (v.n < 20) continue;
      const avgP = v.sumP / v.n;
      const actual = v.hit / v.n;
      const gap = Math.abs(avgP - actual) * 100;
      totalGap += gap;
      bucketCount += 1;
      lines.push(
        `    ${b.padEnd(8)} N=${String(v.n).padStart(5)}  予測=${(avgP * 100).toFixed(1)}%  実現=${(actual * 100).toFixed(1)}%  乖離=${gap.toFixed(1)}pt`,
      );
    }
    const avgGap = bucketCount > 0 ? totalGap / bucketCount : NaN;
    console.log(`k=${k.toFixed(1)}  平均乖離=${avgGap.toFixed(2)}pt`);
    if (k === 1.0 || CANDIDATE_FACTORS.includes(k)) {
      lines.forEach((l) => console.log(l));
    }
    console.log("");
  }
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
