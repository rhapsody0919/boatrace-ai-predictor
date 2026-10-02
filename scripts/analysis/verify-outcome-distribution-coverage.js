/**
 * 出目分布の初期価値評価
 *
 * 直近のレース結果が、outcome_distribution の TopN パターンに
 * どれくらい含まれているかを集計する。
 *
 * 使い方:
 *   node scripts/analysis/verify-outcome-distribution-coverage.js [日数]
 *
 *   引数なし → 直近 5 日間
 */
import { supabase, fetchAll, VENUE_NAMES } from "../lib/supabaseClient.js";

const DAYS = parseInt(process.argv[2] || "5", 10);
const TOPN_LIST = [3, 5, 10, 20];

function getDateNDaysAgoJST(n) {
  const now = new Date();
  const target = new Date(
    now.getTime() - n * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
  return target.toISOString().split("T")[0];
}

async function fetchOutcomeDistribution() {
  const rows = await fetchAll(
    "outcome_distribution",
    "venue_code, first_boat, second_boat, third_boat, count_90days, probability, avg_payout",
    (q) =>
      q
        .order("venue_code")
        .order("first_boat")
        .order("count_90days", { ascending: false }),
  );
  const map = {};
  for (const r of rows) {
    const key = r.venue_code;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }
  return map;
}

async function fetchRecentResults(fromDate) {
  const rows = await fetchAll(
    "race_results",
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    "race_id, rank1, rank2, rank3, payout_trio",
    (q) =>
      q
        .eq("is_cancelled", false)
        .eq("is_no_race", false)
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null)
        .gte("race_id", fromDate),
  );
  return rows;
}

function getVenueCodeFromRaceId(raceId) {
  const parts = raceId.split("-");
  return parseInt(parts[3], 10);
}

async function main() {
  const fromDate = getDateNDaysAgoJST(DAYS);
  console.log("=== Outcome Distribution カバレッジ検証 ===");
  console.log(`対象期間: ${fromDate} 以降 (直近 ${DAYS} 日)`);

  const distMap = await fetchOutcomeDistribution();
  console.log(
    `outcome_distribution: ${Object.keys(distMap).length} 会場分ロード`,
  );

  const results = await fetchRecentResults(fromDate);
  console.log(`検証対象レース結果: ${results.length} 件\n`);

  if (results.length === 0) {
    console.log("対象データなし");
    return;
  }

  const overall = {};
  TOPN_LIST.forEach((n) => {
    overall[n] = { hit: 0, totalPayout: 0, sumProb: 0 };
  });
  let evaluated = 0;
  const perVenue = {};

  for (const r of results) {
    const venueCode = getVenueCodeFromRaceId(r.race_id);
    const allPatterns = distMap[venueCode];
    if (!allPatterns) continue;

    const firstBoat = r.rank1;
    const patternsForFirst = allPatterns
      .filter((p) => p.first_boat === firstBoat)
      .sort((a, b) => b.count_90days - a.count_90days);

    if (patternsForFirst.length === 0) continue;
    evaluated++;

    if (!perVenue[venueCode]) {
      perVenue[venueCode] = {};
      TOPN_LIST.forEach((n) => {
        perVenue[venueCode][n] = { hit: 0, totalPayout: 0, total: 0 };
      });
    }

    for (const n of TOPN_LIST) {
      const top = patternsForFirst.slice(0, n);
      const hit = top.some(
        (p) => p.second_boat === r.rank2 && p.third_boat === r.rank3,
      );
      const sumProb = top.reduce((s, p) => s + Number(p.probability || 0), 0);
      overall[n].sumProb += sumProb;
      perVenue[venueCode][n].total += 1;
      if (hit) {
        overall[n].hit += 1;
        overall[n].totalPayout += r.payout_trio || 0;
        perVenue[venueCode][n].hit += 1;
        perVenue[venueCode][n].totalPayout += r.payout_trio || 0;
      }
    }
  }

  console.log(`評価対象: ${evaluated} 件\n`);
  console.log("--- 全体（1着コース別 TopN パターンへの的中率） ---");
  console.log(
    "TopN\t的中数\t的中率\t平均TopN出現率合計\t平均回収率(100円賭け×N点)",
  );
  for (const n of TOPN_LIST) {
    const o = overall[n];
    const hitRate = ((o.hit / evaluated) * 100).toFixed(2);
    const avgSumProb = (o.sumProb / evaluated).toFixed(2);
    // 100円 × n点購入の場合の回収率
    const recovery = ((o.totalPayout / (evaluated * n * 100)) * 100).toFixed(2);
    console.log(
      `Top${n}\t${o.hit}\t${hitRate}%\t${avgSumProb}%\t\t${recovery}%`,
    );
  }

  console.log("\n--- 会場別 Top10 的中率 ---");
  const venues = Object.keys(perVenue)
    .map((v) => parseInt(v))
    .sort((a, b) => a - b);
  for (const v of venues) {
    const s = perVenue[v][10];
    if (s.total === 0) continue;
    const rate = ((s.hit / s.total) * 100).toFixed(2);
    const recovery =
      s.hit > 0
        ? ((s.totalPayout / (s.total * 10 * 100)) * 100).toFixed(2)
        : "0.00";
    console.log(
      `${String(v).padStart(2, "0")} ${VENUE_NAMES[v]}\t件数=${s.total}\t的中=${s.hit}(${rate}%)\t回収率=${recovery}%`,
    );
  }
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
