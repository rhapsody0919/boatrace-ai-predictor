/**
 * コース別勝率単体での予想力検証
 *
 * 予測力分析（analyze-indicator-predictive-power.js）で11指標中最強と判明した
 * courseRate（進入コース別の勝率）だけを使って複勝予想をした場合の的中率・回収率を検証する。
 * unifiedModel.js の複合スコア（Zスコア合成、複勝的中率90.0%・回収率135.8%）との比較材料とし、
 * 「単一指標の強さ」と「複合スコアの価値」のどちらを訴求すべきか判断する材料にする。
 *
 * 使い方:
 *   node scripts/analysis/backtest-course-rate-only.js --from=2026-07-01 --to=2026-08-01
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
}

function newAcc() {
  return { bets: 0, hits: 0, payout: 0 };
}
function add(acc, hit, payout) {
  acc.bets += 1;
  if (hit) {
    acc.hits += 1;
    acc.payout += payout;
  }
}
function fmt(acc) {
  const invest = acc.bets * 100;
  const hitRate = acc.bets ? ((acc.hits / acc.bets) * 100).toFixed(1) : "-";
  const recovery = invest ? ((acc.payout / invest) * 100).toFixed(1) : "-";
  return `${String(acc.bets).padStart(5)}件 | 的中 ${hitRate.padStart(5)}% | 回収 ${recovery.padStart(6)}%`;
}

async function main() {
  const { from, to } = parseArgs();
  if (!supabase) {
    console.error("Supabase未設定");
    process.exit(1);
  }

  console.log("対象レース取得中...");
  // ⚠️ Supabaseのデフォルトlimitは1000行。.range()ページネーションが必須
  // （fetchAllヘルパーが内部で処理する）。2026-08-12にこの罠で複数の分析スクリプトが
  // 対象期間の一部しか見ていなかった不具合が発覚し、全て修正した
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, payout_place_1, payout_place_2, is_cancelled, is_no_race",
    (q) => {
      let query = q.not("rank1", "is", null).not("rank2", "is", null);
      if (from) query = query.gte("race_id", from);
      if (to) query = query.lte("race_id", to);
      return query;
    },
  );
  const validResults = results.filter((r) => !r.is_cancelled && !r.is_no_race);
  console.log(`  ${validResults.length}件\n`);

  const racerStatsCache = new Map();
  const placeAcc = newAcc();
  let noDataSkipped = 0;

  let processed = 0;
  for (const result of validResults) {
    const raceId = result.race_id;
    const { data: entries } = await supabase
      .from("race_entries")
      .select("boat_number, racer_id")
      .eq("race_id", raceId)
      .order("boat_number");
    if (!entries || entries.length < 6) continue;

    const racerIdsToFetch = entries
      .map((e) => e.racer_id)
      .filter((id) => id != null && !racerStatsCache.has(id));
    if (racerIdsToFetch.length > 0) {
      const { data: statsRows } = await supabase
        .from("racer_aggregated_stats")
        .select("racer_id, course_race_counts")
        .in("racer_id", racerIdsToFetch)
        .eq("venue_code", 0);
      for (const s of statsRows ?? []) racerStatsCache.set(s.racer_id, s);
    }

    const courseRates = entries.map((e) => {
      const stats = racerStatsCache.get(e.racer_id);
      const counts = stats?.course_race_counts?.[String(e.boat_number)];
      const rate = counts?.total
        ? ((counts.wins ?? 0) / counts.total) * 100
        : null;
      return { number: e.boat_number, rate };
    });

    const valid = courseRates.filter((c) => c.rate != null);
    if (valid.length < 2) {
      noDataSkipped += 1;
      continue;
    }
    const sorted = [...valid].sort((a, b) => b.rate - a.rate);
    const top2 = sorted.slice(0, 2).map((c) => c.number);

    const actualTop2 = [result.rank1, result.rank2];
    const hitBoat = top2.find((n) => actualTop2.includes(n));
    const hit = hitBoat != null;
    const payout = hit
      ? hitBoat === result.rank1
        ? result.payout_place_1 || 0
        : result.payout_place_2 || 0
      : 0;
    add(placeAcc, hit, payout);

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${validResults.length}件処理...`);
  }

  console.log(`\nデータ不足でスキップ: ${noDataSkipped}件`);
  console.log("\n=== 複勝（コース別勝率のみ、上位2艇） ===");
  console.log(fmt(placeAcc));
  console.log(
    "  ※比較: unifiedModel.js複合スコアは的中90.0%・回収135.8%（1週間分、2026-08-12検証）",
  );

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
