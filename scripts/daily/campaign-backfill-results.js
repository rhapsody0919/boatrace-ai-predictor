/**
 * 企画型SNS投稿パイプライン Phase B（結果確定後の実績書き戻し）。
 *
 * 稼働中の企画について、actual_result未確定のsns_campaign_entriesを
 * race_resultsと突き合わせ、的中判定・払戻額・累計収支を計算して書き戻す。
 *
 * ⚠️ DB列名の罠（scripts/lib/payoutCalculator.js参照）: race_results.payout_trifecta/
 * payout_trioは列名と実態が英日逆転している。3連単（着順一致）の判定にはpayout_trio列を使う。
 *
 * 使い方: node --env-file=.env.local scripts/daily/campaign-backfill-results.js
 */
import { supabase } from "../lib/supabaseClient.js";
import {
  getActiveCampaigns,
  getCampaignEntries,
  backfillEntryResult,
} from "../lib/snsCampaigns.js";

async function main() {
  const campaigns = await getActiveCampaigns();
  if (campaigns.length === 0) {
    console.log("稼働中の企画が無い");
    return;
  }

  for (const campaign of campaigns) {
    console.log(`\n--- 企画: ${campaign.name} ---`);
    const entries = await getCampaignEntries(campaign.id);
    const pending = entries.filter((e) => e.actual_result == null);
    console.log(`結果未確定のエントリ: ${pending.length}件`);
    if (pending.length === 0) continue;

    const raceIds = pending.map((e) => e.race_id);
    const { data: results, error } = await supabase
      .from("race_results")
      .select("race_id, rank1, rank2, rank3, payout_trio")
      .in("race_id", raceIds);
    if (error) throw new Error(`race_results取得エラー: ${error.message}`);
    const resultByRaceId = new Map(results.map((r) => [r.race_id, r]));

    for (const entry of pending) {
      const result = resultByRaceId.get(entry.race_id);
      if (!result || result.rank1 == null) {
        console.log(`  ${entry.race_id}: まだ結果未確定`);
        continue;
      }

      const actual = `${result.rank1}-${result.rank2}-${result.rank3}`;
      const picks = (entry.ai_picks || []).map((p) => p.combination);
      const hit = picks.includes(actual);
      // 実態逆転: 3連単の払戻はpayout_trio列
      const payoutYen = hit
        ? Math.round(
            (result.payout_trio / 100) *
              (entry.purchase_amount_yen / picks.length),
          )
        : 0;

      const updated = await backfillEntryResult(entry.id, {
        actualResult: actual,
        hit,
        payoutYen,
      });

      console.log(
        `  ${hit ? "🎯" : "❌"} ${entry.race_id}: 実際=${actual} 買い目=${picks.join(",")} 払戻=${payoutYen}円 通算収支=${updated.cumulative_net_yen}円`,
      );
    }
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
