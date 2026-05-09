/**
 * イン崩れ指数閾値の妥当性分析
 * スコア範囲（30-70）と会場別閾値（45-75）の矛盾を診断
 *
 * 実行: node scripts/analysis/analyze-volatility-thresholds.js [VENUE_CODE] [DAYS]
 * 例:   node scripts/analysis/analyze-volatility-thresholds.js 05 7
 */
import { supabase } from "../lib/supabaseClient.js";
import {
  VENUE_VOLATILITY_THRESHOLD,
  VENUE_VOLATILITY_THRESHOLD_DEFAULT,
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

async function analyzeVenueThresholds(venueCode, daysBack = 7) {
  try {
    // 指定会場のスコア分布を取得
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const formattedDate = startDate.toISOString().split("T")[0];

    const { data: races, error } = await supabase
      .from("races")
      .select("venue_code, volatility_score, volatility_level")
      .eq("venue_code", parseInt(venueCode, 10))
      .gte("race_date", formattedDate)
      .order("race_date", { ascending: false });

    if (error) throw error;

    if (!races || races.length === 0) {
      console.log(`❌ ${VENUE_NAMES[venueCode]} (${venueCode}): データなし`);
      return;
    }

    // 統計計算
    const scores = races.map((r) => r.volatility_score);
    const levels = races.map((r) => r.volatility_level);

    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
    const range = max - min;

    const levelCounts = { low: 0, medium: 0, high: 0 };
    levels.forEach((level) => levelCounts[level]++);

    const totalRaces = races.length;
    const lowPct = ((levelCounts.low / totalRaces) * 100).toFixed(1);
    const mediumPct = ((levelCounts.medium / totalRaces) * 100).toFixed(1);
    const highPct = ((levelCounts.high / totalRaces) * 100).toFixed(1);

    // 閾値情報
    const highThr =
      VENUE_VOLATILITY_THRESHOLD[venueCode] ??
      VENUE_VOLATILITY_THRESHOLD_DEFAULT;
    const lowThr = Math.max(30, highThr - 15);
    const maxPossibleScore = 70; // スコア計算の上限

    // 問題診断
    const problemSeverity = analyzeProblem(
      min,
      max,
      lowThr,
      highThr,
      maxPossibleScore,
    );

    // 結果表示
    console.log(`\n${"=".repeat(70)}`);
    console.log(
      `📊 ${VENUE_NAMES[venueCode]} (${venueCode}) — ${daysBack}日間の分析`,
    );
    console.log(`${"=".repeat(70)}`);
    console.log(`\n📈 スコア分布:`);
    console.log(`  最小: ${min}, 最大: ${max}, 平均: ${avg}, 幅: ${range}`);
    console.log(`\n🏷️  分類結果:`);
    console.log(`  Low  (堅い):     ${levelCounts.low}件 (${lowPct}%)`);
    console.log(`  Medium (標準):   ${levelCounts.medium}件 (${mediumPct}%)`);
    console.log(`  High (崩れやすい): ${levelCounts.high}件 (${highPct}%)`);
    console.log(`\n⚙️  閾値設定:`);
    console.log(`  High 閾値: ${highThr}`);
    console.log(`  Low 上限:  ${lowThr} (= max(30, ${highThr} - 15))`);
    console.log(`  スコア上限: ${maxPossibleScore} (計算式の制約)`);
    console.log(`\n⚠️  診断結果:`);
    console.log(problemSeverity.message);

    return {
      venueCode,
      venueName: VENUE_NAMES[venueCode],
      stats: { min, max, avg: parseFloat(avg), range, totalRaces },
      distribution: {
        low: levelCounts.low,
        medium: levelCounts.medium,
        high: levelCounts.high,
      },
      thresholds: { highThr, lowThr, maxPossibleScore },
      problem: problemSeverity,
    };
  } catch (err) {
    console.error(`❌ エラー: ${err.message}`);
    process.exit(1);
  }
}

function analyzeProblem(min, max, lowThr, highThr, maxPossibleScore) {
  const issues = [];

  // 1. スコア上限がhigh閾値を下回る
  if (maxPossibleScore < highThr) {
    issues.push(
      `🔴 高: スコア上限 ${maxPossibleScore} が high閾値 ${highThr} に到達不可`,
    );
  }

  // 2. すべてのスコアがlow閾値未満
  if (max < lowThr) {
    issues.push(
      `🔴 重大: すべてのスコア (${min}-${max}) が low閾値 ${lowThr} 未満 → 常に 'low' 分類`,
    );
  }

  // 3. low上限とhigh閾値のマージンが小さい
  const margin = highThr - lowThr;
  if (margin < 10) {
    issues.push(
      `🟡 中: Medium領域が狭い (${margin}pt) → 一部スコアしか 'medium' にならない`,
    );
  }

  // 4. 観測スコア幅が狭い（設計値30-70に対して実測が限定的）
  const scoreSpread = max - min;
  if (scoreSpread < 10) {
    issues.push(
      `🟡 中: スコア分布が狭い (${scoreSpread}pt) → 閾値調整の余地大`,
    );
  }

  return {
    severity: issues.length > 0 ? "HIGH" : "OK",
    message:
      issues.length > 0
        ? issues.join("\n  ")
        : "✅ 正常: 閾値とスコア分布に矛盾なし",
  };
}

async function analyzeAllVenues(daysBack = 7) {
  console.log(`\n🌍 全24会場の閾値妥当性を一括分析（${daysBack}日間）\n`);

  const results = [];
  for (const code of Object.keys(VENUE_NAMES).sort()) {
    const result = await analyzeVenueThresholds(code, daysBack);
    if (result) results.push(result);
  }

  // サマリー表示
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📋 分析サマリー (${daysBack}日間)`);
  console.log(`${"=".repeat(70)}\n`);

  const problematic = results.filter((r) => r.problem.severity === "HIGH");
  console.log(`⚠️  問題のある会場: ${problematic.length}/${results.length}\n`);

  problematic.forEach((r) => {
    console.log(`  • ${r.venueName} (${r.venueCode})`);
    console.log(
      `    スコア: ${r.stats.min}-${r.stats.max}, 閾値: ${r.thresholds.lowThr}/${r.thresholds.highThr}`,
    );
    console.log(`    ${r.problem.message.split("\n")[0]}`);
  });

  return results;
}

// メイン実行
const args = process.argv.slice(2);
const venueCode = args[0];
const daysBack = parseInt(args[1], 10) || 7;

if (venueCode) {
  // 単一会場分析
  await analyzeVenueThresholds(venueCode.padStart(2, "0"), daysBack);
} else {
  // 全会場分析
  await analyzeAllVenues(daysBack);
}
