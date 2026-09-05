/**
 * X（Twitter）経由のサイト流入レポート
 *
 * docs/operation/x-operations-playbook.md の位置づけ定義:
 * 「Xそのものでの大規模なフォロワー獲得を主目的にせず、ブログ・SEO・ブランド認知の
 * 補完チャネルと位置づける。KPIは『Xがどれだけ伸びたか』よりも『ブログ・サイトへの
 * 送客・ブランド想起にどれだけ寄与したか』を優先する」
 *
 * にもかかわらず、/x-growth-report はX側の指標（インプレッション・いいね等）しか見ておらず、
 * 本来のKPIであるサイト送客への貢献度を一度も計測していなかった（2026-09-05発覚）。
 * GA4 Data API から X 経由（t.co / x.com / twitter.com）のセッション・ランディングページを
 * 集計し、この欠落を埋める。
 *
 * 使い方:
 *   node scripts/analysis/x-referral-report.js [--days=30]
 *
 * 必要な設定は scripts/analysis/i18n-demand-report.js と共通（GA4_PROPERTY_ID等）。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import {
  findPreviousReport,
  perDay,
  formatDelta,
} from "../lib/reportComparison.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const DAYS = parseInt(
  (process.argv.find((a) => a.startsWith("--days=")) || "--days=30").split(
    "=",
  )[1],
  10,
);
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;

if (!PROPERTY_ID) {
  console.error(
    `❌ GA4_PROPERTY_ID が設定されていません。詳細: docs/operation/i18n-demand-report.md`,
  );
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/analytics.readonly",
]);
const analyticsdata = google.analyticsdata({ version: "v1beta", auth });
const property = `properties/${PROPERTY_ID}`;
const dateRanges = [{ startDate: `${DAYS}daysAgo`, endDate: "today" }];

// X（Twitter）由来と判定するsessionSourceの値。
// t.co = Xのリンク短縮ドメイン（本文中のリンククリック経由の主要な流入元）
// x.com / twitter.com = リファラーがそのまま渡るケース（アプリ内ブラウザ等）
const X_SOURCE_VALUES = ["t.co", "x.com", "twitter.com"];

async function runReport(request) {
  const res = await analyticsdata.properties.runReport({
    property,
    requestBody: { dateRanges, ...request },
  });
  return res.data.rows || [];
}

function isXSource(sourceValue) {
  // 完全一致で判定する（部分文字列一致だと "chatgpt.com" が "t.co" を、
  // "copilot.com" が "t.com" 経由で誤ヒットする。GA4のsessionSourceは
  // ドメイン名そのものが値になるため、完全一致で十分かつ安全）
  return X_SOURCE_VALUES.includes(sourceValue.toLowerCase());
}

// 1. Organic Social全体の推移（Xだけに絞る前の母数、チャネル全体感を見るため）
async function reportOrganicSocialTotal() {
  const rows = await runReport({
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "conversions" },
    ],
  });
  const row = rows.find((r) => r.dimensionValues[0].value === "Organic Social");
  if (!row) return { sessions: 0, activeUsers: 0, conversions: 0 };
  return {
    sessions: parseInt(row.metricValues[0].value, 10),
    activeUsers: parseInt(row.metricValues[1].value, 10),
    conversions: parseFloat(row.metricValues[2].value),
  };
}

// 2. sessionSource別の内訳からX由来のみ抽出
async function reportXReferral() {
  const rows = await runReport({
    dimensions: [{ name: "sessionSource" }],
    metrics: [
      { name: "sessions" },
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "conversions" },
    ],
  });

  const xRows = rows.filter((r) => isXSource(r.dimensionValues[0].value));
  const bySource = xRows.map((r) => ({
    source: r.dimensionValues[0].value,
    sessions: parseInt(r.metricValues[0].value, 10),
    activeUsers: parseInt(r.metricValues[1].value, 10),
    newUsers: parseInt(r.metricValues[2].value, 10),
    conversions: parseFloat(r.metricValues[3].value),
  }));

  const totals = bySource.reduce(
    (acc, r) => ({
      sessions: acc.sessions + r.sessions,
      activeUsers: acc.activeUsers + r.activeUsers,
      newUsers: acc.newUsers + r.newUsers,
      conversions: acc.conversions + r.conversions,
    }),
    { sessions: 0, activeUsers: 0, newUsers: 0, conversions: 0 },
  );

  return { bySource, totals };
}

// 3. X経由セッションのランディングページ内訳（どの記事・投稿が送客に効いているか）
async function reportXLandingPages() {
  const rows = await runReport({
    dimensions: [
      { name: "sessionSource" },
      { name: "landingPagePlusQueryString" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
    ],
    limit: 100,
  });

  const xRows = rows.filter((r) => isXSource(r.dimensionValues[0].value));
  return xRows
    .map((r) => ({
      source: r.dimensionValues[0].value,
      landingPage: r.dimensionValues[1].value,
      sessions: parseInt(r.metricValues[0].value, 10),
      engagementRate: parseFloat(r.metricValues[1].value),
      avgSessionDuration: parseFloat(r.metricValues[2].value),
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20);
}

// 4. 日別推移（Xの投稿活動と時系列で突き合わせるため）
async function reportXDailyTrend() {
  const rows = await runReport({
    dimensions: [{ name: "date" }, { name: "sessionSource" }],
    metrics: [{ name: "sessions" }],
  });

  const xRows = rows.filter((r) => isXSource(r.dimensionValues[1].value));
  const byDate = {};
  xRows.forEach((r) => {
    const date = r.dimensionValues[0].value;
    const sessions = parseInt(r.metricValues[0].value, 10);
    byDate[date] = (byDate[date] || 0) + sessions;
  });

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sessions]) => ({ date, sessions }));
}

async function main() {
  console.log(`\n📊 X経由サイト流入レポート（直近${DAYS}日間）`);
  console.log("=".repeat(50));

  const [organicSocialTotal, xReferral, landingPages, dailyTrend] =
    await Promise.all([
      reportOrganicSocialTotal(),
      reportXReferral(),
      reportXLandingPages(),
      reportXDailyTrend(),
    ]);

  console.log("\n## Organic Social 全体（参考、Xに絞る前の母数）");
  console.log(
    `  セッション: ${organicSocialTotal.sessions} ユーザー: ${organicSocialTotal.activeUsers} コンバージョン: ${organicSocialTotal.conversions.toFixed(1)}`,
  );

  console.log(
    "\n## X経由セッション（sessionSource: t.co / x.com / twitter.com）",
  );
  if (xReferral.totals.sessions === 0) {
    console.log("  0件。X経由の計測可能なサイト流入は確認できませんでした。");
    console.log(
      "  ※ t.coリンクのクリックはGA4で計測されるはずだが、ゼロの場合は次を疑う: (1)そもそもリンク付き投稿が少ない, (2)UTMやリファラーが欠落するアプリ内ブラウザ経由が大半, (3)GA4のセッション定義（同一ユーザーの30分ルール）による過小計上",
    );
  } else {
    console.log(
      `  合計セッション: ${xReferral.totals.sessions} 新規ユーザー: ${xReferral.totals.newUsers} コンバージョン: ${xReferral.totals.conversions.toFixed(1)}`,
    );
    xReferral.bySource.forEach((r) => {
      console.log(
        `    ${r.source}: セッション${r.sessions} / 新規${r.newUsers} / CV${r.conversions.toFixed(1)}`,
      );
    });
  }

  console.log("\n## X経由の着地ページ（上位、送客に効いている記事・機能）");
  if (landingPages.length === 0) {
    console.log("  データなし");
  } else {
    landingPages.forEach((p) => {
      console.log(
        `  ${p.landingPage.padEnd(50)} セッション:${p.sessions} 滞在:${p.avgSessionDuration.toFixed(0)}s (${p.source})`,
      );
    });
  }

  console.log("\n## 日別推移（直近14日、Xの投稿活動と突き合わせて解釈する）");
  dailyTrend.slice(-14).forEach((d) => {
    console.log(`  ${d.date}: ${d.sessions}`);
  });

  // 前回レポートとの比較
  const today = new Date().toISOString().slice(0, 10);
  const prev = findPreviousReport("data/analysis/x-referral", today);
  let comparison = null;
  if (prev) {
    const prevPerDay = perDay(
      prev.data.totals?.sessions ?? 0,
      prev.data.days ?? DAYS,
    );
    const currentPerDay = perDay(xReferral.totals.sessions, DAYS);
    comparison = {
      previousReportDate: prev.date,
      previousSessionsPerDay: parseFloat(prevPerDay.toFixed(2)),
      currentSessionsPerDay: parseFloat(currentPerDay.toFixed(2)),
      delta: formatDelta(currentPerDay - prevPerDay, 2),
    };
    console.log(
      `\n## 前回レポート（${prev.date}）との比較\n  セッション/日: ${currentPerDay.toFixed(2)} (前回 ${prevPerDay.toFixed(2)}、${comparison.delta})`,
    );
  } else {
    console.log("\n## 前回レポートなし（初回実行）");
  }

  const outDir = "data/analysis/x-referral";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `report-${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        days: DAYS,
        organicSocialTotal,
        totals: xReferral.totals,
        bySource: xReferral.bySource,
        topLandingPages: landingPages,
        dailyTrend,
        comparison,
      },
      null,
      2,
    ),
  );
  console.log(`\n💾 保存: ${path.resolve(outPath)}`);
}

main().catch((err) => {
  console.error("❌ エラー:", err.message);
  process.exit(1);
});
