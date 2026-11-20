/**
 * verify-sns-daily-runner.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-daily-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  runSnsDaily,
  createYoutubeAnalyticsClient,
  createSnsDailyStore,
  setsuShortLink,
} from "../../lib/snsDailyRunner.js";
import { getServiceAccountToken, createGa4Client } from "../../lib/snsGa4.js";

let first, all, ctx, store, sdrState, mockYoutube, mockGa4;

function sdr2Scene1() {
  test("shadow は取得と比較までで書かない", async () => {
    const result = await runSnsDaily(ctx("shadow"), {
      store,
      youtube: mockYoutube(),
      ga4: mockGa4(),
    });
    assert.ok(result.report.changed > 0);
    assert.equal(result.rowsWritten, 0);
    assert.deepEqual(sdrState.upserts, []);
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
}

function sdr2Scene2() {
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
}

function sdr2Scene3() {
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
          [
            "20261014",
            "youtube",
            "race-full",
            sdrState.draftId,
            "(not set)",
            8,
            8,
          ], // 下書きの ID の UTM は X だけ
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
          [sdrState.draftId],
        )
      ).length,
      0,
    );
  });
}

function sdr2Scene4() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・ctx・store・sdrState・mockYoutube・mockGa4） */
export function runSnsDailyRunnerScenes2(env) {
  ({ first, all, ctx, store, sdrState, mockYoutube, mockGa4 } = env);
  sdr2Scene1();
  sdr2Scene2();
  sdr2Scene3();
  sdr2Scene4();
}

function sdr2Scene5() {
  test("節の機力の Shorts のリンクの読み取り: 会場のページだけ、utm_source・utm_medium・utm_content が要る、0 埋めと句読点", () => {
    const q = "utm_source=youtube&utm_medium=shorts&utm_content=final_gap";
    assert.deepEqual(
      setsuShortLink(
        `見て\nhttps://www.boat-ai.jp/venue/01?${q}）。\n#ボートレース`,
      ),
      {
        venue: 1,
        utm: {
          sessionSource: "youtube",
          sessionMedium: "shorts",
          sessionManualAdContent: "final_gap",
        },
      },
    );
    assert.equal(
      setsuShortLink(`https://www.boat-ai.jp/venue/13?${q}&utm_campaign=Setsu`)
        .utm.sessionCampaignName,
      "setsu",
    );
    for (const caption of [
      "https://www.boat-ai.jp/venue/13?utm_source=youtube",
      `https://www.boat-ai.jp/venue/13/meet/2026-10-10?${q}`,
      `https://example.com/venue/13?${q}`,
      "リンクなし",
      null,
    ])
      assert.equal(setsuShortLink(caption), null, String(caption));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・ctx・store・sdrState・mockYoutube・mockGa4） */
export function runSnsDailyRunnerScenes3(env) {
  ({ first, all, ctx, store, sdrState, mockYoutube, mockGa4 } = env);
  sdr2Scene5();
}
