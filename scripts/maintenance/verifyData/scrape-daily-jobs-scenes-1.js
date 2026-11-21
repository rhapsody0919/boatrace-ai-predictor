/**
 * verify-scrape-daily-jobs.js の後半の場面（1/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../../lib/scrapeJobs/dailyJob.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { runPointRankJob } from "../../lib/pointRankJob.js";
import { runVenueEntryCourseStatsJob } from "../../lib/venueEntryCourseStatsJob.js";
import { runVenueMotorStatsJob } from "../../lib/venueMotorStatsJob.js";
import { runRacerNewsJob } from "../../lib/racerNewsJob.js";
import { runRacerProfilesJob } from "../../lib/racerProfilesJob.js";
import { runRaceSeriesJob } from "../../lib/raceSeriesJob.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";

let check, show, jst, POINT_RANK_G1, POINT_RANK_NONE, createFakeFetch, liveRow, runJob, throwingFetch, strictClient;

// ===========================================================================
// (c)(d) 得点率（B2）
// ===========================================================================
export const POINT_RANK_TABLES = () => ({
  races: [
    { race_id: "2026-09-19-05-01", race_grade: "G1" },
    { race_id: "2026-09-19-05-02", race_grade: "G1" },
    { race_id: "2026-09-19-17-01", race_grade: "G3" },
    { race_id: "2026-09-19-04-01", race_grade: "ippan" },
  ],
  race_conditions: [
    { race_id: "2026-09-19-05-01", series_day: 4 },
    { race_id: "2026-09-19-17-01", series_day: 2 },
  ],
});

export const pointRankFetch = (overrides = {}) =>
  createFakeFetch((url) => {
    const jcd = new URL(url).searchParams.get("jcd");
    if (jcd in overrides) return overrides[jcd];
    return jcd === "05" ? POINT_RANK_G1 : POINT_RANK_NONE;
  });

async function scene1() {
  // ===========================================================================
  // (a) 対象日の解決（G1・G2の再発防止）
  // ===========================================================================
  {
    const cases = [
      // [ジョブ, 起動時刻(JST), 期待する対象日, 説明]
      ["point_rank", "2026-09-19T22:00:00", "2026-09-19", "指定時刻ちょうど"],
      [
        "point_rank",
        "2026-09-20T01:51:00",
        "2026-09-19",
        "GitHub Actionsの遅延起動と同じ 01:51 でも、対象日は前日のまま（G1）",
      ],
      ["point_rank", "2026-09-19T21:59:00", "2026-09-18", "指定時刻の前は前日"],
      [
        "entry_course_stats",
        "2026-09-19T23:41:00",
        "2026-09-19",
        "23:41 起動（G2で1,296件保存できた日）",
      ],
      [
        "entry_course_stats",
        "2026-09-20T00:21:00",
        "2026-09-19",
        "00:21 起動（G2で翌日を対象にして0件だった時刻）でも前日",
      ],
      ["venue_motor_stats", "2026-09-19T08:04:00", "2026-09-19", "遅延起動"],
      ["racer_news", "2026-09-20T01:10:00", "2026-09-19", "補足の起動は前日"],
      [
        "racer_profiles",
        "2026-10-02T03:00:00",
        "2026-10-02",
        "月次の窓の始まり(UTC 18:00)",
      ],
      [
        "racer_profiles",
        "2026-10-02T05:50:00",
        "2026-10-02",
        "月次の窓の終わり(UTC 20:50)",
      ],
      [
        "racer_profiles",
        "2026-10-02T02:59:00",
        "2026-10-01",
        "指定時刻の前は前日",
      ],
    ];
    for (const [job, at, expected, label] of cases) {
      const actual = resolveTargetDate(jst(at), SCRAPE_JOBS[job].targetTimeJst);
      check(`対象日 ${job} ${at}: ${label}`, actual === expected, actual);
    }

    // 実際に、翌日の races を引かない: 01:51 JST に起動しても、races を like '2026-09-19%' で引く
    const client = createFakeClient({
      tables: {
        races: [{ race_id: "2026-09-19-04-01", race_grade: "ippan" }],
        race_conditions: [],
      },
    });
    const seenLikes = [];
    const origFrom = client.from;
    client.from = (table) => {
      const b = origFrom(table);
      const origLike = b.like;
      b.like = (c, p) => {
        seenLikes.push(p);
        return origLike(c, p);
      };
      return b;
    };
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const fetchImpl = createFakeFetch(() => POINT_RANK_NONE);
    const res = await runJob({
      job: "point_rank",
      run: (ctx) => runPointRankJob(ctx),
      store,
      client,
      politeFetch: fetchImpl,
      at: jst("2026-09-20T01:51:00"),
    });
    check(
      "得点率: 01:51 JST の起動でも、対象日(09-19)の races を引き、翌日(09-20)を引かない",
      res.status === 200 &&
        res.body.targetDate === "2026-09-19" &&
        seenLikes.some((p) => p.startsWith("2026-09-19")) &&
        !seenLikes.some((p) => p.startsWith("2026-09-20")),
      show({ status: res.status, body: res.body, seenLikes }),
    );
  }
}

async function scene2() {
  // ===========================================================================
  // (b) off・行なし・075未適用は、何も取得せず、何も書かない
  // ===========================================================================
  {
    const jobs = [
      ["point_rank", (ctx) => runPointRankJob(ctx)],
      ["entry_course_stats", (ctx) => runVenueEntryCourseStatsJob(ctx)],
      ["venue_motor_stats", (ctx) => runVenueMotorStatsJob(ctx)],
      ["racer_news", (ctx) => runRacerNewsJob(ctx)],
      ["racer_profiles", (ctx) => runRacerProfilesJob(ctx)],
      ["race_series", (ctx) => runRaceSeriesJob(ctx)],
    ];
    for (const [job, run] of jobs) {
      for (const [label, storeOptions] of [
        ["mode=off", { rows: { [job]: { job, mode: "off" } } }],
        ["行なし", {}],
        ["075未適用", { available: false }],
      ]) {
        const store = createMemoryStore(storeOptions);
        const fetchImpl = throwingFetch();
        const res = await runJob({
          job,
          run,
          store,
          client: strictClient(),
          politeFetch: fetchImpl,
          at: jst("2026-09-19T22:30:00"),
        });
        check(
          `${job} ${label}: 何も取得せず、DBのデータテーブルにもアクセスせず、200で終わる`,
          res.status === 200 &&
            fetchImpl.count === 0 &&
            !store.calls.some((c) => c.name === "acquireLease"),
          show(res),
        );
      }
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・jst・POINT_RANK_G1・POINT_RANK_NONE・createFakeFetch・liveRow・runJob・throwingFetch・strictClient） */
export async function runScrapeDailyJobsScenes1(env) {
  ({ check, show, jst, POINT_RANK_G1, POINT_RANK_NONE, createFakeFetch, liveRow, runJob, throwingFetch, strictClient } = env);
  await scene1();
  await scene2();
}
