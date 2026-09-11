/**
 * 既存のバックテスト用レースデータ（races-*.json）に、
 * predictions.feature_contributions.turnPrediction（1マーク展開予測の
 * 決まり手×コース別確率分布、2着3着分布、boatStrengths）を追加する。
 *
 * イン崩れ注意度に最適化したAIプロンプトの検証用。
 * turnPredictionは日次予測生成時（generate-predictions.js）に既に計算・保存済みのため、
 * 再計算せずpredictionsテーブルから取得するだけで済む。
 *
 * 使い方: node scripts/analysis/campaign-backtest-fetch-turnprediction.js <入力races-*.json> <出力ファイル名>
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");

async function main() {
  const [inputPath, outName] = process.argv.slice(2);
  if (!inputPath || !outName) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-fetch-turnprediction.js <入力races-*.json> <出力ファイル名>",
    );
    process.exit(1);
  }

  const races = JSON.parse(await fs.readFile(inputPath, "utf-8"));
  const raceIds = races.map((r) => r.raceId);

  const BATCH_SIZE = 100;
  const turnPredictionByRaceId = new Map();
  for (let i = 0; i < raceIds.length; i += BATCH_SIZE) {
    const batchIds = raceIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("predictions")
      .select("race_id, feature_contributions")
      .eq("model_id", "standard")
      .in("race_id", batchIds);
    if (error) throw new Error(`predictions取得エラー: ${error.message}`);
    for (const row of data) {
      const tp = row.feature_contributions?.turnPrediction;
      if (tp) turnPredictionByRaceId.set(row.race_id, tp);
    }
  }
  console.log(
    `turnPrediction取得: ${turnPredictionByRaceId.size} / ${raceIds.length}件`,
  );

  const enriched = races.map((r) => ({
    ...r,
    turnPrediction: turnPredictionByRaceId.get(r.raceId) || null,
  }));

  const missing = enriched.filter((r) => !r.turnPrediction).length;
  if (missing > 0) {
    console.warn(`⚠️ turnPredictionが取得できなかったレース: ${missing}件`);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, outName);
  await fs.writeFile(outPath, JSON.stringify(enriched, null, 2) + "\n");
  console.log(`✅ 書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
