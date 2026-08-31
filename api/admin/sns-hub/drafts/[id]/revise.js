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
  createInsight,
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

  const { approverId, freeText, saveAsInsight } = body;
  if (!approverId) {
    return jsonResponse({ error: "approverIdは必須です" }, 400);
  }
  const reasonCodes = Array.isArray(body.reasonCodes) ? body.reasonCodes : [];
  const trimmedFreeText = typeof freeText === "string" ? freeText.trim() : "";
  if (reasonCodes.length === 0 && !trimmedFreeText) {
    return jsonResponse(
      { error: "reasonCodesまたはfreeTextのいずれかが必須です" },
      400,
    );
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
      // revision_requestedへの遷移時刻。sns_draftsにupdated_at自動更新トリガーが
      // 無いため明示的にセットする（管理画面の「処理中」経過時間表示が参照する、
      // spec.md課題2）
      updated_at: new Date().toISOString(),
    });

    const routineResult = await fireRoutine("SNS_HUB_ROUTINE", {
      action: "revise",
      draftId: id,
      reasonCodes,
      freeText: freeText || null,
    });

    // ユーザーが選択した場合のみ、自由記述を今後の生成方針への提案(insight)として
    // 登録する。既存の週次昇格フロー(promote-strategy-insights.js)にそのまま乗せる
    // ため、statusは常にproposed（spec.md課題4）。insight登録はあくまで付随的な
    // 処理のため、fireRoutineと同様に失敗してもrevise本体は成功として扱う
    // （コードレビューで指摘: createInsightが例外を投げると、既に成功している
    // ステータス更新・Routine起動まで500エラーに巻き込まれてしまう）
    if (saveAsInsight && freeText?.trim()) {
      try {
        await createInsight({
          platform: draft.platform,
          language: draft.language,
          format: draft.format,
          insight_text: freeText.trim(),
          evidence: `revise操作(content_group_id=${draft.content_group_id})でのユーザー指摘: ${freeText.trim()}`,
          source: "revision-feedback",
          research_method: "manual",
          status: "proposed",
        });
      } catch (insightError) {
        console.error("SNS Hub revise insight登録エラー:", insightError);
      }
    }

    return jsonResponse({ data: updated, routine: routineResult });
  } catch (error) {
    console.error("SNS Hub revise Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
