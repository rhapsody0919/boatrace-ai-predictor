/**
 * verify-race-notices-job.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-race-notices-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createScrapeCronHandler } from "../../lib/scrapeJobs/cronWrapper.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { runRaceNoticesJob } from "../../lib/raceNoticesJob.js";

let check, show, WITH_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore, writes;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const date = "2026-09-20";
  const base = () => ({
    races: raceRows(date, [1, 2, 3]),
    racer_profiles: [],
  });
  const scheduleDown = createFakeClient({
    tables: base(),
    fail: { "races:select": "statement timeout" },
  });
  const store1 = liveStore();
  const fetch1 = stubFetch();
  const r1 = await runJob({
    store: store1,
    client: scheduleDown,
    politeFetch: fetch1,
  });
  check(
    "races の取得がDB障害: 「開催会場なし」の成功にせず、500（ジョブの失敗）。取得はしない。失敗が scrape_job_state に残る",
    r1.status === 500 &&
      fetch1.stats.calls.length === 0 &&
      store1.state.get("race_notices").consecutive_failures === 1 &&
      /レーススケジュールの取得に失敗/.test(
        store1.state.get("race_notices").last_error ?? "",
      ),
    show({ status: r1.status, error: r1.body.error }),
  );
  const healthWriteDown = createFakeClient({
    tables: base(),
    fail: { "race_notices_health:upsert": "connection reset" },
  });
  const r2 = await runJob({
    store: liveStore(),
    client: healthWriteDown,
    politeFetch: stubFetch(),
  });
  check(
    "集計行（race_notices_health）の書き込み失敗: 500。従来のように、ログだけで成功にしない",
    r2.status === 500 &&
      /race_notices_health書き込みエラー/.test(r2.body.error ?? ""),
    show(r2.body),
  );
  const notesWriteDown = createFakeClient({
    tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
    fail: { "race_special_notes:upsert": "connection reset" },
  });
  const r3 = await runJob({
    store: liveStore(),
    client: notesWriteDown,
    politeFetch: stubFetch({}, () => ok(WITH_NOTICES)),
    now: new Date("2017-12-24T14:00:00Z"), // 23:00 JST（指定 22:30 より後）
  });
  check(
    "通知（race_special_notes）の書き込み失敗: 500。集計行は、通知の失敗と独立に書く（構造の成否の記録は残す）",
    r3.status === 500 &&
      /race_special_notes書き込みエラー/.test(r3.body.error ?? "") &&
      notesWriteDown.state.race_notices_health?.length === 1,
    show(r3.body),
  );
  const profilesDown = createFakeClient({
    tables: base(),
    fail: { "racer_profiles:select": "statement timeout" },
  });
  const r4 = await runJob({
    store: liveStore(),
    client: profilesDown,
    politeFetch: stubFetch(),
  });
  return { base, r4 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ base, r4 }) {
  check(
    "選手名の対応表（racer_profiles）の取得失敗: 部分結果で続行せず、500（racer_id が解決できないまま保存しない）",
    r4.status === 500 && /racer_profiles取得エラー/.test(r4.body.error ?? ""),
    show(r4.body),
  );
  const healthReadDown = createFakeClient({
    tables: base(),
    fail: { "race_notices_health:select": "statement timeout" },
  });
  const r5 = await runJob({
    store: liveStore(),
    client: healthReadDown,
    politeFetch: stubFetch(),
  });
  check(
    "集計行の読み取り失敗: 500（前回の had_success を失ったまま上書きしない）",
    r5.status === 500 &&
      /race_notices_health取得エラー/.test(r5.body.error ?? ""),
    show(r5.body),
  );
  // Supabase 未設定（ハンドラー）
  const handler = createScrapeCronHandler({
    job: "race_notices",
    run: runRaceNoticesJob,
    getClient: async () => null,
  });
  const res = { code: null, body: null };
  process.env.CRON_SECRET = "s3cret";
  await handler(
    { headers: { authorization: "Bearer s3cret" }, query: {} },
    {
      status(c) {
        res.code = c;
        return this;
      },
      json(b) {
        res.body = b;
      },
    },
  );
  check(
    "Supabase 未設定: 200 にせず 500",
    res.code === 500 && /Supabase/.test(res.body?.error ?? ""),
    show(res),
  );
  const unauth = { code: null };
  await handler(
    { headers: {}, query: {} },
    {
      status(c) {
        unauth.code = c;
        return this;
      },
      json() {},
    },
  );
  check("認証: Authorization なしは 401", unauth.code === 401);
}

async function scene3() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  // ---------------------------------------------------------------------------
  // (c) 会場の取得失敗の扱い
  // ---------------------------------------------------------------------------
  {
    const date = "2026-09-20";
    const tables = () => ({
      races: raceRows(date, [1, 2, 3, 4]),
      racer_profiles: [],
    });

    // 全会場が失敗
    const allDownClient = createFakeClient({ tables: tables() });
    const allDownStore = liveStore();
    const allDown = await runJob({
      store: allDownStore,
      client: allDownClient,
      politeFetch: stubFetch({}, () => new Response("err", { status: 500 })),
    });
    check(
      "全会場の取得失敗（HTTP 500）: 500（ジョブの失敗・連続失敗数を増やす）。失敗の理由は集計行に残す（構造変化の監視の入力）",
      allDown.status === 500 &&
        allDownStore.state.get("race_notices").consecutive_failures === 1 &&
        allDownClient.state.race_notices_health.length === 4 &&
        allDownClient.state.race_notices_health.every(
          (r) => r.had_success === false && r.last_reason === "http_500",
        ),
      show({ status: allDown.status, error: allDown.body.error }),
    );

    // 一部の会場だけ失敗
    const partialClient = createFakeClient({ tables: tables() });
    const partial = await runJob({
      store: liveStore(),
      client: partialClient,
      politeFetch: stubFetch({ 3: () => new Response("busy", { status: 503 }) }),
    });
    check(
      "一部の会場だけ失敗: 200（成功）。失敗した会場と理由が応答に残り、集計行に記録される",
      partial.status === 200 &&
        show(partial.body.venuesFailed) ===
          show([{ venueCode: 3, reason: "http_503" }]) &&
        partial.body.venuesChecked === 4 &&
        partialClient.state.race_notices_health.find((r) => r.venue_code === 3)
          .last_reason === "http_503",
      show(partial.body),
    );

    // ブレーカーで取得しなかった会場は、集計行を作らない
    const breakerClient = createFakeClient({ tables: tables() });
    const breaker = await runJob({
      store: liveStore(),
      client: breakerClient,
      politeFetch: stubFetch({
        2: () =>
          new BreakerOpenError("host:boatrace.jp", FIXED_NOW.getTime() + 60000),
        4: () =>
          new BreakerOpenError("host:boatrace.jp", FIXED_NOW.getTime() + 60000),
      }),
    });
    check(
      "ブレーカーが開いていて取得しなかった会場は、失敗にも構造変化の判定材料にもしない（集計行を作らない）。他の会場は書く",
      breaker.status === 200 &&
        show(breaker.body.venuesNotAttempted) === show([2, 4]) &&
        breaker.body.venuesChecked === 2 &&
        show(
          breakerClient.state.race_notices_health.map((r) => r.venue_code).sort(),
        ) === show([1, 3]),
      show(breaker.body),
    );

    // 構造変化（見出しが無い）: 失敗として記録
    const driftClient = createFakeClient({ tables: tables() });
    const drift = await runJob({
      store: liveStore(),
      client: driftClient,
      politeFetch: stubFetch({
        2: () => ok("<html><body>変わった</body></html>"),
      }),
    });
    check(
      "構造変化（見出しが見つからない）: その会場は notice_section_not_found として集計行に記録。他の会場が成功なら200",
      drift.status === 200 &&
        driftClient.state.race_notices_health.find((r) => r.venue_code === 2)
          .last_reason === "notice_section_not_found",
      show(drift.body),
    );
  }
}

async function scene4() {
  // ---------------------------------------------------------------------------
  // (d)(e) 変更のある行だけ書く・二重起動でも増えない
  // ---------------------------------------------------------------------------
  {
    const date = "2026-09-20";
    const client = createFakeClient({
      tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
    });
    const first = await runJob({
      store: liveStore(),
      client,
      politeFetch: stubFetch(),
    });
    const healthWritesAfterFirst = writes(client, "race_notices_health").length;
    const second = await runJob({
      store: liveStore(),
      client,
      politeFetch: stubFetch(),
    });
    check(
      "集計行: 初回は3会場分を書き、内容が同じ2回目は書き込み0件（変更のある行だけ書く）",
      first.body.healthWritten === 3 &&
        second.body.healthWritten === 0 &&
        second.body.healthSkipped === 3 &&
        writes(client, "race_notices_health").length === healthWritesAfterFirst,
      show({
        first: first.body.healthWritten,
        second: second.body.healthWritten,
        skipped: second.body.healthSkipped,
      }),
    );

    // 失敗→回復: had_success が変わる会場だけ書く。last_reason は成功後も残る（従来どおり）
    const c2 = createFakeClient({
      tables: { races: raceRows(date, [1, 2]), racer_profiles: [] },
    });
    await runJob({
      store: liveStore(),
      client: c2,
      politeFetch: stubFetch({ 2: () => new Response("x", { status: 503 }) }),
    });
    const before = writes(c2, "race_notices_health").length;
    const recovered = await runJob({
      store: liveStore(),
      client: c2,
      politeFetch: stubFetch(),
    });
    check(
      "集計行: 失敗した会場が回復すると、その会場の行だけを書き直す（had_success が false→true）",
      recovered.body.healthWritten === 1 &&
        writes(c2, "race_notices_health").length === before + 1 &&
        c2.state.race_notices_health.find((r) => r.venue_code === 2)
          .had_success === true &&
        c2.state.race_notices_health.find((r) => r.venue_code === 1)
          .had_success === true,
      show(recovered.body),
    );

    // 通知: 二重の起動でも増えない（ignoreDuplicates）
    const c3 = createFakeClient({
      tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
    });
    const opts = {
      client: c3,
      politeFetch: stubFetch({}, () => ok(WITH_NOTICES)),
      now: new Date("2017-12-24T14:00:00Z"), // 23:00 JST（指定 22:30 より後）
    };
    const n1 = await runJob({ store: liveStore(), ...opts });
    const n2 = await runJob({ store: liveStore(), ...opts });
    check(
      "通知: 同じページを2回処理しても、race_special_notes は9件のまま（2回目の新規保存は0件）",
      n1.body.notesInserted === 9 &&
        n2.body.notesInserted === 0 &&
        c3.state.race_special_notes.length === 9,
      show({
        n1: n1.body.notesInserted,
        n2: n2.body.notesInserted,
        rows: c3.state.race_special_notes.length,
      }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・WITH_NOTICES・createFakeClient・raceRows・FIXED_NOW・ok・stubFetch・runJob・liveStore・writes） */
export async function runRaceNoticesJobScenes1(env) {
  ({ check, show, WITH_NOTICES, createFakeClient, raceRows, FIXED_NOW, ok, stubFetch, runJob, liveStore, writes } = env);
  await scene3();
  await scene4();
}
