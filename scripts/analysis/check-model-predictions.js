/**
 * モデル別の予測データ存在状況を確認
 * predictions テーブルに model_id 別に何件あるか、
 * top_pick の分布、結果フラグの取れ高を簡易チェック
 */
import { supabase } from "../lib/supabaseClient.js";

async function main() {
  const fromDate = "2026-04-15"; // 直近30日
  console.log(`対象期間: ${fromDate} 以降\n`);

  for (const modelId of ["standard", "safeBet", "upsetFocus"]) {
    const { data, error } = await supabase
      .from("predictions")
      .select(
        // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
        "race_id, model_id, top_pick, is_hit_win, is_hit_trio, payout_trio",
      )
      .eq("model_id", modelId)
      .eq("is_shadow", false)
      .gte("race_id", fromDate)
      .limit(2000);

    if (error) {
      console.log(`${modelId}: ERROR ${error.message}`);
      continue;
    }

    const total = data.length;
    const withResult = data.filter((d) => d.is_hit_win !== null).length;
    const winHits = data.filter((d) => d.is_hit_win === true).length;
    const trifectaHits = data.filter((d) => d.is_hit_trio === true).length;
    const topPickDist = {};
    data.forEach((d) => {
      const k = d.top_pick;
      topPickDist[k] = (topPickDist[k] || 0) + 1;
    });

    console.log(`--- ${modelId} ---`);
    console.log(`  件数: ${total}, 結果あり: ${withResult}`);
    console.log(
      `  単勝的中: ${winHits} (${((winHits / withResult) * 100).toFixed(1)}%)`,
    );
    console.log(`  3連単的中: ${trifectaHits}`);
    console.log(`  top_pick 分布:`, topPickDist);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
