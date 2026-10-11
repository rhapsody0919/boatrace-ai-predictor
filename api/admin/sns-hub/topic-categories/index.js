/**
 * Vercel Edge Function: ネタの型（カテゴリ）一覧取得
 * GET /api/admin/sns-hub/topic-categories
 *
 * sns-hub管理画面「ネタ型設定」用。型ごとのチャネルON/OFFを一覧表示する
 * （2026-09-03新設）。middleware.js のBasic認証に加え、関数先頭の requireAdminAuth でも認証する（多層防御）。
 */

import {
  jsonResponse,
  isConfigured,
  getTopicCategories,
} from "../../../_lib/snsHubHelpers.js";

import { requireAdminAuth } from "../../../_lib/adminAuth.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  try {
    const categories = await getTopicCategories();
    return jsonResponse({ data: categories });
  } catch (error) {
    console.error("SNS Hub topic-categories Edge function error:", error);
    return jsonResponse({ error: "処理を完了できませんでした。最新の状態を再読み込みして確認してください。" }, 500);
  }
}
