/**
 * イン崩れ指数（volatilityFactors.js）の予測力検証
 *
 * ADR0012で「会場内パーセンタイル」に変更したイン崩れ複合スコアが、実際に
 * 「1号艇が1着を逃す（イン崩れ発生）」確率とどれだけ相関するかを検証する。
 * 相関が強ければ「イン崩れを言い当てる」ことをboatAIの強みとして訴求できる。
 *
 * 手法:
 * - 各レースで calculateVolatilityComposite() を算出し、同会場・同期間内での
 *   パーセンタイル（toVolatilityPercentile）に変換する
 * - パーセンタイル帯（10%刻み）別に「実際に1号艇が1着を逃した率」を集計する
 * - パーセンタイルが高い（イン崩れしやすいと予測）帯ほど実際のイン崩れ率が高ければ、
 *   指数は機能している
 *
 * 使い方:
 *   node scripts/analysis/verify-volatility-predictive-power.js --from=2026-07-01 --to=2026-08-01
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { predictFirstMark } from "../lib/turnPrediction.js";
import {
  calculateVolatilityComposite,
  toVolatilityPercentile,
} from "../lib/volatilityFactors.js";

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
}

function bucketOf(percentile) {
  const idx = Math.min(9, Math.floor(percentile * 10));
  return `${idx * 10}-${idx * 10 + 10}%`;
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
  const computations = [];
  const compositeByVenue = new Map();

  let processed = 0;
  for (const result of validResults) {
    const raceId = result.race_id;
    const { data: entries } = await supabase
      .from("race_entries")
      .select("boat_number, racer_id, win_rate")
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
        globalWinRate: e.win_rate,
      };
    });

    const turnPrediction = predictFirstMark(turnPredictionPlayers, {
      venueCode: raceRow.venue_code,
      windSpeed: conditions?.wind_speed ?? null,
      waveHeight: conditions?.wave_height ?? null,
    });

    const volatility = calculateVolatilityComposite(
      entries.map((e) => ({ number: e.boat_number, winRate: e.win_rate })),
      raceRow.venue_code,
      turnPrediction,
      entries.map((e) => ({
        boatNumber: e.boat_number,
        avgST: racerStatsCache.get(e.racer_id)?.avg_st ?? null,
      })),
    );

    if (!compositeByVenue.has(raceRow.venue_code))
      compositeByVenue.set(raceRow.venue_code, []);
    compositeByVenue.get(raceRow.venue_code).push(volatility.composite);

    computations.push({
      venueCode: raceRow.venue_code,
      composite: volatility.composite,
      inKuzure: result.rank1 !== 1, // 1号艇が1着を逃した=イン崩れ
    });

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${validResults.length}件処理...`);
  }

  console.log("\n=== イン崩れ指数 パーセンタイル帯別 実際のイン崩れ率 ===");
  console.log(
    "ランダムなら各帯で全体平均と同水準。パーセンタイルが高いほどイン崩れ率も高ければ機能している\n",
  );

  const overallRate =
    (computations.filter((c) => c.inKuzure).length / computations.length) * 100;
  console.log(
    `全体イン崩れ率（1号艇が1着を逃す率）: ${overallRate.toFixed(1)}%\n`,
  );

  const buckets = new Map();
  for (const c of computations) {
    const venueDist = compositeByVenue.get(c.venueCode) || [];
    const percentile = toVolatilityPercentile(c.composite, venueDist);
    const b = bucketOf(percentile);
    if (!buckets.has(b)) buckets.set(b, { total: 0, inKuzure: 0 });
    const acc = buckets.get(b);
    acc.total += 1;
    if (c.inKuzure) acc.inKuzure += 1;
  }

  const sortedKeys = [...buckets.keys()].sort(
    (a, b) => parseInt(a) - parseInt(b),
  );
  for (const key of sortedKeys) {
    const v = buckets.get(key);
    const rate = (v.inKuzure / v.total) * 100;
    console.log(
      `${key.padEnd(8)} N=${String(v.total).padStart(5)}  イン崩れ率=${rate.toFixed(1)}%`,
    );
  }

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
