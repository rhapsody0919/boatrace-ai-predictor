/**
 * 企画型SNS投稿パイプラインの企画（sns_campaigns）を新規作成するCLI。
 *
 * パイロット企画「龍神レーダーのAIに900円を託してみた——イン崩れ99%レースだけ1週間」
 * を作成する。docs/design/sns-hub-campaign-pipeline/spec.md・tasks.md参照。
 *
 * 使い方: node --env-file=.env.local scripts/maintenance/create-campaign.js
 */
import { createCampaign } from "../lib/snsCampaigns.js";

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const campaign = await createCampaign({
    name: "龍神レーダーのAIに900円を託してみた——イン崩れ99%レースだけ1週間",
    purpose:
      "龍神レーダーが実際にUI上で提供している「イン崩れ注意度」「1マーク展開予測」機能を使い、" +
      "イン崩れ注意度99%以上のレースだけを対象に3連単900円（300円×3点）を1週間購入シミュレーションする。" +
      "回収率が良いかどうかにかかわらず、実際の結果をそのまま発信する透明性企画。",
    persona: "AI予想を試してみたい・的中率や回収率の実態に関心がある層",
    toneSpec: {},
    startDate: today,
    durationDays: 7,
    targetChannels: ["x", "blog"],
    tiktokDecisionNote:
      "ギャンブル結果を扱う内容のためTikTokは対象外とする（人間判断、要件9）",
    selectionCriteria: {
      metric: "volatilityPercentile",
      operator: ">=",
      value: 0.99,
    },
    purchaseAmountYen: 900,
  });

  console.log("✅ 企画を作成した:");
  console.log(JSON.stringify(campaign, null, 2));
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
