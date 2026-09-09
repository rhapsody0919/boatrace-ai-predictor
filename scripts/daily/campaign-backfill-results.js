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
  createResultAnnouncementTopic,
} from "../lib/snsCampaigns.js";

function summarize(entries) {
  const totalSpend = entries.reduce(
    (s, e) => s + (e.purchase_amount_yen || 0),
    0,
  );
  const totalPayout = entries.reduce((s, e) => s + (e.payout_yen || 0), 0);
  const hits = entries.filter((e) => e.hit).length;
  const recoveryRate =
    totalSpend > 0 ? ((totalPayout / totalSpend) * 100).toFixed(1) : "—";
  return { totalSpend, totalPayout, hits, recoveryRate };
}

/**
 * 企画期間（start_date + duration_days）が経過し、かつ全エントリの結果が
 * 確定済みなら運用フロー④（最終まとめ投稿）用のネタを作成し、企画を
 * 'completed'にする。statusを'active'→'completed'にする操作自体がゲートに
 * なるため、この関数は同一企画に対して実質1回しか実行されない
 * （getActiveCampaignsがstatus='active'のみ返すため、次回実行以降は
 * 対象から外れる）。
 */
async function maybeFinalizeCampaign(campaign, entries) {
  const endDate = new Date(campaign.start_date);
  endDate.setDate(endDate.getDate() + campaign.duration_days);
  const today = new Date();
  if (today < endDate) return;

  const stillPending = entries.some((e) => e.actual_result == null);
  if (stillPending) {
    console.log(
      "企画期間は経過したが、結果未確定のエントリが残っているためまとめ投稿は見送る",
    );
    return;
  }
  if (entries.length === 0) {
    console.log(
      "企画期間が経過したがエントリが1件も無いため、まとめ投稿は作らずcompletedにする",
    );
  } else {
    const { totalSpend, totalPayout, hits, recoveryRate } = summarize(entries);
    const topic = await createResultAnnouncementTopic(
      campaign.id,
      `【${campaign.name}】企画終了まとめ: 全${entries.length}レース中${hits}的中、購入${totalSpend}円→払戻${totalPayout}円（回収率${recoveryRate}%）`,
      campaign.target_channels,
      campaign.tone_spec?.autoApproveTopics === true,
    );
    console.log(`最終まとめネタ作成: topic=${topic.id}（承認待ち）`);
  }

  const { error } = await supabase
    .from("sns_campaigns")
    .update({ status: "completed" })
    .eq("id", campaign.id);
  if (error)
    throw new Error(
      `sns_campaigns更新エラー(${campaign.id}): ${error.message}`,
    );
  console.log(`企画を'completed'にした`);
}

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

    if (pending.length > 0) {
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
        // メモリ上のentries配列も更新しておく（後続のmaybeFinalizeCampaignで
        // 「全件確定済みか」を正しく判定するため）
        Object.assign(entry, updated);

        console.log(
          `  ${hit ? "🎯" : "❌"} ${entry.race_id}: 実際=${actual} 買い目=${picks.join(",")} 払戻=${payoutYen}円 通算収支=${updated.cumulative_net_yen}円`,
        );

        // 運用フロー③（対象レース確定後の結果発表投稿）用のネタを作成する。
        // ②の買い目発表とは別の2件目のネタ。backfillEntryResultは
        // actual_result未確定のエントリだけを対象にするため、このブロックは
        // エントリごとに1回だけ実行される（二重生成の心配は無い）
        const topic = await createResultAnnouncementTopic(
          campaign.id,
          `【${campaign.name}】${entry.race_id} 結果発表: ${hit ? "🎯的中" : "❌不的中"}（実際=${actual}、買い目=${picks.join("/")}）払戻${payoutYen}円 通算収支${updated.cumulative_net_yen}円`,
          campaign.target_channels,
          campaign.tone_spec?.autoApproveTopics === true,
        );
        console.log(`     結果発表ネタ作成: topic=${topic.id}（承認待ち）`);
      }
    }

    // 運用フロー④（企画終了時の最終まとめ投稿）
    await maybeFinalizeCampaign(campaign, entries);
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
