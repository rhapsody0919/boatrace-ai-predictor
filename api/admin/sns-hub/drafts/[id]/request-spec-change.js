/**
 * Vercel Edge Function: 制作仕様の変更要望（要件85、2026-09-04新設）
 * POST /api/admin/sns-hub/drafts/:id/request-spec-change
 * body: { approverId: string, message: string }
 *
 * 「BGMを変えてほしい」「尺を伸ばしてほしい」等、個別の下書き修正では
 * 解決しない制作仕様（Tier2ルール）への変更要望をLinearに起票する。
 * コンテンツ品質FB（redo.jsのsaveAsInsight経路）と異なりsns_strategy_insights
 * には書き込まない。ルールファイル（docs/operation/sns-pipeline-*.md等）の
 * 変更は人間が精査してから行うべきで、UIからの一言だけを根拠にAIが
 * ルールファイルを自動編集するのはリスクが高いため（.claude/CLAUDE.md
 * フローB参照）。この下書き自体のstatusも変更しない。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
  createLinearIssue,
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

  const id = req.url.match(/drafts\/([^/]+)\/request-spec-change/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }

  const { approverId, message } = body;
  if (!approverId) {
    return jsonResponse({ error: "approverIdは必須です" }, 400);
  }
  const trimmedMessage = typeof message === "string" ? message.trim() : "";
  if (!trimmedMessage) {
    return jsonResponse({ error: "messageは必須です" }, 400);
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }

    const issueResult = await createLinearIssue({
      // タイトルは[production-spec]（コンテンツ品質FBの[content-quality]と
      // 意図的に区別、コードレビューで指摘: 同じ接頭辞だと「BGMを変えて」の
      // ような制作仕様要望が誤って品質不具合として誤解されるトリアージリスク
      // があった）。Linearラベル自体はcheck-quality-backlog.jsが拾う既存の
      // content-qualityラベルをそのまま流用する（新規ラベル運用を増やさない）
      title: `[production-spec] ${draft.platform}向け制作仕様の変更要望`,
      description: `sns-hub管理画面からの制作仕様変更要望（request-spec-change.js）。承認者: ${approverId}\n\n**要望内容**:\n${trimmedMessage}\n\n**対象**: platform=${draft.platform}, content_group_id=${draft.content_group_id}, draft_id=${id}\n\n人間が内容を精査し、該当するdocs/operation/sns-pipeline-*.md等のルールファイルへの反映を検討してください。複数案を比較しながら作り込みが必要な場合は/refine-creativeスキルの利用を検討してください。`,
    });

    if (!issueResult.created) {
      return jsonResponse(
        {
          data: { draftId: id },
          issue: issueResult,
          warning: `Linear起票がスキップされました（${issueResult.reason}）。要望内容は記録されていません`,
        },
        200,
      );
    }

    return jsonResponse({ data: { draftId: id }, issue: issueResult });
  } catch (error) {
    console.error("SNS Hub request-spec-change Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
