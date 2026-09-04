/**
 * Vercel Edge Function: 「ネタ承認」ネタの却下
 * POST /api/admin/sns-hub/topics/:id/reject
 * body: { approverId: string, reason?: string, saveAsInsight?: boolean }
 *
 * status=proposedのネタのみ却下できる。却下されたネタに紐づくsns_topic_targetsは
 * そのままpendingで残るが、topic.status='approved'を条件にclaimするため
 * 各チャネル別パイプラインからは自然に無視される（別途クリーンアップは不要）。
 *
 * reasonはsns_topics.rejection_reasonに監査用として保存する（2026-09-04追加、
 * migration 045）。saveAsInsightがtrueかつreasonがある場合のみ、drafts側の
 * revise機能と同じ要領でsns_strategy_insightsにも登録し、週次/日次ネタ提案
 * Routineの「0. 蓄積されたフィードバックの確認」ステップ（getActiveInsights）
 * から次回以降のネタ選定に反映されるようにする
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  getTopicById,
  updateTopic,
  createInsight,
} from "../../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const id = req.url.match(/topics\/([^/]+)\/reject/)?.[1];
  if (!isValidUuid(id)) {
    return jsonResponse({ error: "topic idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }
  const { approverId, reason, saveAsInsight } = body;
  if (!approverId) {
    return jsonResponse({ error: "approverIdは必須です" }, 400);
  }

  try {
    const topic = await getTopicById(id);
    if (!topic) {
      return jsonResponse({ error: "ネタが見つかりません" }, 404);
    }
    if (topic.status !== "proposed") {
      return jsonResponse(
        {
          error: `status='${topic.status}'のネタは却下できません（proposedのみ）`,
        },
        409,
      );
    }

    const updated = await updateTopic(id, {
      status: "rejected",
      approver_id: approverId,
      rejection_reason: reason?.trim() || null,
    });

    // insight登録はあくまで付随的な処理のため、失敗してもreject本体は成功として
    // 扱う（revise.jsのcreateInsight呼び出しと同じ方針）
    if (saveAsInsight && reason?.trim()) {
      try {
        await createInsight({
          platform: null,
          language: null,
          format: null,
          insight_text: reason.trim(),
          evidence: `ネタ却下(topic_id=${id})でのユーザー指摘: ${reason.trim()}`,
          source: "topic-rejection-feedback",
          research_method: "manual",
          status: "proposed",
        });
      } catch (insightError) {
        console.error("SNS Hub topic reject insight登録エラー:", insightError);
      }
    }

    return jsonResponse({ data: updated });
  } catch (error) {
    console.error("SNS Hub topic reject Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
