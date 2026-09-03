/**
 * SNSコンテンツ ネタ生成ライン用 sns_content_types / sns_target_accounts /
 * sns_topics / sns_topic_targets 共通操作関数
 *
 * scripts/lib/snsStrategyInsights.jsと同じパターンに従う（Node.jsバッチ処理・
 * Routine用、api/_lib/snsHubHelpers.jsとは別系統）。
 *
 * 設計背景: docs/design/sns-topic-gate/spec.md・plan.md、ADR 0036〜0038。
 * ネタ（sns_topics）はstatus='approved'になって初めて各チャネル別パイプラインの
 * ポーリング対象になる。型（sns_content_types）のrequires_topic_approval=false
 * （日次・一般/日次・時間制約）のネタも、提案元（日次自動提案Routine・手動生成API）が
 * 作成と同時にstatus='approved'にする運用とし、ポーリング側のクエリはtopic.statusの
 * 判定だけで一律に扱える（requires_topic_approvalによる分岐をポーリング側に持たせない）。
 */

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

const CONTENT_TYPES_TABLE = "sns_content_types";
const TARGET_ACCOUNTS_TABLE = "sns_target_accounts";
const TOPICS_TABLE = "sns_topics";
const TOPIC_TARGETS_TABLE = "sns_topic_targets";

function assertSupabaseEnabled() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabase環境変数（SUPABASE_URL/SUPABASE_SERVICE_KEY）が未設定です。sns_topicsを操作できません。",
    );
  }
}

/** activeな型定義を全件取得する */
export async function getActiveContentTypes() {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(CONTENT_TYPES_TABLE)
    .select("*")
    .eq("active", true);
  if (error) {
    throw new Error(`${CONTENT_TYPES_TABLE}取得エラー: ${error.message}`);
  }
  return data || [];
}

/** type_keyから型定義を1件取得する（例: 'venue-feature'） */
export async function getContentTypeByKey(typeKey) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(CONTENT_TYPES_TABLE)
    .select("*")
    .eq("type_key", typeKey)
    .maybeSingle();
  if (error) {
    throw new Error(
      `${CONTENT_TYPES_TABLE}取得エラー(${typeKey}): ${error.message}`,
    );
  }
  return data;
}

/** activeな配信先アカウントを取得する。platform指定時はそのプラットフォームのみ */
export async function getTargetAccounts({ platform } = {}) {
  assertSupabaseEnabled();
  let query = supabase
    .from(TARGET_ACCOUNTS_TABLE)
    .select("*")
    .eq("active", true);
  if (platform) {
    query = query.eq("platform", platform);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`${TARGET_ACCOUNTS_TABLE}取得エラー: ${error.message}`);
  }
  return data || [];
}

/**
 * ネタを新規作成し、**activeな全配信先アカウント分**の sns_topic_targets を
 * 同時に作成する。`targetAccountIds`に含まれるアカウントは`status='pending'`
 * （対象）、含まれないアカウントも行自体は作るが`status='skipped'`（既定除外）
 * で作成する。
 *
 * 2026-09-03修正: 以前は`targetAccountIds`に無いアカウントの行を単に作らない
 * 実装だった。この場合ChannelTargetToggle（sns-hub UI）はexistingな行の
 * pending⇔skipped切替しかできず、「既定でCHANNEL_MATRIXから除外された
 * チャネル（例: TikTok）を、個別ネタの人間判断で後から対象に含める」という
 * 逆方向の操作ができなかった（ユーザー指摘）。全アカウント分の行を必ず作成する
 * ことで、そのチャネルは双方向にトグル可能になる。
 * **既知の制約**: ChannelTargetToggleは`requires_topic_approval=true`の型
 * （venue-feature、「ネタ承認」画面）でのみ到達可能。`autoApprove: true`で
 * 即座にstatus='approved'になる型（daily-auto/race-time-critical）は
 * 承認待ち一覧に出ず`TopicProgressMatrix`（表示専用、クリック不可）にのみ
 * 現れるため、作成時点の判定を人間が後から変更する手段が現状無い。
 * @param {object} params
 * @param {string} params.topicText
 * @param {string} params.contentTypeId
 * @param {string[]} [params.sourceInsightIds] - sns_strategy_insights.id の配列
 * @param {boolean} [params.autoApprove] - true の場合、作成と同時にstatus='approved'にする
 *   （requires_topic_approval=falseの型向け。人間承認を待つ型はfalseのまま'proposed'で作る）
 * @param {string[]} [params.targetAccountIds] - `status='pending'`にするアカウントID。
 *   省略時はactiveな全アカウントをpendingにする（skipped行は発生しない）
 * @param {string} [params.skipReason] - targetAccountIdsに含まれないアカウントの
 *   skip_reasonに入れる文言
 * @returns {Promise<{topic: object, targets: object[]}>}
 */
export async function createTopicWithTargets({
  topicText,
  contentTypeId,
  sourceInsightIds = [],
  autoApprove = false,
  targetAccountIds,
  skipReason = "ネタ種別の既定でチャネル対象外",
}) {
  assertSupabaseEnabled();

  const { data: topic, error: topicError } = await supabase
    .from(TOPICS_TABLE)
    .insert({
      topic_text: topicText,
      content_type_id: contentTypeId,
      source_insight_ids: sourceInsightIds,
      status: autoApprove ? "approved" : "proposed",
      ...(autoApprove ? { approved_at: new Date().toISOString() } : {}),
    })
    .select()
    .single();
  if (topicError) {
    throw new Error(`sns_topics作成エラー: ${topicError.message}`);
  }

  const allAccounts = await getTargetAccounts();
  const includedIds = new Set(
    targetAccountIds && targetAccountIds.length > 0
      ? targetAccountIds
      : allAccounts.map((a) => a.id),
  );

  const { data: targets, error: targetsError } = await supabase
    .from(TOPIC_TARGETS_TABLE)
    .insert(
      allAccounts.map((account) => ({
        topic_id: topic.id,
        target_account_id: account.id,
        status: includedIds.has(account.id) ? "pending" : "skipped",
        skip_reason: includedIds.has(account.id) ? null : skipReason,
      })),
    )
    .select();
  if (targetsError) {
    throw new Error(
      `sns_topic_targets作成エラー(topic=${topic.id}): ${targetsError.message}`,
    );
  }

  return { topic, targets: targets || [] };
}

/** ネタを承認する（sns-hub「ネタ承認」タブからの操作用） */
export async function approveTopic(id, approverId) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TOPICS_TABLE)
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approver_id: approverId,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    throw new Error(`sns_topics承認エラー(${id}): ${error.message}`);
  }
  return data;
}

/** ネタを却下する */
export async function rejectTopic(id, approverId) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TOPICS_TABLE)
    .update({ status: "rejected", approver_id: approverId })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    throw new Error(`sns_topics却下エラー(${id}): ${error.message}`);
  }
  return data;
}

/**
 * 指定した配信先アカウントについて、claim可能な（status='approved'なネタに
 * 紐づくstatus='pending'の）ターゲットを取得する。各チャネル別パイプラインの
 * ポーリング処理の入口として使う。
 */
export async function getClaimableTopicTargets(targetAccountId) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TOPIC_TARGETS_TABLE)
    .select("*, sns_topics!inner(id, topic_text, status, content_type_id)")
    .eq("target_account_id", targetAccountId)
    .eq("status", "pending")
    .eq("sns_topics.status", "approved");
  if (error) {
    throw new Error(
      `${TOPIC_TARGETS_TABLE}取得エラー（claimable, account=${targetAccountId}）: ${error.message}`,
    );
  }
  return data || [];
}

/**
 * ターゲットをアトミックにclaimする（ADR 0036）。
 * 対象行が既に他パイプラインにclaimされていた場合はnullを返す（0行更新）。
 * 素朴な「読んでから書く」実装を避けるため、必ずWHERE status='pending'を条件に含める。
 * @param {string} targetId
 * @param {string} routineRunId
 * @returns {Promise<object|null>}
 */
export async function claimTopicTarget(targetId, routineRunId) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TOPIC_TARGETS_TABLE)
    .update({
      status: "claimed",
      claimed_by: routineRunId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", targetId)
    .eq("status", "pending")
    .select();
  if (error) {
    throw new Error(
      `sns_topic_targets claimエラー(${targetId}): ${error.message}`,
    );
  }
  return (data && data[0]) || null;
}

/** claim済みターゲットを生成完了状態にし、生成した下書きを紐付ける */
export async function markTopicTargetGenerated(targetId, draftId) {
  assertSupabaseEnabled();
  const { error } = await supabase
    .from(TOPIC_TARGETS_TABLE)
    .update({ status: "generated", draft_id: draftId })
    .eq("id", targetId);
  if (error) {
    throw new Error(
      `sns_topic_targets生成完了更新エラー(${targetId}): ${error.message}`,
    );
  }
}

/** チャネル固有の規約チェック等でターゲットをスキップする（要件14） */
export async function markTopicTargetSkipped(targetId, reason) {
  assertSupabaseEnabled();
  const { error } = await supabase
    .from(TOPIC_TARGETS_TABLE)
    .update({ status: "skipped", skip_reason: reason })
    .eq("id", targetId);
  if (error) {
    throw new Error(
      `sns_topic_targetsスキップ更新エラー(${targetId}): ${error.message}`,
    );
  }
}

/** 人間・またはUIからのチャネルラベル手動調整（pending⇔skipped、要件14） */
export async function updateTopicTargetLabel(targetId, status, reason) {
  assertSupabaseEnabled();
  if (status !== "pending" && status !== "skipped") {
    throw new Error(
      `updateTopicTargetLabelはpending/skippedのみ許可（渡された値: ${status}）`,
    );
  }
  const { data, error } = await supabase
    .from(TOPIC_TARGETS_TABLE)
    .update({
      status,
      skip_reason: status === "skipped" ? reason || null : null,
      // pendingへ戻す＝未claim状態に戻すことを意味するため、claim系メタデータも
      // 必ずクリアする。片方だけ更新すると「statusはpendingなのにclaimed_byが
      // 残る」不整合状態になる（2026-09-03、実際のRoutine実行で発生・発覚）
      ...(status === "pending" ? { claimed_by: null, claimed_at: null } : {}),
    })
    .eq("id", targetId)
    .select()
    .single();
  if (error) {
    throw new Error(
      `sns_topic_targetsラベル更新エラー(${targetId}): ${error.message}`,
    );
  }
  return data;
}
