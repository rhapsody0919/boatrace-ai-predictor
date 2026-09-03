/**
 * Vercel Edge Function: ネタの型（カテゴリ）一覧取得
 * GET /api/admin/sns-hub/topic-categories
 *
 * sns-hub管理画面「ネタ型設定」用。型ごとのチャネルON/OFFを一覧表示する
 * （2026-09-03新設）。middleware.js のBasic認証配下にあるため、この関数
 * 自体は認証チェックを行わない。
 */

import {
  jsonResponse,
  isConfigured,
  getTopicCategories,
} from "../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
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
    return jsonResponse({ error: error.message }, 500);
  }
}
