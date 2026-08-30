/**
 * Vercel Edge Function: SNSマーケティングハブ「戦略メモ」insight一覧取得
 * GET /api/admin/sns-hub/insights?status=proposed
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

async function fetchInsights(status) {
  const params = new URLSearchParams({
    select: "*",
    order: "created_at.desc",
  });
  if (status && status !== "all") {
    params.set("status", `eq.${status}`);
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights?${params.toString()}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`sns_strategy_insights取得エラー: ${response.status}`);
  }

  return response.json();
}

// 全insightの反映本数（screens.md「反映本数」表示用）を1クエリでまとめて集計する。
// drafts/index.jsのsignPaths（署名対象パスをまとめて1回のバッチAPI呼び出しで処理する）と
// 同じ思想で、insightごとの個別クエリ（N+1）を避ける。
async function countDraftsByInsightId() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?select=referenced_insight_ids&referenced_insight_ids=neq.{}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    // 集計に失敗しても一覧自体は返す（drafts/index.jsのStorage署名失敗時と同じ方針）
    console.error(`referenced_insight_ids集計エラー: ${response.status}`);
    return null;
  }

  const rows = await response.json();
  const counts = {};
  for (const row of rows) {
    for (const insightId of row.referenced_insight_ids || []) {
      counts[insightId] = (counts[insightId] || 0) + 1;
    }
  }
  return counts;
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

    const insights = await fetchInsights(status);

    // 反映本数はactive/retiredのみ意味を持つ（proposedはまだ生成に使われていない）
    const needsCount = insights.some((i) => i.status !== "proposed");
    const counts = needsCount ? await countDraftsByInsightId() : {};

    // counts自体がnull（集計クエリ失敗）の場合は「0件」と区別するためnullのまま返す
    const enriched = insights.map((insight) => ({
      ...insight,
      referenced_draft_count:
        insight.status === "proposed" || counts === null
          ? null
          : (counts[insight.id] ?? 0),
    }));

    return jsonResponse({ data: enriched });
  } catch (error) {
    console.error("SNS Hub insights Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
