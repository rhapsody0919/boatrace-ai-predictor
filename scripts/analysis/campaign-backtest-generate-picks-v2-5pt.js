/**
 * campaign-backtest-generate-picks-v2.jsの5点版。
 * 同じ上位3艇（コース優位性込みモデルでの順位）について、6通りの着順の
 * うち「最弱艇が1着・2番手が2着・最強艇が3着」という最も考えにくい1通りを
 * 除いた5通りを購入する（3連単の的中確率を上げるには、艇の選定精度より
 * 着順の網羅性を上げる方が効くのでは、という仮説の検証）。
 *
 * 使い方: node scripts/analysis/campaign-backtest-generate-picks-v2-5pt.js races-2026-09-03_2026-09-05.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");

const COURSE_PRIOR = {
  1: 0.5502,
  2: 0.1348,
  3: 0.1258,
  4: 0.0993,
  5: 0.0594,
  6: 0.0306,
};

function avg(nums) {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function strength(boat, avgWinRate, avgMotor2Rate) {
  const abilityFactor = avgWinRate > 0 ? (boat.win_rate ?? 0) / avgWinRate : 1;
  const motorFactor =
    avgMotor2Rate > 0
      ? 1 + 0.2 * ((boat.motor_2rate ?? 0) / avgMotor2Rate - 1)
      : 1;
  return COURSE_PRIOR[boat.boat_number] * abilityFactor * motorFactor;
}

function generatePicks(boats) {
  const avgWinRate = avg(boats.map((b) => b.win_rate ?? 0));
  const avgMotor2Rate = avg(boats.map((b) => b.motor_2rate ?? 0));
  const ranked = [...boats].sort(
    (a, b) =>
      strength(b, avgWinRate, avgMotor2Rate) -
      strength(a, avgWinRate, avgMotor2Rate),
  );
  const [r1, r2, r3] = ranked.map((b) => b.boat_number);
  // 6通りから「r3-r2-r1」（最弱→2番手→最強、最も考えにくい順）だけ除いた5通り
  const all6 = [
    `${r1}-${r2}-${r3}`,
    `${r1}-${r3}-${r2}`,
    `${r2}-${r1}-${r3}`,
    `${r2}-${r3}-${r1}`,
    `${r3}-${r1}-${r2}`,
    `${r3}-${r2}-${r1}`,
  ];
  return { ranking: ranked.map((b) => b.boat_number), picks: all6.slice(0, 5) };
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-generate-picks-v2-5pt.js <races-*.json>",
    );
    process.exit(1);
  }
  const races = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const picks = races.map((race) => {
    const { ranking, picks } = generatePicks(race.boats);
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
    `picks-v2-5pt-${inputFile.replace(/^races-/, "")}`,
  );
  await fs.writeFile(outPath, JSON.stringify(picks, null, 2) + "\n");
  console.log(`✅ ${picks.length}件の予想（5点）を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
