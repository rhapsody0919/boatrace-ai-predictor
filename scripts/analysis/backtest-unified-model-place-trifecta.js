/**
 * 新AI予想モデル「unified」の複勝・3連複バックテスト
 *
 * race_odds.trifecta_all は3連単オッズのみのため、複勝・3連複は事前オッズが無くEVベースの
 * 選別はできない。代わりに「AIスコア順位（boatScores、6艇全体でZスコア化）をそのまま
 * 予想に使った場合」の的中率・回収率を検証する。結果確定後の配当は race_results から取得できる。
 *
 * ⚠️ DB列名の罠: race_results.payout_trifecta は実態3連複、payout_trio は実態3連単
 *   （scripts/lib/payoutCalculator.js参照）。本スクリプトが検証する3連複は payout_trifecta を使う。
 *
 * 予想方法:
 * - 複勝候補: AIスコア上位2艇のうち、どちらかが1着or2着に入れば的中
 * - 3連複候補: AIスコア上位3艇（順不同）が実際の上位3着と一致すれば的中
 *
 * 使い方:
 *   node scripts/analysis/backtest-unified-model-place-trifecta.js --from=2026-07-01 --to=2026-08-01
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { predictFirstMark } from "../lib/turnPrediction.js";
import { calculateUnifiedScores } from "../lib/unifiedModel.js";
import { fetchRaceIndicatorData } from "../lib/raceIndicatorData.js";
import { getTrifectaKey } from "../lib/payoutCalculator.js";

const BET_YEN = 100;

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
  const invest = acc.bets * BET_YEN;
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
  // ⚠️ Supabaseのデフォルトlimitは1000行。fetchAllで.range()ページネーションする
  const results = await fetchAll(
    "race_results",
    "race_id, rank1, rank2, rank3, payout_place_1, payout_place_2, payout_trifecta, is_cancelled, is_no_race",
    (q) => {
      let query = q
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null);
      if (from) query = query.gte("race_id", from);
      if (to) query = query.lte("race_id", to);
      return query;
    },
  );
  const validResults = results.filter((r) => !r.is_cancelled && !r.is_no_race);
  console.log(`  ${validResults.length}件\n`);

  const racerStatsCache = new Map();
  const placeAcc = newAcc();
  const trifectaAcc = newAcc();

  let processed = 0;
  for (const result of validResults) {
    const raceId = result.race_id;
    const { data: entries } = await supabase
      .from("race_entries")
      .select(
        "boat_number, racer_id, win_rate, local_win_rate, motor_2rate, grade",
      )
      .eq("race_id", raceId)
      .order("boat_number");
    if (!entries || entries.length < 6) continue;

    const { data: raceRow } = await supabase
      .from("races")
      .select("venue_code")
      .eq("race_id", raceId)
      .single();
    if (!raceRow) continue;

    const { data: conditions } = await supabase
      .from("race_conditions")
      .select("wind_speed, wave_height")
      .eq("race_id", raceId)
      .maybeSingle();

    const racerIdsToFetch = entries
      .map((e) => e.racer_id)
      .filter((id) => id != null && !racerStatsCache.has(id));
    if (racerIdsToFetch.length > 0) {
      const { data: statsRows } = await supabase
        .from("racer_aggregated_stats")
        .select(
          "racer_id, avg_st, st_stddev, attack_distribution, defense_distribution, course_race_counts",
        )
        .in("racer_id", racerIdsToFetch)
        .eq("venue_code", 0);
      for (const s of statsRows ?? []) racerStatsCache.set(s.racer_id, s);
    }

    const players = entries.map((e) => ({
      number: e.boat_number,
      course: e.boat_number,
      racerId: e.racer_id,
      winRate: e.win_rate,
      localWinRate: e.local_win_rate,
      motor2Rate: e.motor_2rate,
      grade: e.grade,
    }));

    const turnPredictionPlayers = entries.map((e) => {
      const stats = racerStatsCache.get(e.racer_id);
      return {
        boatNumber: e.boat_number,
        course: e.boat_number,
        avgST: stats?.avg_st ?? null,
        stStddev: stats?.st_stddev ?? null,
        attackDistribution: stats?.attack_distribution || null,
        defenseDistribution: stats?.defense_distribution || null,
        courseRaceCounts: stats?.course_race_counts || null,
        motor2Rate: e.motor_2rate,
        grade: e.grade,
        globalWinRate: e.win_rate,
        localWinRate: e.local_win_rate,
      };
    });

    const turnPrediction = predictFirstMark(turnPredictionPlayers, {
      venueCode: raceRow.venue_code,
      windSpeed: conditions?.wind_speed ?? null,
      waveHeight: conditions?.wave_height ?? null,
    });

    const indicatorData = await fetchRaceIndicatorData(
      raceId,
      entries.map((e) => ({ boatNumber: e.boat_number, racerId: e.racer_id })),
    );
    const { boatScores } = calculateUnifiedScores(
      players,
      turnPrediction,
      indicatorData,
      racerStatsCache,
    );

    const sorted = [...boatScores].sort((a, b) => b.score - a.score);
    const top2 = sorted.slice(0, 2).map((s) => s.number);
    const top3 = sorted.slice(0, 3).map((s) => s.number);

    // 複勝: 上位2艇のうちどちらかが1着or2着なら的中。配当は的中艇の枠に対応するpayout_placeを使う
    const actualTop2 = [result.rank1, result.rank2];
    const placeHitBoat = top2.find((n) => actualTop2.includes(n));
    const placeHit = placeHitBoat != null;
    const placePayout = placeHit
      ? placeHitBoat === result.rank1
        ? result.payout_place_1 || 0
        : result.payout_place_2 || 0
      : 0;
    add(placeAcc, placeHit, placePayout);

    // 3連複: 上位3艇（順不同）が実際の上位3着と一致すれば的中
    const predictedTrifectaKey = getTrifectaKey(top3[0], top3[1], top3[2]);
    const actualTrifectaKey = getTrifectaKey(
      result.rank1,
      result.rank2,
      result.rank3,
    );
    const trifectaHit = predictedTrifectaKey === actualTrifectaKey;
    add(
      trifectaAcc,
      trifectaHit,
      trifectaHit ? result.payout_trifecta || 0 : 0,
    );

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${validResults.length}件処理...`);
  }

  console.log("\n=== 複勝（AIスコア上位2艇） ===");
  console.log(fmt(placeAcc));
  console.log("\n=== 3連複（AIスコア上位3艇、順不同） ===");
  console.log(fmt(trifectaAcc));

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
