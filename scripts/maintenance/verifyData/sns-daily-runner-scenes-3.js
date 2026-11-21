/**
 * verify-sns-daily-runner.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-daily-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSnsDaily, createSnsDailyStore } from "../../lib/snsDailyRunner.js";

let db, first, all, NOW, ctx, store, sdrState, mockYoutube, mockGa4, rows;

// ---------- PD02: 動画ごとの engagedViews・views を sns_metric_observations に（pt3d、マイグレーション 175） ----------
const TOTALS = {
  views: 200,
  engagedViews: 150,
  averageViewPercentage: 64.5,
  averageViewDuration: 21,
};

export const engagedYoutube =
  (calls = [], totals = TOTALS) =>
  async () => ({
    report: async (params) => {
      calls.push(params);
      if (params.filters === "video==old" && !params.dimensions)
        return totals ? [totals] : [];
      return (await mockYoutube()()).report(params);
    },
  });

export const nextDay = {
  mode: "live",
  now: () => new Date(NOW.getTime() + 86400000),
  targetDate: "2026-10-17",
};

export const observations = () =>
  all(
    `SELECT draft_id, "window", metric_name, metric_value::float v, missing_reason, denominator_name, denominator_value::float d,
       period_start, period_end, data_through, observed_at, source, external_post_id, revision, definition
     FROM sns_metric_observations ORDER BY metric_name, revision`,
  );

function sdr3Scene1() {
  test("節の機力の Shorts の読み取りに落ちても、ほかの GA4 の行は書き、分かる理由で失敗として返す", async () => {
    const result = await runSnsDaily(ctx(), {
      store: {
        ...store,
        setsuShortDrafts: async () => {
          throw new Error(
            "日次の取り込みの DB の読み取りに失敗: HTTP 500 sns_drafts",
          );
        },
      },
      youtube: mockYoutube(),
      ga4: mockGa4(),
    });
    assert.equal(result.outcome, "error");
    assert.match(result.error, /GA4（節の機力の Shorts）: .*HTTP 500/);
    assert.ok((await rows("source='site-analytics'")).length > 0);
  });
  test("節の機力の Shorts の下書きが無ければ GA4 を余分に呼ばない", async () => {
    await db.query("DELETE FROM sns_drafts WHERE format LIKE 'setsu_kiryoku%'");
    const calls = [];
    await runSnsDaily(ctx(), {
      store,
      youtube: mockYoutube(),
      ga4: mockGa4(calls),
    });
    assert.equal(
      calls.some((c) =>
        JSON.stringify(c.dimensionFilter).includes("landingPage"),
      ),
      false,
    );
  });
  test("PostgREST の store: 節の機力の Shorts は format と platform で引き、説明欄を読む", async () => {
    const urls = [];
    const pg = createSnsDailyStore({
      url: "https://db",
      key: "k",
      fetchImpl: async (url) => {
        urls.push(decodeURIComponent(String(url)));
        return Response.json([]);
      },
    });
    await pg.setsuShortDrafts("2026-10-12T00:00:00+09:00");
    assert.equal(
      urls[0],
      "https://db/rest/v1/sns_drafts?format=eq.setsu_kiryoku_short&platform=eq.youtube&posted_at=gte.2026-10-12T00:00:00+09:00&select=id,posted_at,caption_text",
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
        utm: [
          ["20261014", "x", "race-full", sdrState.draftId, "manual-test", 3, 4],
        ],
      }),
    });
    assert.equal(result.outcome, undefined);
    const got = await all(
      "SELECT metric_name, metric_value::float v FROM sns_channel_daily WHERE day='2026-10-14' AND utm_content=$1 ORDER BY metric_name",
      [sdrState.draftId],
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
}

function sdr3Scene2() {
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
}

function sdr3Scene3() {
  test("pt3d の窓の終わり: 夏時間・冬時間・切り替わりの日も PT の 0:00", async () => {
    const { ptMidnightUtc } = await import("../../lib/snsDailyRunner.js");
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
        (o) =>
          o.v === null && /未確定/.test(o.missing_reason) && !o.data_through,
      ),
    );
    assert.ok(missing.every((o) => o.denominator_name === null));
    // 同じ日の2回目の起動（補足の起動）では欠測を重ねない
    const same = [];
    await runSnsDaily(ctx(), {
      store,
      youtube: engagedYoutube(same, null),
      ga4: mockGa4(),
    });
    assert.equal(same.filter((c) => !c.dimensions).length, 0);
    // 次の日に値が出たら入れ直す
    await runSnsDaily(nextDay, {
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
    await runSnsDaily(nextDay, {
      store,
      youtube: engagedYoutube(calls),
      ga4: mockGa4(),
    });
    assert.equal(calls.filter((c) => !c.dimensions).length, 1);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・NOW・ctx・store・sdrState・mockYoutube・mockGa4・rows） */
export function runSnsDailyRunnerScenes4(env) {
  ({ db, first, all, NOW, ctx, store, sdrState, mockYoutube, mockGa4, rows } =
    env);
  sdr3Scene1();
  sdr3Scene2();
  sdr3Scene3();
}
