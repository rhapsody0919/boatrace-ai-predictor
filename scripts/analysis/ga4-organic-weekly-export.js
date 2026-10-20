/**
 * GA4 の自然検索（Organic Search）を週別・日別に書き出す
 *
 * monthly-pv-trend-report.js は月別の標準出力だけで、ユーザー数を週で足し合わせられない
 * （ユーザー数は日別の和にならない）。週別は GA4 側で isoYearIsoWeek（月曜始まり）として集計させる。
 *
 * 使い方:
 *   node scripts/analysis/ga4-organic-weekly-export.js --start=2026-09-28 --end=2026-10-19 --out=data/analysis/xxx/ga4.json
 *
 * 出力: プロパティの設定（タイムゾーン等。読めたものだけ）、週別×チャネル、日別×チャネル、
 *       自然検索の週別×着地ページ、全チャネルの週別合計。期間が計測の切れ目をまたぐときは notes に残す。
 * 必要な設定は monthly-pv-trend-report.js と共通（GA4_PROPERTY_ID、サービスアカウント）。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import { ga4PvBreaksWithin } from "../lib/ga4MeasurementBreaks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const START = arg("start");
const END = arg("end");
const OUT = arg("out");
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
if (!isDate(START) || !isDate(END) || !OUT || !PROPERTY_ID) {
  console.error(
    "❌ --start=YYYY-MM-DD --end=YYYY-MM-DD --out=出力先 と GA4_PROPERTY_ID（.env.local）が要ります",
  );
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/analytics.readonly",
]);
const analyticsData = google.analyticsdata({ version: "v1beta", auth });
const analyticsAdmin = google.analyticsadmin({ version: "v1alpha", auth });

const METRICS = [
  "sessions",
  "engagedSessions",
  "engagementRate",
  "newUsers",
  "activeUsers",
  "totalUsers",
  "screenPageViews",
  "userEngagementDuration",
  "averageSessionDuration",
  "eventCount",
];

const ORGANIC_FILTER = {
  filter: {
    fieldName: "sessionDefaultChannelGroup",
    stringFilter: { value: "Organic Search" },
  },
};

const PAGE_SIZE = 100000;

// 行を { 次元名: 値, 指標名: 数値 } にして返す。上限で切れないようページングする
async function runReport({ dimensions, metrics = METRICS, dimensionFilter }) {
  const rows = [];
  for (;;) {
    const res = await analyticsData.properties.runReport({
      property: `properties/${PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate: START, endDate: END }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        dimensionFilter,
        limit: PAGE_SIZE,
        offset: rows.length,
        keepEmptyRows: false,
      },
    });
    const batch = (res.data.rows ?? []).map((r) => ({
      ...Object.fromEntries(
        dimensions.map((d, i) => [d, r.dimensionValues[i].value]),
      ),
      ...Object.fromEntries(
        metrics.map((m, i) => [m, Number(r.metricValues[i].value)]),
      ),
    }));
    rows.push(...batch);
    if (rows.length >= Number(res.data.rowCount ?? 0) || batch.length === 0) {
      return { rowCount: Number(res.data.rowCount ?? 0), rows };
    }
  }
}

// 管理 API で読めるものだけ読む。権限や API 未対応で読めなければ理由を残して進む
async function readSettings() {
  const tryRead = async (label, fn) => {
    try {
      return { [label]: await fn() };
    } catch (err) {
      return { [label]: { error: err.message } };
    }
  };
  const name = `properties/${PROPERTY_ID}`;
  const parts = await Promise.all([
    tryRead("property", async () => {
      const { data } = await analyticsAdmin.properties.get({ name });
      return {
        displayName: data.displayName,
        timeZone: data.timeZone,
        currencyCode: data.currencyCode,
        createTime: data.createTime,
        industryCategory: data.industryCategory,
      };
    }),
    tryRead("dataStreams", async () => {
      const { data } = await analyticsAdmin.properties.dataStreams.list({
        parent: name,
      });
      return (data.dataStreams ?? []).map((s) => ({
        type: s.type,
        displayName: s.displayName,
        defaultUri: s.webStreamData?.defaultUri ?? null,
        createTime: s.createTime,
      }));
    }),
    tryRead("customDimensions", async () => {
      const { data } = await analyticsAdmin.properties.customDimensions.list({
        parent: name,
        pageSize: 200,
      });
      return data.customDimensions ?? [];
    }),
    tryRead("keyEvents", async () => {
      const { data } = await analyticsAdmin.properties.keyEvents.list({
        parent: name,
        pageSize: 200,
      });
      return data.keyEvents ?? [];
    }),
    tryRead("dataRetention", async () => {
      const { data } = await analyticsAdmin.properties.getDataRetentionSettings(
        {
          name: `${name}/dataRetentionSettings`,
        },
      );
      return data;
    }),
  ]);
  return Object.assign({}, ...parts);
}

async function main() {
  const settings = await readSettings();
  const weeklyByChannel = await runReport({
    dimensions: ["isoYearIsoWeek", "sessionDefaultChannelGroup"],
  });
  const dailyByChannel = await runReport({
    dimensions: ["date", "sessionDefaultChannelGroup"],
  });
  const weeklyTotal = await runReport({ dimensions: ["isoYearIsoWeek"] });
  const organicWeeklyLanding = await runReport({
    dimensions: ["isoYearIsoWeek", "landingPage"],
    metrics: [
      "sessions",
      "engagedSessions",
      "newUsers",
      "activeUsers",
      "screenPageViews",
    ],
    dimensionFilter: ORGANIC_FILTER,
  });
  const organicWeeklyDevice = await runReport({
    dimensions: ["isoYearIsoWeek", "deviceCategory"],
    dimensionFilter: ORGANIC_FILTER,
  });
  // 週の日数（期間の端は7日に満たない）。dailyByChannel から数える
  const daysByWeek = {};
  for (const d of new Set(dailyByChannel.rows.map((r) => r.date))) {
    const dt = new Date(
      `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`,
    );
    const thursday = new Date(dt);
    thursday.setUTCDate(dt.getUTCDate() + 3 - ((dt.getUTCDay() + 6) % 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const key = `${thursday.getUTCFullYear()}${String(week).padStart(2, "0")}`;
    daysByWeek[key] = (daysByWeek[key] ?? 0) + 1;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    propertyId: PROPERTY_ID,
    startDate: START,
    endDate: END,
    notes: {
      week: "isoYearIsoWeek は月曜始まりの ISO 週（例 202641 = 2026-10-05〜10-11）。daysByWeek が7未満の週は期間の端で欠けている",
      dates: "日付はプロパティのタイムゾーン（settings.property.timeZone）",
      measurementBreaks: ga4PvBreaksWithin(START, END),
      internalTraffic:
        "内部トラフィック除外のフィルタ（データフィルタ）は Admin API v1alpha で読めないため settings に含まない。設定日は scripts/lib/ga4MeasurementBreaks.js の記録（2026-10-01）",
    },
    settings,
    daysByWeek,
    weeklyByChannel,
    weeklyTotal,
    organicWeeklyLanding,
    organicWeeklyDevice,
    dailyByChannel,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const organic = weeklyByChannel.rows.filter(
    (r) => r.sessionDefaultChannelGroup === "Organic Search",
  );
  for (const r of organic) {
    console.log(
      `${r.isoYearIsoWeek}（${daysByWeek[r.isoYearIsoWeek] ?? "?"}日） sessions=${r.sessions} newUsers=${r.newUsers} activeUsers=${r.activeUsers} PV=${r.screenPageViews} engagementRate=${r.engagementRate.toFixed(3)}`,
    );
  }
}

main().catch((err) => {
  console.error("❌ GA4 取得エラー:", err.message);
  process.exit(1);
});
