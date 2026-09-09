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
import { getTodayDateJST } from "../lib/dateUtils.js";

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
  // 引数省略時はJSTの本日日付を使う（UTC基準のtoISOString()だと、JST 0-9時台に
  // 実行した場合に前日の日付になってしまう既知の罠。2026-09-09にfindQualifyingRaces
  // 側のrace_id基準フィルタで直した同種のバグが、この呼び出し元のデフォルト値
  // 計算にも残っていたため合わせて修正した。1日複数回の自動実行では朝の時間帯に
  // 必ず踏む）
  const targetDate = process.argv[2] || getTodayDateJST();
  console.log(`対象日: ${targetDate}`);

  const campaigns = await getActiveCampaigns();
  if (campaigns.length === 0) {
    console.log("稼働中の企画が無い");
    return;
  }

  // 企画1件の異常（selection_criteriaの設定ミス、DB一時エラー等）で他の企画の
  // 処理まで止まらないよう、企画ごとにtry/catchで分離する（2026-09-09、
  // 天才エンジニアレビューで指摘: 元々このループ自体は無防備で、
  // findQualifyingRaces()等が例外を投げるとmain()の外側catchまで一気に
  // 抜けて後続の企画が一切処理されない構造だった）。失敗した企画があれば
  // 最後にexit code 1で終了し、CI側の失敗検知（Slack通知）につなげる。
  let hadCampaignError = false;
  for (const campaign of campaigns) {
    console.log(`\n--- 企画: ${campaign.name} ---`);
    try {
      await processCampaign(campaign, targetDate);
    } catch (error) {
      hadCampaignError = true;
      console.log(
        `❌ 企画「${campaign.name}」の処理中にエラー: ${error.message}`,
      );
    }
  }
  if (hadCampaignError) process.exitCode = 1;
}

async function processCampaign(campaign, targetDate) {
  const qualifying = await findQualifyingRaces(
    targetDate,
    campaign.selection_criteria,
  );
  console.log(`対象条件を満たすレース: ${qualifying.length}件`);
  if (qualifying.length === 0) return;

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
        autoApproveTopic: campaign.tone_spec?.autoApproveTopics === true,
      });

      console.log(
        `  ✅ ${q.raceId}: エントリ作成（買い目: ${picks.picks.join(", ")}, entry=${entry.id}, topic=${topic.id}, 承認待ち）`,
      );
    } catch (error) {
      console.log(`  ❌ ${q.raceId}: エントリ作成エラー（${error.message}）`);
    }
  }
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
