/**
 * Vercel Edge Function: 精度統計サマリ
 * Supabase RPC関数 get_accuracy_summary を呼び出し、CDNでキャッシュ
 */

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

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_accuracy_summary`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );

    if (!response.ok) {
      throw new Error(`Supabase RPC error: ${response.status}`);
    }

    const data = await response.json();

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
