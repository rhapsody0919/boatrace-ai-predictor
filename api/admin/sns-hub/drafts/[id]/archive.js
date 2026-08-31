/**
 * Vercel Edge Function: 下書きを一覧から非表示にする（アーカイブ化）
 * POST /api/admin/sns-hub/drafts/:id/archive
 *
 * 不要な下書き（英語版の下書き等）を承認待ち・投稿準備完了等の一覧から
 * 除外するための機能（ユーザー要望、2026-08-31）。TABS定義（SnsHubAdmin.jsx）
 * のどのタブもstatus='archived'を対象にしていないため、archived化するだけで
 * 全タブから除外される。実データ（DB行・Storage上の動画ファイル）は削除しない
 * ため、必要であればSupabase側で直接statusを戻せば復元できる。
 * ステータスによる制限は設けない（どのタブの下書きも非表示にできる汎用機能）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
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

  const id = req.url.match(/drafts\/([^/]+)\/archive/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.status === "archived") {
      return jsonResponse({ error: "既に非表示になっています" }, 409);
    }

    const updated = await updateDraft(id, {
      status: "archived",
      archived_at: new Date().toISOString(),
    });

    return jsonResponse({ data: updated });
  } catch (error) {
    console.error("SNS Hub archive Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
