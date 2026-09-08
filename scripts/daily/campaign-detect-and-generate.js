/**
 * 企画型SNS投稿パイプライン Phase A（対象レース検出→買い目生成→ネタ登録）。
 *
 * 稼働中の企画（sns_campaigns.status='active'）について、本日のレースから
 * 選定条件（selection_criteria）を満たすレースを検出し、campaignVolatilityModel.js
 * で買い目を生成、sns_campaign_entries + sns_topics（要人間承認）を作成する。
 *
 * 1日に複数回・複数レースがヒットしうる（想定通り、docs/design/sns-hub-campaign-pipeline/
 * spec.md参照）。既に同一レースのエントリが存在する場合はスキップし、重複登録しない。
 *
 * 使い方: node --env-file=.env.local scripts/daily/campaign-detect-and-generate.js [YYYY-MM-DD]
 *   日付省略時は本日（JST）を対象にする。
 */
import {
  getActiveCampaigns,
  findQualifyingRaces,
  getRaceEntriesForScoring,
  getRaceIdsWithResults,
  createCampaignEntryWithTopic,
  getCampaignEntries,
} from "../lib/snsCampaigns.js";
import {
  computeCampaignPicks,
  MODEL_NAME,
} from "../lib/campaignVolatilityModel.js";

function buildPromptText({ raceId, boats, turnPrediction, metricValue }) {
  const table = boats
    .map(
      (b) =>
        `${b.boat_number}号艇 ${b.player_name}: 勝率${b.win_rate} モーター2連率${b.motor_2rate}%`,
    )
    .join("\n");
  const patterns = (turnPrediction?.patterns || [])
    .map(
      (p) =>
        `${p.technique}(${p.winnerCourse}号艇): ${Math.round(p.probability * 100)}%`,
    )
    .join(" / ");

  return [
    `レース: ${raceId}`,
    `イン崩れ注意度: ${Math.round(metricValue * 100)}%`,
    "",
    "出走表:",
    table,
    "",
    `1マーク展開予測: ${patterns || "データ無し"}`,
    "",
    `${MODEL_NAME}による買い目生成（1号艇除外、出走表×展開予測の組み合わせランキング）`,
  ].join("\n");
}

async function main() {
  const targetDate = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(`対象日: ${targetDate}`);

  const campaigns = await getActiveCampaigns();
  if (campaigns.length === 0) {
    console.log("稼働中の企画が無い");
    return;
  }

  for (const campaign of campaigns) {
    console.log(`\n--- 企画: ${campaign.name} ---`);
    const qualifying = await findQualifyingRaces(
      targetDate,
      campaign.selection_criteria,
    );
    console.log(`対象条件を満たすレース: ${qualifying.length}件`);
    if (qualifying.length === 0) continue;

    const existingEntries = await getCampaignEntries(campaign.id);
    const existingRaceIds = new Set(existingEntries.map((e) => e.race_id));
    // 企画は「結果が出る前に賭ける」ことが前提のため、既に確定済みのレースは
    // 買い目が生成できても対象外にする（2026-09-08、日中実行時に確定済み
    // レースを登録しかけた反省を踏まえた必須チェック）
    const confirmedRaceIds = await getRaceIdsWithResults(
      qualifying.map((q) => q.raceId),
    );

    for (const q of qualifying) {
      if (existingRaceIds.has(q.raceId)) {
        console.log(`  ${q.raceId}: 既にエントリ済みのためスキップ`);
        continue;
      }
      if (confirmedRaceIds.has(q.raceId)) {
        console.log(
          `  ${q.raceId}: 既に結果確定済みのためスキップ（企画の前提上、対象外）`,
        );
        continue;
      }
      if (!q.turnPrediction) {
        console.log(`  ${q.raceId}: turnPredictionデータ無しのためスキップ`);
        continue;
      }

      const boats = await getRaceEntriesForScoring(q.raceId);
      if (boats.length !== 6) {
        console.log(
          `  ${q.raceId}: race_entriesが6艇揃っていないためスキップ（${boats.length}艇）`,
        );
        continue;
      }

      let picks;
      try {
        picks = computeCampaignPicks(boats, q.turnPrediction);
      } catch (error) {
        console.log(
          `  ${q.raceId}: 買い目生成エラー（${error.message}）のためスキップ`,
        );
        continue;
      }

      const promptText = buildPromptText({
        raceId: q.raceId,
        boats,
        turnPrediction: q.turnPrediction,
        metricValue: q.metricValue,
      });

      // 1レースのエントリ作成失敗で残りのレース・企画の処理を止めない
      // （1日に複数レースがヒットしうる想定のため）
      try {
        const { entry, topic } = await createCampaignEntryWithTopic({
          campaignId: campaign.id,
          raceId: q.raceId,
          selectionMetricValue: q.metricValue,
          aiPromptText: promptText,
          aiModelName: MODEL_NAME,
          aiPicks: picks.picks,
          purchaseAmountYen: campaign.purchase_amount_yen,
          topicText: `【${campaign.name}】${q.raceId} イン崩れ注意度${Math.round(q.metricValue * 100)}% 買い目: ${picks.picks.join(" / ")}`,
          targetChannels: campaign.target_channels,
        });

        console.log(
          `  ✅ ${q.raceId}: エントリ作成（買い目: ${picks.picks.join(", ")}, entry=${entry.id}, topic=${topic.id}, 承認待ち）`,
        );
      } catch (error) {
        console.log(`  ❌ ${q.raceId}: エントリ作成エラー（${error.message}）`);
      }
    }
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
