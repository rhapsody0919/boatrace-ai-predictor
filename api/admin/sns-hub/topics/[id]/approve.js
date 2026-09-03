/**
 * Vercel Edge Function: 「ネタ承認」ネタの承認
 * POST /api/admin/sns-hub/topics/:id/approve
 * body: { approverId: string }
 *
 * status=proposedのネタのみ承認できる。承認により各チャネル別パイプラインの
 * ポーリング対象になる（ADR 0036のclaim機構、docs/design/sns-topic-gate/plan.md参照）。
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

  const id = req.url.match(/topics\/([^/]+)\/approve/)?.[1];
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
          error: `status='${topic.status}'のネタは承認できません（proposedのみ）`,
        },
        409,
      );
    }

    const updated = await updateTopic(id, {
      status: "approved",
      approved_at: new Date().toISOString(),
      approver_id: approverId,
    });

    return jsonResponse({ data: updated });
  } catch (error) {
    console.error("SNS Hub topic approve Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
