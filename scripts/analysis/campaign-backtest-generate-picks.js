/**
 * campaign-backtest-fetch-races.jsの出力に対して、簡易スコアリングで
 * 3連単3点を生成する（ペース感テスト用の近似判断、本物のAIプロンプト
 * 回答そのものではない）。
 *
 * スコア = win_rate + 0.05*motor_2rate + 0.03*boat_2rate + 0.02*local_win_rate
 * 3点: 本命順（1-2-3位）／2-3位入替／上位2艇入替
 *
 * 使い方: node scripts/analysis/campaign-backtest-generate-picks.js races-2026-09-03_2026-09-05.json
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");

function score(boat) {
  return (
    (boat.win_rate ?? 0) +
    0.05 * (boat.motor_2rate ?? 0) +
    0.03 * (boat.boat_2rate ?? 0) +
    0.02 * (boat.local_win_rate ?? 0)
  );
}

function generatePicks(boats) {
  const ranked = [...boats].sort((a, b) => score(b) - score(a));
  const [r1, r2, r3] = ranked;
  return [
    `${r1.boat_number}-${r2.boat_number}-${r3.boat_number}`,
    `${r1.boat_number}-${r3.boat_number}-${r2.boat_number}`,
    `${r2.boat_number}-${r1.boat_number}-${r3.boat_number}`,
  ];
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-generate-picks.js <races-*.json>",
    );
    process.exit(1);
  }
  const races = JSON.parse(
    await fs.readFile(path.join(DIR, inputFile), "utf-8"),
  );

  const picks = races.map((race) => ({
    raceId: race.raceId,
    volatilityPercentile: race.volatilityPercentile,
    buckets: race.buckets,
    picks: generatePicks(race.boats),
  }));

  const outPath = path.join(DIR, `picks-${inputFile.replace(/^races-/, "")}`);
  await fs.writeFile(outPath, JSON.stringify(picks, null, 2) + "\n");
  console.log(`✅ ${picks.length}件の予想を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
