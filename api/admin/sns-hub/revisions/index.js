/**
 * Vercel Edge Function: 直近の修正フィードバック（過去のFB）一覧取得
 * GET /api/admin/sns-hub/revisions?windowDays=30&limit=30
 *
 * scripts/lib/contentRevisionHistory.js の getRecentRevisions() と同じロジック
 * のEdge版。Node専用のsupabaseClient.js経由の同ファイルをEdge Functionから
 * 直接importできないため、insights/index.jsと同じREST直叩きパターンで
 * 独立実装した（2026-09-04、sns-hub UIに「今どんなルール・FBで生成されて
 * いるか」を可視化する要望を受けて新設）。
 *
 * middleware.js のBasic認証配下にあるため、この関数自体は認証チェックを行わない。
 */

import {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  jsonResponse,
  isConfigured,
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

  const url = new URL(req.url);
  const windowDays = Number(url.searchParams.get("windowDays")) || 30;
  const limit = Number(url.searchParams.get("limit")) || 30;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const params = new URLSearchParams({
    select:
      "id,platform,format,title,revision_reason_codes,revision_reason_freetext,updated_at",
    revision_reason_codes: "not.is.null",
    updated_at: `gte.${cutoff.toISOString()}`,
    order: "updated_at.desc",
    limit: String(limit),
  });

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/sns_drafts?${params.toString()}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`sns_drafts revision履歴取得エラー: ${response.status}`);
    }
    const rows = await response.json();
    const data = rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      format: row.format,
      title: row.title,
      revisionReasonCodes: row.revision_reason_codes || [],
      revisionReasonFreetext: row.revision_reason_freetext,
      updatedAt: row.updated_at,
    }));
    return jsonResponse({ data });
  } catch (error) {
    console.error("SNS Hub revisions Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
