/**
 * verify-scrape-daily-jobs.js の後半の場面（2/9）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-daily-jobs.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { FetchError } from "../../lib/scrapeJobs/politeFetch.js";
import { runPointRankJob } from "../../lib/pointRankJob.js";
import { run as runPointRank } from "../../daily/scrape-point-rank.js";
import { createFakeSupabaseClient as createFakeClient } from "../../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { POINT_RANK_TABLES, pointRankFetch } from "./scrape-daily-jobs-scenes-1.js";

let check, show, jst, POINT_RANK_G1, POINT_RANK_NONE, liveRow, runJob;

/** 元の verify の1つの塊 { } を割った 1/5 */
async function scene1() {
  const at = jst("2026-09-19T22:00:00");
  const runIt = (store, client, fetchImpl, when = at) =>
    runJob({
      job: "point_rank",
      run: (ctx) => runPointRankJob(ctx),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });
  // shadow: 取得・解析のみ。書かない・処理済みにしない
  {
    const client = createFakeClient({ tables: POINT_RANK_TABLES() });
    const store = createMemoryStore({
      rows: { point_rank: { ...liveRow("point_rank"), mode: "shadow" } },
    });
    const fetchImpl = pointRankFetch();
    const res = await runIt(store, client, fetchImpl);
    const row = store.state.get("point_rank");
    check(
      "得点率 shadow: 3会場を取得・解析し、racer_series_points へ書かず、対象日を処理済みにしない",
      res.status === 200 &&
        fetchImpl.log.length === 3 &&
        client.writesTo("racer_series_points").length === 0 &&
        row.last_target_date === undefined &&
        row.last_report?.rowsParsed === 52 &&
        row.last_report?.expectedVenues === 1,
      show({ body: res.body, report: row.last_report }),
    );
  }
  return { at, runIt };
}

/** 元の verify の1つの塊 { } を割った 2/5 */
async function scene2({ at, runIt }) {
  // live: 書く・処理済みにする・2回目は何もしない（冪等）
  {
    const client = createFakeClient({ tables: POINT_RANK_TABLES() });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const fetchImpl = pointRankFetch();
    const res = await runIt(store, client, fetchImpl);
    const written = client.data.racer_series_points ?? [];
    const row = store.state.get("point_rank");
    check(
      "得点率 live: G1の4日目の表(52名)を書く。meet_start_date は対象日から series_day で逆算(09-16)。対象日を処理済みにする",
      res.status === 200 &&
        written.length === 52 &&
        written.every(
          (r) => r.venue_code === 5 && r.meet_start_date === "2026-09-16",
        ) &&
        row.last_target_date === "2026-09-19" &&
        row.last_rows_written === 52,
      show({ body: res.body, n: written.length }),
    );
    check(
      "得点率: 取得は politeFetch 経由・会場ごとに1回ずつ（attempts=1。再試行は politeFetch）・同時数の上限を守る",
      fetchImpl.log.length === 3 && fetchImpl.maxActive <= 3,
      show({ n: fetchImpl.log.length, max: fetchImpl.maxActive }),
    );
    const again = await runIt(
      store,
      client,
      fetchImpl,
      jst("2026-09-20T01:30:00"),
    );
    check(
      "得点率: 補足の起動(01:30 JST)は、同じ対象日が処理済みなので、何も取得せず何も書かない（冪等）",
      again.status === 200 &&
        again.body.skipped === "already_done" &&
        again.body.targetDate === "2026-09-19" &&
        fetchImpl.log.length === 3 &&
        client.writesTo("racer_series_points").length === 1,
      show(again.body),
    );
  }
  return { at, runIt };
}

/** 元の verify の1つの塊 { } を割った 3/5 */
async function scene3({ at, runIt }) {
  // SG/G1の4日目以降なのに表が無い → 期待あり・エラー。他会場の分は書く。対象日は処理済みにならず、補足の起動が再試行する
  {
    const client = createFakeClient({ tables: POINT_RANK_TABLES() });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const res = await runIt(
      store,
      client,
      pointRankFetch({ "05": POINT_RANK_NONE }),
    );
    const row = store.state.get("point_rank");
    check(
      "得点率: G1の4日目なのに表が無い(期待1会場・0行)は、エラー(500)。対象日を処理済みにしない",
      res.status === 500 &&
        /表が無い/.test(res.body.error ?? "") &&
        row.last_target_date === undefined &&
        row.consecutive_failures === 1,
      show(res.body),
    );
    const retry = await runIt(
      store,
      client,
      pointRankFetch(),
      jst("2026-09-19T23:30:00"),
    );
    check(
      "得点率: 補足の起動(23:30)が、同じ対象日を再試行して成功し、処理済みにする",
      retry.status === 200 &&
        store.state.get("point_rank").last_target_date === "2026-09-19" &&
        (client.data.racer_series_points ?? []).length === 52,
      show(retry.body),
    );
  }
  // 仕様上の空（表が無いのが正常な日）は、期待0件で正常。処理済みになる
  {
    const client = createFakeClient({
      tables: {
        races: [
          { race_id: "2026-09-19-17-01", race_grade: "G3" },
          { race_id: "2026-09-19-04-01", race_grade: "ippan" },
        ],
        race_conditions: [{ race_id: "2026-09-19-17-01", series_day: 2 }],
      },
    });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const res = await runIt(store, client, pointRankFetch());
    check(
      "得点率: 表が無いのが仕様の日(G3・一般戦のみ)は、0件でも正常(期待0)。対象日は処理済み。書き込みなし",
      res.status === 200 &&
        store.state.get("point_rank").last_target_date === "2026-09-19" &&
        client.writesTo("racer_series_points").length === 0 &&
        res.body.expectedVenues === 0,
      show(res.body),
    );
  }
  // 取得失敗（会場のページ）はエラー
  {
    const client = createFakeClient({ tables: POINT_RANK_TABLES() });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const res = await runIt(
      store,
      client,
      pointRankFetch({ 17: new FetchError("https://x", 3, new Error("boom")) }),
    );
    check(
      "得点率: 会場の取得失敗は、エラー(500)。他会場の表(52名)は書く。処理済みにしない",
      res.status === 500 &&
        (client.data.racer_series_points ?? []).length === 52 &&
        store.state.get("point_rank").last_target_date === undefined,
      show(res.body),
    );
  }
  return { at, runIt };
}

/** 元の verify の1つの塊 { } を割った 4/5 */
async function scene4({ at, runIt }) {
  // 開催会場が0件（races が空）はエラー
  {
    const client = createFakeClient({ tables: { races: [] } });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const res = await runIt(store, client, pointRankFetch());
    check(
      "得点率: 対象日の開催会場が0件は、エラー（DB障害・対象日の誤りを、成功にしない）",
      res.status === 500 && /開催会場が0件/.test(res.body.error ?? ""),
      show(res.body),
    );
  }
  // DBの書き込みエラーはエラー
  {
    const client = createFakeClient({
      tables: POINT_RANK_TABLES(),
      failOn: { "racer_series_points:upsert": "disk full" },
    });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const res = await runIt(store, client, pointRankFetch());
    check(
      "得点率: 書き込みエラーは、エラー(500)。処理済みにしない",
      res.status === 500 &&
        /書き込みエラー/.test(res.body.error ?? "") &&
        store.state.get("point_rank").last_target_date === undefined,
      show(res.body),
    );
  }
  // ソフトデッドライン: 着手しなかった会場があれば incomplete（処理済みにしない）
  {
    const client = createFakeClient({ tables: POINT_RANK_TABLES() });
    const store = createMemoryStore({
      rows: { point_rank: liveRow("point_rank") },
    });
    const fetchImpl = pointRankFetch();
    let clock = at.getTime();
    const res = await runJob({
      job: "point_rank",
      run: (ctx) => runPointRankJob(ctx, { concurrency: 1 }),
      store,
      client,
      politeFetch: async (...args) => {
        clock += 280 * 1000; // 1会場の取得で、maxDuration(300)−30 を超える
        return fetchImpl(...args);
      },
      at: () => new Date(clock),
    });
    check(
      "得点率: ソフトデッドラインを過ぎたら以降の会場に着手せず、対象日を処理済みにしない(incomplete)",
      res.status === 200 &&
        res.body.incomplete === true &&
        res.body.venuesNotAttempted.length === 2 &&
        store.state.get("point_rank").last_target_date === undefined,
      show(res.body),
    );
  }
}

/** 元の verify の1つの塊 { } を割った 5/5 */
async function scene5() {
  // CLI（従来の run(date)）: 逐次・global fetch・オプション無しの挙動を変えない
  {
    const client = createFakeClient({
      tables: {
        races: [{ race_id: "2026-09-19-05-01", race_grade: "G1" }],
        race_conditions: [{ race_id: "2026-09-19-05-01", series_day: 4 }],
      },
    });
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(POINT_RANK_G1, { status: 200 });
    };
    // モジュールの supabase は、この環境では null のため、client は明示する（CLIと同じ引数で、client のみ差し替える）
    const started = Date.now();
    const result = await runPointRank("2026-09-19", { client });
    globalThis.fetch = origFetch;
    check(
      "得点率 CLI: 既定は、global fetch・逐次・会場間1秒待機。書き込みも従来どおり(52行)",
      urls.length === 1 &&
        result.updated === true &&
        result.count === 52 &&
        result.failures.length === 0 &&
        Date.now() - started >= 950,
      show({
        urls: urls.length,
        count: result.count,
        ms: Date.now() - started,
      }),
    );
    const dry = await runPointRank("2026-09-19", {
      client: createFakeClient({
        tables: {
          races: [{ race_id: "2026-09-19-05-01", race_grade: "G1" }],
          race_conditions: [{ race_id: "2026-09-19-05-01", series_day: 4 }],
        },
      }),
      fetchImpl: async () => new Response(POINT_RANK_G1, { status: 200 }),
      venueDelayMs: 0,
      dryRun: true,
    });
    check(
      "得点率: dryRun は解析のみで書かない（rowsParsed=52・count=0）",
      dry.updated === false && dry.count === 0 && dry.rowsParsed === 52,
      show(dry),
    );
  }
}

async function scene6() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    const s3 = await scene3(s2);
    await scene4(s3);
    await scene5();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・jst・POINT_RANK_G1・POINT_RANK_NONE・liveRow・runJob） */
export async function runScrapeDailyJobsScenes2(env) {
  ({ check, show, jst, POINT_RANK_G1, POINT_RANK_NONE, liveRow, runJob } = env);
  await scene6();
}
