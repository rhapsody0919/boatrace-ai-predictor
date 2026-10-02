/**
 * 2着・3着の統計分布を算出するスクリプト
 *
 * race_results から (winning_technique, winner_course) ごとに
 * 2着・3着のコース分布を算出し、placementDistribution.js に
 * ハードコードするための定数を出力する。
 *
 * Usage: node scripts/analysis/calculate-placement-distribution.js
 */

import { fetchAll, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { TECHNIQUES } from "../lib/winningTechniques.js";

// 日本語 → 英語キー変換
function toTechniqueKey(jpTechnique) {
  return TECHNIQUES[jpTechnique] || null;
}

// course_1..course_6 からボート番号がどのコースにいるか特定
function findCourse(result, boatNumber) {
  for (let c = 1; c <= 6; c++) {
    if (result[`course_${c}`] === boatNumber) return c;
  }
  return null;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase が未設定です");
    process.exit(1);
  }

  console.log("race_results から2着・3着の統計分布を算出中...\n");

  // 全件取得（1000件ずつページネーション）
  const allResults = await fetchAll(
    "race_results",
    "rank1, rank2, rank3, winning_technique, course_1, course_2, course_3, course_4, course_5, course_6",
    (q) =>
      q
        .not("winning_technique", "is", null)
        .not("rank1", "is", null)
        .not("rank2", "is", null)
        .not("rank3", "is", null)
        .not("course_1", "is", null)
        .order("race_id"),
  );

  console.log(`\n合計 ${allResults.length} 件のレース結果を取得\n`);

  // 集計用マップ: key → { second: {course: count}, third: {course: count}, total: number }
  const stats = {};
  let skipped = 0;

  for (const result of allResults) {
    const techKey = toTechniqueKey(result.winning_technique);
    if (!techKey) {
      skipped++;
      continue;
    }

    const winnerCourse = findCourse(result, result.rank1);
    const secondCourse = findCourse(result, result.rank2);
    const thirdCourse = findCourse(result, result.rank3);

    if (!winnerCourse || !secondCourse || !thirdCourse) {
      skipped++;
      continue;
    }

    const key = `${techKey}_${winnerCourse}`;

    if (!stats[key]) {
      stats[key] = {
        second: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        third: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        total: 0,
      };
    }

    stats[key].second[secondCourse]++;
    stats[key].third[thirdCourse]++;
    stats[key].total++;
  }

  if (skipped > 0) {
    console.log(`${skipped} 件スキップ（技法不明 or コース特定不能）\n`);
  }

  // 正規化して確率分布に変換
  const distribution = {};

  for (const [key, data] of Object.entries(stats)) {
    const secondDist = {};
    const thirdDist = {};

    for (let c = 1; c <= 6; c++) {
      secondDist[c] = Math.round((data.second[c] / data.total) * 1000) / 1000;
      thirdDist[c] = Math.round((data.third[c] / data.total) * 1000) / 1000;
    }

    distribution[key] = {
      second: secondDist,
      third: thirdDist,
      sampleSize: data.total,
    };
  }

  // ソートして表示
  const sortedKeys = Object.keys(distribution).sort((a, b) => {
    const [tA, cA] = a.split("_");
    const [tB, cB] = b.split("_");
    if (cA !== cB) return Number(cA) - Number(cB);
    return tA.localeCompare(tB);
  });

  console.log("=== 2着・3着コース分布 ===\n");

  for (const key of sortedKeys) {
    const d = distribution[key];
    const confidence =
      d.sampleSize >= 100 ? "HIGH" : d.sampleSize >= 30 ? "MED" : "LOW";
    console.log(`${key} (n=${d.sampleSize}, confidence=${confidence})`);
    console.log(
      `  2着: ${Object.entries(d.second)
        .map(([c, p]) => `${c}コース=${(p * 100).toFixed(1)}%`)
        .join(", ")}`,
    );
    console.log(
      `  3着: ${Object.entries(d.third)
        .map(([c, p]) => `${c}コース=${(p * 100).toFixed(1)}%`)
        .join(", ")}`,
    );
    console.log();
  }

  // placementDistribution.js 用の出力
  console.log("\n=== placementDistribution.js 用コード ===\n");
  console.log("export const PLACEMENT_DISTRIBUTION = {");
  for (const key of sortedKeys) {
    const d = distribution[key];
    console.log(`  "${key}": {`);
    console.log(
      `    second: { ${Object.entries(d.second)
        .map(([c, p]) => `${c}: ${p}`)
        .join(", ")} },`,
    );
    console.log(
      `    third:  { ${Object.entries(d.third)
        .map(([c, p]) => `${c}: ${p}`)
        .join(", ")} },`,
    );
    console.log(`    sampleSize: ${d.sampleSize},`);
    console.log(`  },`);
  }
  console.log("};");

  // グローバル平均（フォールバック用）
  console.log("\n// フォールバック用グローバル平均");
  const globalSecond = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const globalThird = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let globalTotal = 0;

  for (const data of Object.values(stats)) {
    for (let c = 1; c <= 6; c++) {
      globalSecond[c] += data.second[c];
      globalThird[c] += data.third[c];
    }
    globalTotal += data.total;
  }

  console.log("export const GLOBAL_PLACEMENT_AVERAGE = {");
  console.log(
    `  second: { ${Object.entries(globalSecond)
      .map(([c, n]) => `${c}: ${Math.round((n / globalTotal) * 1000) / 1000}`)
      .join(", ")} },`,
  );
  console.log(
    `  third:  { ${Object.entries(globalThird)
      .map(([c, n]) => `${c}: ${Math.round((n / globalTotal) * 1000) / 1000}`)
      .join(", ")} },`,
  );
  console.log(`  sampleSize: ${globalTotal},`);
  console.log("};");
}

main().catch(console.error);
