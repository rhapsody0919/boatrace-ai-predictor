/**
 * 思考アシスト（BOA-430）の GA4 の読み取り。1日（または期間）の /race/{id}/assist の page_view・ユーザー、
 * レース詳細（/race/{id}）に対する割合、assist_* イベントの回数と、登録したカスタムディメンションごとの内訳を取る。
 * イベントの定義は docs/design/thinking-assist/events.md。
 *
 * 数字は本番（www.boat-ai.jp）だけ。Preview（*.vercel.app）の閲覧は excludedHosts に分けて残す。
 * 内訳はそのパラメータを持つイベントだけで取る。値が空欄（""）か "(not set)" の行は値が届いていない分
 * （カスタムディメンションを登録する前の分を含む。登録日より前には遡らない）。
 *
 * 使い方:
 *   node scripts/analysis/assist-ga4/report.js --from=2026-10-11 [--to=2026-10-11]
 * 結果は data/analysis/assist-ga4/{from}.json（期間なら {from}_{to}.json）に書く。
 * 必要な設定は monthly-pv-trend-report.js と共通（.env.local の GA4_PROPERTY_ID、
 * credentials/google-service-account.json）。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../../lib/googleServiceAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../../.env.local") });

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const FROM = arg("from");
const TO = arg("to") ?? FROM;
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;
const HOST = "www.boat-ai.jp";
const ASSIST_PATH = "^/race/[^/]+/assist$";
const RACE_PATH = "^/race/[^/]+$";
// 登録したカスタムディメンション（2026-10-11 登録）と、それを持つイベント（events.md のイベントの表）。
// 内訳はそのパラメータを持つイベントだけで取る（持たないイベントも空欄で返るため）
const DIMENSIONS = {
  assist_view: ["assist_view_switch"],
  assist_entry: ["assist_view_switch"],
  assist_lens: [
    "assist_lens_select",
    "assist_deep_open",
    "assist_metric_compare",
    "assist_target",
  ],
  assist_boat: ["assist_deep_open"],
  assist_metric: ["assist_metric_compare"],
  assist_sheet: ["assist_sheet_open"],
  assist_guide_step: ["assist_guide_step"],
  assist_target: ["assist_target"],
};

if (
  !FROM ||
  !/^\d{4}-\d{2}-\d{2}$/.test(FROM) ||
  !/^\d{4}-\d{2}-\d{2}$/.test(TO)
) {
  console.error("使い方: --from=YYYY-MM-DD [--to=YYYY-MM-DD]");
  process.exit(1);
}
if (!PROPERTY_ID) {
  console.error("GA4_PROPERTY_ID が設定されていません（.env.local）");
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/analytics.readonly",
]);
const analyticsData = google.analyticsdata({ version: "v1beta", auth });

const pathIs = (value) => ({
  filter: {
    fieldName: "pagePath",
    stringFilter: { matchType: "PARTIAL_REGEXP", value },
  },
});
const hostIs = {
  filter: {
    fieldName: "hostName",
    stringFilter: { matchType: "EXACT", value: HOST },
  },
};
const assistEvents = {
  filter: {
    fieldName: "eventName",
    stringFilter: { matchType: "BEGINS_WITH", value: "assist_" },
  },
};
const and = (...expressions) => ({ andGroup: { expressions } });

/** runReport の行を「ディメンションの値 → 指標の数」のオブジェクトの配列にする */
async function report({ dimensions, metrics, filter }) {
  const res = await analyticsData.properties.runReport({
    property: `properties/${PROPERTY_ID}`,
    requestBody: {
      dateRanges: [{ startDate: FROM, endDate: TO }],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      dimensionFilter: filter,
      limit: 1000,
    },
  });
  return (res.data.rows ?? []).map((r) => ({
    ...Object.fromEntries(
      dimensions.map((d, i) => [d, r.dimensionValues[i].value]),
    ),
    ...Object.fromEntries(
      metrics.map((m, i) => [m, Number(r.metricValues[i].value)]),
    ),
  }));
}

const one = (rows, key) => rows[0]?.[key] ?? 0;

async function main() {
  const assist = await report({
    dimensions: [],
    metrics: ["screenPageViews", "totalUsers", "userEngagementDuration"],
    filter: and(pathIs(ASSIST_PATH), hostIs),
  });
  const race = await report({
    dimensions: [],
    metrics: ["screenPageViews", "totalUsers"],
    filter: and(pathIs(RACE_PATH), hostIs),
  });
  const assistPv = one(assist, "screenPageViews");
  const assistUsers = one(assist, "totalUsers");
  const racePv = one(race, "screenPageViews");
  const raceUsers = one(race, "totalUsers");
  const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

  const byHost = await report({
    dimensions: ["hostName"],
    metrics: ["screenPageViews", "totalUsers"],
    filter: pathIs(ASSIST_PATH),
  });
  const byDevice = await report({
    dimensions: ["deviceCategory"],
    metrics: ["screenPageViews", "totalUsers"],
    filter: and(pathIs(ASSIST_PATH), hostIs),
  });
  const byHour = await report({
    dimensions: ["hour"],
    metrics: ["screenPageViews", "totalUsers"],
    filter: and(pathIs(ASSIST_PATH), hostIs),
  });
  const newVsReturning = await report({
    dimensions: ["newVsReturning"],
    metrics: ["totalUsers", "screenPageViews"],
    filter: and(pathIs(ASSIST_PATH), hostIs),
  });
  const events = await report({
    dimensions: ["eventName"],
    metrics: ["eventCount", "totalUsers"],
    filter: and(assistEvents, hostIs),
  });
  const breakdowns = {};
  for (const [d, names] of Object.entries(DIMENSIONS)) {
    breakdowns[d] = (
      await report({
        dimensions: ["eventName", `customEvent:${d}`],
        metrics: ["eventCount"],
        filter: and(
          {
            filter: {
              fieldName: "eventName",
              inListFilter: { values: names },
            },
          },
          hostIs,
        ),
      })
    ).map((r) => ({
      eventName: r.eventName,
      value: r[`customEvent:${d}`],
      eventCount: r.eventCount,
    }));
  }

  const out = {
    from: FROM,
    to: TO,
    fetchedAt: new Date().toISOString(),
    host: HOST,
    notes: [
      "数字は本番（www.boat-ai.jp）だけ。Preview の閲覧は excludedHosts",
      "breakdowns はそのパラメータを持つイベントだけ。value が空文字か (not set) の行は値が届いていない分（カスタムディメンションを登録する前の分を含む。2026-10-11 登録）",
      "ユーザー自身の確認や他のレーンの本番確認が混ざりうる（内部の人の通信を分ける設定は確かめていない）",
    ],
    assist: {
      pageViews: assistPv,
      users: assistUsers,
      engagementSeconds: one(assist, "userEngagementDuration"),
    },
    raceDetail: { pageViews: racePv, users: raceUsers },
    assistShareOfRaceDetail: {
      pageViewsPct: ratio(assistPv, racePv),
      usersPct: ratio(assistUsers, raceUsers),
    },
    excludedHosts: byHost.filter((r) => r.hostName !== HOST),
    byDevice,
    byHour: byHour.sort((a, b) => Number(a.hour) - Number(b.hour)),
    newVsReturning,
    events: events.sort((a, b) => b.eventCount - a.eventCount),
    breakdowns,
  };
  const dir = path.join(__dirname, "../../../data/analysis/assist-ga4");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    FROM === TO ? `${FROM}.json` : `${FROM}_${TO}.json`,
  );
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`書き出し: ${path.relative(process.cwd(), file)}`);
  console.log(
    `/assist ${assistPv} PV・${assistUsers}人、レース詳細 ${racePv} PV・${raceUsers}人（PV ${out.assistShareOfRaceDetail.pageViewsPct}%）`,
  );
  for (const e of out.events)
    console.log(`  ${e.eventName}: ${e.eventCount}回・${e.totalUsers}人`);
}

main().catch((e) => {
  console.error(`GA4 の取得に失敗: ${e.message}`);
  process.exit(1);
});
