/**
 * Vercel Edge Function: 型（カテゴリ）×チャネルのON/OFF切替
 * PATCH /api/admin/sns-hub/topic-categories/:id/channels/:platform
 * body: { enabled: boolean }
 *
 * sns-hub管理画面「ネタ型設定」テーブルのトグル操作用（2026-09-03新設）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  updateTopicCategoryChannel,
} from "../../../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

const VALID_PLATFORMS = ["blog", "note", "x", "tiktok", "youtube"];

export default async function handler(req) {
  if (req.method !== "PATCH") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const match = req.url.match(/topic-categories\/([^/]+)\/channels\/([^/]+)$/);
  const categoryId = match?.[1];
  const platform = match?.[2];
  if (!isValidUuid(categoryId)) {
    return jsonResponse({ error: "category idの形式が不正です" }, 400);
  }
  if (!VALID_PLATFORMS.includes(platform)) {
    return jsonResponse({ error: `不正なplatform: ${platform}` }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }
  if (typeof body.enabled !== "boolean") {
    return jsonResponse({ error: "enabledはboolean必須です" }, 400);
  }

  try {
    const updated = await updateTopicCategoryChannel(
      categoryId,
      platform,
      body.enabled,
    );
    if (!updated) {
      return jsonResponse(
        { error: "対象の型×チャネル設定が見つかりません" },
        404,
      );
    }
    return jsonResponse({ data: updated });
  } catch (error) {
    console.error(
      "SNS Hub topic-category channel update Edge function error:",
      error,
    );
    return jsonResponse({ error: error.message }, 500);
  }
}
