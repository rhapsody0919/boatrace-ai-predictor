/**
 * Vercel Edge Function: 管理画面（/admin/rules）の運用成績（全体・ルール別・週別）
 * GET /api/admin/rules/performance
 *
 * 集計は RPC get_admin_rule_performance（docs/db-migration/111）。service role key で呼ぶ
 * （RPC は anon/authenticated に EXECUTE を与えていない）。ルール定義は src/config/venueRules.js を
 * サーバー側で読み込んで p_rules に渡す。クライアントからルールを受け取らない。
 * 返すのは生の整数だけで、% の丸め・週の累積は src/services/adminRulePerformance.js が行う。
 *
 * middleware.js のBasic認証に加え、関数先頭の requireAdminAuth でも認証する（多層防御）。
 */

import {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  jsonResponse,
  isConfigured,
} from "../../_lib/snsHubHelpers.js";
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import { toRpcRules } from "../../../src/config/venueRules.js";
import { RULE_PERFORMANCE_START_DATE } from "../../../src/services/adminRulePerformance.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_admin_rule_performance`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_rules: toRpcRules(),
          p_start_date: RULE_PERFORMANCE_START_DATE,
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `get_admin_rule_performance 呼び出しエラー: ${response.status} ${detail.slice(0, 300)}`,
      );
    }
    const data = await response.json();
    return new Response(
      JSON.stringify({ startDate: RULE_PERFORMANCE_START_DATE, data }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("admin rules performance error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
