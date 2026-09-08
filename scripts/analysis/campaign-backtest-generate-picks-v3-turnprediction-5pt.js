/**
 * campaign-backtest-generate-picks-v3-turnprediction.jsの5点版。
 * turnPredictionベースの上位3艇について、6通りの着順のうち最も考えにくい
 * 1通り（最弱艇1着・2番手2着・最強艇3着）を除いた5通りを購入する。
 *
 * 使い方: node scripts/analysis/campaign-backtest-generate-picks-v3-turnprediction-5pt.js races-xxx-with-turnprediction.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");

function computeBoatScores(turnPrediction) {
  const winProbByBoat = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const patterns = turnPrediction?.patterns || [];
  for (const p of patterns) {
    winProbByBoat[p.winnerCourse] =
      (winProbByBoat[p.winnerCourse] || 0) + p.probability;
  }
  const coveredProb = Object.values(winProbByBoat).reduce((s, v) => s + v, 0);
  const remaining = Math.max(0, 1 - coveredProb);

  const boatStrengths = turnPrediction?.boatStrengths || [1, 1, 1, 1, 1, 1];
  const strengthSum = boatStrengths.reduce((s, v) => s + v, 0) || 1;

  const finalScore = {};
  for (let boat = 1; boat <= 6; boat++) {
    const strengthShare = (boatStrengths[boat - 1] || 0) / strengthSum;
    finalScore[boat] = winProbByBoat[boat] + remaining * strengthShare;
  }
  return finalScore;
}

function generatePicks(turnPrediction) {
  const finalScore = computeBoatScores(turnPrediction);
  const ranking = Object.keys(finalScore)
    .map(Number)
    .sort((a, b) => finalScore[b] - finalScore[a]);
  const [r1, r2, r3] = ranking;
  const all6 = [
    `${r1}-${r2}-${r3}`,
    `${r1}-${r3}-${r2}`,
    `${r2}-${r1}-${r3}`,
    `${r2}-${r3}-${r1}`,
    `${r3}-${r1}-${r2}`,
    `${r3}-${r2}-${r1}`,
  ];
  return { ranking, picks: all6.slice(0, 5) };
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-generate-picks-v3-turnprediction-5pt.js <races-*-with-turnprediction.json>",
    );
    process.exit(1);
  }
  const races = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const skipped = [];
  const picks = races
    .map((race) => {
      if (!race.turnPrediction) {
        skipped.push(race.raceId);
        return null;
      }
      const { ranking, picks } = generatePicks(race.turnPrediction);
      return {
        raceId: race.raceId,
        volatilityPercentile: race.volatilityPercentile,
        buckets: race.buckets,
        ranking,
        picks,
      };
    })
    .filter(Boolean);

  if (skipped.length > 0) {
    console.warn(`⚠️ turnPrediction無しでスキップ: ${skipped.length}件`);
  }

  const outPath = path.join(
    DIR,
    `picks-v3-turnprediction-5pt-${inputFile.replace(/^races-/, "").replace(/-with-turnprediction/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(picks, null, 2) + "\n");
  console.log(`✅ ${picks.length}件の予想（5点）を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
