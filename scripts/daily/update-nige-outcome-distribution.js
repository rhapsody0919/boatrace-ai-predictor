import { supabase } from "../lib/supabaseClient.js";

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

function getTodayDateJST() {
  const now = new Date();
  const jstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jstDate.toISOString().split("T")[0];
}

function getNinetyDaysAgoJST() {
  const today = new Date();
  const ninetyDaysAgo = new Date(
    today.getTime() - 90 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
  return ninetyDaysAgo.toISOString().split("T")[0];
}

// 逃げ（winning_technique='逃げ'）で1着になったレースのみを対象に取得する
async function fetchAllNigeRaceResults() {
  const ninetyDaysAgo = getNinetyDaysAgoJST();
  const allResults = [];
  let from = 0;
  const pageSize = 1000;

  console.log(
    "過去90日（" + ninetyDaysAgo + "以降）の逃げ成功レースを取得中...",
  );

  while (true) {
    const { data, error } = await supabase
      .from("race_results")
      .select("race_id, rank1, rank2, rank3, payout_trifecta")
      .eq("is_cancelled", false)
      .eq("is_no_race", false)
      .eq("winning_technique", "逃げ")
      .not("rank1", "is", null)
      .not("rank2", "is", null)
      .not("rank3", "is", null)
      .gte("race_id", ninetyDaysAgo)
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("レース結果取得エラー:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      if (from === 0) {
        console.log("該当データなし");
        return null;
      }
      break;
    }

    allResults.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log("取得完了: " + allResults.length + "件");
  return allResults;
}

// venue_code ごとに(1着, 2着, 3着)パターンを集計する
// 分母(total_races)は「その会場で逃げ成功したレースの総数」（既にfetch時点で絞り込み済み）
async function aggregateByVenue(raceResults) {
  const venueData = {};

  raceResults.forEach((result) => {
    const parts = result.race_id.split("-");
    const venueCode = parseInt(parts[3]);

    if (!venueData[venueCode]) {
      venueData[venueCode] = [];
    }

    venueData[venueCode].push(result);
  });

  const aggregated = {};

  for (const venueCode in venueData) {
    const results = venueData[venueCode];
    const patterns = {};
    const totalRaces = results.length;

    results.forEach((result) => {
      const pattern = result.rank1 + "-" + result.rank2 + "-" + result.rank3;
      if (!patterns[pattern]) {
        patterns[pattern] = { count: 0, totalPayout: 0 };
      }
      patterns[pattern].count++;
      if (result.payout_trifecta) {
        patterns[pattern].totalPayout += result.payout_trifecta;
      }
    });

    const records = [];
    for (const pattern in patterns) {
      const parts = pattern.split("-");
      const firstBoat = parseInt(parts[0]);
      const secondBoat = parseInt(parts[1]);
      const thirdBoat = parseInt(parts[2]);
      const count = patterns[pattern].count;
      const probability = ((count / totalRaces) * 100).toFixed(2);
      const avgPayout = Math.round(patterns[pattern].totalPayout / count);

      records.push({
        venue_code: parseInt(venueCode),
        first_boat: firstBoat,
        second_boat: secondBoat,
        third_boat: thirdBoat,
        count_90days: count,
        total_races: totalRaces,
        probability: parseFloat(probability),
        avg_payout: avgPayout,
        last_updated: getTodayDateJST(),
      });
    }

    aggregated[venueCode] = records;
  }

  return aggregated;
}

async function upsertNigeOutcomeDistribution(aggregated) {
  let totalInserted = 0;

  for (const venueCode in aggregated) {
    const venueName = VENUE_NAMES[String(venueCode).padStart(2, "0")];
    const records = aggregated[venueCode];

    console.log(
      "\n" + venueName + "(" + venueCode + "): " + records.length + "パターン",
    );

    const { error: delError } = await supabase
      .from("nige_outcome_distribution")
      .delete()
      .eq("venue_code", parseInt(venueCode));

    if (delError) {
      console.error("  削除エラー:", delError.message);
      continue;
    }

    const { data, error: insError } = await supabase
      .from("nige_outcome_distribution")
      .insert(records);

    if (insError) {
      console.error("  挿入エラー:", insError.message);
      continue;
    }

    const inserted = data ? data.length : records.length;
    totalInserted += inserted;
    console.log(
      "  挿入完了: " +
        inserted +
        "件 (total_races: " +
        records[0].total_races +
        ")",
    );
  }

  return totalInserted;
}

async function main() {
  console.log("=== Nige Outcome Distribution 日次更新 ===");
  console.log("実行日時: " + new Date().toISOString());

  const raceResults = await fetchAllNigeRaceResults();
  if (!raceResults || raceResults.length === 0) {
    console.log("\nデータがないため終了します");
    return;
  }

  const aggregated = await aggregateByVenue(raceResults);
  console.log("\n集計完了: " + Object.keys(aggregated).length + "会場");

  const totalInserted = await upsertNigeOutcomeDistribution(aggregated);

  console.log("\n=== 完了 ===");
  console.log("合計挿入件数: " + totalInserted + "件");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
