/**
 * Vercel Edge Function: 「戦略メモ」insightの採用（active化）
 * POST /api/admin/sns-hub/insights/:id/approve
 *
 * status=proposedのinsightのみ採用できる。既にactive/retiredのものは対象外。
 *
 * 本来は週次Routine（scripts/maintenance/promote-strategy-insights.js、ADR 0030）が
 * risk-rules照合の上で自動昇格させる設計だったが、そのRoutine自体（sns-hub-content-generation）
 * が後の統合作業で全廃止され、昇格経路が孤立した（2026-09-05発覚）。ここでは代わりに
 * 人間が管理画面から個別に採用する運用に切り替える。risk-rules.jsonとの照合結果は
 * 参考情報として返すのみで、承認自体をブロックしない（risk-rules.json自体の方針
 * 「検出は警告表示のみ」を踏襲）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidUuid,
  getInsightById,
  updateInsight,
} from "../../../../_lib/snsHubHelpers.js";
import { matchRiskRules } from "../../../../../scripts/lib/riskRuleMatcher.js";
import riskRules from "../../../../../sns-video-studio/remotion/risk-rules.json";

import { requireAdminAuth } from "../../../../_lib/adminAuth.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const id = req.url.match(/insights\/([^/]+)\/approve/)?.[1];
  if (!isValidUuid(id)) {
    return jsonResponse({ error: "insight idの形式が不正です" }, 400);
  }

  try {
    const insight = await getInsightById(id);
    if (!insight) {
      return jsonResponse({ error: "insightが見つかりません" }, 404);
    }
    if (insight.status !== "proposed") {
      return jsonResponse(
        {
          error: `status='${insight.status}'のinsightは採用できません（proposedのみ）`,
        },
        409,
      );
    }

    const violations = matchRiskRules(
      insight.insight_text,
      insight.platform,
      riskRules.rules,
    ).map(({ id, category, matchedPattern }) => ({ id, category, matchedPattern }));

    const updated = await updateInsight(id, {
      status: "active",
      activated_at: new Date().toISOString(),
    });

    return jsonResponse({ data: updated, riskWarnings: violations });
  } catch (error) {
    console.error("SNS Hub insight approve Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
