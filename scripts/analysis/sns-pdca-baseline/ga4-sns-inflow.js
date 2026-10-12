/**
 * SNS PDCA ループ（docs/design/sns-pdca-loop）の基準値: GA4 で X・YouTube から来たサイトユーザーを日別に取り、
 * 期間ごとの平均・SD・0の日数と、SNS 由来で龍神ソナーのタブを開いた人数を出す。
 *
 * 流入元は完全一致のリストで絞る（正規表現 `t\.co` は "chatgpt.com" にも当たるため）。
 * 数は Cookie に同意した人だけ（src/utils/analytics.js）なので下限として扱う。
 *
 * 使い方:
 *   node scripts/analysis/sns-pdca-baseline/ga4-sns-inflow.js --from=2026-08-15 --to=2026-10-11 \
 *     [--posting=2026-08-29..2026-09-15] [--sonar-from=2026-10-08]
 * 結果は data/analysis/sns-pdca-baseline/ga4-{from}_{to}.json。
 * 必要な設定は assist-ga4/report.js と共通（.env.local の GA4_PROPERTY_ID、credentials/google-service-account.json）。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../../lib/googleServiceAuth.js";
import { summarize } from "./stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.join(__dirname, "../../../.env.local"),
  quiet: true,
});

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const FROM = arg("from");
const TO = arg("to");
const POSTING = (arg("posting") ?? "2026-08-29..2026-09-15").split("..");
const SONAR_FROM = arg("sonar-from") ?? "2026-10-08";
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
if (!FROM || !TO)
  throw new Error("--from と --to（YYYY-MM-DD）を指定してください");
if (!PROPERTY_ID) throw new Error(".env.local に GA4_PROPERTY_ID がありません");

export const X_SOURCES = ["t.co", "x.com", "twitter.com", "x"];
export const YOUTUBE_SOURCES = [
  "youtube.com",
  "m.youtube.com",
  "youtube",
  "youtu.be",
  "com.google.android.youtube",
];

const host = {
  filter: {
    fieldName: "hostName",
    stringFilter: { matchType: "EXACT", value: "www.boat-ai.jp" },
  },
};
const inList = (fieldName, values) => ({
  filter: { fieldName, inListFilter: { values } },
});
const and = (...expressions) => ({ andGroup: { expressions } });
const sonarTab = and(
  inList("eventName", ["race_tab_select", "race_tab_initial"]),
  {
    filter: {
      fieldName: "customEvent:tab_id",
      stringFilter: { matchType: "EXACT", value: "sonar" },
    },
  },
);

const analyticsData = google.analyticsdata({
  version: "v1beta",
  auth: getGoogleAuthClient([
    "https://www.googleapis.com/auth/analytics.readonly",
  ]),
});

async function report(body) {
  const res = await analyticsData.properties.runReport({
    property: `properties/${PROPERTY_ID}`,
    requestBody: { limit: 10000, ...body },
  });
  return (res.data.rows ?? []).map((r) => [
    ...r.dimensionValues.map((v) => v.value),
    ...r.metricValues.map((v) => Number(v.value)),
  ]);
}

const ymd = (d) => d.replaceAll("-", "");
function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10).replaceAll("-", ""));
  }
  return out;
}

const snsRows = await report({
  dateRanges: [{ startDate: FROM, endDate: TO }],
  dimensions: [{ name: "date" }, { name: "sessionSource" }],
  metrics: [{ name: "totalUsers" }, { name: "sessions" }],
  dimensionFilter: and(
    host,
    inList("sessionSource", [...X_SOURCES, ...YOUTUBE_SOURCES]),
  ),
});
const byDay = Object.fromEntries(
  daysBetween(FROM, TO).map((d) => [d, { x: 0, youtube: 0 }]),
);
for (const [date, source, users] of snsRows) {
  byDay[date][YOUTUBE_SOURCES.includes(source) ? "youtube" : "x"] += users;
}
const daily = Object.entries(byDay).map(([date, v]) => ({ date, ...v }));
const period = (a, b) =>
  daily.filter((r) => r.date >= ymd(a) && r.date <= ymd(b));
const periodStats = (a, b) => ({
  from: a,
  to: b,
  x: summarize(period(a, b).map((r) => r.x)),
  youtube: summarize(period(a, b).map((r) => r.youtube)),
});

const utmRows = await report({
  dateRanges: [{ startDate: FROM, endDate: TO }],
  dimensions: [
    { name: "sessionSource" },
    { name: "sessionCampaignName" },
    { name: "sessionManualAdContent" },
  ],
  metrics: [{ name: "totalUsers" }],
  dimensionFilter: and(host, {
    filter: {
      fieldName: "sessionMedium",
      stringFilter: { matchType: "EXACT", value: "social" },
    },
  }),
});

const sonarRows = await report({
  dateRanges: [{ startDate: SONAR_FROM, endDate: TO }],
  dimensions: [{ name: "sessionSource" }],
  metrics: [{ name: "totalUsers" }],
  dimensionFilter: and(host, sonarTab),
  orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
});

const organic = await report({
  dateRanges: [{ startDate: FROM, endDate: TO }],
  dimensions: [{ name: "date" }],
  metrics: [{ name: "totalUsers" }],
  dimensionFilter: and(host, {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: { matchType: "EXACT", value: "Organic Search" },
    },
  }),
});

const result = {
  generatedAt: new Date().toISOString(),
  range: { from: FROM, to: TO },
  note: "GA4 は Cookie に同意した人だけ。流入元は完全一致のリスト。ユーザー数は日ごとの totalUsers の和（同じ人が別の日に来れば2と数える）",
  sources: { x: X_SOURCES, youtube: YOUTUBE_SOURCES },
  periods: {
    beforePosting: periodStats(
      FROM,
      new Date(Date.parse(POSTING[0]) - 86400000).toISOString().slice(0, 10),
    ),
    posting: periodStats(POSTING[0], POSTING[1]),
    last28: periodStats(
      new Date(Date.parse(TO) - 27 * 86400000).toISOString().slice(0, 10),
      TO,
    ),
  },
  organicSearchDaily: summarize(organic.map((r) => r[1])),
  utmSocial: utmRows.map(([source, campaign, content, users]) => ({
    source,
    campaign,
    content,
    users,
  })),
  sonarTabUsersBySource: {
    from: SONAR_FROM,
    rows: sonarRows.map(([source, users]) => ({ source, users })),
    sns: sonarRows
      .filter(([s]) => [...X_SOURCES, ...YOUTUBE_SOURCES].includes(s))
      .reduce((a, [, u]) => a + u, 0),
  },
  daily,
};

const outDir = path.join(__dirname, "../../../data/analysis/sns-pdca-baseline");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `ga4-${FROM}_${TO}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.periods, null, 2));
console.log(
  "SNS 由来でソナーのタブを開いた人:",
  result.sonarTabUsersBySource.sns,
);
console.log(`書き出し: ${path.relative(process.cwd(), outPath)}`);
