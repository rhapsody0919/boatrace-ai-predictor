/**
 * verify-sns-daily-runner.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-daily-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSnsDaily } from "../../lib/snsDailyRunner.js";

let first, ctx, store, sdrState, mockYoutube, mockGa4, rows;

function sdr1Scene1() {
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
}

function sdr1Scene2() {
  test("YouTube: 行なしは PT の D−3 の件数だけ0確定し、平均と直近日は欠測", async () => {
    sdrState.videos = [
      {
        draft_id: sdrState.draftId,
        external_post_id: "empty",
        posted_at: "2026-10-12T20:00:00Z",
      },
    ];
    const deps = {
      store,
      youtube: async () => ({ report: async () => [] }),
      ga4: null,
    };
    const result = await runSnsDaily(ctx(), deps);
    const saved = await rows("channel='youtube'");
    const counts = ["views", "engagedViews", "subscribersGained"];
    const settled = saved.filter(
      (r) => r.day === "2026-10-12" && counts.includes(r.metric_name),
    );
    assert.equal(settled.length, 6); // チャネルと動画の3指標
    assert.ok(settled.every((r) => r.v === 0 && r.missing_reason === null));
    const averages = saved.filter(
      (r) => r.day === "2026-10-12" && !counts.includes(r.metric_name),
    );
    assert.equal(averages.length, 2);
    assert.ok(
      averages.every(
        (r) => r.v === null && /平均.*算出できない/.test(r.missing_reason),
      ),
    );
    const recent = saved.filter((r) => r.day !== "2026-10-12");
    assert.equal(recent.length, 11);
    assert.ok(
      recent.every((r) => r.v === null && /未確定/.test(r.missing_reason)),
    );
    assert.deepEqual(
      [...result.report.youtubeZeroFinalizations].sort(
        (a, b) =>
          a.metric_name.localeCompare(b.metric_name) ||
          String(a.draft_id).localeCompare(String(b.draft_id)),
      ),
      settled
        .map((r) => ({
          day: r.day,
          channel: r.channel,
          draft_id: r.draft_id,
          metric_name: r.metric_name,
          reason: "Analytics が行を返さない日を D−3 で0と確定",
        }))
        .sort(
          (a, b) =>
            a.metric_name.localeCompare(b.metric_name) ||
            String(a.draft_id).localeCompare(String(b.draft_id)),
        ),
    );
    const again = await runSnsDaily(ctx(), deps);
    assert.equal(again.rowsWritten, 0);
    assert.deepEqual(
      again.report.youtubeZeroFinalizations,
      result.report.youtubeZeroFinalizations,
    );
  });
}

function sdr1Scene3() {
  test("YouTube: D−2 の欠測は翌日の D−3 で同じキーの0へ更新する", async () => {
    sdrState.videos = [
      {
        draft_id: sdrState.draftId,
        external_post_id: "empty",
        posted_at: "2026-10-13T20:00:00Z",
      },
    ];
    const deps = {
      store,
      ga4: null,
      youtube: async () => ({ report: async () => [] }),
    };
    await runSnsDaily(ctx(), deps);
    const where = "channel='youtube' AND day='2026-10-13'";
    const beforeRows = await rows(where);
    assert.equal(beforeRows.length, 8);
    assert.ok(beforeRows.every((r) => r.v === null));
    await runSnsDaily(
      {
        ...ctx(),
        now: () => new Date("2026-10-17T01:05:00Z"),
        targetDate: "2026-10-17",
      },
      deps,
    );
    const afterRows = await rows(where);
    assert.equal(afterRows.length, 8);
    assert.ok(
      afterRows
        .filter((r) => !r.metric_name.startsWith("average"))
        .every((r) => r.v === 0 && r.missing_reason === null),
    );
    assert.ok(
      afterRows
        .filter((r) => r.metric_name.startsWith("average"))
        .every((r) => r.v === null),
    );
  });
  test("YouTube: D−3 でも行の値が不正・欠落なら0にせず、明示0を規則の0として報告しない", async () => {
    sdrState.videos = [];
    for (const value of [undefined, null, -1, NaN, "0", 0]) {
      const result = await runSnsDaily(ctx(), {
        store,
        ga4: null,
        youtube: async () => ({
          report: async () => [{ day: "2026-10-12", views: value }],
        }),
      });
      const saved = await rows("channel='youtube' AND day='2026-10-12'");
      assert.equal(saved.length, 3);
      assert.ok(
        saved.every(
          (r) => r.v === (r.metric_name === "views" && value === 0 ? 0 : null),
        ),
      );
      assert.deepEqual(result.report.youtubeZeroFinalizations, []);
    }
  });
  test("YouTube: API 失敗は0確定せず失敗結果とする", async () => {
    const result = await runSnsDaily(ctx(), {
      store,
      ga4: null,
      youtube: async () => ({
        report: async () => {
          throw new Error("fixture failure");
        },
      }),
    });
    assert.equal(result.outcome, "error");
    assert.deepEqual(await rows("channel='youtube'"), []);
    assert.deepEqual(result.report.youtubeZeroFinalizations, []);
  });
}

function sdr1Scene4() {
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
        ["2026-10-14", sdrState.draftId, sdrState.draftId, "sessions", 2],
        ["2026-10-14", sdrState.draftId, sdrState.draftId, "sonar_users", 1],
        ["2026-10-14", sdrState.draftId, sdrState.draftId, "users", 2],
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
}

function sdr1Scene5() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・ctx・store・sdrState・mockYoutube・mockGa4・rows） */
export function runSnsDailyRunnerScenes1(env) {
  ({ first, ctx, store, sdrState, mockYoutube, mockGa4, rows } = env);
  sdr1Scene1();
  sdr1Scene2();
  sdr1Scene3();
  sdr1Scene4();
  sdr1Scene5();
}
