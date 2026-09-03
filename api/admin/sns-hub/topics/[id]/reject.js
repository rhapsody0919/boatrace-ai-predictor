/**
 * Vercel Edge Function: 「ネタ承認」ネタの却下
 * POST /api/admin/sns-hub/topics/:id/reject
 * body: { approverId: string }
 *
 * status=proposedのネタのみ却下できる。却下されたネタに紐づくsns_topic_targetsは
 * そのままpendingで残るが、topic.status='approved'を条件にclaimするため
 * 各チャネル別パイプラインからは自然に無視される（別途クリーンアップは不要）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  getTopicById,
  updateTopic,
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
  const { approverId } = body;
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
    });

    return jsonResponse({ data: updated });
  } catch (error) {
    console.error("SNS Hub topic reject Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
