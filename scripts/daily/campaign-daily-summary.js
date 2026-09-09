/**
 * 企画型SNS投稿パイプライン フェーズ「1日のまとめ」。
 *
 * 稼働中の企画（sns_campaigns.status='active'）について、本日（JST）
 * race_idを持つエントリのうち結果確定済みのものを集計し、1日分のダイジェスト
 * ネタを1件作成する。レースごとの「結果発表」（campaign-backfill-results.js）
 * とは別の投稿。ナイター終了後（21:30 JST頃を想定）に実行する。
 *
 * 対象日に結果確定済みのエントリが1件も無い日（対象レースが無かった・まだ
 * 結果未確定）は何もしない。同じ日に複数回実行しても重複投稿しない
 * （createDailySummaryTopic側で同一topic_textの既存チェックを行う）。
 *
 * 使い方: node --env-file=.env.local scripts/daily/campaign-daily-summary.js [YYYY-MM-DD]
 *   日付省略時は本日（JST）を対象にする。
 */
import {
  getActiveCampaigns,
  createDailySummaryTopic,
} from "../lib/snsCampaigns.js";
import { getTodayDateJST } from "../lib/dateUtils.js";

async function main() {
  const targetDate = process.argv[2] || getTodayDateJST();
  console.log(`対象日: ${targetDate}`);

  const campaigns = await getActiveCampaigns();
  if (campaigns.length === 0) {
    console.log("稼働中の企画が無い");
    return;
  }

  for (const campaign of campaigns) {
    console.log(`\n--- 企画: ${campaign.name} ---`);
    try {
      const topic = await createDailySummaryTopic(campaign, targetDate);
      if (topic) {
        console.log(`✅ 1日のまとめネタ作成: topic=${topic.id}（承認待ち）`);
      } else {
        console.log(
          "対象日に結果確定済みのエントリが無いか、既に作成済みのためスキップ",
        );
      }
    } catch (error) {
      console.log(`❌ 1日のまとめネタ作成エラー（${error.message}）`);
    }
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
