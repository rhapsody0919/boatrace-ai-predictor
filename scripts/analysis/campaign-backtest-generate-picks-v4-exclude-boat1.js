/**
 * campaign-backtest-generate-picks v4:
 * v3（turnPredictionベース）と同じランキングロジックだが、1号艇を
 * 候補から完全に除外し、2〜6号艇のみで3連単を組む。
 * 「イン崩れ狙いなら最初から1号艇を切ったほうが良いのでは」という
 * 仮説の検証用。
 *
 * 使い方: node scripts/analysis/campaign-backtest-generate-picks-v4-exclude-boat1.js races-xxx-with-turnprediction.json
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
  return { finalScore, patterns };
}

function pickSecondThird(winnerBoat, candidates, patterns, boatStrengths) {
  const matching = patterns
    .filter((p) => p.winnerCourse === winnerBoat)
    .sort((a, b) => b.probability - a.probability)[0];

  const [c1, c2] = candidates;
  if (matching?.secondPlace) {
    const s1 = matching.secondPlace[c1] ?? 0;
    const s2 = matching.secondPlace[c2] ?? 0;
    return s1 >= s2 ? [c1, c2] : [c2, c1];
  }
  const bs1 = boatStrengths[c1 - 1] ?? 0;
  const bs2 = boatStrengths[c2 - 1] ?? 0;
  return bs1 >= bs2 ? [c1, c2] : [c2, c1];
}

function generatePicks(turnPrediction) {
  const { finalScore, patterns } = computeBoatScores(turnPrediction);
  const boatStrengths = turnPrediction?.boatStrengths || [1, 1, 1, 1, 1, 1];

  // 1号艇を除外し、2〜6号艇のみでランキングする
  const ranking = Object.keys(finalScore)
    .map(Number)
    .filter((boat) => boat !== 1)
    .sort((a, b) => finalScore[b] - finalScore[a]);

  const winner = ranking[0];
  const [second, third] = pickSecondThird(
    winner,
    [ranking[1], ranking[2]],
    patterns,
    boatStrengths,
  );

  return {
    ranking,
    picks: [
      `${winner}-${second}-${third}`,
      `${winner}-${third}-${second}`,
      `${second}-${winner}-${third}`,
    ],
  };
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-generate-picks-v4-exclude-boat1.js <races-*-with-turnprediction.json>",
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
    `picks-v4-exclude-boat1-${inputFile.replace(/^races-/, "").replace(/-with-turnprediction/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(picks, null, 2) + "\n");
  console.log(`✅ ${picks.length}件の予想を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
