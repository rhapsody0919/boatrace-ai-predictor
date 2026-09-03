/**
 * Vercel Edge Function: チャネルラベルの手動調整
 * PATCH /api/admin/sns-hub/topics/:id/targets/:targetId
 * body: { status: 'pending' | 'skipped', reason?: string }
 *
 * ネタ承認キューUI・進捗マトリクスUIの両方から、個別ターゲット（配信先アカウント）を
 * 対象に含める/除外するトグル操作に使う（spec.md要件14）。claim済み・生成済みの
 * ターゲットは対象外（api/_lib/snsHubHelpers.jsのupdateTopicTargetLabelがWHERE句で保証）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  updateTopicTargetLabel,
} from "../../../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  if (req.method !== "PATCH") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const targetId = req.url.match(/targets\/([^/]+)$/)?.[1];
  if (!isValidUuid(targetId)) {
    return jsonResponse({ error: "target idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }
  const { status, reason } = body;
  if (status !== "pending" && status !== "skipped") {
    return jsonResponse(
      { error: "statusはpendingまたはskippedのみ指定できます" },
      400,
    );
  }

  try {
    const updated = await updateTopicTargetLabel(targetId, status, reason);
    if (!updated) {
      return jsonResponse(
        {
          error:
            "対象のターゲットが見つからないか、既にclaim/生成済みのため変更できません",
        },
        409,
      );
    }
    return jsonResponse({ data: updated });
  } catch (error) {
    console.error(
      "SNS Hub topic target label update Edge function error:",
      error,
    );
    return jsonResponse({ error: error.message }, 500);
  }
}
