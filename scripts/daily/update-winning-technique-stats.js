import { fetchAll, supabase } from "../lib/supabaseClient.js";
import { NOT_NO_RACE_FILTER } from "../lib/raceOutcomeFilters.js";
import {
  VENUE_CODES,
  buildPeriodRecords,
  collectRaces,
  sourceRanges,
  validateSources,
} from "../lib/venueTechniquePeriod.js";

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

async function fetchAllRaceResults() {
  const ninetyDaysAgo = getNinetyDaysAgoJST();
  const allResults = [];
  let from = 0;
  const pageSize = 1000;

  console.log("過去90日（" + ninetyDaysAgo + "以降）のレース結果を取得中...");

  while (true) {
    const { data, error } = await supabase
      .from("race_results")
      .select("race_id, rank1, winning_technique")
      .eq("is_cancelled", false)
      .or(NOT_NO_RACE_FILTER) // 不成立は race_status で外す（is_no_race は全行 false。BOA-545）
      .not("rank1", "is", null)
      .not("winning_technique", "is", null)
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

// 会場×枠番（1着艇の rank1）ごとに決まり手の出現割合を集計する
function aggregateByVenueAndBoatNumber(raceResults) {
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

    // 枠番（rank1）ごとにグループ化
    const byBoatNumber = {};
    results.forEach((result) => {
      const boatNumber = result.rank1;
      if (!byBoatNumber[boatNumber]) {
        byBoatNumber[boatNumber] = { total: 0, techniques: {} };
      }
      byBoatNumber[boatNumber].total++;
      const technique = result.winning_technique;
      byBoatNumber[boatNumber].techniques[technique] =
        (byBoatNumber[boatNumber].techniques[technique] || 0) + 1;
    });

    const records = [];
    for (const boatNumber in byBoatNumber) {
      const { total, techniques } = byBoatNumber[boatNumber];
      for (const technique in techniques) {
        const count = techniques[technique];
        records.push({
          venue_code: parseInt(venueCode),
          boat_number: parseInt(boatNumber),
          winning_technique: technique,
          count_90days: count,
          total_races: total,
          percentage: parseFloat(((count / total) * 100).toFixed(2)),
          last_updated: getTodayDateJST(),
        });
      }
    }

    aggregated[venueCode] = records;
  }

  return aggregated;
}

async function upsertWinningTechniqueStats(aggregated) {
  let totalInserted = 0;

  for (const venueCode in aggregated) {
    const venueName = VENUE_NAMES[String(venueCode).padStart(2, "0")];
    const records = aggregated[venueCode];

    console.log(
      "\n" + venueName + "(" + venueCode + "): " + records.length + "件",
    );

    const { error: delError } = await supabase
      .from("winning_technique_stats")
      .delete()
      .eq("venue_code", parseInt(venueCode));

    if (delError) {
      console.error("  削除エラー:", delError.message);
      continue;
    }

    const { data, error: insError } = await supabase
      .from("winning_technique_stats")
      .insert(records);

    if (insError) {
      console.error("  挿入エラー:", insError.message);
      continue;
    }

    const inserted = data ? data.length : records.length;
    totalInserted += inserted;
    console.log("  挿入完了: " + inserted + "件");
  }

  return totalInserted;
}

/**
 * 会場の決まり手の期間（90日・365日）の表 venue_technique_period_stats を書き直す（BOA-430、ADR 0088）。
 * 既存の winning_technique_stats の処理と違い、失敗は握りつぶさず投げる（画面が古い値・片方の期間だけを出さないため）
 */
async function updateVenueTechniquePeriodStats() {
  const today = getTodayDateJST();
  const ranges = sourceRanges(today);
  console.log("\n=== 会場の決まり手の期間（venue_technique_period_stats） ===");

  const live = ranges.live
    ? await fetchAll(
        "race_results",
        "race_id, race_status, is_cancelled, rank1, winning_technique",
        (q) =>
          q
            .eq("is_cancelled", false)
            .or(NOT_NO_RACE_FILTER)
            .not("rank1", "is", null)
            .not("winning_technique", "is", null)
            .gte("race_id", ranges.live.from)
            .lt("race_id", `${ranges.live.to}-99`)
            .order("race_id"),
      )
    : [];
  const archive = ranges.archive
    ? await fetchAll(
        "kb_archive_races",
        "race_id, race_date, venue_code, has_result, technique",
        (q) =>
          q
            .eq("has_result", true)
            .not("technique", "is", null)
            .gte("race_date", ranges.archive.from)
            .lte("race_date", ranges.archive.to)
            .order("race_id"),
      )
    : [];
  // 除外は読み取りの条件と純関数の両方で行う（純関数が正。条件は読む行を減らすため）
  const { races, liveCount, archiveCount } = collectRaces(live, archive);
  const problems = validateSources({ today, archiveCount, liveCount });
  if (problems.length > 0) throw new Error(problems.join("\n"));
  console.log(
    `読み込み: 新しい表 ${live.length}行（数える ${liveCount}件）・長期の表 ${archive.length}行（数える ${archiveCount}件）`,
  );

  const byVenue = buildPeriodRecords(races, today);
  let written = 0;
  for (const venue of VENUE_CODES) {
    const { error: delError } = await supabase
      .from("venue_technique_period_stats")
      .delete()
      .eq("venue_code", venue);
    if (delError)
      throw new Error(`会場${venue}の削除に失敗: ${delError.message}`);
    const records = byVenue[venue];
    if (records.length === 0) continue;
    // 90日と365日を1回の書き込みで入れる（片方だけ残るのを防ぐ）
    const { error: insError } = await supabase
      .from("venue_technique_period_stats")
      .insert(records);
    if (insError)
      throw new Error(`会場${venue}の書き込みに失敗: ${insError.message}`);
    written += records.length;
  }
  console.log(`書き込み完了: ${written}行`);
}

async function main() {
  console.log("=== Winning Technique Stats 日次更新 ===");
  console.log("実行日時: " + new Date().toISOString());

  const raceResults = await fetchAllRaceResults();
  if (!raceResults || raceResults.length === 0) {
    console.log(
      "\n直近90日のデータがないため winning_technique_stats は更新しません",
    );
  } else {
    const aggregated = aggregateByVenueAndBoatNumber(raceResults);
    console.log("\n集計完了: " + Object.keys(aggregated).length + "会場");

    const totalInserted = await upsertWinningTechniqueStats(aggregated);
    console.log("合計挿入件数: " + totalInserted + "件");
  }

  await updateVenueTechniquePeriodStats();
  console.log("\n=== 完了 ===");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
