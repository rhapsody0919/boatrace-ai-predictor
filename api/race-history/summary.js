/**
 * Vercel Edge Function: レース履歴サマリー
 * race_history_cache テーブルから事前計算済みキャッシュを取得
 * accuracy/index.js と同じパターン（RPC 廃止、テーブル SELECT に変更）
 */

import { badRequest, queryError } from "../_lib/strictQuery.js";

export const config = {
  runtime: "edge",
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const url = new URL(req.url);
  // 画面（getRaceHistorySummary(90)）は ?days=90 だけを送り、キャッシュも90日の1つしか無い。
  // 他の値・他のキーはキャッシュ外しになるので拒む（api/_lib/strictQuery.js）
  const invalid = queryError(url, { days: (v) => v === "90" });
  if (invalid) return badRequest(invalid);

  try {
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") || "90", 10), 1),
      365,
    );

    // race_history_cache テーブルから直接取得（RPC廃止）
    const cacheKey = days <= 90 ? "race_history_summary_90" : "race_history_summary_90";

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/race_history_cache?key=eq.${cacheKey}&select=data`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`race_history_cache fetch failed: ${response.status}`);
    }

    const rows = await response.json();
    const data = rows[0]?.data || { days: [] };

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("Race history Edge function error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}
