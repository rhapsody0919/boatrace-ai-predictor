/**
 * Vercel Edge Function: 下書きへの修正指摘（統合版）
 * POST /api/admin/sns-hub/drafts/:id/redo
 * body: { approverId: string, reasonCodes?: string[], freeText?: string,
 *          saveAsInsight?: boolean, scope?: 'channel'|'all' }
 *
 * 2026-09-04、旧「一部修正」（revise.js）と「全部作り直し」を1つのフローに
 * 統合した（実務上ほぼ全部作り直しになっていたため）。Routine側は
 * freeText/reasonCodesの内容から、同じネタのまま直すか題材選定からやり直すか
 * を判断する（各sns-pipeline-*.mdの「A'. 修正対応フロー」参照）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
  updateDraft,
  fireRoutine,
  createInsight,
  resolveRoutineEnvPrefix,
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
  "design-spacing",
  "design-color",
  "design-font-size",
  "design-visual-material",
  "unnatural-japanese",
  "search-intent-mismatch",
  "data-accuracy-error",
  "too-similar-to-existing",
];

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

  const { approverId, freeText, saveAsInsight, scope } = body;
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

    // ADR 0038: 下書きのplatformから正しいチャネル別パイプラインの発火先を解決する
    const routineResult = await fireRoutine(
      resolveRoutineEnvPrefix(draft.platform),
      {
        action: "redo",
        draftId: id,
        reasonCodes,
        format: draft.format,
        platform: draft.platform,
        language: draft.language,
        freeText: freeText || null,
      },
    );

    // 「恒久ルール化」を選んだ場合のみ、自由記述を今後の生成方針への提案(insight)
    // として登録する。scope==='all'なら全チャネル共通（platform/language/format
    // すべてnull）、既定（'channel'）ならこの下書きのplatform/language/formatに
    // 限定する（2026-09-04、旧実装は下書きから常に自動セットしておりユーザーが
    // 適用範囲を選べなかった）。insight登録の失敗でredo本体を失敗扱いにしない
    if (saveAsInsight && trimmedFreeText) {
      try {
        const isAllScope = scope === "all";
        await createInsight({
          platform: isAllScope ? null : draft.platform,
          language: isAllScope ? null : draft.language,
          format: isAllScope ? null : draft.format,
          insight_text: trimmedFreeText,
          evidence: `修正指摘(content_group_id=${draft.content_group_id})でのユーザー指摘: ${trimmedFreeText}`,
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
