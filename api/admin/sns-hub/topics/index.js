/**
 * Vercel Edge Function: 「ネタ承認」ネタ一覧取得
 * GET /api/admin/sns-hub/topics?status=proposed
 *
 * middleware.js のBasic認証配下にあるため、この関数自体は認証チェックを行わない。
 * service role keyでSupabaseにアクセスする（ADR 0021の役割分担を踏襲）。
 *
 * 型情報（sns_content_types）・進捗マトリクス用のターゲット一覧（sns_topic_targets、
 * 対応する配信先アカウント情報つき）を1クエリでまとめて埋め込む（drafts/index.jsの
 * sns_template_variants/sns_approvers埋め込みと同じ思想、N+1を避ける）。
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

async function fetchTopics(status) {
  const params = new URLSearchParams({
    select:
      "*,sns_content_types(type_key,label,cadence,requires_topic_approval,trigger_mode),sns_topic_targets(id,target_account_id,status,claimed_by,claimed_at,skip_reason,draft_id,sns_target_accounts(platform,account_label))",
    order: "proposed_at.desc",
  });
  if (status && status !== "all") {
    params.set("status", `eq.${status}`);
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topics?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`sns_topics取得エラー: ${response.status}`);
  }

  return response.json();
}

export default async function handler(req) {
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const topics = await fetchTopics(status);

    return jsonResponse({ data: topics });
  } catch (error) {
    console.error("SNS Hub topics Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
