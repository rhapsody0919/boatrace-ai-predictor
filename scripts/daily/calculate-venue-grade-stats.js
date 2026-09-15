/**
 * calculate-venue-grade-stats.js - 会場×グレード×艇番の横断統計を集計する（BOA-263）
 *
 * 全24会場×全グレード（一般戦/G3/G2/G1/SG）の横断集計はrace_results全件（4万行超）の
 * スキャンが必要で、既存の選手単体スキャン（1選手あたり平均129走）の200〜330倍の規模に
 * なる。このリポジトリの既存規約（winning_technique_stats・accuracy_cache等）では
 * 「全会場横断」集計は必ず日次バッチで事前集計しキャッシュテーブルに保存する方式を
 * 取っているため、本スクリプトもその方式に倣う（venue_grade_boat_statsテーブル、
 * docs/db-migration/059_venue_grade_boat_stats.sql）。
 *
 * race_gradeは2025-12-03〜2026-02-03の約2ヶ月間NULLになっている欠損期間があるため
 * （2026-02-04以降はNULLゼロ、実データで確認済み）、その期間は集計対象から除外する。
 */
import { supabase } from "../lib/supabaseClient.js";
import { toTechniqueKey } from "../lib/winningTechniques.js";

// race_gradeが安定して記録されるようになった日付（それ以前はNULLの欠損期間）
const CLEAN_DATA_SINCE = "2026-02-04";
const GRADE_KEYS = ["SG", "G1", "G2", "G3", "ippan"];
const isDryRun = process.argv.includes("--dry-run");

// 注: scripts/lib/supabaseClient.jsに共有のfetchAll(table, select, buildQuery)が
// 既にあるが、そちらはページ取得エラー時に`console.error`してループをbreakし、
// 取得済み分だけで処理を続行する（エラーを握りつぶして部分データを返す）。本関数は
// 意図的にエラーをthrowして即座に失敗させる（getAllRacersLiteの2026-09-08の
// コードレビューで確立された「[]や部分データをエラー時に返すとwithCacheが正常値として
// キャッシュしてしまう」教訓に合わせるため）。共有ヘルパー側のエラー処理変更は
// 50箇所以上の既存呼び出し元に影響するため本チケットのスコープ外とし、ここでは
// 挙動が異なることを承知の上でローカル実装を保持する
async function fetchAll(query) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function getBucket(stats, venueCode, grade, boatNumber) {
  const key = `${venueCode}-${grade}-${boatNumber}`;
  if (!stats.has(key)) {
    stats.set(key, {
      venue_code: venueCode,
      race_grade: grade,
      boat_number: boatNumber,
      race_count: 0,
      wins: 0,
      top2: 0,
      top3: 0,
      technique: {},
      payout_count: 0,
      manshu_count: 0,
      payout_trio_sum: 0,
    });
  }
  return stats.get(key);
}

async function calculateVenueGradeStats() {
  console.log(
    `🔬 会場×グレード×艇番統計を集計中（${CLEAN_DATA_SINCE} 〜、race_gradeがNULLの欠損期間は除外）`,
  );

  const races = await fetchAll((from, to) =>
    supabase
      .from("races")
      .select(
        "venue_code, race_grade, race_results(rank1, rank2, rank3, winning_technique, payout_trio, is_cancelled, is_no_race)",
      )
      .gte("race_date", CLEAN_DATA_SINCE)
      .order("race_id")
      .range(from, to),
  );

  const stats = new Map();
  let skippedNoGrade = 0;
  let skippedUnusable = 0;

  races.forEach((r) => {
    const grade = r.race_grade;
    if (!grade || !GRADE_KEYS.includes(grade)) {
      skippedNoGrade++;
      return;
    }
    const result = Array.isArray(r.race_results)
      ? r.race_results[0]
      : r.race_results;
    if (
      !result ||
      result.is_cancelled ||
      result.is_no_race ||
      result.rank1 === null
    ) {
      skippedUnusable++;
      return;
    }

    const venueCode = r.venue_code;
    const { rank1, rank2, rank3, winning_technique, payout_trio } = result;
    // 決まり手の異常値（"逃げ抜き"等、6分類に含まれない値）はtoTechniqueKeyがnullを
    // 返すため自然に除外される（実データで1件確認済み、BOA-263調査時点）
    const techKey = toTechniqueKey(winning_technique);

    // 艇番別集計（1〜6）。全レースは6艇が出走する前提で、毎レース各艇番のrace_countに
    // +1する（RacerPerformanceStats.jsx等の既存のcourseRaceCounts集計と同じ考え方）
    for (let boat = 1; boat <= 6; boat++) {
      const b = getBucket(stats, venueCode, grade, boat);
      b.race_count += 1;
      if (rank1 === boat) {
        b.wins += 1;
        if (techKey) b.technique[techKey] = (b.technique[techKey] || 0) + 1;
      }
      if (rank1 === boat || rank2 === boat) b.top2 += 1;
      if (rank1 === boat || rank2 === boat || rank3 === boat) b.top3 += 1;
    }

    // レース全体集計（boat_number=0）: 決まり手構成比・万舟率・平均配当
    const wide = getBucket(stats, venueCode, grade, 0);
    wide.race_count += 1;
    if (techKey) wide.technique[techKey] = (wide.technique[techKey] || 0) + 1;
    // payout_trioが実際の3連単（DB列名の歴史的な逆転、payout_trifectaは実際の3連複）。
    // is_cancelled/is_no_raceでない有効なレースでもスクレイピング取得失敗等で
    // payout_trioがNULLになりうるため（scrape-results.js参照）、万舟率・平均配当の
    // 分母はrace_countではなく専用のpayout_countを使う（getTodaysVenueRankingの
    // payoutCountと同じ考え方）
    if (payout_trio !== null && payout_trio !== undefined) {
      wide.payout_count += 1;
      wide.payout_trio_sum += payout_trio;
      if (payout_trio >= 10000) wide.manshu_count += 1;
    }
  });

  console.log(
    `  対象レース: ${races.length}件（race_grade欠損によるスキップ: ${skippedNoGrade}件、中止/不成立等によるスキップ: ${skippedUnusable}件）`,
  );

  const rows = [...stats.values()].map((v) => ({
    venue_code: v.venue_code,
    race_grade: v.race_grade,
    boat_number: v.boat_number,
    race_count: v.race_count,
    wins: v.wins,
    top2: v.top2,
    top3: v.top3,
    technique_breakdown: v.technique,
    payout_count: v.payout_count,
    manshu_count: v.manshu_count,
    payout_trio_sum: v.payout_trio_sum,
    updated_at: new Date().toISOString(),
  }));

  console.log(`  集計セル数: ${rows.length}`);

  if (isDryRun) {
    console.log("🔍 --dry-run: DB書き込みはスキップします");
    // 鳴門（venue_code=14）の艇番別勝率をサンプル表示（ブラッシュアップ時の
    // モック値: 一般戦1号艇67.4%→G1 63.0%→SG 83.3%、3号艇は逆にG1で上昇、と
    // 比較する）
    const naruto = rows.filter(
      (r) => r.venue_code === 14 && r.boat_number <= 3,
    );
    console.log("鳴門（venue_code=14）の1〜3号艇サンプル:");
    naruto
      .sort(
        (a, b) =>
          a.boat_number - b.boat_number ||
          a.race_grade.localeCompare(b.race_grade),
      )
      .forEach((r) => {
        const winRate =
          r.race_count > 0 ? ((r.wins / r.race_count) * 100).toFixed(1) : "-";
        const top2Rate =
          r.race_count > 0 ? ((r.top2 / r.race_count) * 100).toFixed(1) : "-";
        console.log(
          `  ${r.boat_number}号艇 ${r.race_grade}: n=${r.race_count} 勝率=${winRate}% 連対率=${top2Rate}%`,
        );
      });
    return;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("venue_grade_boat_stats")
      .upsert(batch, { onConflict: "venue_code,race_grade,boat_number" });
    if (error) {
      console.error(
        `❌ venue_grade_boat_stats更新エラー（${i}件目〜）:`,
        error.message,
      );
    }
  }

  console.log("✅ venue_grade_boat_stats集計完了");
}

calculateVenueGradeStats().catch((e) => {
  console.error(e);
  process.exit(1);
});
