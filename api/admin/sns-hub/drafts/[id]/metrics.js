/**
 * Vercel Edge Function: エンゲージメント指標の手動入力
 * POST /api/admin/sns-hub/drafts/:id/metrics
 * body: { metricName: string, metricValue: number, source?: 'manual'|'api' }
 *
 * 手動入力もPhase2のAPI自動取得も同じ共通フォーマットで保存する（spec.md要件9）。
 * Phase1では管理画面からの入力はTikTok投稿のみを想定するが、sourceを持たせておくことで
 * Phase2のAPI取得値とも同じテーブルで扱える。
 */

import {
  jsonResponse,
  isConfigured,
  getDraftById,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} from "../../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

const VALID_METRIC_NAMES = ["views", "likes", "saves", "shares", "impressions"];
const VALID_SOURCES = ["manual", "api"];

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const id = req.url.match(/drafts\/([^/]+)\/metrics/)?.[1];
  if (!id) {
    return jsonResponse({ error: "draft idが指定されていません" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }

  const { metricName, metricValue, source = "manual" } = body;
  if (!VALID_METRIC_NAMES.includes(metricName)) {
    return jsonResponse(
      {
        error: `不正なmetricName: ${metricName}（有効値: ${VALID_METRIC_NAMES.join(", ")}）`,
      },
      400,
    );
  }
  if (typeof metricValue !== "number" || Number.isNaN(metricValue)) {
    return jsonResponse(
      { error: "metricValueは数値である必要があります" },
      400,
    );
  }
  if (!VALID_SOURCES.includes(source)) {
    return jsonResponse({ error: `不正なsource: ${source}` }, 400);
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.status !== "posted") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きには指標を記録できません（postedのみ）`,
        },
        409,
      );
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/sns_draft_metrics`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        draft_id: id,
        metric_name: metricName,
        metric_value: metricValue,
        source,
      }),
    });

    if (!response.ok) {
      throw new Error(`sns_draft_metrics登録エラー: ${response.status}`);
    }

    const rows = await response.json();
    return jsonResponse({ data: rows[0] });
  } catch (error) {
    console.error("SNS Hub metrics Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
