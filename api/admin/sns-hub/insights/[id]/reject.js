/**
 * Vercel Edge Function: 「戦略メモ」insightの却下
 * POST /api/admin/sns-hub/insights/:id/reject
 * body: { reason?: string }（任意。却下ボタンのみで完結させる低摩擦設計のため必須にしない、spec.md要件4）
 *
 * status=proposedのinsightのみ却下できる。既にactive/retiredのものは対象外。
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  getInsightById,
  updateInsight,
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

  const id = req.url.match(/insights\/([^/]+)\/reject/)?.[1];
  if (!isValidUuid(id)) {
    return jsonResponse({ error: "insight idの形式が不正です" }, 400);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // ボディ無しでもデフォルト値で継続する（reasonは任意入力のため）
  }

  try {
    const insight = await getInsightById(id);
    if (!insight) {
      return jsonResponse({ error: "insightが見つかりません" }, 404);
    }
    if (insight.status !== "proposed") {
      return jsonResponse(
        {
          error: `status='${insight.status}'のinsightは却下できません（proposedのみ）`,
        },
        409,
      );
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : null;

    const updated = await updateInsight(id, {
      status: "retired",
      retired_at: new Date().toISOString(),
      ...(reason ? { decision_note: reason } : {}),
    });

    return jsonResponse({ data: updated });
  } catch (error) {
    console.error("SNS Hub insight reject Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
