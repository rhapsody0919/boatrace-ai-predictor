/**
 * v5: 1号艇を除外した上で、出走表データ（勝率・モーター等）と展開予測
 * （turnPrediction.patternsに登場する艇＝技術的に勝ち筋があるとモデルが
 * 認めている艇）を組み合わせてランキングする。
 *
 * v4（boatStrengthsのみで1号艇除外）は回収率38.4%/42.9%(ge_99/ge_100)と
 * 低調だった。boatStrengthsは総合力の代理指標に過ぎず、出走表の実データ
 * （勝率・モーター）を直接見ていない。本モデルはその2つを明示的に掛け合わせる。
 *
 * combined(boat) = statScore(boat) * (1 + patternBonus(boat) * BOOST)
 *   statScore  = レース内平均比の勝率・モーター2連率（1号艇除く5艇内で正規化）
 *   patternBonus = turnPrediction.patternsでその艇がwinnerCourseとして
 *                  登場する場合の確率（登場しなければ0）
 *
 * 使い方: node scripts/analysis/campaign-backtest-v5-combined-exclude-boat1.js races-xxx-with-turnprediction.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");
const BOOST = 3.0; // 展開予測に登場する艇をどれだけ優遇するか

function avg(nums) {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function generatePicks(boats, turnPrediction) {
  const rest = boats.filter((b) => b.boat_number !== 1);
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
  const [r1, r2, r3] = scored.map((s) => s.boat);
  return {
    ranking: scored.map((s) => s.boat),
    picks: [`${r1}-${r2}-${r3}`, `${r1}-${r3}-${r2}`, `${r2}-${r1}-${r3}`],
  };
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-v5-combined-exclude-boat1.js <races-*-with-turnprediction.json>",
    );
    process.exit(1);
  }
  const races = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const picks = races.map((race) => {
    const { ranking, picks } = generatePicks(race.boats, race.turnPrediction);
    return {
      raceId: race.raceId,
      volatilityPercentile: race.volatilityPercentile,
      buckets: race.buckets,
      ranking,
      picks,
    };
  });

  const outPath = path.join(
    DIR,
    `picks-v5-combined-exclude-boat1-${inputFile.replace(/^races-/, "").replace(/-with-turnprediction/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(picks, null, 2) + "\n");
  console.log(`✅ ${picks.length}件の予想を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
