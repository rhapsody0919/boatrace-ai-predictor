/**
 * 企画型（キャンペーン型）SNS投稿パイプライン用 sns_campaigns / sns_campaign_entries
 * 共通操作関数。
 *
 * scripts/lib/snsTopics.jsと同じパターンに従う（Node.jsバッチ処理・Routine用）。
 * 設計背景: docs/design/sns-hub-campaign-pipeline/spec.md・plan.md、ADR 0043。
 *
 * 企画のエントリは既存のネタゲート（sns_topics、requires_topic_approval=trueの
 * venue-feature型を流用）を必ず経由する。企画のエントリだからといって人間承認を
 * 省略しない（spec.md「シミュレーション開示」「TikTok人間判断」等の要件を担保するため）。
 */

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";
import { createTopicWithTargets, getTargetAccounts } from "./snsTopics.js";

const CAMPAIGNS_TABLE = "sns_campaigns";
const ENTRIES_TABLE = "sns_campaign_entries";
const VENUE_FEATURE_TYPE_KEY = "venue-feature";

function assertSupabaseEnabled() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabase環境変数（SUPABASE_URL/SUPABASE_SERVICE_KEY）が未設定です。sns_campaignsを操作できません。",
    );
  }
}

/**
 * 企画を新規作成する。
 * @param {object} params
 * @param {string} params.name
 * @param {string} [params.purpose]
 * @param {string} [params.persona]
 * @param {object} [params.toneSpec]
 * @param {string} params.startDate - 'YYYY-MM-DD'
 * @param {number} params.durationDays
 * @param {string[]} params.targetChannels
 * @param {string} [params.tiktokDecisionNote]
 * @param {object} params.selectionCriteria - 例: {metric:'volatilityPercentile', operator:'>=', value:0.99}
 * @param {number} params.purchaseAmountYen
 */
export async function createCampaign({
  name,
  purpose,
  persona,
  toneSpec = {},
  startDate,
  durationDays,
  targetChannels,
  tiktokDecisionNote,
  selectionCriteria,
  purchaseAmountYen,
}) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(CAMPAIGNS_TABLE)
    .insert({
      name,
      purpose,
      persona,
      tone_spec: toneSpec,
      start_date: startDate,
      duration_days: durationDays,
      target_channels: targetChannels,
      tiktok_decision_note: tiktokDecisionNote,
      selection_criteria: selectionCriteria,
      purchase_amount_yen: purchaseAmountYen,
    })
    .select()
    .single();
  if (error) throw new Error(`${CAMPAIGNS_TABLE}作成エラー: ${error.message}`);
  return data;
}

export async function getCampaign(id) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(CAMPAIGNS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new Error(`${CAMPAIGNS_TABLE}取得エラー(${id}): ${error.message}`);
  return data;
}

export async function getActiveCampaigns() {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(CAMPAIGNS_TABLE)
    .select("*")
    .eq("status", "active");
  if (error) throw new Error(`${CAMPAIGNS_TABLE}取得エラー: ${error.message}`);
  return data || [];
}

/**
 * 指定日のpredictionsから、選定条件（selection_criteria）を満たすレースを検出する。
 * campaign-backtest-fetch-races.jsと同じロジック（同一race_idの重複predictions行は
 * predicted_at最新のみ残す）を本番用に移植。
 *
 * ⚠️ predicted_atではなくrace_idで絞り込む（2026-09-09、実運用で発見した不具合）:
 * 当初predicted_atの日付範囲（UTC）で絞り込んでいたが、predicted_atはUTC保存な
 * のに対しレースはJST基準の日付で運用されるため、JST朝（UTC前日夜）に生成された
 * predictionsが「対象日」の範囲外と誤判定され0件になった（本番で実際に発生）。
 * race_idは"YYYY-MM-DD-会場-レース番号"形式でJST日付を直接含むため、こちらで
 * 絞り込めばタイムゾーンの問題が起きない。
 * @param {string} date - 'YYYY-MM-DD'（対象日、race_idのJST日付で絞り込む）
 * @param {{metric:string, operator:'>='|'<=', value:number}} criteria
 * @returns {Promise<Array<{raceId:string, metricValue:number, turnPrediction:object|null}>>}
 */
export async function findQualifyingRaces(date, criteria) {
  assertSupabaseEnabled();
  const { metric, operator, value } = criteria;
  if (operator !== ">=" && operator !== "<=") {
    throw new Error(`findQualifyingRaces: 未対応のoperatorです（${operator}）`);
  }

  const PAGE_SIZE = 1000;
  const rows = [];
  for (let page = 0; ; page++) {
    // model_idでの絞り込みは付けない（standard/safeBet/upsetFocus/unifiedの
    // 各行とも同じfeature_contributions.turnPrediction/volatilityPercentileを
    // 共有しており後段でrace_id単位に重複排除するため不要な上、
    // .eq('model_id',...)を足すとクエリプランが悪化しstatement timeoutになる
    // 実測結果があった）
    const { data, error } = await supabase
      .from("predictions")
      .select("race_id, predicted_at, feature_contributions")
      .gte("race_id", date)
      .lte("race_id", `${date}-99-99`)
      .not("feature_contributions", "is", null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(`predictions取得エラー: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const latestByRaceId = new Map();
  for (const row of rows) {
    const existing = latestByRaceId.get(row.race_id);
    if (
      !existing ||
      new Date(row.predicted_at) > new Date(existing.predicted_at)
    ) {
      latestByRaceId.set(row.race_id, row);
    }
  }

  const qualifying = [];
  for (const row of latestByRaceId.values()) {
    const metricValue = row.feature_contributions?.[metric];
    if (typeof metricValue !== "number") continue;
    const matches =
      operator === ">=" ? metricValue >= value : metricValue <= value;
    if (!matches) continue;
    qualifying.push({
      raceId: row.race_id,
      metricValue,
      turnPrediction: row.feature_contributions?.turnPrediction || null,
    });
  }
  return qualifying;
}

/**
 * 指定したrace_idのうち、既にrace_resultsが確定済みのものを返す。
 * 企画は「結果が出る前に賭ける」ことが前提のため、Phase A（対象レース検出）は
 * 必ずこれで確定済みレースを除外してからエントリを作成する（2026-09-08、
 * 日中に手動実行した際に確定済みレースを誤って登録しかけた実例あり）。
 */
export async function getRaceIdsWithResults(raceIds) {
  assertSupabaseEnabled();
  if (raceIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id")
    .in("race_id", raceIds)
    .not("rank1", "is", null);
  if (error) throw new Error(`race_results確認エラー: ${error.message}`);
  return new Set((data || []).map((r) => r.race_id));
}

/** race_entriesから6艇分のスコアリング用データを取得する */
export async function getRaceEntriesForScoring(raceId) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from("race_entries")
    .select("boat_number, player_name, win_rate, motor_2rate")
    .eq("race_id", raceId)
    .order("boat_number");
  if (error)
    throw new Error(`race_entries取得エラー(${raceId}): ${error.message}`);
  return data || [];
}

/**
 * 企画エントリ（対象レース1件）を作成し、既存のネタゲート（sns_topics、
 * venue-feature型、要人間承認）にも同時に登録する。
 * @param {object} params
 * @param {string} params.campaignId
 * @param {string} params.raceId
 * @param {number} params.selectionMetricValue
 * @param {string} params.aiPromptText
 * @param {string} params.aiModelName
 * @param {string[]} params.aiPicks - 例: ["1-2-3", "1-3-2", "2-1-3"]
 * @param {number} params.purchaseAmountYen
 * @param {string} params.topicText
 * @param {string[]} params.targetChannels - 例: ['x','blog']。sns_campaigns.target_channelsを
 *   そのまま渡す。省略時は全チャネル配信になってしまうため呼び出し元で必ず渡すこと
 * @param {boolean} [params.autoApproveTopic] - trueならネタ承認（sns_topics.status）を
 *   自動でapprovedにする。sns_campaigns.tone_spec.autoApproveTopicsが立っている企画のみ
 *   trueを渡すこと（既定はfalse=要人間承認）。**投稿自体の自動承認とは別レイヤー**
 *   （下書き生成後の実際の投稿承認は、この設定に関わらず常に人間が行う。
 *   docs/design/sns-hub-campaign-pipeline/spec.md「シミュレーション開示」参照）
 * @returns {Promise<{entry:object, topic:object}>}
 */
export async function createCampaignEntryWithTopic({
  campaignId,
  raceId,
  selectionMetricValue,
  aiPromptText,
  aiModelName,
  aiPicks,
  purchaseAmountYen,
  topicText,
  targetChannels,
  autoApproveTopic = false,
}) {
  assertSupabaseEnabled();

  const { data: entry, error: entryError } = await supabase
    .from(ENTRIES_TABLE)
    .insert({
      campaign_id: campaignId,
      race_id: raceId,
      selection_metric_value: selectionMetricValue,
      ai_prompt_text: aiPromptText,
      ai_model_name: aiModelName,
      ai_picks: aiPicks.map((combination) => ({ combination })),
      purchase_amount_yen: purchaseAmountYen,
    })
    .select()
    .single();
  if (entryError) {
    throw new Error(
      `${ENTRIES_TABLE}作成エラー(race=${raceId}): ${entryError.message}`,
    );
  }

  // ここから先で失敗すると、sns_campaign_entriesだけが作成されsns_topicsが
  // 無い孤立行になる。呼び出し元（campaign-detect-and-generate.js）は
  // 既存エントリの有無でスキップ判定するため、孤立行が残ると当該レースは
  // 二度と再試行されなくなる。失敗時はentryを削除し、次回実行での
  // 再試行を可能にする
  try {
    const topic = await createCampaignTopic(
      campaignId,
      topicText,
      targetChannels,
      autoApproveTopic,
    );
    return { entry, topic };
  } catch (error) {
    await supabase.from(ENTRIES_TABLE).delete().eq("id", entry.id);
    throw error;
  }
}

/**
 * sns_campaigns.target_channelsに含まれるplatformのactiveなアカウントIDのみを返す。
 * 指定しない（省略・空配列）場合は全チャネル配信になってしまう既知の罠を防ぐため、
 * createCampaignTopicは必ずこれを通してtargetAccountIdsを絞り込む
 * （2026-09-09、target_channelsが単なるメタデータとして保存されるだけで
 * 実際の配信対象フィルタに使われていなかった不具合を発見・修正）。
 */
async function getTargetAccountIdsForChannels(targetChannels) {
  if (!targetChannels || targetChannels.length === 0) {
    throw new Error(
      "getTargetAccountIdsForChannels: targetChannelsが空です。全チャネル配信を防ぐため必須です",
    );
  }
  const allAccounts = await getTargetAccounts();
  return allAccounts
    .filter((a) => targetChannels.includes(a.platform))
    .map((a) => a.id);
}

/**
 * 企画に紐づくネタ（venue-feature型、要人間承認）を1件作成する。
 * createCampaignEntryWithTopic（対象レース検出時）とcreateResultAnnouncementTopic
 * （結果確定後）の共通処理。
 */
async function createCampaignTopic(
  campaignId,
  topicText,
  targetChannels,
  autoApprove = false,
) {
  const contentType = await getVenueFeatureContentType();
  const targetAccountIds = await getTargetAccountIdsForChannels(targetChannels);
  const { topic } = await createTopicWithTargets({
    topicText,
    contentTypeId: contentType.id,
    autoApprove,
    targetAccountIds,
    skipReason: "企画のtarget_channelsに含まれないチャネルのため対象外",
  });

  const { error: linkError } = await supabase
    .from("sns_topics")
    .update({ campaign_id: campaignId })
    .eq("id", topic.id);
  if (linkError) {
    throw new Error(
      `sns_topics.campaign_id更新エラー(topic=${topic.id}): ${linkError.message}`,
    );
  }

  return { ...topic, campaign_id: campaignId };
}

/**
 * 結果確定後の「結果発表」用ネタを作成する（運用フロー③）。
 * Phase A（対象レース検出時）が作るネタ（②事前の買い目発表）とは別の、
 * 2件目のネタを同じ企画に対して作る。呼び出し元でエントリごとに1回だけ
 * 呼ぶこと（backfillEntryResultとは独立しているため、二重生成防止は
 * 呼び出し元スクリプトの責務）。
 * @param {string} campaignId
 * @param {string} topicText
 * @param {string[]} targetChannels - 例: ['x','blog']。sns_campaigns.target_channelsをそのまま渡す
 * @param {boolean} [autoApproveTopic] - createCampaignEntryWithTopicと同じ意味
 * @returns {Promise<object>} topic
 */
export async function createResultAnnouncementTopic(
  campaignId,
  topicText,
  targetChannels,
  autoApproveTopic = false,
) {
  assertSupabaseEnabled();
  return createCampaignTopic(
    campaignId,
    topicText,
    targetChannels,
    autoApproveTopic,
  );
}

async function getVenueFeatureContentType() {
  const { data, error } = await supabase
    .from("sns_content_types")
    .select("id")
    .eq("type_key", VENUE_FEATURE_TYPE_KEY)
    .maybeSingle();
  if (error) {
    throw new Error(
      `sns_content_types取得エラー(${VENUE_FEATURE_TYPE_KEY}): ${error.message}`,
    );
  }
  if (!data) {
    throw new Error(
      `sns_content_typesに"${VENUE_FEATURE_TYPE_KEY}"が見つかりません`,
    );
  }
  return data;
}

/** 企画内の全エントリを作成日時昇順で取得する（Phase B・通算収支計算用） */
export async function getCampaignEntries(campaignId) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error)
    throw new Error(
      `${ENTRIES_TABLE}取得エラー(campaign=${campaignId}): ${error.message}`,
    );
  return data || [];
}

/**
 * レース結果確定後、エントリに実績を書き戻す（Phase B）。
 * cumulative_net_yenは同一企画内でこのエントリより前に作成された全エントリの
 * 収支合計＋このエントリの収支。
 */
export async function backfillEntryResult(
  entryId,
  { actualResult, hit, payoutYen },
) {
  assertSupabaseEnabled();
  const { data: entry, error: fetchError } = await supabase
    .from(ENTRIES_TABLE)
    .select("campaign_id, purchase_amount_yen, created_at")
    .eq("id", entryId)
    .single();
  if (fetchError)
    throw new Error(
      `${ENTRIES_TABLE}取得エラー(${entryId}): ${fetchError.message}`,
    );

  const priorEntries = await getCampaignEntries(entry.campaign_id);
  const priorNet = priorEntries
    .filter(
      (e) =>
        e.id !== entryId && new Date(e.created_at) < new Date(entry.created_at),
    )
    .reduce(
      (sum, e) => sum + ((e.payout_yen || 0) - (e.purchase_amount_yen || 0)),
      0,
    );
  const cumulativeNetYen = priorNet + (payoutYen - entry.purchase_amount_yen);

  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .update({
      actual_result: actualResult,
      hit,
      payout_yen: payoutYen,
      cumulative_net_yen: cumulativeNetYen,
    })
    .eq("id", entryId)
    .select()
    .single();
  if (error)
    throw new Error(`${ENTRIES_TABLE}更新エラー(${entryId}): ${error.message}`);
  return data;
}
