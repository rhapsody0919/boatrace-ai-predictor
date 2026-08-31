/**
 * Vercel Edge Function: SNSマーケティングハブ「フォーマットカタログ」型一覧取得
 * GET /api/admin/sns-hub/template-variants
 *
 * middleware.js のBasic認証配下にあるため、この関数自体は認証チェックを行わない。
 * service role keyでSupabaseにアクセスする（ADR 0021の役割分担を踏襲）。
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

  try {
    const params = new URLSearchParams({
      select: "*",
      order: "format.asc,created_at.asc",
    });

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/sns_template_variants?${params.toString()}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`sns_template_variants取得エラー: ${response.status}`);
    }

    const templateVariants = await response.json();
    return jsonResponse({ data: templateVariants });
  } catch (error) {
    console.error("SNS Hub template-variants Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
