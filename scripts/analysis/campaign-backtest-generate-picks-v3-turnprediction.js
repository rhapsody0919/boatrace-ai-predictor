/**
 * campaign-backtest-generate-picks v3:
 * イン崩れ注意度(volatilityPercentile)の算出根拠である1マーク展開予測
 * （turnPrediction: 決まり手×コース別の勝利確率、boatStrengths）を
 * ランキングの主根拠として使うモデル。
 *
 * v1/v2が生の勝率・モーター2連率のみを使っていたのに対し、v3は
 * 「1号艇が逃げなかった場合、どの艇がどの決まり手で勝つか」という
 * turnPredictionの構造化された予測をそのまま艇順ランキングに反映する。
 *
 * 各艇の勝利スコア = turnPrediction.patterns から該当艇が勝者コースになっている
 * 確率の合計 + (patternsでカバーされていない残り確率をboatStrengths比で配分)
 *
 * 使い方: node scripts/analysis/campaign-backtest-generate-picks-v3-turnprediction.js races-xxx-with-turnprediction.json
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
  // winnerBoatが勝者コースと一致するpatternのsecondPlace分布があればそれを使う
  const matching = patterns
    .filter((p) => p.winnerCourse === winnerBoat)
    .sort((a, b) => b.probability - a.probability)[0];

  const [c1, c2] = candidates;
  if (matching?.secondPlace) {
    const s1 = matching.secondPlace[c1] ?? 0;
    const s2 = matching.secondPlace[c2] ?? 0;
    return s1 >= s2 ? [c1, c2] : [c2, c1];
  }
  // フォールバック: boatStrengthsで比較
  const bs1 = boatStrengths[c1 - 1] ?? 0;
  const bs2 = boatStrengths[c2 - 1] ?? 0;
  return bs1 >= bs2 ? [c1, c2] : [c2, c1];
}

function generatePicks(turnPrediction) {
  const { finalScore, patterns } = computeBoatScores(turnPrediction);
  const boatStrengths = turnPrediction?.boatStrengths || [1, 1, 1, 1, 1, 1];

  const ranking = Object.keys(finalScore)
    .map(Number)
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
      "使い方: node scripts/analysis/campaign-backtest-generate-picks-v3-turnprediction.js <races-*-with-turnprediction.json>",
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
    `picks-v3-turnprediction-${inputFile.replace(/^races-/, "").replace(/-with-turnprediction/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(picks, null, 2) + "\n");
  console.log(`✅ ${picks.length}件の予想を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
