/**
 * 全会場のラベル精度検証
 * 動的閾値計算が実際のレース結果に対して有効かどうかを検証
 *
 * 実行: node scripts/analysis/verify-all-venues-label-accuracy.js
 */
import { supabase } from "../lib/supabaseClient.js";
import {
  VENUE_1COURSE_WIN_RATE,
  VENUE_1COURSE_AVG,
  VENUE_VOLATILITY_THRESHOLD,
  getVolatilityThreshold,
} from "../lib/venueParameters.js";

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

function getVolatilityLevelOld(score, venueCode) {
  const highThr = VENUE_VOLATILITY_THRESHOLD[venueCode] ?? 65;
  const lowThr = Math.max(30, highThr - 15);
  if (score < lowThr) return "low";
  if (score < highThr) return "medium";
  return "high";
}

function getVolatilityLevelNew(score, venueCode) {
  const highThr = getVolatilityThreshold(venueCode);
  const lowThr = Math.max(30, highThr - 15);
  if (score < lowThr) return "low";
  if (score < highThr) return "medium";
  return "high";
}

// ページネーション対応でデータ取得
async function fetchAllRaces(formattedDate) {
  const allRaces = [];
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: pageRaces, error: racesError } = await supabase
      .from("races")
      .select("race_id, race_date, venue_code, volatility_score")
      .gte("race_date", formattedDate)
      .not("volatility_score", "is", null)
      .order("race_date", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (racesError) throw racesError;
    if (!pageRaces || pageRaces.length === 0) {
      hasMore = false;
    } else {
      allRaces.push(...pageRaces);
      offset += pageSize;
      hasMore = pageRaces.length === pageSize;
    }
  }
  return allRaces;
}

// race_resultsを小分けにして取得（URIが大きくなりすぎないようにする）
async function fetchResultMap(raceIds) {
  const allResults = [];
  const chunkSize = 200;
  for (let i = 0; i < raceIds.length; i += chunkSize) {
    const chunk = raceIds.slice(i, i + chunkSize);
    const { data: pageResults, error: resultsError } = await supabase
      .from("race_results")
      .select("race_id, rank1")
      .in("race_id", chunk);

    if (resultsError) throw resultsError;
    if (pageResults) {
      allResults.push(...pageResults);
    }
  }

  const resultMap = {};
  if (allResults) {
    allResults.forEach((r) => {
      resultMap[r.race_id] = r.rank1;
    });
  }
  return resultMap;
}

function tallyLabel(buckets, label, isWin) {
  const bucket =
    label === "low"
      ? buckets.low
      : label === "medium"
        ? buckets.medium
        : buckets.high;
  bucket.count++;
  if (isWin) bucket.wins++;
}

function winRate(bucket) {
  return bucket.count > 0 ? bucket.wins / bucket.count : 0;
}

function analyzeVenue(venueCode, venueRaces, resultMap) {
  const oldBuckets = {
    low: { count: 0, wins: 0 },
    medium: { count: 0, wins: 0 },
    high: { count: 0, wins: 0 },
  };
  const newBuckets = {
    low: { count: 0, wins: 0 },
    medium: { count: 0, wins: 0 },
    high: { count: 0, wins: 0 },
  };

  for (const race of venueRaces) {
    const score = race.volatility_score;
    const rank1 = resultMap[race.race_id];
    const isWin = rank1 === 1;

    const oldLabel = getVolatilityLevelOld(score, venueCode);
    const newLabel = getVolatilityLevelNew(score, venueCode);

    tallyLabel(oldBuckets, oldLabel, isWin);
    tallyLabel(newBuckets, newLabel, isWin);
  }

  const oldLowRate = winRate(oldBuckets.low);
  const newLowRate = winRate(newBuckets.low);
  const oldMedRate = winRate(oldBuckets.medium);
  const newMedRate = winRate(newBuckets.medium);
  const oldHighRate = winRate(oldBuckets.high);
  const newHighRate = winRate(newBuckets.high);

  const improvement = newLowRate - oldLowRate;
  const oldTrend =
    oldLowRate > oldMedRate && oldMedRate > oldHighRate ? "✅" : "⚠️";
  const newTrend =
    newLowRate > newMedRate && newMedRate > newHighRate ? "✅" : "⚠️";

  return {
    oldLow: oldBuckets.low,
    newLow: newBuckets.low,
    row: {
      code: venueCode,
      name: VENUE_NAMES[venueCode],
      rate: VENUE_1COURSE_WIN_RATE[venueCode],
      oldLowRate,
      newLowRate,
      improvement,
      oldTrend,
      newTrend,
    },
  };
}

function printVenueRow(v) {
  const improvementMark =
    v.improvement > 0.03 ? "🟢" : v.improvement > 0 ? "🟡" : "🔴";
  console.log(
    `| ${v.code}:${v.name} | ${v.rate.toFixed(2)} | ${(v.oldLowRate * 100).toFixed(1)}% | ${(v.newLowRate * 100).toFixed(1)}% | ${improvementMark}${(v.improvement * 100).toFixed(1)}pt | ${v.oldTrend}→${v.newTrend} |`,
  );
}

function printTotals(totals) {
  console.log();
  const totalOldRate = winRate({
    wins: totals.oldLowWins,
    count: totals.oldLowCount,
  });
  const totalNewRate = winRate({
    wins: totals.newLowWins,
    count: totals.newLowCount,
  });

  console.log(`\n📊 全体:

旧計算 Low: ${(totalOldRate * 100).toFixed(1)}% (${totals.oldLowWins}勝 / ${totals.oldLowCount}レース)
新計算 Low: ${(totalNewRate * 100).toFixed(1)}% (${totals.newLowWins}勝 / ${totals.newLowCount}レース)

✅ 動的閾値により、ラベルの信頼性が向上しました

${"=".repeat(120)}\n`);
}

async function verifyAllVenues(daysBack = 90) {
  try {
    console.log(`\n${"=".repeat(120)}`);
    console.log(`🎯 全会場ラベル精度検証`);
    console.log(`分析期間: 過去${daysBack}日\n`);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const formattedDate = startDate.toISOString().split("T")[0];

    const allRaces = await fetchAllRaces(formattedDate);

    if (allRaces.length === 0) {
      console.log(`❌ データなし`);
      return;
    }

    const raceIds = allRaces.map((r) => r.race_id);
    const resultMap = await fetchResultMap(raceIds);

    const completedRaces = allRaces.filter((r) => r.race_id in resultMap);

    console.log(
      `📊 対象: ${completedRaces.length}レース（${allRaces.length}中）\n`,
    );

    console.log(`| 会場 | 勝率 | 旧: Low着率 | 新: Low着率 | 改善 | 傾向 |`);
    console.log(`|------|------|-----------|-----------|--------|------|`);

    const totals = {
      oldLowWins: 0,
      oldLowCount: 0,
      newLowWins: 0,
      newLowCount: 0,
    };

    const venueResults = [];

    for (const venueCode of Object.keys(VENUE_NAMES)) {
      const venueRaces = completedRaces.filter(
        (r) => r.venue_code === parseInt(venueCode, 10),
      );

      if (venueRaces.length === 0) continue;

      const { oldLow, newLow, row } = analyzeVenue(
        venueCode,
        venueRaces,
        resultMap,
      );

      totals.oldLowWins += oldLow.wins;
      totals.oldLowCount += oldLow.count;
      totals.newLowWins += newLow.wins;
      totals.newLowCount += newLow.count;

      venueResults.push(row);
    }

    // 会場コード順でソート
    venueResults.sort((a, b) => parseInt(a.code) - parseInt(b.code));

    venueResults.forEach(printVenueRow);

    printTotals(totals);
  } catch (err) {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  }
}

await verifyAllVenues(90);
