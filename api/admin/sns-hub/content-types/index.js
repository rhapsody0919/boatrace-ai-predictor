/**
 * Vercel Edge Function: ネタの型一覧取得
 * GET /api/admin/sns-hub/content-types
 *
 * 手動生成パネルの型選択ドロップダウン用（spec.md要件17）。
 * middleware.js のBasic認証配下にあるため、この関数自体は認証チェックを行わない。
 */

import {
  jsonResponse,
  isConfigured,
  getActiveContentTypes,
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
    const contentTypes = await getActiveContentTypes();
    return jsonResponse({ data: contentTypes });
  } catch (error) {
    console.error("SNS Hub content-types Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
