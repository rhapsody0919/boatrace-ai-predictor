/**
 * 展開予測（turnPrediction.js v6, Phase1/2改善後）の決定精度検証
 *
 * data/analysis/turn-prediction-venue-analysis.json（2026-05-17時点、Phase1/2改善前）と
 * 同じ手法（methodology: "UI表示順の上位3技術のいずれかが実績1着コースと一致すれば的中"）で、
 * Task3/4のPhase1/2改善（逃げ確率キャリブレーション・会場グループ別パラメータ）を反映した
 * 最新ロジックの精度を検証する。predictionsテーブルの過去データは旧ロジックのままのため
 * （コード変更は新規生成分にしか反映されない）、on-the-flyで predictFirstMark を再計算する。
 *
 * 使い方:
 *   node scripts/analysis/verify-turn-prediction-accuracy-v6.js --from=2026-06-01 --to=2026-08-01
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { predictFirstMark } from "../lib/turnPrediction.js";

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

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
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
    "race_id, rank1, is_cancelled, is_no_race",
    (q) => {
      let query = q.not("rank1", "is", null);
      if (from) query = query.gte("race_id", from);
      if (to) query = query.lte("race_id", to);
      return query;
    },
  );
  const validResults = results.filter((r) => !r.is_cancelled && !r.is_no_race);
  console.log(`  ${validResults.length}件\n`);

  const racerStatsCache = new Map();
  const overall = { total: 0, hits: 0 };
  const byVenue = new Map();

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

    const top3Courses = (turnPrediction.patterns ?? []).map(
      (p) => p.winnerCourse,
    );
    const hit = top3Courses.includes(result.rank1);

    overall.total += 1;
    if (hit) overall.hits += 1;

    if (!byVenue.has(raceRow.venue_code))
      byVenue.set(raceRow.venue_code, { total: 0, hits: 0 });
    const v = byVenue.get(raceRow.venue_code);
    v.total += 1;
    if (hit) v.hits += 1;

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${validResults.length}件処理...`);
  }

  console.log("\n=== 全体（Phase1/2改善後） ===");
  console.log(
    `的中率: ${((overall.hits / overall.total) * 100).toFixed(1)}% (${overall.hits}/${overall.total})`,
  );
  console.log(
    "  ※旧ロジック(Phase1/2改善前)の全国平均は72.5%（2026-05-17分析、1000レース）",
  );

  console.log("\n=== 会場別（Phase1/2改善後） ===");
  for (const [venue, v] of [...byVenue.entries()].sort((a, b) => a[0] - b[0])) {
    const rate = (v.hits / v.total) * 100;
    console.log(
      `${String(venue).padStart(2, "0")} ${(VENUE_NAMES[venue] || "").padEnd(6)}: ${rate.toFixed(1)}% (${v.hits}/${v.total})`,
    );
  }

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
