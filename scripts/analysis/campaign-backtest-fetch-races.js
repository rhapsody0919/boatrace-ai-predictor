/**
 * 企画型パイプライン（docs/design/sns-hub-campaign-pipeline/）の
 * ペース感テスト用データ取得スクリプト。
 *
 * イン崩れ確率（predictions.feature_contributions.volatilityPercentile）が
 * 90%以上または10%以下のレースを指定期間から抽出し、AIが3連単を判断する
 * ための簡易データ（race_entriesの主要指標）をJSONで出力する。
 *
 * 注意: 結果（race_results）は含めない。AIの判断に結果情報が混入すると
 * バックテストとして意味を持たなくなるため、意図的に分離している。
 *
 * 使い方: node scripts/analysis/campaign-backtest-fetch-races.js 2026-09-03 2026-09-05
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../data/analysis/campaign-backtest");

const HIGH_THRESHOLDS = [0.9, 0.95, 0.99, 1.0];
const LOW_THRESHOLDS = [0.1, 0.05, 0.01, 0.0];

function classify(p) {
  const bucketsHigh = HIGH_THRESHOLDS.filter((t) => p >= t).map(
    (t) => `ge_${Math.round(t * 100)}`,
  );
  const bucketsLow = LOW_THRESHOLDS.filter((t) => p <= t).map(
    (t) => `le_${Math.round(t * 100)}`,
  );
  return [...bucketsHigh, ...bucketsLow];
}

async function main() {
  const [fromDate, toDate] = process.argv.slice(2);
  if (!fromDate || !toDate) {
    console.error(
      "使い方: node scripts/analysis/campaign-backtest-fetch-races.js <from> <to>",
    );
    process.exit(1);
  }

  // Supabaseのデフォルトlimit(1000行)を超えるため.range()でページネーションする
  const PAGE_SIZE = 1000;
  const predictions = [];
  for (let page = 0; ; page++) {
    const { data, error: predError } = await supabase
      .from("predictions")
      .select("race_id, predicted_at, feature_contributions")
      .gte("predicted_at", fromDate)
      .lte("predicted_at", `${toDate} 23:59:59`)
      .not("feature_contributions", "is", null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (predError)
      throw new Error(`predictions取得エラー: ${predError.message}`);
    predictions.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`取得したpredictions行数: ${predictions.length}`);

  // 同一race_idに複数のpredictions行が存在する（再計算等）ため、
  // predicted_atが最新の1件だけを残す（重複カウント防止）
  const latestByRaceId = new Map();
  for (const p of predictions) {
    const existing = latestByRaceId.get(p.race_id);
    if (
      !existing ||
      new Date(p.predicted_at) > new Date(existing.predicted_at)
    ) {
      latestByRaceId.set(p.race_id, p);
    }
  }
  console.log(
    `重複排除後のユニークレース数: ${latestByRaceId.size}（重複${predictions.length - latestByRaceId.size}件を除外）`,
  );

  const qualifying = [...latestByRaceId.values()]
    .map((p) => {
      const percentile = p.feature_contributions?.volatilityPercentile;
      if (typeof percentile !== "number") return null;
      const buckets = classify(percentile);
      if (buckets.length === 0) return null;
      return { raceId: p.race_id, percentile, buckets };
    })
    .filter(Boolean);

  console.log(`対象レース: ${qualifying.length}件`);

  const races = [];
  for (const q of qualifying) {
    const { data: entries, error: entriesError } = await supabase
      .from("race_entries")
      .select(
        "boat_number, player_name, grade, win_rate, local_win_rate, motor_2rate, motor_3rate, boat_2rate, boat_3rate",
      )
      .eq("race_id", q.raceId)
      .order("boat_number");
    if (entriesError) {
      console.error(
        `race_entries取得エラー(${q.raceId}): ${entriesError.message}`,
      );
      continue;
    }
    if (!entries || entries.length !== 6) continue;

    races.push({
      raceId: q.raceId,
      volatilityPercentile: q.percentile,
      buckets: q.buckets,
      boats: entries,
    });
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `races-${fromDate}_${toDate}.json`);
  await fs.writeFile(outPath, JSON.stringify(races, null, 2) + "\n");
  console.log(`✅ ${races.length}件を書き出した: ${outPath}`);
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
