/**
 * 月次PV推移レポート
 *
 * 「直近2-3ヶ月でPVが頭打ちになっている」という懸念を検証するため、GA4 Data API から
 * 月別PV・セッション数と、集客チャネル別（Organic Search / Direct / Referral等）の
 * 月次推移を取得する。
 *
 * 使い方:
 *   node scripts/analysis/monthly-pv-trend-report.js [--months=6]
 *
 * 必要な設定は i18n-demand-report.js と共通（.env.local の GA4_PROPERTY_ID、
 * credentials/google-service-account.json）。
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const MONTHS = parseInt(
  (process.argv.find((a) => a.startsWith("--months=")) || "--months=6").split(
    "=",
  )[1],
  10,
);
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;

if (!PROPERTY_ID) {
  console.error("❌ GA4_PROPERTY_ID が設定されていません（.env.local）。");
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/analytics.readonly",
]);
const analyticsData = google.analyticsdata({ version: "v1beta", auth });

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d.toISOString().split("T")[0];
}

async function main() {
  const startDate = monthsAgo(MONTHS);

  // 月別 PV・セッション数
  const byMonth = await analyticsData.properties.runReport({
    property: `properties/${PROPERTY_ID}`,
    requestBody: {
      dateRanges: [{ startDate, endDate: "today" }],
      dimensions: [{ name: "yearMonth" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "sessions" },
        { name: "totalUsers" },
      ],
      orderBys: [{ dimension: { dimensionName: "yearMonth" } }],
    },
  });

  console.log(`\n## 月別PV・セッション・ユーザー数推移（過去${MONTHS}ヶ月）`);
  for (const row of byMonth.data.rows ?? []) {
    const [ym] = row.dimensionValues.map((d) => d.value);
    const [pv, sessions, users] = row.metricValues.map((m) => m.value);
    console.log(
      `  ${ym}: PV ${Number(pv).toLocaleString()} / セッション ${Number(sessions).toLocaleString()} / ユーザー ${Number(users).toLocaleString()}`,
    );
  }

  // 月別 × チャネル別 セッション数（どの集客経路が伸び悩んでいるか）
  const byChannel = await analyticsData.properties.runReport({
    property: `properties/${PROPERTY_ID}`,
    requestBody: {
      dateRanges: [{ startDate, endDate: "today" }],
      dimensions: [
        { name: "yearMonth" },
        { name: "sessionDefaultChannelGroup" },
      ],
      metrics: [{ name: "sessions" }],
      orderBys: [{ dimension: { dimensionName: "yearMonth" } }],
      limit: 200,
    },
  });

  console.log(`\n## 月別 × チャネル別 セッション数推移`);
  const grouped = {};
  for (const row of byChannel.data.rows ?? []) {
    const [ym, channel] = row.dimensionValues.map((d) => d.value);
    const [sessions] = row.metricValues.map((m) => m.value);
    grouped[ym] = grouped[ym] ?? {};
    grouped[ym][channel] = Number(sessions);
  }
  for (const ym of Object.keys(grouped).sort()) {
    const channels = grouped[ym];
    const parts = Object.entries(channels)
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${c}:${v.toLocaleString()}`)
      .join(" / ");
    console.log(`  ${ym}: ${parts}`);
  }
}

main().catch((err) => {
  console.error("❌ レポート生成エラー:", err.message);
  process.exit(1);
});
