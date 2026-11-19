/**
 * verify-race-notices-job.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-race-notices-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { RACE_NOTICES_CONCURRENCY, runRaceNoticesJob } from "../../lib/raceNoticesJob.js";
import { run as runRaceInformation, createInformationFetcher } from "../../daily/scrape-race-information.js";

let out, check, show, NO_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore;

async function scene1() {
  // ---------------------------------------------------------------------------
  // (f) 並列度・ソフトデッドライン
  // ---------------------------------------------------------------------------
  {
    const date = "2026-09-20";
    const venues = Array.from({ length: 24 }, (_, i) => i + 1);
    const client = createFakeClient({
      tables: { races: raceRows(date, venues), racer_profiles: [] },
    });
    const pf = stubFetch();
    const r = await runJob({ store: liveStore(), client, politeFetch: pf });
    check(
      `並列度: 24会場を、同時取得${RACE_NOTICES_CONCURRENCY}以下で処理する（最大${pf.stats.maxInFlight}）。全会場を1回ずつ取得`,
      r.status === 200 &&
        pf.stats.maxInFlight <= RACE_NOTICES_CONCURRENCY &&
        pf.stats.maxInFlight > 1 &&
        pf.stats.calls.length === 24 &&
        new Set(pf.stats.calls).size === 24,
      show({ max: pf.stats.maxInFlight, calls: pf.stats.calls.length }),
    );

    // ソフトデッドライン（maxDuration−30秒）: 過ぎたら、以降の会場は取得しない
    const client2 = createFakeClient({
      tables: { races: raceRows(date, venues), racer_profiles: [] },
    });
    const clock = { t: FIXED_NOW.getTime() };
    const pf2 = stubFetch();
    const slowFetch = async (url, init) => {
      const res = await pf2(url, init);
      clock.t += 100 * 1000; // 1会場ごとに100秒進める
      return res;
    };
    const r2 = await runScrapeJob({
      job: "race_notices",
      store: liveStore(),
      run: runRaceNoticesJob,
      now: () => new Date(clock.t),
      worker: "w-test",
      client: client2,
      politeFetch: slowFetch,
    });
    check(
      "ソフトデッドライン（300−30=270秒）を過ぎたら、以降の会場は取得しない（取得しなかった会場は集計行を作らず、次の起動で取得する）",
      r2.status === 200 &&
        pf2.stats.calls.length < 24 &&
        r2.body.venuesNotAttempted.length > 0 &&
        r2.body.venuesChecked + r2.body.venuesNotAttempted.length === 24 &&
        client2.state.race_notices_health.length === r2.body.venuesChecked,
      show({
        fetched: pf2.stats.calls.length,
        notAttempted: r2.body.venuesNotAttempted?.length,
      }),
    );

    // 開催なし（races が空）: 成功（skipped）
    const emptyClient = createFakeClient({
      tables: { races: [], racer_profiles: [] },
    });
    const empty = await runJob({
      store: liveStore(),
      client: emptyClient,
      politeFetch: stubFetch(),
    });
    check(
      "races が空（朝の初期化の前・開催なし）: 200（skipped: no_schedule）。取得も書き込みもしない",
      empty.status === 200 &&
        empty.body.skipped === "no_schedule" &&
        !emptyClient.calls.some((c) => c.op === "upsert"),
      show(empty.body),
    );
  }
}

async function scene2() {
  // ---------------------------------------------------------------------------
  // (g) 従来の呼び出し（run(schedule, date)）は挙動を変えない
  // ---------------------------------------------------------------------------
  {
    const date = "2026-09-20";
    const schedule = [1, 2].map((v) => ({
      race_id: `${date}-${String(v).padStart(2, "0")}-01`,
      venue_code: v,
      race_no: 1,
      start_time: new Date(`${date}T10:30:00+09:00`),
    }));
    // 書き込みが失敗しても、投げずに戻る（従来どおり、ログのみ）
    const client = createFakeClient({
      tables: { racer_profiles: [] },
      fail: { "race_notices_health:upsert": "boom" },
    });
    const order = [];
    const legacy = await runRaceInformation(schedule, date, {
      client,
      fetchPage: async (venueCode) => {
        order.push(venueCode);
        return { html: NO_NOTICES, reason: null };
      },
    });
    check(
      "従来の呼び出し（strict なし）: 書き込みが失敗しても投げない（ログのみ）。会場は逐次（コード順）",
      show(order) === show([1, 2]) &&
        legacy.updated === false &&
        legacy.count === 0 &&
        legacy.writeErrors.length === 1,
      show({ order, writeErrors: legacy.writeErrors }),
    );
    const noClient = await runRaceInformation(schedule, date, { client: null });
    check(
      "従来の呼び出し: Supabase 未設定は、投げずに { updated: false, count: 0 } を返す",
      noClient.updated === false && noClient.count === 0,
    );
    const strictNoClient = await runRaceInformation(schedule, date, {
      client: null,
      strict: true,
    }).then(
      () => null,
      (e) => e,
    );
    check(
      "strict: Supabase 未設定は例外",
      strictNoClient instanceof Error && /Supabase/.test(strictNoClient.message),
    );

    // createInformationFetcher: 取得の形
    const fetcher = createInformationFetcher(async (url) => {
      if (url.includes("jcd=01")) return new Response("x", { status: 503 });
      if (url.includes("jcd=02"))
        throw new BreakerOpenError("host:boatrace.jp", 1);
      if (url.includes("jcd=03")) throw new Error("socket hang up");
      return ok(NO_NOTICES);
    });
    const results = await Promise.all(
      [1, 2, 3, 4].map((v) => fetcher(v, "20260920")),
    );
    check(
      "取得関数（politeFetch用）: HTTPエラー・ブレーカー・例外・成功を、従来の reason の形にそろえる",
      results[0].reason === "http_503" &&
        results[1].reason === "breaker_open" &&
        /^fetch_error: socket hang up/.test(results[2].reason) &&
        results[3].html === NO_NOTICES &&
        results[3].reason === null,
      show(results.map((r) => r.reason)),
    );
  }
}

async function scene3() {
  // ---------------------------------------------------------------------------
  // (i) 夜1回（2026-10-03）: 対象日は指定時刻から解決した日。取得に失敗した会場・着手しなかった会場があれば、
  //     対象日を処理済みにしない（補足の起動 23:00・23:30 が取り直す）
  // ---------------------------------------------------------------------------
  {
    const info = (over) => async () => ({
      venuesChecked: 2,
      venuesFailed: [],
      venuesNotAttempted: [],
      notesParsed: 0,
      rowsUnparsed: 0,
      venuesWithUnparsedRows: [],
      notesInserted: 0,
      healthWritten: 2,
      healthSkipped: 0,
      digest: null,
      capturedPages: [],
      ...over,
    });
    const seen = [];
    const ctx = {
      targetDate: "2026-09-19",
      now: () => new Date("2026-09-20T14:00:00Z"),
      mode: "live",
      client: null,
      politeFetch: async () => new Response(""),
      shouldStop: () => false,
    };
    const getSchedule = async (date) => {
      seen.push(date);
      return [{ venueCode: "01" }, { venueCode: "02" }];
    };
    const ok = await runRaceNoticesJob(ctx, {
      getSchedule,
      runInformation: info(),
    });
    const failed = await runRaceNoticesJob(ctx, {
      getSchedule,
      runInformation: info({
        venuesFailed: [{ venueCode: "02", reason: "timeout" }],
      }),
    });
    const notAttempted = await runRaceNoticesJob(ctx, {
      getSchedule,
      runInformation: info({ venuesNotAttempted: ["02"] }),
    });
    check(
      "夜1回: 対象日は共通ラッパが解決した ctx.targetDate（壁時計の日付ではない）。全会場が取れれば処理済み、取得失敗・未着手の会場があれば処理済みにしない（incomplete）",
      seen.every((d) => d === "2026-09-19") &&
        ok.incomplete === false &&
        failed.incomplete === true &&
        notAttempted.incomplete === true,
      show({
        seen,
        ok: ok.incomplete,
        failed: failed.incomplete,
        notAttempted: notAttempted.incomplete,
      }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・NO_NOTICES・createFakeClient・raceRows・FIXED_NOW・ok・stubFetch・runJob・liveStore） */
export async function runRaceNoticesJobScenes2(env) {
  ({ out, check, show, NO_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore } = env);
  await scene1();
  await scene2();
  await scene3();
}

function scene4() {
  out.log("\n✅ 全ての検証に成功");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・show・NO_NOTICES・createFakeClient・raceRows・FIXED_NOW・ok・stubFetch・runJob・liveStore） */
export function runRaceNoticesJobScenes3(env) {
  ({ out, check, show, NO_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore } = env);
  scene4();
}
