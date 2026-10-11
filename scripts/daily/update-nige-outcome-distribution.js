import { supabase } from "../lib/supabaseClient.js";
import {
  TRIFECTA_PAYOUT_COLUMN,
  aggregateOutcomeDistribution,
} from "../lib/outcomeDistribution.js";
import { NOT_NO_RACE_FILTER } from "../lib/raceOutcomeFilters.js";

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
      .select(
        `race_id, rank1, rank2, rank3, refund_boats, ${TRIFECTA_PAYOUT_COLUMN}`,
      ) // refund_boats: 返還艇を飛ばして集計する（BOA-579）
      .eq("is_cancelled", false)
      .or(NOT_NO_RACE_FILTER) // 不成立は race_status で外す（is_no_race は全行 false。BOA-545）
      .eq("winning_technique", "逃げ")
      .not("rank1", "is", null)
      .not("rank2", "is", null)
      .not("rank3", "is", null)
      .gte("race_id", ninetyDaysAgo)
      .order("race_id")
      .range(from, from + pageSize - 1);

    if (error) {
      // 失敗を「データなし」（exit 0）にしない。古い統計が残ったまま成功扱いになるため（BOA-391）
      throw new Error(`レース結果取得エラー: ${error.message}`);
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
// 集計は共通の純粋関数（3連単の配当＝payout_trio。列名と中身が逆。BOA-535）
async function aggregateByVenue(raceResults) {
  return aggregateOutcomeDistribution(raceResults, {
    today: getTodayDateJST(),
  });
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
