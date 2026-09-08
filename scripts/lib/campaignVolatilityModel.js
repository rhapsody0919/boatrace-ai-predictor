/**
 * イン崩れ狙い企画（docs/design/sns-hub-campaign-pipeline/）用の買い目生成モデル。
 *
 * scripts/analysis/campaign-backtest-v5-combined-exclude-boat1.js でのバックテストで
 * 検証済みのロジックをそのまま本番用に移植したもの（3週間分463レースでge_99=94.3%、
 * ge_100=105.5%、未知の直近3日間でも崩壊しないことを確認済み）。
 *
 * 設計判断（重要）: 当初spec.mdは「AI用コピペプロンプトを生成し、人間がAIに貼り付けて
 * 回答をもらう」運用を想定していたが、バックテストで実際のAI（Claude）による都度判断は
 * 本モデルより明確に成績が悪かった（回収率27.2% vs 94.3%）ため、買い目生成は本モデル
 * （決定的な計算式）で自動化する方針に変更した。ai_model_name列には実態通り
 * MODEL_NAME（'volatility-v5-stats-x-turnprediction'）を記録し、'claude-sonnet-5'等の
 * 実際のAIモデル名は名乗らない（開示の誠実性を優先）。
 *
 * モデルの考え方: 1号艇を完全に除外した上で、出走表データ（勝率・モーター2連率）と
 * 展開予測（turnPrediction.patternsに登場する艇＝技術的に勝ち筋がある艇）を掛け合わせて
 * 2〜6号艇をランキングする。上位3艇の3連単3点（同一3艇の順列3通り、900円）を買い目とする。
 * 掛け方の追加検証（5点・ボックス・フォーメーション等）はすべてこのシンプルな3点より
 * 劣ったため、意図的にこの形のまま据え置いている。
 */

export const MODEL_NAME = "volatility-v5-stats-x-turnprediction";
const BOOST = 3.0; // 展開予測に登場する艇をどれだけ優遇するか（バックテストと同じ値）

function avg(nums) {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * @param {Array<{boat_number:number, win_rate:number, motor_2rate:number}>} boats - race_entries由来の6艇分データ
 * @param {{patterns?: Array<{winnerCourse:number, probability:number}>}} turnPrediction - feature_contributions.turnPrediction
 * @returns {{ranking:number[], picks:string[]}} ranking: 1号艇を除いた5艇を有力順に並べた配列。picks: 3連単3点（"a-b-c"形式）
 */
export function computeCampaignPicks(boats, turnPrediction) {
  const rest = boats.filter((b) => b.boat_number !== 1);
  if (rest.length !== 5) {
    throw new Error(
      `computeCampaignPicks: 1号艇を除いた艇数が5ではありません（${rest.length}艇）`,
    );
  }

  const avgWinRate = avg(rest.map((b) => b.win_rate ?? 0));
  const avgMotor = avg(rest.map((b) => b.motor_2rate ?? 0));

  const patternProbByBoat = {};
  for (const p of turnPrediction?.patterns || []) {
    patternProbByBoat[p.winnerCourse] =
      (patternProbByBoat[p.winnerCourse] || 0) + p.probability;
  }

  const scored = rest.map((b) => {
    const statScore =
      (avgWinRate > 0 ? (b.win_rate ?? 0) / avgWinRate : 1) * 0.6 +
      (avgMotor > 0 ? (b.motor_2rate ?? 0) / avgMotor : 1) * 0.4;
    const patternBonus = patternProbByBoat[b.boat_number] || 0;
    const combined = statScore * (1 + patternBonus * BOOST);
    return { boat: b.boat_number, combined };
  });

  scored.sort((a, b) => b.combined - a.combined);
  const ranking = scored.map((s) => s.boat);
  const [r1, r2, r3] = ranking;

  return {
    ranking,
    picks: [`${r1}-${r2}-${r3}`, `${r1}-${r3}-${r2}`, `${r2}-${r1}-${r3}`],
  };
}
