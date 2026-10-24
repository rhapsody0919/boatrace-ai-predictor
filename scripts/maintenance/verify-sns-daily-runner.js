// SNS の暦日の値の取り込み（sns-pdca-loop tasks 22、cron sns_daily）の再現テスト。
// SQL154 までを PGlite に入れ、YouTube Analytics・GA4 はモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  createSnsDailyStore,
  createYoutubeAnalyticsClient,
  ptDate,
  runSnsDaily,
} from "../lib/snsDailyRunner.js";
import { createGa4Client, getServiceAccountToken } from "../lib/snsGa4.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

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
  youtubeVideos: async () => videos,
  engagedObserved: async (ids, definition) =>
    (
      await all(
        "SELECT draft_id FROM sns_metric_observations WHERE \"window\"='pt3d' AND metric_name='engagedViews' AND source='youtube-analytics' AND metric_value IS NOT NULL AND denominator_value IS NOT NULL AND definition=$1 AND draft_id = ANY($2)",
        [definition, ids],
      )
    ).map((r) => r.draft_id),
  appendObservation: (id, observation) =>
    db.query("SELECT append_sns_metric_observation($1,$2)", [id, observation]),
  fullPictureDrafts: async (raceIds) =>
    (
      await all(
        "SELECT id, platform, posted_at, source_data->'full_picture'->>'race_id' AS race_id FROM sns_drafts WHERE format='full_picture' AND source_data->'full_picture'->>'race_id' = ANY($1)",
        [raceIds],
      )
    ).map((d) => ({ ...d, posted_at: d.posted_at?.toISOString() ?? null })),
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
    upserts.push(rows.length);
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
let videos = [];
let upserts = [];
let draftId;

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
  draftId = (
    await first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at) VALUES(gen_random_uuid(),'short','youtube','ja','全貌','本文','posted','2026-10-09T20:00:00Z') RETURNING id",
    )
  ).id;
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM sns_channel_daily; DELETE FROM sns_metric_observations",
  );
  upserts = [];
  // PT 10-13 に投稿した動画（投稿日 10-13・翌日 10-14 が取り直しの範囲に入る）と、古い動画（範囲外）
  videos = [
    {
      draft_id: draftId,
      external_post_id: "vid1",
      posted_at: "2026-10-13T20:00:00Z",
    },
    {
      draft_id: draftId,
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

// UTM の行: [日付, 流入元, campaign, content, term, 指標...]
function mockGa4(calls = [], { utm = [], utmSonar = [] } = {}) {
  return async () => async (body) => {
    calls.push(body);
    const dims = body.dimensions.map((d) => d.name).join(",");
    const sonar = JSON.stringify(body.dimensionFilter).includes("race_tab");
    if (dims === "date,sessionSource")
      return sonar
        ? [["20261014", "t.co", 2]]
        : [
            ["20261014", "t.co", 5, 6],
            ["20261014", "x", 3, 3],
            ["20261014", "youtube.com", 4, 4],
          ];
    return sonar
      ? [["20261014", "x", "race-full", draftId, "(not set)", 1], ...utmSonar]
      : [
          ["20261014", "x", "race-full", draftId, "(not set)", 2, 2],
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

test("YouTube: チャネル全体は D−3〜D−1（PT）を埋め、動画は投稿日＋翌日だけ、行の無い日は欠測", async () => {
  const calls = [];
  const result = await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(calls),
    ga4: mockGa4(),
  });
  assert.deepEqual(result.report.ptDays, [
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
  ]);
  // 古い動画は日次の行を読まない（クォータを使わない）。pt3d の観測（投稿日から3日目が D−3 より前）だけ1回読む（PD02）
  assert.deepEqual(
    calls.map((c) => c.filters ?? "channel"),
    ["channel", "video==vid1", "video==old"],
  );
  assert.equal(calls[2].dimensions, undefined);
  assert.equal(calls[1].startDate, "2026-10-13");
  assert.equal(calls[1].endDate, "2026-10-14");
  const video = await rows(`draft_id IS NOT NULL AND channel='youtube'`);
  assert.equal(video.length, 10); // 2日×5指標
  assert.deepEqual(
    video
      .filter((r) => r.day === "2026-10-13")
      .map((r) => [r.metric_name, r.v]),
    [
      ["averageViewDuration", 42],
      ["averageViewPercentage", 71.5],
      ["engagedViews", 80],
      ["subscribersGained", 1],
      ["views", 100],
    ],
  );
  assert.ok(
    video
      .filter((r) => r.day === "2026-10-14")
      .every((r) => r.v === null && /未確定/.test(r.missing_reason)),
  );
  const channelViews = await rows(
    `draft_id IS NULL AND channel='youtube' AND metric_name='views'`,
  );
  assert.deepEqual(
    channelViews.map((r) => [r.day, r.v]),
    [
      ["2026-10-12", 10],
      ["2026-10-13", 10],
      ["2026-10-14", 10],
    ],
  );
});

test("GA4: チャネル全体は流入元をチャネルに足し行の無い日は0、UTM は下書きに結びつける", async () => {
  await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4(),
  });
  const x14 = await rows(
    `channel='x' AND day='2026-10-14' AND utm_content IS NULL AND source='site-analytics'`,
  );
  assert.deepEqual(
    x14.map((r) => [r.metric_name, r.v]),
    [
      ["sessions", 9],
      ["sonar_users", 2],
      ["users", 8],
    ],
  );
  const x13 = await rows(
    `channel='x' AND day='2026-10-13' AND utm_content IS NULL AND source='site-analytics'`,
  );
  assert.ok(x13.length === 3 && x13.every((r) => r.v === 0));
  const utm = await rows(`utm_content IS NOT NULL`);
  assert.deepEqual(
    utm.map((r) => [r.day, r.utm_content, r.draft_id, r.metric_name, r.v]),
    [
      ["2026-10-14", draftId, draftId, "sessions", 2],
      ["2026-10-14", draftId, draftId, "sonar_users", 1],
      ["2026-10-14", draftId, draftId, "users", 2],
      ["2026-10-15", "2026-10-15", null, "sessions", 8],
      ["2026-10-15", "2026-10-15", null, "users", 7],
    ],
  );
});

test("取り直しは値が変わった行だけ書く（同じなら0行）", async () => {
  const deps = { store, youtube: mockYoutube(), ga4: mockGa4() };
  const firstRun = await runSnsDaily(ctx(), deps);
  assert.ok(firstRun.rowsWritten > 0);
  const total = Number(
    (await first("SELECT count(*) c FROM sns_channel_daily")).c,
  );
  const again = await runSnsDaily(ctx(), deps);
  assert.equal(again.rowsWritten, 0);
  assert.equal(again.rowsParsed, total);
  // 未確定だった PT 10-14 の動画の値が出たら、その行だけ書き換わる（行は増えない）
  const changed = await runSnsDaily(ctx(), {
    ...deps,
    youtube: async () => ({
      report: async (params) =>
        params.filters === "video==vid1"
          ? [
              {
                day: "2026-10-13",
                views: 100,
                engagedViews: 80,
                averageViewPercentage: 71.5,
                averageViewDuration: 42,
                subscribersGained: 1,
              },
              {
                day: "2026-10-14",
                views: 30,
                engagedViews: 20,
                averageViewPercentage: 60,
                averageViewDuration: 25,
                subscribersGained: 0,
              },
            ]
          : await (await mockYoutube()()).report(params),
    }),
  });
  assert.equal(changed.rowsWritten, 5); // PT 10-14 の5指標
  assert.equal(
    Number((await first("SELECT count(*) c FROM sns_channel_daily")).c),
    total,
  );
});

test("GA4 の鍵が無い間は GA4 を飛ばして report.alerts、YouTube は書く", async () => {
  const result = await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: null,
  });
  assert.equal(result.outcome, undefined);
  assert.equal(result.report.alerts[0].key, "ga4_unconfigured");
  assert.equal((await rows(`source='site-analytics'`)).length, 0);
  assert.ok((await rows(`source='youtube-analytics'`)).length > 0);
});

test("片方が失敗しても、もう片方は書いてから失敗として返す（補足の起動がやり直す）", async () => {
  const result = await runSnsDaily(ctx(), {
    store,
    youtube: async () => {
      throw new Error("YouTube Analytics reports が失敗: HTTP 403");
    },
    ga4: mockGa4(),
  });
  assert.equal(result.outcome, "error");
  assert.match(result.error, /YouTube Analytics.*403/);
  assert.ok((await rows(`source='site-analytics'`)).length > 0);
});

test("shadow は取得と比較までで書かない", async () => {
  const result = await runSnsDaily(ctx("shadow"), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4(),
  });
  assert.ok(result.report.changed > 0);
  assert.equal(result.rowsWritten, 0);
  assert.deepEqual(upserts, []);
});

test("YouTube Analytics の client: 列名で行を組み立て、失敗は状態コードだけ", async () => {
  const urls = [];
  const client = createYoutubeAnalyticsClient({
    accessToken: "t",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json({
        columnHeaders: [{ name: "day" }, { name: "views" }],
        rows: [["2026-10-13", 5]],
      });
    },
  });
  assert.deepEqual(
    await client.report({
      startDate: "2026-10-13",
      endDate: "2026-10-13",
      dimensions: "day",
      metrics: "views",
      filters: "video==a",
    }),
    [{ day: "2026-10-13", views: 5 }],
  );
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("ids"), "channel==MINE");
  assert.equal(u.searchParams.get("filters"), "video==a");
  const failing = createYoutubeAnalyticsClient({
    accessToken: "t",
    fetchImpl: async () =>
      Response.json({ error: { message: "secret" } }, { status: 403 }),
  });
  await assert.rejects(
    failing.report({}),
    (e) => /HTTP 403/.test(e.message) && !/secret/.test(e.message),
  );
});

test("GA4: サービスアカウントの JWT（RS256）でトークンを取り、runReport の行を数にする", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const key = JSON.stringify({
    client_email: "sa@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  let assertion;
  const token = await getServiceAccountToken(key, {
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      assertion = new URLSearchParams(init.body).get("assertion");
      return Response.json({ access_token: "ga4-token" });
    },
  });
  assert.equal(token, "ga4-token");
  const [h, p, sig] = assertion.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  assert.equal(claims.iss, "sa@example.iam.gserviceaccount.com");
  assert.equal(
    claims.scope,
    "https://www.googleapis.com/auth/analytics.readonly",
  );
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(
    createVerify("RSA-SHA256")
      .update(`${h}.${p}`)
      .verify(publicKey, Buffer.from(sig, "base64url")),
  );
  await assert.rejects(
    getServiceAccountToken("not json"),
    /JSON ではありません/,
  );

  const runReport = createGa4Client({
    propertyId: "123",
    accessToken: "ga4-token",
    fetchImpl: async (url) => {
      assert.equal(
        url,
        "https://analyticsdata.googleapis.com/v1beta/properties/123:runReport",
      );
      return Response.json({
        rows: [
          {
            dimensionValues: [{ value: "20261014" }],
            metricValues: [{ value: "3" }],
          },
        ],
      });
    },
  });
  assert.deepEqual(await runReport({}), [["20261014", 3]]);
});

test("PostgREST の store: 既存の行は1000行ずつ読み、upsert は一意制約の列で", async () => {
  const calls = [];
  const pg = createSnsDailyStore({
    url: "https://db",
    key: "k",
    fetchImpl: async (url, init = {}) => {
      calls.push([
        decodeURIComponent(String(url)),
        init.headers?.Range,
        init.headers?.Prefer,
      ]);
      if (init.method === "POST") return new Response(null, { status: 201 });
      const page = String(url).includes("offset=0") ? 1000 : 3;
      return Response.json(Array.from({ length: page }, () => ({})));
    },
  });
  assert.equal((await pg.existing("2026-10-12", "2026-10-15")).length, 1003);
  assert.deepEqual(
    calls.map((c) => c[0].match(/limit=\d+&offset=\d+/)[0]),
    ["limit=1000&offset=0", "limit=1000&offset=1000"],
  );
  assert.match(calls[0][0], /day=gte\.2026-10-12&day=lte\.2026-10-15/);
  await pg.upsert([{}]);
  assert.match(
    calls.at(-1)[0],
    /on_conflict=day,channel,draft_id,utm_content,source,metric_name,definition/,
  );
  assert.equal(calls.at(-1)[2], "resolution=merge-duplicates,return=minimal");
});

test("全貌の UTM（utm_content=race_id）: X・YouTube を term ごとに分け、下書きの投稿日（JST）と翌日だけ残す", async () => {
  const race = "2026-10-13-04-12";
  const ins = (platform, postedAt) =>
    first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at,source_data) VALUES(gen_random_uuid(),'full_picture',$1,'ja','全貌','本文','posted',$2,$3) RETURNING id",
      [platform, postedAt, { full_picture: { race_id: race } }],
    );
  // JST 10/13 17:00 に投稿（posted_at の JST の日付で数える。UTC では同じ日）
  const x = (await ins("x", "2026-10-13T08:00:00Z")).id;
  const yt = (await ins("youtube", "2026-10-13T08:05:00Z")).id;
  // 作り直して push した未投稿の下書き（同じレース・チャネル）があっても、投稿された方を使う
  await ins("x", null);
  await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4([], {
      utm: [
        ["20261013", "x", "race-full", race, "full", 5, 6], // 投稿日
        ["20261014", "x", "race-full", race, "full", 2, 2], // 翌日
        ["20261015", "x", "race-full", race, "full", 9, 9], // 翌々日は数えない
        ["20261014", "youtube", "race-full", race, "shorts", 3, 3],
        ["20261014", "youtube", "race-full", race, "full", 1, 1],
        ["20261014", "x", "race-full", "2026-10-14-05-01", "full", 4, 4], // 下書きの無いレースは数えない
        ["20261014", "youtube", "race-full", draftId, "(not set)", 8, 8], // 下書きの ID の UTM は X だけ
      ],
      utmSonar: [["20261013", "x", "race-full", race, "full", 1]],
    }),
  });
  const got = await all(
    "SELECT day::text, channel, draft_id, metric_name, metric_value::float v, definition FROM sns_channel_daily WHERE utm_content=$1 ORDER BY day, channel, definition, metric_name",
    [race],
  );
  const summary = got.map((r) => [
    r.day,
    r.channel,
    r.draft_id === x ? "x" : r.draft_id === yt ? "yt" : r.draft_id,
    r.metric_name,
    r.v,
    /utm_term=(\w+)/.exec(r.definition)?.[1],
  ]);
  const sorted = (list) =>
    [...list].sort((p, q) =>
      JSON.stringify(p).localeCompare(JSON.stringify(q)),
    );
  assert.deepEqual(
    sorted(summary),
    sorted([
      ["2026-10-13", "x", "x", "sessions", 6, "full"],
      ["2026-10-13", "x", "x", "sonar_users", 1, "full"],
      ["2026-10-13", "x", "x", "users", 5, "full"],
      ["2026-10-14", "x", "x", "sessions", 2, "full"],
      ["2026-10-14", "x", "x", "users", 2, "full"],
      ["2026-10-14", "youtube", "yt", "sessions", 1, "full"],
      ["2026-10-14", "youtube", "yt", "users", 1, "full"],
      ["2026-10-14", "youtube", "yt", "sessions", 3, "shorts"],
      ["2026-10-14", "youtube", "yt", "users", 3, "shorts"],
    ]),
  );
  assert.equal(
    (
      await all(
        "SELECT 1 FROM sns_channel_daily WHERE utm_content='2026-10-14-05-01'",
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await all(
        "SELECT 1 FROM sns_channel_daily WHERE channel='youtube' AND utm_content=$1",
        [draftId],
      )
    ).length,
    0,
  );
});

test("全貌の完全版の機能への導線（utm_content=レース ID/sonar・/assist、hq 契約 10/24 C1）: レース ID で下書きに結びつけ、utm_content は機能つきで残す", async () => {
  const race = "2026-10-13-06-11";
  const yt = (
    await first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at,source_data) VALUES(gen_random_uuid(),'full_picture','youtube','ja','全貌','本文','posted','2026-10-13T08:05:00Z',$1) RETURNING id",
      [{ full_picture: { race_id: race } }],
    )
  ).id;
  await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4([], {
      utm: [
        ["20261013", "youtube", "race-full", `${race}/sonar`, "full", 4, 5],
        ["20261014", "youtube", "race-full", `${race}/assist`, "full", 2, 2],
        [
          "20261014",
          "youtube",
          "race-full",
          "2026-10-14-07-01/sonar",
          "full",
          9,
          9,
        ], // 下書きの無いレースは数えない
      ],
    }),
  });
  const got = await all(
    "SELECT day::text, utm_content, draft_id, metric_name, metric_value::float v FROM sns_channel_daily WHERE utm_content LIKE $1 ORDER BY day, utm_content, metric_name",
    [`${race}/%`],
  );
  assert.deepEqual(
    got.map((r) => [
      r.day,
      r.utm_content,
      r.draft_id === yt ? "yt" : r.draft_id,
      r.metric_name,
      r.v,
    ]),
    [
      ["2026-10-13", `${race}/sonar`, "yt", "sessions", 5],
      ["2026-10-13", `${race}/sonar`, "yt", "users", 4],
      ["2026-10-14", `${race}/assist`, "yt", "sessions", 2],
      ["2026-10-14", `${race}/assist`, "yt", "users", 2],
    ],
  );
  assert.equal(
    (
      await all(
        "SELECT 1 FROM sns_channel_daily WHERE utm_content LIKE '2026-10-14-07-01%'",
      )
    ).length,
    0,
  );
});

test("PostgREST の store: 全貌の下書きは race_id で引き、投稿の時刻を読む", async () => {
  const urls = [];
  const pg = createSnsDailyStore({
    url: "https://db",
    key: "k",
    fetchImpl: async (url) => {
      urls.push(decodeURIComponent(String(url)));
      return Response.json([]);
    },
  });
  await pg.fullPictureDrafts(["2026-10-13-04-12", "2026-10-13-05-01"]);
  assert.match(
    urls[0],
    /sns_drafts\?format=eq\.full_picture&source_data->full_picture->>race_id=in\.\(2026-10-13-04-12,2026-10-13-05-01\)&select=id,platform,posted_at,race_id:source_data->full_picture->>race_id/,
  );
});

test("下書きの ID の UTM に utm_term の違う行が2つ来ても、足して1行にし一括 upsert が落ちない（審査 P2）", async () => {
  const result = await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4([], {
      utm: [["20261014", "x", "race-full", draftId, "manual-test", 3, 4]],
    }),
  });
  assert.equal(result.outcome, undefined);
  const got = await all(
    "SELECT metric_name, metric_value::float v FROM sns_channel_daily WHERE day='2026-10-14' AND utm_content=$1 ORDER BY metric_name",
    [draftId],
  );
  assert.deepEqual(
    got.map((r) => [r.metric_name, r.v]),
    [
      ["sessions", 6],
      ["sonar_users", 1],
      ["users", 5],
    ],
  );
});

test("全貌: JST で翌日になる投稿（UTC 15:00 以降）は JST の日付で数え、投稿済みが2つなら早い方、流入元の大文字・知らない term もそろえる", async () => {
  const race = "2026-10-13-05-02";
  const ins = (platform, postedAt) =>
    first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at,source_data) VALUES(gen_random_uuid(),'full_picture',$1,'ja','全貌','本文','posted',$2,$3) RETURNING id",
      [platform, postedAt, { full_picture: { race_id: race } }],
    );
  // UTC 10/12 15:30 = JST 10/13 00:30 に投稿（JST の投稿日は 10/13、翌日は 10/14）
  const early = (await ins("x", "2026-10-12T15:30:00Z")).id;
  await ins("x", "2026-10-13T05:00:00Z");
  await runSnsDaily(ctx(), {
    store,
    youtube: mockYoutube(),
    ga4: mockGa4([], {
      utm: [
        ["20261013", "X", "race-full", race, "FULL", 2, 2],
        ["20261014", "x", "race-full", race, "abc", 1, 1],
        ["20261015", "x", "race-full", race, "full", 9, 9],
      ],
    }),
  });
  const got = await all(
    "SELECT day::text, channel, draft_id, metric_value::float v, definition FROM sns_channel_daily WHERE utm_content=$1 AND metric_name='users' ORDER BY day",
    [race],
  );
  assert.deepEqual(
    got.map((r) => [
      r.day,
      r.channel,
      r.draft_id === early,
      r.v,
      /utm_term=([^・]+)/.exec(r.definition)[1],
    ]),
    [
      ["2026-10-13", "x", true, 2, "full"],
      ["2026-10-14", "x", true, 1, "その他"],
    ],
  );
});
// ---------- PD02: 動画ごとの engagedViews・views を sns_metric_observations に（pt3d、マイグレーション 175） ----------
const TOTALS = {
  views: 200,
  engagedViews: 150,
  averageViewPercentage: 64.5,
  averageViewDuration: 21,
};
const engagedYoutube =
  (calls = [], totals = TOTALS) =>
  async () => ({
    report: async (params) => {
      calls.push(params);
      if (params.filters === "video==old" && !params.dimensions)
        return totals ? [totals] : [];
      return (await mockYoutube()()).report(params);
    },
  });
const observations = () =>
  all(
    `SELECT draft_id, "window", metric_name, metric_value::float v, missing_reason, denominator_name, denominator_value::float d,
       period_start, period_end, data_through, observed_at, source, external_post_id, revision, definition
     FROM sns_metric_observations ORDER BY metric_name, revision`,
  );

test("pt3d の観測: 投稿日から3日目が D−3 より前の動画だけ、PT の3日の和の engagedViews（分母 views）・views・平均を1回入れる", async () => {
  const calls = [];
  const result = await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube(calls),
    ga4: mockGa4(),
  });
  assert.equal(result.outcome, undefined, result.error);
  // 古い動画（PT 10-09 投稿、3日目 10-11 < D−3 の 10-12）だけ。vid1（PT 10-13）はまだ
  const q = calls.filter((c) => !c.dimensions);
  assert.deepEqual(q, [
    {
      startDate: "2026-10-09",
      endDate: "2026-10-11",
      metrics: "engagedViews,views,averageViewPercentage,averageViewDuration",
      filters: "video==old",
    },
  ]);
  const obs = await observations();
  assert.deepEqual(
    obs.map((o) => [o.metric_name, o.v, o.denominator_name, o.d, o.window]),
    [
      ["averageViewDuration", 21, null, null, "pt3d"],
      ["averageViewPercentage", 64.5, null, null, "pt3d"],
      ["engagedViews", 150, "views", 200, "pt3d"],
      ["views", 200, null, null, "pt3d"],
    ],
  );
  // 窓の終わりは PT の3日目の翌日 0:00（10-12 0:00 PDT = 07:00 UTC）。175 の CHECK と同じ式
  const e = obs[2];
  assert.equal(e.period_start.toISOString(), "2026-10-09T20:00:00.000Z");
  assert.equal(e.period_end.toISOString(), "2026-10-12T07:00:00.000Z");
  assert.equal(e.data_through.toISOString(), "2026-10-12T07:00:00.000Z");
  assert.equal(e.observed_at.toISOString(), NOW.toISOString());
  assert.equal(e.source, "youtube-analytics");
  assert.equal(e.external_post_id, "old");
  assert.match(e.definition, /投稿日から3日の和（窓 pt3d/);
  assert.equal(result.report.observed, 4);
  // 次の日も、engagedViews と分母の入った観測があれば読まない・入れない
  const again = [];
  await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube(again),
    ga4: mockGa4(),
  });
  assert.equal(again.filter((c) => !c.dimensions).length, 0);
  assert.equal((await observations()).length, 4);
});

test("pt3d の窓の終わり: 夏時間・冬時間・切り替わりの日も PT の 0:00", async () => {
  const { ptMidnightUtc } = await import("../lib/snsDailyRunner.js");
  assert.equal(ptMidnightUtc("2026-10-12"), "2026-10-12T07:00:00.000Z");
  assert.equal(ptMidnightUtc("2026-11-02"), "2026-11-02T08:00:00.000Z");
  // 2026-11-01 は夏時間の終わり（0:00 はまだ PDT）
  assert.equal(ptMidnightUtc("2026-11-01"), "2026-11-01T07:00:00.000Z");
  // PGlite の 175 の CHECK と同じ値になる（冬時間の投稿）
  const row = await first(
    `SELECT ((((timestamptz '2026-11-05T20:00:00Z' AT TIME ZONE 'America/Los_Angeles')::date + 3)::timestamp) AT TIME ZONE 'America/Los_Angeles') e`,
  );
  assert.equal(row.e.toISOString(), ptMidnightUtc("2026-11-08"));
});

test("pt3d の観測: Analytics が行を返さなければ欠測で入れ、値が出た日に入れ直す（revision 2）", async () => {
  await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube([], null),
    ga4: mockGa4(),
  });
  const missing = await observations();
  assert.ok(
    missing.every(
      (o) => o.v === null && /未確定/.test(o.missing_reason) && !o.data_through,
    ),
  );
  assert.ok(missing.every((o) => o.denominator_name === null));
  await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube(),
    ga4: mockGa4(),
  });
  const ev = (await observations()).filter(
    (o) => o.metric_name === "engagedViews",
  );
  assert.deepEqual(
    ev.map((o) => [o.revision, o.v]),
    [
      [1, null],
      [2, 150],
    ],
  );
});

test("pt3d の観測: engagedViews があっても分母の views が欠けたら、次の日に取り直す", async () => {
  await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube([], { engagedViews: 150 }),
    ga4: mockGa4(),
  });
  const calls = [];
  await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube(calls),
    ga4: mockGa4(),
  });
  assert.equal(calls.filter((c) => !c.dimensions).length, 1);
});

test("pt3d の観測: 175 の前（窓の CHECK）は日次の取り込みを失敗にせず知らせる。ほかの CHECK 違反・失敗は失敗にし、残りの動画も入れる。shadow は入れない", async () => {
  const result = await runSnsDaily(ctx(), {
    store: {
      ...store,
      appendObservation: async () => {
        throw new Error(
          '観測の保存に失敗: HTTP 400 {"code":"23514","message":"new row for relation \\"sns_metric_observations\\" violates check constraint \\"sns_metric_observations_window_check\\""}',
        );
      },
    },
    youtube: engagedYoutube(),
    ga4: mockGa4(),
  });
  assert.equal(result.outcome, undefined);
  assert.ok(
    result.report.alerts.some((a) => a.key === "engaged_window_unapplied"),
  );
  // 日次の表は今までどおり書く
  assert.ok((await rows(`source='youtube-analytics'`)).length > 0);
  // 期間の式の CHECK 違反は「未適用」にしない
  const tried = [];
  const failed = await runSnsDaily(ctx(), {
    store: {
      ...store,
      appendObservation: async (id, o) => {
        tried.push(o.metric_name);
        throw new Error(
          '観測の保存に失敗: HTTP 400 {"code":"23514","message":"violates check constraint \\"sns_metric_observations_period_end\\""}',
        );
      },
    },
    youtube: engagedYoutube(),
    ga4: mockGa4(),
  });
  assert.equal(failed.outcome, "error");
  assert.match(failed.error, /engagedViews の観測/);
  assert.ok(
    !failed.report.alerts.some((a) => a.key === "engaged_window_unapplied"),
  );
  // 1件の失敗で止めず、残りも試す
  assert.equal(tried.length, 4);
  await runSnsDaily(ctx("shadow"), {
    store,
    youtube: engagedYoutube(),
    ga4: mockGa4(),
  });
  assert.equal((await observations()).length, 0);
});

test("pt3d の観測: 実際の CHECK（175）を通る（窓の値と窓の終わりの式）", async () => {
  await runSnsDaily(ctx(), {
    store,
    youtube: engagedYoutube(),
    ga4: mockGa4(),
  });
  assert.equal((await observations()).length, 4);
  const def = await first(
    "SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='sns_metric_observations_window_check'",
  );
  assert.match(def.d, /pt3d/);
});

test("PostgREST の store: pt3d の観測の有無を引き、append_sns_metric_observation で入れる", async () => {
  const calls = [];
  const s = createSnsDailyStore({
    url: "https://db",
    key: "k",
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url: decodeURIComponent(String(url)), opts });
      return String(url).includes("rpc/")
        ? new Response("{}")
        : Response.json([{ draft_id: "d1" }]);
    },
  });
  assert.deepEqual(await s.engagedObserved(["d1", "d2"], "定義"), ["d1"]);
  assert.match(
    calls[0].url,
    /sns_metric_observations\?window=eq\.pt3d&metric_name=eq\.engagedViews&source=eq\.youtube-analytics&metric_value=not\.is\.null&denominator_value=not\.is\.null&definition=eq\.定義&draft_id=in\.\(d1,d2\)/,
  );
  await s.appendObservation("d1", { window: "pt3d" });
  assert.equal(
    calls[1].url,
    "https://db/rest/v1/rpc/append_sns_metric_observation",
  );
  assert.deepEqual(JSON.parse(calls[1].opts.body), {
    p_draft_id: "d1",
    p_observation: { window: "pt3d" },
  });
  const bad = createSnsDailyStore({
    url: "https://db",
    key: "k",
    fetchImpl: async () => new Response("no", { status: 400 }),
  });
  await assert.rejects(bad.appendObservation("d1", {}), /HTTP 400/);
});
