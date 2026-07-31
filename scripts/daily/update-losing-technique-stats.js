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
      .eq("is_no_race", false)
      .not("rank1", "is", null)
      .not("winning_technique", "is", null)
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

// 会場×枠番ごとに「その枠番が1着を逃した場合、勝者がどの決まり手で勝ったか」を集計する
function aggregateLosingTechnique(raceResults) {
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
    const records = [];

    // 枠番1-6は必ずどのレースにも出走しているため、
    // 総レース数のうち「その枠番が勝たなかったレース」が分母になる
    for (let boatNumber = 1; boatNumber <= 6; boatNumber++) {
      const losses = results.filter((r) => r.rank1 !== boatNumber);
      const totalLosses = losses.length;
      if (totalLosses === 0) continue;

      const techniques = {};
      losses.forEach((r) => {
        const technique = r.winning_technique;
        techniques[technique] = (techniques[technique] || 0) + 1;
      });

      for (const technique in techniques) {
        const count = techniques[technique];
        records.push({
          venue_code: parseInt(venueCode),
          boat_number: boatNumber,
          losing_technique: technique,
          count_90days: count,
          total_losses_90days: totalLosses,
          percentage: parseFloat(((count / totalLosses) * 100).toFixed(2)),
          last_updated: getTodayDateJST(),
        });
      }
    }

    aggregated[venueCode] = records;
  }

  return aggregated;
}

async function upsertLosingTechniqueStats(aggregated) {
  let totalInserted = 0;

  for (const venueCode in aggregated) {
    const venueName = VENUE_NAMES[String(venueCode).padStart(2, "0")];
    const records = aggregated[venueCode];

    console.log(
      "\n" + venueName + "(" + venueCode + "): " + records.length + "件",
    );

    const { error: delError } = await supabase
      .from("losing_technique_stats")
      .delete()
      .eq("venue_code", parseInt(venueCode));

    if (delError) {
      console.error("  削除エラー:", delError.message);
      continue;
    }

    const { data, error: insError } = await supabase
      .from("losing_technique_stats")
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

async function main() {
  console.log("=== Losing Technique Stats 日次更新 ===");
  console.log("実行日時: " + new Date().toISOString());

  const raceResults = await fetchAllRaceResults();
  if (!raceResults || raceResults.length === 0) {
    console.log("\nデータがないため終了します");
    return;
  }

  const aggregated = aggregateLosingTechnique(raceResults);
  console.log("\n集計完了: " + Object.keys(aggregated).length + "会場");

  const totalInserted = await upsertLosingTechniqueStats(aggregated);

  console.log("\n=== 完了 ===");
  console.log("合計挿入件数: " + totalInserted + "件");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
