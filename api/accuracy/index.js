/**
 * Vercel Edge Function: 精度統計サマリ
 * accuracy_cache テーブルから pre-compute 済みデータを読み込み、CDN でキャッシュ
 * データは calculate-accuracy.js（夜間バッチ）が毎日更新する
 */

import { badRequest, queryError } from "../_lib/strictQuery.js";

export const config = {
  runtime: "edge",
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

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

  // 画面（src/services/supabaseDataService.js）はクエリを付けない。付いた要求はキャッシュ外しなので拒む（api/_lib/strictQuery.js）
  const invalid = queryError(new URL(req.url), {});
  if (invalid) return badRequest(invalid);

  try {
    // accuracy_cache テーブルから単一行読み込み（重い get_accuracy_summary RPC を廃止）
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/accuracy_cache?key=eq.accuracy_summary&select=data`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Supabase accuracy_cache error: ${response.status}`);
    }

    const rows = await response.json();
    if (!rows || rows.length === 0) {
      throw new Error("accuracy_cache is empty — run calculate-accuracy.js first");
    }
    const data = rows[0].data;

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // 精度データは calculate-accuracy.js が日1回更新するため24時間キャッシュで十分
        "Cache-Control": "s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("Accuracy Edge function error:", error);

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
