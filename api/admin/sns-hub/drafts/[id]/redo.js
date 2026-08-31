/**
 * Vercel Edge Function: 下書きの全部作り直し
 * POST /api/admin/sns-hub/drafts/:id/redo
 * body: { approverId: string, freeText?: string }
 *
 * 「一部修正」と異なり、新しいcontent_group_idで全く別のアイデアとして
 * 作り直すことをRoutineに指示する（plan.mdのステータス遷移図参照）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
  updateDraft,
  fireRoutine,
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

  const id = req.url.match(/drafts\/([^/]+)\/redo/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }

  const { approverId, freeText, saveAsInsight } = body;
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
          error: `status='${draft.status}'の下書きは作り直せません（pending_reviewのみ）`,
        },
        409,
      );
    }

    const updated = await updateDraft(id, {
      status: "revision_requested",
      approver_id: approverId,
      revision_reason_codes: ["full-redo"],
      revision_reason_freetext: freeText || null,
    });

    const routineResult = await fireRoutine("SNS_HUB_ROUTINE", {
      action: "redo",
      draftId: id,
      format: draft.format,
      platform: draft.platform,
      language: draft.language,
      freeText: freeText || null,
    });

    // ユーザーが選択した場合のみ、自由記述を今後の生成方針への提案(insight)として
    // 登録する（revise.jsと同じ方針、spec.md課題4）。insight登録の失敗でredo本体を
    // 失敗扱いにしないよう個別にcatchする（revise.jsと同じ理由）
    if (saveAsInsight && freeText?.trim()) {
      try {
        await createInsight({
          platform: draft.platform,
          language: draft.language,
          format: draft.format,
          insight_text: freeText.trim(),
          evidence: `redo操作(content_group_id=${draft.content_group_id})でのユーザー指摘: ${freeText.trim()}`,
          source: "revision-feedback",
          research_method: "manual",
          status: "proposed",
        });
      } catch (insightError) {
        console.error("SNS Hub redo insight登録エラー:", insightError);
      }
    }

    return jsonResponse({ data: updated, routine: routineResult });
  } catch (error) {
    console.error("SNS Hub redo Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
