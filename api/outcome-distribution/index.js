/**
 * Vercel Edge Function: 出目分布データ
 * outcome_distribution テーブルから会場別の3連単出現パターンを取得
 * データは update-outcome-distribution.js（夜間バッチ）が毎日更新する
 */

export const config = {
  runtime: "edge",
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const VENUE_NAMES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

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
    const url = new URL(req.url);
    const venueCode = url.searchParams.get("venue_code");

    if (!venueCode) {
      throw new Error("venue_code query parameter is required");
    }

    const parsedVenueCode = parseInt(venueCode, 10);
    if (isNaN(parsedVenueCode) || parsedVenueCode < 1 || parsedVenueCode > 24) {
      throw new Error("venue_code must be a number between 1 and 24");
    }

    // outcome_distribution テーブルから該当会場のデータを取得
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/outcome_distribution?venue_code=eq.${parsedVenueCode}&order=first_boat,count_90days.desc`,
      {
        method: "GET",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Supabase outcome_distribution error: ${response.status}`,
      );
    }

    const rows = await response.json();
    if (!rows || rows.length === 0) {
      throw new Error(
        "No outcome distribution data for this venue — run update-outcome-distribution.js first",
      );
    }

    // 1着別にグループ化（1-6）
    const data = {};
    let totalRaces = 0;
    let lastUpdated = null;

    for (const row of rows) {
      const firstBoat = row.first_boat;
      if (!data[firstBoat]) {
        data[firstBoat] = [];
      }

      data[firstBoat].push({
        second_boat: row.second_boat,
        third_boat: row.third_boat,
        count: row.count_90days,
        probability: row.probability,
        avg_payout: row.avg_payout,
      });

      if (!totalRaces) {
        totalRaces = row.total_races;
        lastUpdated = row.last_updated;
      }
    }

    const venueName = VENUE_NAMES[String(parsedVenueCode).padStart(2, "0")];

    const result = {
      venue_code: parsedVenueCode,
      venue_name: venueName,
      total_races: totalRaces,
      last_updated: lastUpdated,
      data: data,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        // 出目分布データは update-outcome-distribution.js が日1回更新するため24時間キャッシュで十分
        "Cache-Control": "s-maxage=86400, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    console.error("Outcome Distribution Edge function error:", error);

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
