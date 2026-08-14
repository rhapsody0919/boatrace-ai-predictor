// race_outcome_frequencies 更新スクリプト（AI予想モデル大規模改修 Task2, ADR0010）
// 過去180日の race_results を会場×1着艇×2着艇×3着艇の組み合わせ別に集計し、
// 出現率・回収率を race_outcome_frequencies へupsertする。
// 新モデル（unified）の複数買い目候補（FR5）における「類似条件過去実績」の算出元。

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { getTrioKey, calculateRecoveryRate } from "../lib/payoutCalculator.js";

const WINDOW_DAYS = 180;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 500; // races への .in() クエリのチャンクサイズ

async function fetchRecentResults(cutoffDate) {
  let allResults = [];
  let from = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from("race_results")
      .select(
        "race_id, rank1, rank2, rank3, payout_trio, is_cancelled, is_no_race",
      )
      .gte("result_at", cutoffDate)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!page || page.length === 0) break;
    allResults = allResults.concat(page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allResults.filter(
    (r) => !r.is_cancelled && !r.is_no_race && r.rank1 && r.rank2 && r.rank3,
  );
}

async function fetchVenueCodeMap(raceIds) {
  const map = {};
  for (let i = 0; i < raceIds.length; i += CHUNK_SIZE) {
    const chunk = raceIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("races")
      .select("race_id, venue_code")
      .in("race_id", chunk);
    if (error) throw error;
    for (const r of data || []) {
      map[r.race_id] = r.venue_code;
    }
  }
  return map;
}

function aggregate(results, venueCodeMap) {
  // key: `${venueCode}|${trioKey}` -> { venueCode, rank1, rank2, rank3, count, totalPayout }
  const comboMap = new Map();
  // venueCode -> レース数（sample_races、出現率の分母）
  const venueRaceCount = new Map();

  for (const r of results) {
    const venueCode = venueCodeMap[r.race_id];
    if (venueCode == null) continue;

    venueRaceCount.set(venueCode, (venueRaceCount.get(venueCode) || 0) + 1);

    const trioKey = getTrioKey(r.rank1, r.rank2, r.rank3);
    const mapKey = `${venueCode}|${trioKey}`;
    const existing = comboMap.get(mapKey) || {
      venueCode,
      rank1: r.rank1,
      rank2: r.rank2,
      rank3: r.rank3,
      count: 0,
      totalPayout: 0,
    };
    existing.count += 1;
    existing.totalPayout += r.payout_trio || 0;
    comboMap.set(mapKey, existing);
  }

  const rows = [];
  for (const combo of comboMap.values()) {
    const sampleRaces = venueRaceCount.get(combo.venueCode) || 0;
    const appearanceRate = sampleRaces > 0 ? combo.count / sampleRaces : null;
    const avgPayout =
      combo.count > 0 ? Math.round(combo.totalPayout / combo.count) : null;
    const recoveryRate = calculateRecoveryRate(combo.count, combo.totalPayout);

    rows.push({
      venue_code: combo.venueCode,
      rank1_boat: combo.rank1,
      rank2_boat: combo.rank2,
      rank3_boat: combo.rank3,
      window_days: WINDOW_DAYS,
      total_occurrences: combo.count,
      sample_races: sampleRaces,
      appearance_rate: appearanceRate,
      avg_payout: avgPayout,
      recovery_rate: recoveryRate,
      updated_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const chunk = rows.slice(i, i + PAGE_SIZE);
    const { error } = await supabase
      .from("race_outcome_frequencies")
      .upsert(chunk, {
        onConflict: "venue_code,rank1_boat,rank2_boat,rank3_boat,window_days",
      });
    if (error) throw error;
  }
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error(
      "Supabase が設定されていません（環境変数を確認してください）",
    );
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  console.log(
    `過去${WINDOW_DAYS}日（${cutoffIso}以降）のレース結果を取得中...`,
  );
  const results = await fetchRecentResults(cutoffIso);
  console.log(`  ${results.length}件のレース結果を取得`);

  const raceIds = [...new Set(results.map((r) => r.race_id))];
  console.log(`会場コードをマッピング中（${raceIds.length}レース）...`);
  const venueCodeMap = await fetchVenueCodeMap(raceIds);

  console.log("会場×着順パターンで集計中...");
  const rows = aggregate(results, venueCodeMap);
  console.log(`  ${rows.length}件の組み合わせを算出`);

  console.log("race_outcome_frequencies へupsert中...");
  await upsertRows(rows);
  console.log("✅ 完了");
}

main().catch((error) => {
  console.error("❌ エラーが発生しました:", error);
  process.exit(1);
});
