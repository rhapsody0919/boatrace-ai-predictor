/**
 * Vercel Edge Function: 投稿済みへのステータス反映
 * POST /api/admin/sns-hub/drafts/:id/mark-posted
 * body: { postedAt?: string (ISO8601、省略時は現在時刻) }
 *
 * ready_to_post状態の下書きにのみ適用できる（plan.mdのステータス遷移図参照）。
 */

import {
  jsonResponse,
  isConfigured,
  getDraftById,
  updateDraft,
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

  const id = req.url.match(/drafts\/([^/]+)\/mark-posted/)?.[1];
  if (!id) {
    return jsonResponse({ error: "draft idが指定されていません" }, 400);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // ボディ無しでもデフォルト値で継続する
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.status !== "ready_to_post") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きは投稿済みにできません（ready_to_postのみ）`,
        },
        409,
      );
    }

    const updated = await updateDraft(id, {
      status: "posted",
      posted_at: body.postedAt || new Date().toISOString(),
    });

    return jsonResponse({ data: updated });
  } catch (error) {
    console.error("SNS Hub mark-posted Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
