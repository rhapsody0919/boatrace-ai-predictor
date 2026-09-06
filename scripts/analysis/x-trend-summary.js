/**
 * X集客の複数時点トレンド判定
 *
 * /x-growth-report は長らく「前回レポートとの2点比較」に留まっており、
 * 「前回だけたまたま悪かった/良かった」のか「継続して悪化/改善している」のかを
 * 区別できなかった（2026-09-06、ユーザー指摘を受けた改善の一つ）。
 * data/analysis/x-growth・x-referral の直近5件を並べてトレンド判定する。
 *
 * 使い方:
 *   node scripts/analysis/x-trend-summary.js
 */
import { findRecentReports, detectTrend } from "../lib/reportComparison.js";

const RECENT_N = 5;

function printTrend(label, reports, picker) {
  // reportsとインデックスを対応させたまま保持し、表示用ラベルがズレないようにする
  // （2026-09-06、filterで欠損値を先に取り除いた結果、日付ラベルと値の対応が
  // ズレていたバグを発見・修正した実例）
  const rawSeries = reports.map((r) => picker(r.data));
  const numericSeries = rawSeries.filter((v) => typeof v === "number");
  const trend = detectTrend(numericSeries);
  const labeled = reports
    .map((r, i) => `${r.date}: ${rawSeries[i] ?? "N/A"}`)
    .join(" → ");

  console.log(`\n## ${label}`);
  console.log(`  ${labeled}`);
  if (trend.direction === "insufficient-data") {
    console.log(
      `  判定: データ不足（3時点以上必要、現在${numericSeries.length}時点）`,
    );
  } else if (trend.direction === "flat") {
    console.log(`  判定: 横ばい`);
  } else {
    const jp = trend.direction === "improving" ? "改善" : "悪化";
    console.log(`  判定: ${jp}が${trend.consecutiveMoves}回連続`);
  }
}

function main() {
  console.log(
    `\n📈 X集客トレンド判定（直近${RECENT_N}レポート、data/analysis/x-growth・x-referral）`,
  );
  console.log("=".repeat(50));

  const today = new Date().toISOString().slice(0, 10);
  const xGrowthReports = findRecentReports(
    "data/analysis/x-growth",
    today,
    RECENT_N,
  );
  const xReferralReports = findRecentReports(
    "data/analysis/x-referral",
    today,
    RECENT_N,
  );

  if (xGrowthReports.length === 0) {
    console.log(
      "\nx-growthレポートが見つかりません。先に/x-growth-reportのステップ1を実施してください。",
    );
  } else {
    printTrend("フォロワー数", xGrowthReports, (d) => d.followerCount);
    // 過去レポートでフィールド名がtotalPostsCounter表記だった時期があるため両対応
    // （2026-09-06、実際にこの表記ゆれでN/Aになる不具合を発見）
    printTrend(
      "投稿総数",
      xGrowthReports,
      (d) => d.totalPosts ?? d.totalPostsCounter,
    );
  }

  if (xReferralReports.length === 0) {
    console.log(
      "\nx-referralレポートが見つかりません。node scripts/analysis/x-referral-report.jsを先に実行してください。",
    );
  } else {
    printTrend(
      "X経由サイトセッション数",
      xReferralReports,
      (d) => d.totals?.sessions,
    );
  }

  console.log(
    "\n※ 3時点未満のためデータ不足と出た指標は、断定的な傾向判断を避けること（母数警告と同じ考え方）",
  );
}

main();
