/**
 * Vercel Edge Function: 下書きの承認
 * POST /api/admin/sns-hub/drafts/:id/approve
 * body: { approverId: string }
 *
 * 承認は日本語版（pending_review状態）に対してのみ行える。
 * 承認後、英語版自動生成のためRoutineの/fireを呼ぶ（ADR 0020、spec.md要件6）。
 */

import {
  jsonResponse,
  isConfigured,
  getDraftById,
  updateDraft,
  fireRoutine,
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

  const id = req.url.match(/drafts\/([^/]+)\/approve/)?.[1];
  if (!id) {
    return jsonResponse({ error: "draft idが指定されていません" }, 400);
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
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.status !== "pending_review") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きは承認できません（pending_reviewのみ）`,
        },
        409,
      );
    }

    const updated = await updateDraft(id, {
      status: "approved",
      approver_id: approverId,
      approved_at: new Date().toISOString(),
    });

    const routineResult = await fireRoutine("SNS_HUB_ROUTINE", {
      action: "translate",
      draftId: id,
      contentGroupId: draft.content_group_id,
    });

    return jsonResponse({ data: updated, routine: routineResult });
  } catch (error) {
    console.error("SNS Hub approve Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
