/**
 * 展開予測キャリブレーション分析レポート
 *
 * 決まり手予測の確率精度を厳密に評価する。
 * - 多クラスブライアスコア（週次推移）
 * - 確率帯別キャリブレーション（全決まり手統合 + 個別）
 * - 逃げ予測の週次キャリブレーション推移
 *
 * 使い方:
 *   node scripts/analysis/calibration-report.js
 *   node scripts/analysis/calibration-report.js --weeks=8
 *   node scripts/analysis/calibration-report.js --from=2026-03-01 --to=2026-04-01
 */

import {
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";

// 決まり手マッピング（予測側の英語 → 実績側の日本語）
const TECHNIQUE_MAP = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  makurizashi: "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
};
const TECHNIQUE_MAP_REV = Object.fromEntries(
  Object.entries(TECHNIQUE_MAP).map(([k, v]) => [v, k]),
);
const TECHNIQUES = Object.keys(TECHNIQUE_MAP);

// CLI引数パース
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { weeks: null, from: null, to: null, model: "safeBet" };
  for (const arg of args) {
    if (arg.startsWith("--weeks=")) opts.weeks = parseInt(arg.split("=")[1]);
    if (arg.startsWith("--from=")) opts.from = arg.split("=")[1];
    if (arg.startsWith("--to=")) opts.to = arg.split("=")[1];
    if (arg.startsWith("--model=")) opts.model = arg.split("=")[1];
  }
  return opts;
}

// ISO 8601 週番号を取得
function getISOWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  // 木曜日を基準に週の年を決定（ISO 8601）
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// 線形回帰
function linearRegression(x, y) {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const ssRes = y.reduce(
    (a, yi, i) => a + (yi - (slope * x[i] + intercept)) ** 2,
    0,
  );
  const ssTot = y.reduce((a, yi) => a + (yi - sumY / n) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const opts = parseArgs();

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     展開予測キャリブレーション分析レポート              ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // --- データ取得 ---
  console.log("データ取得中...");

  const predictions = await fetchAll(
    "predictions",
    "race_id, feature_contributions",
    (q) =>
      q.eq("model_id", opts.model).not("feature_contributions", "is", null),
  );

  const results = await fetchAll(
    "race_results",
    "race_id, winning_technique, rank1",
    (q) => q.not("winning_technique", "is", null),
  );

  const resultMap = new Map();
  for (const r of results) resultMap.set(r.race_id, r);

  // --- 突き合わせ ---
  const matched = [];
  let noDistribution = 0;
  let noResult = 0;
  let unmappedTechnique = 0;

  for (const p of predictions) {
    const tp = p.feature_contributions?.turnPrediction;
    if (!tp?.distribution) {
      noDistribution++;
      continue;
    }
    const result = resultMap.get(p.race_id);
    if (!result?.winning_technique) {
      noResult++;
      continue;
    }
    const actualTechKey = TECHNIQUE_MAP_REV[result.winning_technique];
    if (!actualTechKey) {
      unmappedTechnique++;
      continue;
    }

    const date = p.race_id.substring(0, 10);

    // 期間フィルタ
    if (opts.from && date < opts.from) continue;
    if (opts.to && date > opts.to) continue;

    matched.push({
      raceId: p.race_id,
      date,
      week: getISOWeek(date),
      distribution: tp.distribution,
      actualTech: actualTechKey,
    });
  }

  // 週数フィルタ
  if (opts.weeks) {
    const allWeeks = [...new Set(matched.map((m) => m.week))].sort();
    const recentWeeks = new Set(allWeeks.slice(-opts.weeks));
    const before = matched.length;
    matched.splice(
      0,
      matched.length,
      ...matched.filter((m) => recentWeeks.has(m.week)),
    );
    console.log(
      `最新${opts.weeks}週に絞り込み: ${before} → ${matched.length}件`,
    );
  }

  const dateRange =
    matched.length > 0
      ? `${matched[0].date} ~ ${matched[matched.length - 1].date}`
      : "N/A";

  console.log(`\nモデル: ${opts.model}`);
  console.log(`期間: ${dateRange}`);
  console.log(`分析対象: ${matched.length}レース`);
  console.log(
    `(distribution無し: ${noDistribution}, 結果無し: ${noResult}, 未対応決まり手: ${unmappedTechnique})\n`,
  );

  if (matched.length === 0) {
    console.log("分析対象データがありません。");
    return;
  }

  // ============================
  // 1. 多クラスブライアスコア（週次）
  // ============================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("1. 多クラスブライアスコア（週次推移）");
  console.log("   ※ 低いほど確率予測が正確。完璧=0、ランダム≈0.83");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const weeklyData = {};
  for (const m of matched) {
    if (!weeklyData[m.week]) weeklyData[m.week] = [];
    weeklyData[m.week].push(m);
  }

  const weekKeys = Object.keys(weeklyData).sort();
  const weeklyScores = [];

  for (const wk of weekKeys) {
    const races = weeklyData[wk];
    let brierSum = 0;
    for (const race of races) {
      for (const tech of TECHNIQUES) {
        const predicted = race.distribution[tech] || 0;
        const actual = race.actualTech === tech ? 1 : 0;
        brierSum += (predicted - actual) ** 2;
      }
    }
    const brier = brierSum / races.length;
    weeklyScores.push({ week: wk, n: races.length, brier });
  }

  for (const s of weeklyScores) {
    const bar = "█".repeat(Math.round(s.brier * 40));
    console.log(
      `  ${s.week}  N=${String(s.n).padStart(5)}  ${s.brier.toFixed(4)}  ${bar}`,
    );
  }

  if (weeklyScores.length >= 3) {
    const x = weeklyScores.map((_, i) => i);
    const y = weeklyScores.map((s) => s.brier);
    const reg = linearRegression(x, y);
    const pctChange =
      ((weeklyScores[weeklyScores.length - 1].brier - weeklyScores[0].brier) /
        weeklyScores[0].brier) *
      100;
    console.log(
      `\n  傾き: ${reg.slope.toFixed(6)} (${reg.slope < 0 ? "改善傾向" : "悪化傾向"})  R²=${reg.r2.toFixed(3)}`,
    );
    console.log(
      `  初週→最終週: ${weeklyScores[0].brier.toFixed(4)} → ${weeklyScores[weeklyScores.length - 1].brier.toFixed(4)} (${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%)`,
    );
  }

  // ============================
  // 2. 確率帯別キャリブレーション
  // ============================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("2. 確率帯別キャリブレーション（全決まり手統合）");
  console.log("   ※ 予測確率X%のとき実際にX%的中していれば完璧");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const bins = {};
  for (const race of matched) {
    for (const tech of TECHNIQUES) {
      const predicted = race.distribution[tech] || 0;
      const actual = race.actualTech === tech ? 1 : 0;
      const binKey = Math.floor(predicted / 0.1) * 0.1;
      const label = `${(binKey * 100).toFixed(0)}-${((binKey + 0.1) * 100).toFixed(0)}%`;
      if (!bins[label])
        bins[label] = { sum: 0, count: 0, predSum: 0, order: binKey };
      bins[label].sum += actual;
      bins[label].count += 1;
      bins[label].predSum += predicted;
    }
  }

  console.log("  確率帯        N    平均予測  実現率    乖離     判定");
  console.log("  ──────────  ──────  ──────  ──────  ──────  ────────");
  for (const [label, data] of Object.entries(bins).sort(
    (a, b) => a[1].order - b[1].order,
  )) {
    const avgPred = ((data.predSum / data.count) * 100).toFixed(1);
    const actualRate = ((data.sum / data.count) * 100).toFixed(1);
    const gap = Math.abs(avgPred - actualRate).toFixed(1);
    const judge = gap < 3 ? "✅ 良好" : gap < 7 ? "⚠️  許容" : "❌ 要改善";
    console.log(
      `  ${label.padEnd(10)} ${String(data.count).padStart(7)}  ${avgPred.padStart(6)}%  ${actualRate.padStart(6)}%  ${gap.padStart(5)}pt  ${judge}`,
    );
  }

  // ============================
  // 3. 決まり手ごとのキャリブレーション
  // ============================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("3. 決まり手ごとのキャリブレーション（N≥30のみ）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const tech of TECHNIQUES) {
    const techBins = {};
    for (const race of matched) {
      const predicted = race.distribution[tech] || 0;
      const actual = race.actualTech === tech ? 1 : 0;
      const step = predicted < 0.2 ? 0.05 : 0.1;
      const binKey = Math.floor(predicted / step) * step;
      const label = `${(binKey * 100).toFixed(0)}-${((binKey + step) * 100).toFixed(0)}%`;
      if (!techBins[label])
        techBins[label] = { sum: 0, count: 0, predSum: 0, order: binKey };
      techBins[label].sum += actual;
      techBins[label].count += 1;
      techBins[label].predSum += predicted;
    }

    const significant = Object.entries(techBins)
      .filter(([_, d]) => d.count >= 30)
      .sort((a, b) => a[1].order - b[1].order);
    if (significant.length === 0) continue;

    console.log(`  【${TECHNIQUE_MAP[tech]}（${tech}）】`);
    console.log("  確率帯        N    平均予測  実現率    乖離");
    for (const [label, data] of significant) {
      const avgPred = ((data.predSum / data.count) * 100).toFixed(1);
      const actualRate = ((data.sum / data.count) * 100).toFixed(1);
      const gap = Math.abs(avgPred - actualRate).toFixed(1);
      console.log(
        `  ${label.padEnd(10)} ${String(data.count).padStart(7)}  ${avgPred.padStart(6)}%  ${actualRate.padStart(6)}%  ${gap.padStart(5)}pt`,
      );
    }
    console.log("");
  }

  // ============================
  // 4. 逃げ予測の週次キャリブレーション推移
  // ============================
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("4. 逃げ予測: 週次キャリブレーション推移");
  console.log("   ※ 各確率帯で (予測確率−実現率) を表示。0に近いほど良い");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const bands = ["0-40%", "40-55%", "55-70%", "70-100%"];
  const bandRanges = [
    [0, 0.4],
    [0.4, 0.55],
    [0.55, 0.7],
    [0.7, 1.01],
  ];
  const weekTechBins = {};

  for (const race of matched) {
    const predicted = race.distribution.nige || 0;
    const actual = race.actualTech === "nige" ? 1 : 0;
    const bandIdx = bandRanges.findIndex(
      ([lo, hi]) => predicted >= lo && predicted < hi,
    );
    const band = bands[bandIdx] || "70-100%";
    const key = `${race.week}|${band}`;
    if (!weekTechBins[key])
      weekTechBins[key] = { sum: 0, count: 0, predSum: 0 };
    weekTechBins[key].sum += actual;
    weekTechBins[key].count += 1;
    weekTechBins[key].predSum += predicted;
  }

  console.log("  週          " + bands.map((b) => b.padStart(12)).join(""));
  for (const wk of weekKeys) {
    let line = `  ${wk}  `;
    for (const band of bands) {
      const d = weekTechBins[`${wk}|${band}`];
      if (!d || d.count < 20) {
        line += "   (N<20)   ";
      } else {
        const avgPred = (d.predSum / d.count) * 100;
        const actualRate = (d.sum / d.count) * 100;
        const gap = (avgPred - actualRate).toFixed(1);
        line += `${gap > 0 ? "+" : ""}${gap}pt(${d.count})`.padStart(12);
      }
    }
    console.log(line);
  }
  console.log("  正=過信, 負=過小評価");

  // ============================
  // 5. サマリー
  // ============================
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("5. サマリー");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 全体ブライアスコア
  let totalBrier = 0;
  for (const race of matched) {
    for (const tech of TECHNIQUES) {
      const predicted = race.distribution[tech] || 0;
      const actual = race.actualTech === tech ? 1 : 0;
      totalBrier += (predicted - actual) ** 2;
    }
  }
  totalBrier /= matched.length;
  console.log(`  全体ブライアスコア: ${totalBrier.toFixed(4)}`);

  // 信頼できる確率帯
  const reliableBins = Object.entries(bins)
    .filter(([_, d]) => d.count >= 50)
    .filter(([_, d]) => {
      const avgPred = (d.predSum / d.count) * 100;
      const actualRate = (d.sum / d.count) * 100;
      return Math.abs(avgPred - actualRate) < 5;
    })
    .map(([label]) => label);

  const unreliableBins = Object.entries(bins)
    .filter(([_, d]) => d.count >= 50)
    .filter(([_, d]) => {
      const avgPred = (d.predSum / d.count) * 100;
      const actualRate = (d.sum / d.count) * 100;
      return Math.abs(avgPred - actualRate) >= 10;
    })
    .map(([label]) => label);

  console.log(
    `  信頼できる確率帯 (乖離<5pt): ${reliableBins.join(", ") || "なし"}`,
  );
  console.log(
    `  要改善の確率帯 (乖離≥10pt): ${unreliableBins.join(", ") || "なし"}`,
  );

  if (weeklyScores.length >= 3) {
    const x = weeklyScores.map((_, i) => i);
    const y = weeklyScores.map((s) => s.brier);
    const reg = linearRegression(x, y);
    console.log(
      `  精度トレンド: ${reg.slope < 0 ? "改善傾向" : "横ばい〜悪化"} (傾き: ${reg.slope.toFixed(6)}, R²=${reg.r2.toFixed(3)})`,
    );
  }

  console.log("\n  買い方提案への活用:");
  if (reliableBins.length > 0) {
    console.log(`    ✅ ${reliableBins.join(", ")} の確率はそのまま信頼できる`);
  }
  if (unreliableBins.length > 0) {
    console.log(`    ⚠️  ${unreliableBins.join(", ")} は補正が必要`);
  }

  console.log("\n完了");
}

main().catch((e) => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
