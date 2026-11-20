// SNS の暦日の値の取り込み（sns-pdca-loop tasks 22、cron sns_daily）の再現テスト。
// SQL154 までを PGlite に入れ、YouTube Analytics・GA4 はモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { ptDate, runSnsDaily } from "../lib/snsDailyRunner.js";

import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { importSpecifiers } from "./verifyData/importSpecifiers.js";
import { runSnsDailyRunnerScenes1 } from "./verifyData/sns-daily-runner-scenes-1.js";
import {
  runSnsDailyRunnerScenes2,
  runSnsDailyRunnerScenes3,
} from "./verifyData/sns-daily-runner-scenes-2.js";
import { runSnsDailyRunnerScenes4 } from "./verifyData/sns-daily-runner-scenes-3.js";
import { runSnsDailyRunnerScenes5 } from "./verifyData/sns-daily-runner-scenes-4.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;

// 2026-10-16 10:05 JST（= 10-15 18:05 PT）に動く。JST の対象日は 10-16、取り直すのは JST 10-13〜15・PT 10-12〜14
const NOW = new Date("2026-10-16T01:05:00Z");
const ctx = (mode = "live") => ({
  mode,
  now: () => NOW,
  targetDate: "2026-10-16",
});
const COLS = [
  "day",
  "channel",
  "draft_id",
  "utm_content",
  "source",
  "metric_name",
  "metric_value",
  "missing_reason",
  "definition",
  "observed_at",
];

const store = {
  youtubeVideos: async () => sdrState.videos,
  engagedObservations: async (ids, metrics) =>
    (
      await all(
        "SELECT draft_id, metric_name, definition, metric_value::float metric_value, denominator_value::float denominator_value, observed_at FROM sns_metric_observations WHERE \"window\"='pt3d' AND source='youtube-analytics' AND metric_name = ANY($1) AND draft_id = ANY($2)",
        [metrics, ids],
      )
    ).map((o) => ({ ...o, observed_at: o.observed_at.toISOString() })),
  appendObservation: (id, observation) =>
    db.query("SELECT append_sns_metric_observation($1,$2)", [id, observation]),
  fullPictureDrafts: async (raceIds) =>
    (
      await all(
        "SELECT id, platform, posted_at, source_data->'full_picture'->>'race_id' AS race_id FROM sns_drafts WHERE format='full_picture' AND source_data->'full_picture'->>'race_id' = ANY($1)",
        [raceIds],
      )
    ).map((d) => ({ ...d, posted_at: d.posted_at?.toISOString() ?? null })),
  setsuShortDrafts: async (since) =>
    (
      await all(
        "SELECT id, posted_at, caption_text FROM sns_drafts WHERE format='setsu_kiryoku_short' AND platform='youtube' AND posted_at >= $1",
        [since],
      )
    ).map((d) => ({ ...d, posted_at: d.posted_at.toISOString() })),
  existingDrafts: async (ids) =>
    (await all("SELECT id FROM sns_drafts WHERE id = ANY($1)", [ids])).map(
      (r) => r.id,
    ),
  existing: async (from, to) =>
    (
      await all(
        `SELECT ${COLS.slice(0, 9).join(",")}, metric_value::float metric_value FROM sns_channel_daily WHERE day BETWEEN $1 AND $2`,
        [from, to],
      )
    ).map((r) => ({ ...r, day: r.day.toISOString().slice(0, 10) })),
  // 本番の PostgREST の一括 upsert と同じく1文で入れる（同じキーの行が2つあると Postgres が文ごと拒む）
  async upsert(rows) {
    sdrState.upserts.push(rows.length);
    const values = rows
      .map(
        (_, i) =>
          `(${COLS.map((__, j) => `$${i * COLS.length + j + 1}`).join(",")})`,
      )
      .join(",");
    await db.query(
      `INSERT INTO sns_channel_daily(${COLS.join(",")}) VALUES ${values}
       ON CONFLICT ON CONSTRAINT sns_channel_daily_key DO UPDATE SET metric_value=EXCLUDED.metric_value,
         missing_reason=EXCLUDED.missing_reason, observed_at=EXCLUDED.observed_at`,
      rows.flatMap((r) => COLS.map((c) => r[c])),
    );
  },
};
const sdrState = { videos: [], upserts: [], draftId: undefined };

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
  );
  for (const file of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "136_sns_metric_observations.sql",
    "137_sns_x_send.sql",
    "138_sns_external_operations.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "146_sns_shorts_send.sql",
    "147_sns_draft_diff.sql",
    "148_sns_posted_approval_guard.sql",
    "153_sns_auto_send.sql",
    "154_sns_tokens_metric_jobs.sql",
    "169_sns_full_picture_metric_windows.sql",
    "175_sns_metric_observations_pt3d.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + file, import.meta.url),
        "utf8",
      ),
    );
  sdrState.draftId = (
    await first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at) VALUES(gen_random_uuid(),'short','youtube','ja','全貌','本文','posted','2026-10-09T20:00:00Z') RETURNING id",
    )
  ).id;
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM sns_channel_daily; DELETE FROM sns_metric_observations",
  );
  sdrState.upserts = [];
  // PT 10-13 に投稿した動画（投稿日 10-13・翌日 10-14 が取り直しの範囲に入る）と、古い動画（範囲外）
  sdrState.videos = [
    {
      draft_id: sdrState.draftId,
      external_post_id: "vid1",
      posted_at: "2026-10-13T20:00:00Z",
    },
    {
      draft_id: sdrState.draftId,
      external_post_id: "old",
      posted_at: "2026-10-09T20:00:00Z",
    },
  ];
});
after(() => db.close());

function mockYoutube(calls = [], { channelDays } = {}) {
  return async () => ({
    report: async (params) => {
      calls.push(params);
      if (params.filters === "video==vid1")
        return [
          {
            day: "2026-10-13",
            views: 100,
            engagedViews: 80,
            averageViewPercentage: 71.5,
            averageViewDuration: 42,
            subscribersGained: 1,
          },
        ];
      if (params.filters) return [];
      return (channelDays ?? ["2026-10-12", "2026-10-13", "2026-10-14"]).map(
        (day) => ({ day, views: 10, engagedViews: 8, subscribersGained: 0 }),
      );
    },
  });
}

const SETSU_COLS = [
  "date",
  "landingPage",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
  "sessionManualAdContent",
];
function setsuReport(body, sessions) {
  const filters = body.dimensionFilter.andGroup.expressions
    .map((e) => e.filter)
    .filter((f) => f && f.fieldName !== "hostName");
  const hit = (row) =>
    filters.every((f) => {
      const v = String(row[SETSU_COLS.indexOf(f.fieldName)]);
      const { matchType, value } = f.stringFilter;
      return matchType === "FULL_REGEXP"
        ? new RegExp(value).test(v)
        : v.toLowerCase() === value.toLowerCase();
    });
  const byDay = new Map();
  for (const row of sessions.filter(hit)) {
    const d = byDay.get(row[0]) ?? { users: new Set(), sessions: 0 };
    d.users.add(row[6]);
    d.sessions += row[7];
    byDay.set(row[0], d);
  }
  return [...byDay].map(([date, d]) => [date, d.users.size, d.sessions]);
}

// UTM の行: [日付, 流入元, campaign, content, term, 指標...]
function mockGa4(
  calls = [],
  { utm = [], utmSonar = [], utmAssist = [], setsu = [] } = {},
) {
  return async () => async (body) => {
    calls.push(body);
    const dims = body.dimensions.map((d) => d.name).join(",");
    // 節の機力の Shorts: setsu はセッションの行 [日付, landingPage, source, medium, campaign, content, 人の ID, sessions]。
    // GA4 と同じく、フィルタ（landingPage の正規表現・次元の完全一致、大文字小文字を区別しない）で絞り、日付ごとに人を重複なしで数える
    if (JSON.stringify(body.dimensionFilter).includes("landingPage"))
      return setsuReport(body, setsu);
    const sonar = JSON.stringify(body.dimensionFilter).includes("race_tab");
    if (JSON.stringify(body.dimensionFilter).includes("pagePath"))
      return utmAssist;
    if (dims === "date,sessionSource")
      return sonar
        ? [["20261014", "t.co", 2]]
        : [
            ["20261014", "t.co", 5, 6],
            ["20261014", "x", 3, 3],
            ["20261014", "youtube.com", 4, 4],
          ];
    return sonar
      ? [
          ["20261014", "x", "race-full", sdrState.draftId, "(not set)", 1],
          ...utmSonar,
        ]
      : [
          ["20261014", "x", "race-full", sdrState.draftId, "(not set)", 2, 2],
          ["20261015", "x", "today_digest", "2026-10-15", "(not set)", 7, 8],
          ...utm,
        ];
  };
}

const rows = (where = "TRUE") =>
  all(
    `SELECT day::text, channel, draft_id, utm_content, metric_name, metric_value::float v, missing_reason FROM sns_channel_daily WHERE ${where} ORDER BY day, channel, metric_name, utm_content`,
  );

test("cron の登録: sns_daily は JST 10:00 の日次", () => {
  assert.equal(SCRAPE_JOBS.sns_daily.kind, "daily");
  assert.equal(SCRAPE_JOBS.sns_daily.targetTimeJst, "10:00");
  assert.equal(ptDate(NOW), "2026-10-15");
});

// ---- 後半の場面（verifyData/sns-daily-runner-scenes-1.js・sns-daily-runner-scenes-2.js） ----
runSnsDailyRunnerScenes1({
  first,
  ctx,
  store,
  sdrState,
  mockYoutube,
  mockGa4,
  rows,
});
runSnsDailyRunnerScenes2({
  first,
  all,
  ctx,
  store,
  sdrState,
  mockYoutube,
  mockGa4,
});

test("節の機力の Shorts（setsu_kiryoku_short）: 説明欄のリンクの utm_* と landingPage で下書きに結びつけ、投稿日と翌日だけ残す（BOA-1209）", async () => {
  const link = (venue, content) =>
    `節の機力\nhttps://www.boat-ai.jp/venue/${venue}?utm_source=youtube&utm_medium=shorts&utm_content=${content}\n#ボートレース`;
  const ins = (format, platform, caption, postedAt) =>
    first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at) VALUES(gen_random_uuid(),$1,$2,'ja','節の機力',$3,'posted',$4) RETURNING id",
      [format, platform, caption, postedAt],
    );
  // JST 10/13 21:30 と 10/14 21:30 に同じ会場・同じ utm で投稿（10/14 の流入は当日の b に付ける）
  const a = (
    await ins(
      "setsu_kiryoku_short",
      "youtube",
      link(13, "final_gap"),
      "2026-10-13T12:30:00Z",
    )
  ).id;
  const b = (
    await ins(
      "setsu_kiryoku_short",
      "youtube",
      link(13, "final_gap"),
      "2026-10-14T12:30:00Z",
    )
  ).id;
  // 別の会場の投稿（10/14）
  const c = (
    await ins(
      "setsu_kiryoku_short",
      "youtube",
      link(24, "motor_up"),
      "2026-10-14T12:30:00Z",
    )
  ).id;
  // utm_medium・utm_content の無いリンクは結びつけない（同じ会場のページへの別の投稿の流入を拾わない）。
  // X の節の機力（リンクなし）は GA4 の行を持たない
  await ins(
    "setsu_kiryoku_short",
    "youtube",
    "https://www.boat-ai.jp/venue/1?utm_source=youtube",
    "2026-10-14T12:30:00Z",
  );
  await ins("setsu_kiryoku", "x", "本文", "2026-10-14T12:30:00Z");
  const calls = [];
  const S = "(not set)";
  await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4(calls, {
      setsu: [
        ["20261013", "/venue/13", "youtube", "shorts", S, "final_gap", "u1", 2], // a の投稿日
        ["20261013", "/venue/13", "youtube", "shorts", S, "final_gap", "u2", 1],
        // b の投稿日（a の翌日でもある）。同じ人が campaign・大文字小文字・末尾の / の違う2つのセッションで来ても1人
        ["20261014", "/venue/13", "youtube", "shorts", S, "final_gap", "u3", 1],
        [
          "20261014",
          "/venue/13/",
          "YouTube",
          "Shorts",
          "x",
          "Final_Gap",
          "u3",
          1,
        ],
        ["20261015", "/venue/13", "youtube", "shorts", S, "final_gap", "u4", 1], // b の翌日
        ["20261016", "/venue/13", "youtube", "shorts", S, "final_gap", "u5", 1], // b の翌々日は範囲の外
        [
          "20261014",
          "/venue/13",
          "youtube",
          "referral",
          S,
          "final_gap",
          "u6",
          1,
        ], // medium が違う
        ["20261014", "/venue/13", "youtube", "shorts", S, "motor_up", "u7", 1], // content が違う
        ["20261014", "/venue/24", "youtube", "shorts", S, "motor_up", "u8", 1], // c の投稿日
        ["20261014", "/venue/1", "youtube", "(none)", S, S, "u9", 1], // utm の無い下書きの会場
      ],
    }),
  });
  // リンクごとに1回、次元は日付だけ（GA4 が人を重複なしで数える）
  const qs = calls.filter((c2) =>
    JSON.stringify(c2.dimensionFilter).includes("landingPage"),
  );
  assert.equal(qs.length, 2);
  for (const q of qs)
    assert.deepEqual(
      q.dimensions.map((d) => d.name),
      ["date"],
    );
  assert.match(
    JSON.stringify(qs[0].dimensionFilter),
    /"matchType":"FULL_REGEXP","value":"\^\/venue\/0\?13\/\?\$"/,
  );
  const got = (
    await all(
      "SELECT day::text, channel, draft_id, utm_content, metric_name, metric_value::float v FROM sns_channel_daily WHERE definition LIKE '%setsu_kiryoku_short%'",
    )
  ).map((r) => [
    r.day,
    r.channel,
    { [a]: "a", [b]: "b", [c]: "c" }[r.draft_id] ?? r.draft_id,
    r.utm_content,
    r.metric_name,
    r.v,
  ]);
  assert.deepEqual(
    got.sort((p, q2) => JSON.stringify(p).localeCompare(JSON.stringify(q2))),
    [
      ["2026-10-13", "youtube", "a", "final_gap", "sessions", 3],
      ["2026-10-13", "youtube", "a", "final_gap", "users", 2],
      ["2026-10-14", "youtube", "b", "final_gap", "sessions", 2],
      ["2026-10-14", "youtube", "b", "final_gap", "users", 1],
      ["2026-10-14", "youtube", "c", "motor_up", "sessions", 1],
      ["2026-10-14", "youtube", "c", "motor_up", "users", 1],
      ["2026-10-15", "youtube", "b", "final_gap", "sessions", 1],
      ["2026-10-15", "youtube", "b", "final_gap", "users", 1],
    ],
  );
});

// ---- 後半の場面（verifyData/sns-daily-runner-scenes-2.js・sns-daily-runner-scenes-3.js・sns-daily-runner-scenes-4.js） ----
runSnsDailyRunnerScenes3({
  first,
  all,
  ctx,
  store,
  sdrState,
  mockYoutube,
  mockGa4,
});
runSnsDailyRunnerScenes4({
  db,
  first,
  all,
  NOW,
  ctx,
  store,
  sdrState,
  mockYoutube,
  mockGa4,
  rows,
});
runSnsDailyRunnerScenes5({
  first,
  all,
  ctx,
  store,
  sdrState,
  mockYoutube,
  mockGa4,
  rows,
});

test("snsGa4 はブログ記事のファイルを読む src モジュールに依存しない", async () => {
  // 本文の字は読まず、import の解決で直の依存を見る（verifyData/importSpecifiers.js）
  assert.deepEqual(
    await importSpecifiers(new URL("../lib/snsGa4.js", import.meta.url)),
    ["node:crypto"],
  );
});
