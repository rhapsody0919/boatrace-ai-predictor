/**
 * Vercel Edge Function: 下書きの一部修正指摘
 * POST /api/admin/sns-hub/drafts/:id/revise
 * body: { approverId: string, reasonCodes: string[], freeText?: string }
 *
 * 定型理由（複数選択可）＋自由記述で修正を指摘する（spec.md要件3）。
 * status を revision_requested に更新し、修正対応Routineの/fireを呼ぶ（ADR 0020）。
 * 旧バージョンのarchived化・新バージョンの作成はRoutine側（Task14）の責務。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
  updateDraft,
  fireRoutine,
} from "../../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

const VALID_REASON_CODES = [
  "time-expression-error",
  "gambling-connotation",
  "typo-or-data-error",
  "tone-adjustment",
  "format-or-topic-change",
];

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const id = req.url.match(/drafts\/([^/]+)\/revise/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }

  const { approverId, reasonCodes, freeText } = body;
  if (!approverId) {
    return jsonResponse({ error: "approverIdは必須です" }, 400);
  }
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    return jsonResponse({ error: "reasonCodesは1件以上必須です" }, 400);
  }
  const invalidCodes = reasonCodes.filter(
    (c) => !VALID_REASON_CODES.includes(c),
  );
  if (invalidCodes.length > 0) {
    return jsonResponse(
      { error: `不正なreasonCodes: ${invalidCodes.join(", ")}` },
      400,
    );
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.status !== "pending_review") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きには修正指摘できません（pending_reviewのみ）`,
        },
        409,
      );
    }

    const updated = await updateDraft(id, {
      status: "revision_requested",
      approver_id: approverId,
      revision_reason_codes: reasonCodes,
      revision_reason_freetext: freeText || null,
    });

    const routineResult = await fireRoutine("SNS_HUB_ROUTINE", {
      action: "revise",
      draftId: id,
      reasonCodes,
      freeText: freeText || null,
    });

    return jsonResponse({ data: updated, routine: routineResult });
  } catch (error) {
    console.error("SNS Hub revise Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
