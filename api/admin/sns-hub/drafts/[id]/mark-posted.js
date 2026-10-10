/**
 * Vercel Edge Function: 投稿済みへのステータス反映
 * POST /api/admin/sns-hub/drafts/:id/mark-posted
 * body: { postedAt?: string (ISO8601、省略時は現在時刻) }
 *
 * approved（日本語版の承認直後）とready_to_post（翻訳版）のどちらからも
 * 投稿済みにできる。管理画面（SnsHubAdmin.jsx）は両ステータスで投稿アクションを
 * 表示しており、日本語版はapprovedのまま人間が投稿するのが通常フローのため。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
  updateDraft,
} from "../../../../_lib/snsHubHelpers.js";

import { requireAdminAuth } from "../../../../_lib/adminAuth.js";
import { isBundlePublicationBlocked } from "../../../../_lib/snsBundleValidation.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const id = req.url.match(/drafts\/([^/]+)\/mark-posted/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
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
    if (isBundlePublicationBlocked(draft)) {
      return jsonResponse(
        { error: "公開不可: v0素材の保留はこの操作で解除できません" },
        409,
      );
    }
    if (draft.status !== "approved" && draft.status !== "ready_to_post") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きは投稿済みにできません（approved/ready_to_postのみ）`,
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
    return jsonResponse(
      {
        error:
          "処理を完了できませんでした。最新の状態を再読み込みして確認してください。",
      },
      error.status || 500,
    );
  }
}
