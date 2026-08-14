/**
 * データ出走表11指標の着順予測力分析（AI予想モデル大規模改修 Task8）
 *
 * unifiedModel.js の WEIGHTS 定数は「既存3モデルの係数感覚を参考にした暫定値」で、
 * 一度も実データで検証されていなかった。softmax温度の再キャリブレーション後もバックテストの
 * 回収率が改善しなかったため、AIスコアの中身（11指標の重み付けバランス）自体を疑い、
 * 各指標が実際にどれだけ着順予測に寄与するかを個別に検証する。
 *
 * 手法（analyze-upset-factors.jsの因子分析アプローチを踏襲）:
 * - 1着艇を除いた残り5艇について、各指標でレース内順位（1〜5位）をつける
 * - 実際に2着になった艇がその指標で何位だったかを集計する
 * - ランダムなら各順位は1/5=20%均等。1位（最高値）に有意に偏っていれば予測力が高い
 *
 * 使い方:
 *   node scripts/analysis/analyze-indicator-predictive-power.js --from=2026-06-01 --to=2026-08-01
 */

import { supabase, fetchAll } from "../lib/supabaseClient.js";
import { fetchRaceIndicatorData } from "../lib/raceIndicatorData.js";

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
}

// 指標定義: key, ラベル, 値の高い方が良いか(higherIsBetter)
const INDICATORS = [
  { key: "winRate", label: "全国勝率", higherIsBetter: true },
  { key: "localWinRate", label: "当地勝率", higherIsBetter: true },
  { key: "motor", label: "モーター2連率", higherIsBetter: true },
  { key: "form", label: "調子delta", higherIsBetter: true },
  { key: "avgSt", label: "平均ST", higherIsBetter: false },
  { key: "stDeviation", label: "STのブレ", higherIsBetter: false },
  { key: "exhibitionSt", label: "展示ST", higherIsBetter: false },
  { key: "exhibitionTime", label: "展示タイム", higherIsBetter: false },
  { key: "courseRate", label: "コース別勝率", higherIsBetter: true },
  { key: "returnRate", label: "回収率", higherIsBetter: true },
];

function byBoat(rows, boatKey = "boat_number") {
  const map = new Map();
  (rows ?? []).forEach((row) => map.set(row[boatKey], row));
  return map;
}

/** 残り5艇について指標値を取得する。値が無い艇はnull */
function extractIndicatorValues(key, remainingPlayers, ctx) {
  return remainingPlayers.map((p) => {
    let value = null;
    switch (key) {
      case "winRate":
        value = parseFloat(p.winRate);
        break;
      case "localWinRate":
        value = parseFloat(p.localWinRate);
        break;
      case "motor":
        value = parseFloat(p.motor2Rate);
        break;
      case "form":
        value = ctx.racerFormByBoat.get(p.number)?.delta ?? null;
        break;
      case "avgSt":
        value = ctx.racerStatsMap.get(p.racerId)?.avg_st ?? null;
        break;
      case "stDeviation": {
        const row = ctx.stPredictabilityByBoat.get(p.number);
        value = row?.sample_count > 0 ? row.avg_deviation : null;
        break;
      }
      case "exhibitionSt":
        value = ctx.stPredictabilityByBoat.get(p.number)?.exhibition_st ?? null;
        break;
      case "exhibitionTime": {
        const row = ctx.exhibitionByBoat.get(p.number);
        value = row?.exhibition_time ?? row?.avg_exhibition_time ?? null;
        break;
      }
      case "courseRate": {
        const stats = ctx.racerStatsMap.get(p.racerId);
        const course = p.course ?? p.number;
        const counts = stats?.course_race_counts?.[String(course)];
        value = counts?.total
          ? ((counts.wins ?? 0) / counts.total) * 100
          : null;
        break;
      }
      case "returnRate": {
        const row = ctx.returnRateByBoat.get(p.number);
        value = row?.sample_count > 0 ? row.win_return_rate : null;
        break;
      }
      default:
        value = null;
    }
    return { number: p.number, value: Number.isFinite(value) ? value : null };
  });
}

/** レース内順位を算出（1位が最良）。同値は同順位扱いしない簡易版 */
function rankValues(values, higherIsBetter) {
  const valid = values.filter((v) => v.value !== null);
  const sorted = [...valid].sort((a, b) =>
    higherIsBetter ? b.value - a.value : a.value - b.value,
  );
  const rankMap = new Map(sorted.map((v, i) => [v.number, i + 1]));
  return rankMap; // number -> rank(1-5)、値なしはmapに含まれない
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
    "race_id, rank1, rank2, is_cancelled, is_no_race",
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
  // key -> rank(1-5) -> count
  const rankCounts = Object.fromEntries(
    INDICATORS.map((ind) => [
      ind.key,
      { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 },
    ]),
  );

  let processed = 0;
  for (const result of validResults) {
    const raceId = result.race_id;
    const { data: entries } = await supabase
      .from("race_entries")
      .select("boat_number, racer_id, win_rate, local_win_rate, motor_2rate")
      .eq("race_id", raceId)
      .order("boat_number");
    if (!entries || entries.length < 6) continue;

    const racerIdsToFetch = entries
      .map((e) => e.racer_id)
      .filter((id) => id != null && !racerStatsCache.has(id));
    if (racerIdsToFetch.length > 0) {
      const { data: statsRows } = await supabase
        .from("racer_aggregated_stats")
        .select("racer_id, avg_st, course_race_counts")
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
    }));

    const remaining = players.filter((p) => p.number !== result.rank1);
    if (remaining.length !== 5) continue;

    const indicatorData = await fetchRaceIndicatorData(
      raceId,
      entries.map((e) => ({ boatNumber: e.boat_number, racerId: e.racer_id })),
    );
    const ctx = {
      racerFormByBoat: byBoat(indicatorData?.racerForm, "boatNumber"),
      stPredictabilityByBoat: byBoat(indicatorData?.stPredictability),
      exhibitionByBoat: byBoat(indicatorData?.exhibitionTrend),
      returnRateByBoat: byBoat(indicatorData?.returnRate),
      racerStatsMap: racerStatsCache,
    };

    for (const ind of INDICATORS) {
      const values = extractIndicatorValues(ind.key, remaining, ctx);
      const rankMap = rankValues(values, ind.higherIsBetter);
      const rank = rankMap.get(result.rank2);
      if (rank == null) continue; // 2着艇の値が欠損 or ランク付け対象外
      rankCounts[ind.key][rank] += 1;
      rankCounts[ind.key].total += 1;
    }

    processed += 1;
    if (processed % 100 === 0)
      console.log(`  ${processed}/${validResults.length}件処理...`);
  }

  console.log("\n=== 指標別 予測力（2着艇のレース内順位分布） ===");
  console.log(
    "ランダムなら各順位20%均等。1位（最良値）への偏りが大きいほど予測力が高い\n",
  );
  for (const ind of INDICATORS) {
    const c = rankCounts[ind.key];
    if (c.total === 0) {
      console.log(`${ind.label.padEnd(12)}: データなし`);
      continue;
    }
    const pct = (r) => ((c[r] / c.total) * 100).toFixed(1);
    const top2 = (((c[1] + c[2]) / c.total) * 100).toFixed(1);
    console.log(
      `${ind.label.padEnd(12)}: N=${String(c.total).padStart(4)}  1位=${pct(1).padStart(5)}% 2位=${pct(2).padStart(5)}% 3位=${pct(3).padStart(5)}% 4位=${pct(4).padStart(5)}% 5位=${pct(5).padStart(5)}%  [上位2位計=${top2}%]`,
    );
  }

  console.log("\n完了");
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
