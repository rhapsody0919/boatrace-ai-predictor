import { supabase, fetchAll } from "../lib/supabaseClient.js";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
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

// 会場×枠番ごとに「そのレースで展示タイム最速だった回数」と「その時に1着だった回数」を集計する
// 複数艇が同タイム（同着）の場合は艇番の若い順等の恣意的なタイブレークを避けるため除外する
// （参加数=race_countにはカウントする）
function aggregateExhibitionTimeTop(exhibitionRows, raceResults) {
  const raceIdToVenue = new Map();
  const byRace = new Map();

  exhibitionRows.forEach((row) => {
    const venueCode = parseInt(row.race_id.split("-")[3], 10);
    raceIdToVenue.set(row.race_id, venueCode);
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(row);
  });

  const rank1ByRace = new Map(raceResults.map((r) => [r.race_id, r.rank1]));

  const stats = new Map();

  const bump = (venueCode, boatNumber, key) => {
    const mapKey = `${venueCode}-${boatNumber}`;
    if (!stats.has(mapKey)) {
      stats.set(mapKey, {
        venue_code: venueCode,
        boat_number: boatNumber,
        raceCount: 0,
        fastestCount: 0,
        winWhenFastestCount: 0,
      });
    }
    stats.get(mapKey)[key]++;
  };

  byRace.forEach((rows, raceId) => {
    const venueCode = raceIdToVenue.get(raceId);

    rows.forEach((row) => bump(venueCode, row.boat_number, "raceCount"));

    const minTime = Math.min(...rows.map((row) => row.exhibition_time));
    const fastestCandidates = rows.filter(
      (row) => row.exhibition_time === minTime,
    );
    if (fastestCandidates.length !== 1) return; // 同着はスキップ

    const fastest = fastestCandidates[0];
    bump(venueCode, fastest.boat_number, "fastestCount");

    const winnerBoatNumber = rank1ByRace.get(raceId);
    if (winnerBoatNumber === fastest.boat_number) {
      bump(venueCode, fastest.boat_number, "winWhenFastestCount");
    }
  });

  return [...stats.values()].map((s) => ({
    venue_code: s.venue_code,
    boat_number: s.boat_number,
    race_count: s.raceCount,
    fastest_count: s.fastestCount,
    fastest_rate: parseFloat(((s.fastestCount / s.raceCount) * 100).toFixed(2)),
    win_count_when_fastest: s.winWhenFastestCount,
    win_rate_when_fastest:
      s.fastestCount > 0
        ? parseFloat(
            ((s.winWhenFastestCount / s.fastestCount) * 100).toFixed(2),
          )
        : 0,
    last_updated: getTodayDateJST(),
  }));
}

async function upsertExhibitionTimeTopStats(records) {
  const byVenue = new Map();
  records.forEach((r) => {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  });

  let totalInserted = 0;
  for (const [venueCode, venueRecords] of byVenue) {
    const venueName = VENUE_NAMES[venueCode] ?? venueCode;
    console.log(`\n${venueName}(${venueCode}): ${venueRecords.length}件`);

    const { error: delError } = await supabase
      .from("exhibition_time_top_stats")
      .delete()
      .eq("venue_code", venueCode);
    if (delError) {
      console.error("  削除エラー:", delError.message);
      continue;
    }

    const { data, error: insError } = await supabase
      .from("exhibition_time_top_stats")
      .insert(venueRecords);
    if (insError) {
      console.error("  挿入エラー:", insError.message);
      continue;
    }

    const inserted = data ? data.length : venueRecords.length;
    totalInserted += inserted;
    console.log(`  挿入完了: ${inserted}件`);
  }
  return totalInserted;
}

async function main() {
  console.log("=== Exhibition Time Top Stats 日次更新 ===");
  console.log("実行日時: " + new Date().toISOString());

  const ninetyDaysAgo = getNinetyDaysAgoJST();
  console.log(`過去90日（${ninetyDaysAgo}以降）のデータを取得中...`);

  const exhibitionRows = await fetchAll(
    "exhibition_data",
    "race_id, boat_number, exhibition_time",
    (q) => q.gte("race_id", ninetyDaysAgo),
  );
  console.log(`exhibition_data取得完了: ${exhibitionRows.length}件`);

  if (exhibitionRows.length === 0) {
    console.log("\nデータがないため終了します");
    return;
  }

  const raceResults = await fetchAll("race_results", "race_id, rank1", (q) =>
    q
      .gte("race_id", ninetyDaysAgo)
      .eq("is_cancelled", false)
      .eq("is_no_race", false)
      .not("rank1", "is", null),
  );
  console.log(`race_results取得完了: ${raceResults.length}件`);

  const records = aggregateExhibitionTimeTop(exhibitionRows, raceResults);
  console.log(`\n集計完了: ${records.length}件（会場×枠番）`);

  const totalInserted = await upsertExhibitionTimeTopStats(records);

  console.log("\n=== 完了 ===");
  console.log("合計挿入件数: " + totalInserted + "件");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
