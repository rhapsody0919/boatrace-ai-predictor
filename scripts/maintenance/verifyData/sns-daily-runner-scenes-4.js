/**
 * verify-sns-daily-runner.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-daily-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSnsDaily, createSnsDailyStore } from "../../lib/snsDailyRunner.js";
import {
  engagedYoutube,
  observations,
  nextDay,
} from "./sns-daily-runner-scenes-3.js";

let first, all, ctx, store, sdrState, mockYoutube, mockGa4, rows;

function sdr4Scene1() {
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
}

function sdr4Scene2() {
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
    assert.deepEqual(
      await s.engagedObservations(["d1", "d2"], ["engagedViews", "views"]),
      [{ draft_id: "d1" }],
    );
    assert.match(
      calls[0].url,
      /sns_metric_observations\?window=eq\.pt3d&source=eq\.youtube-analytics&metric_name=in\.\(engagedViews,views\)&draft_id=in\.\(d1,d2\)&select=draft_id,metric_name,definition,metric_value,denominator_value,observed_at/,
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
    // PostgREST の本文は details が長い。制約名（message）を切らずに残す（/code-review の指摘）
    const pg = createSnsDailyStore({
      url: "https://db",
      key: "k",
      fetchImpl: async () =>
        Response.json(
          {
            code: "23514",
            details: `Failing row contains (${"x".repeat(400)})`,
            hint: null,
            message:
              'new row for relation "sns_metric_observations" violates check constraint "sns_metric_observations_window_check"',
          },
          { status: 400 },
        ),
    });
    await assert.rejects(
      pg.appendObservation("d1", {}),
      /HTTP 400 23514 .*sns_metric_observations_window_check/,
    );
  });
  test("pt3d の観測: 1本の Analytics の読み取りに落ちても、残りの動画は入れ、失敗として返す。日付が壊れていれば分かる理由で落とす", async () => {
    sdrState.videos.push({
      draft_id: sdrState.draftId,
      external_post_id: "broken",
      posted_at: "2026-10-09T20:00:00Z",
    });
    const result = await runSnsDaily(ctx(), {
      store,
      youtube: async () => ({
        report: async (params) => {
          if (params.filters === "video==broken" && !params.dimensions)
            throw new Error("YouTube Analytics reports が失敗: HTTP 500");
          return (await engagedYoutube()()).report(params);
        },
      }),
      ga4: mockGa4(),
    });
    assert.equal(result.outcome, "error");
    assert.match(
      result.error,
      /engagedViews の観測（.*）の読み取り: .*HTTP 500/,
    );
    assert.equal((await observations()).length, 4);
    // 日次の表は今までどおり書く
    assert.ok((await rows(`draft_id IS NOT NULL`)).length > 0);
    const { ptMidnightUtc } = await import("../../lib/snsDailyRunner.js");
    assert.throws(
      () => ptMidnightUtc("Invalid Date"),
      /PT の 0:00 を出せない日付/,
    );
  });
}

function sdr4Scene3() {
  test("pt3d の観測: 4指標のうち1つの保存に落ちたら、次の日にその指標だけ取り直す（Codex の審査 P1）", async () => {
    const first1 = await runSnsDaily(ctx(), {
      store: {
        ...store,
        appendObservation: async (id, o) => {
          if (o.metric_name === "views")
            throw new Error("観測の保存に失敗: HTTP 503");
          return store.appendObservation(id, o);
        },
      },
      youtube: engagedYoutube(),
      ga4: mockGa4(),
    });
    assert.equal(first1.outcome, "error");
    assert.deepEqual(
      (await observations()).map((o) => o.metric_name),
      ["averageViewDuration", "averageViewPercentage", "engagedViews"],
    );
    const calls = [];
    const again = await runSnsDaily(nextDay, {
      store,
      youtube: engagedYoutube(calls),
      ga4: mockGa4(),
    });
    assert.equal(again.report.observed, 1);
    assert.equal(calls.filter((c) => !c.dimensions).length, 1);
    assert.deepEqual(
      (await observations()).map((o) => [o.metric_name, o.v]),
      [
        ["averageViewDuration", 21],
        ["averageViewPercentage", 64.5],
        ["engagedViews", 150],
        ["views", 200],
      ],
    );
  });
}

function sdr4Scene4() {
  test("思考アシストの UTM: page_view の人数を投稿日と翌日だけ全貌へ保存する", async () => {
    const race = "2026-10-13-08-12";
    const id = (
      await first(
        "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,status,posted_at,source_data) VALUES(gen_random_uuid(),'full_picture','youtube','ja','全貌','本文','posted','2026-10-13T08:05:00Z',$1) RETURNING id",
        [{ full_picture: { race_id: race } }],
      )
    ).id;
    const calls = [];
    await runSnsDaily(ctx(), {
      store,
      youtube: mockYoutube(),
      ga4: mockGa4(calls, {
        utmAssist: [
          ["20261013", "YouTube", "race-full", `${race}/assist`, "FULL", 3],
          ["20261014", "youtube", "race-full", race, "shorts", 2],
          ["20261015", "youtube", "race-full", race, "full", 9],
          [
            "20261014",
            "youtube",
            "race-full",
            "2026-10-14-07-01/assist",
            "full",
            9,
          ],
        ],
      }),
    });
    const got = await all(
      "SELECT day::text, channel, draft_id, utm_content, metric_value::float v, definition FROM sns_channel_daily WHERE metric_name='assist_users' ORDER BY day",
    );
    assert.deepEqual(
      got.map((r) => [r.day, r.channel, r.draft_id, r.utm_content, r.v]),
      [
        ["2026-10-13", "youtube", id, `${race}/assist`, 3],
        ["2026-10-14", "youtube", id, race, 2],
      ],
    );
    assert.match(got[0].definition, /assist_users.*utm_term=full/);
    assert.match(got[1].definition, /assist_users.*utm_term=shorts/);
    const request = calls.find((c) =>
      JSON.stringify(c.dimensionFilter).includes("pagePath"),
    );
    assert.deepEqual(request.metrics, [{ name: "totalUsers" }]);
    assert.equal(request.dimensions.length, 5);
    const filter = request.dimensionFilter.andGroup.expressions.at(-1);
    assert.deepEqual(filter.andGroup.expressions[0], {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "page_view" },
      },
    });
    const path = filter.andGroup.expressions[1].filter;
    assert.equal(path.fieldName, "pagePath");
    assert.equal(path.stringFilter.matchType, "FULL_REGEXP");
    const re = new RegExp(path.stringFilter.value);
    for (const prefix of ["", "/en", "/zh-TW", "/ko"])
      assert.ok(re.test(`${prefix}/race/${race}/assist`));
    for (const path of [
      `/race/${race}`,
      `/race/${race}/assist/extra`,
      "/assist",
      `/race/${race}/assistant`,
    ])
      assert.equal(re.test(path), false);
    assert.equal(calls.filter((c) => c.dimensions.length === 2).length, 2);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・all・ctx・store・sdrState・mockYoutube・mockGa4・rows） */
export function runSnsDailyRunnerScenes5(env) {
  ({ first, all, ctx, store, sdrState, mockYoutube, mockGa4, rows } = env);
  sdr4Scene1();
  sdr4Scene2();
  sdr4Scene3();
  sdr4Scene4();
}
