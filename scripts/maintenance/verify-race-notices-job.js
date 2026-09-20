/**
 * verify-race-notices-job.js - レース特記事項（A5）の共通ラッパ対応（BOA-353 T4b-11-1・T4b-11-2）の検証。
 * DBにも取得先にも接続しない（偽クライアント・メモリのストア・fetchの差し替え）。
 *
 *   (a) モード: off・行なしは何もしない（取得もDB書き込みもしない）。shadow は取得・解析のみで、DBへ書かない。
 *       live で書く。二重の起動（cron-job.org と Vercel Cron）は、ジョブ単位のリースで、片方が何もしない
 *   (b) DB障害を200にしない（G13）: races の取得失敗・集計行の書き込み失敗・通知の書き込み失敗は、
 *       HTTP 500（ジョブの失敗）。「開催会場なし」の成功に化けさせない
 *   (c) 全会場の取得失敗は失敗（500）。一部の会場の失敗は成功で、集計行に理由が残る。ブレーカーで
 *       取得しなかった会場は、集計行を作らない（構造変化の判定材料にしない）
 *   (d) race_notices_health は、変更のある行だけ書く（D9）。同じ内容の2回目は書き込み0件
 *   (e) 通知の書き込みは、重複を無視する upsert。二重の起動でも、同じ通知は増えない
 *   (f) 会場の並列度は上限つき。ソフトデッドラインを過ぎたら、以降の会場は取得しない
 *   (g) 従来の呼び出し（run(schedule, date)。CLI）は、オプション無しで、逐次・失敗はログのみ（挙動を変えない）
 *   (h) 配線: api/cron/race-notices.js の maxDuration とレジストリの一致、vercel.json の cron（10分間隔・
 *       JST 07:00〜23:59）、cron-job.org の既存の起動と二重にならない（リース・冪等）
 *
 * 実行: node scripts/maintenance/verify-race-notices-job.js
 */
import fs from "node:fs";
import {
  runScrapeJob,
  createScrapeCronHandler,
} from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import {
  RACE_NOTICES_CONCURRENCY,
  runRaceNoticesJob,
} from "../lib/raceNoticesJob.js";
import {
  createInformationFetcher,
  run as runRaceInformation,
} from "../daily/scrape-race-information.js";

// 検証の対象コードが出すログ（失敗のシミュレーションで出るエラーログを含む）は捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    out.log(`✅ ${label}`);
  } else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);

const FIXTURES = new URL("../lib/__fixtures__/raceNotices/", import.meta.url);
const NO_NOTICES = fs.readFileSync(
  new URL("no-notices.html", FIXTURES),
  "utf8",
);
const WITH_NOTICES = fs.readFileSync(
  new URL("with-notices.html", FIXTURES),
  "utf8",
);

// ---------------------------------------------------------------------------
// 偽クライアント（PostgREST の最小限。fetchAll の range・upsert の ignoreDuplicates と select を再現する）
// ---------------------------------------------------------------------------
function createFakeClient({ tables = {}, fail = {} } = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]),
  );
  const calls = [];
  const matches = (row, filters) =>
    filters.every(([kind, column, value]) => {
      if (kind === "eq") return row[column] === value;
      if (kind === "in") return value.includes(row[column]);
      if (kind === "like")
        return String(row[column]).startsWith(value.replace(/%$/, ""));
      if (kind === "not-null") return row[column] != null;
      return true;
    });
  const execute = (q) => {
    calls.push({ table: q.table, op: q.op, rows: q.payload, opts: q.opts });
    const failure = fail[`${q.table}:${q.op}`];
    if (failure) return { data: null, error: { message: failure } };
    const rows = (state[q.table] ??= []);
    if (q.op === "select") {
      let found = rows.filter((r) => matches(r, q.filters));
      if (q.range) found = found.slice(q.range[0], q.range[1] + 1);
      return { data: found.map((r) => ({ ...r })), error: null };
    }
    // upsert
    const keys = (q.opts?.onConflict ?? "").split(",").filter(Boolean);
    const touched = [];
    for (const row of q.payload) {
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
      if (existing) {
        if (!q.opts?.ignoreDuplicates) {
          Object.assign(existing, row);
          touched.push(existing);
        }
      } else {
        const created = { id: rows.length + 1, ...row };
        rows.push(created);
        touched.push(created);
      }
    }
    return {
      data: q.returning ? touched.map((r) => ({ id: r.id })) : null,
      error: null,
    };
  };
  const from = (table) => {
    const q = { table, op: "select", filters: [], payload: null, opts: null };
    const b = {
      select: () => {
        if (q.op !== "select") q.returning = true;
        return b;
      },
      upsert: (rows, opts) => (
        (q.op = "upsert"),
        (q.payload = rows),
        (q.opts = opts),
        b
      ),
      eq: (c, v) => (q.filters.push(["eq", c, v]), b),
      in: (c, v) => (q.filters.push(["in", c, v]), b),
      like: (c, v) => (q.filters.push(["like", c, v]), b),
      not: (c, op) => (op === "is" && q.filters.push(["not-null", c]), b),
      range: (a, z) => ((q.range = [a, z]), b),
      order: () => b,
      then: (resolve, reject) =>
        Promise.resolve(execute(q)).then(resolve, reject),
    };
    return b;
  };
  return { from, state, calls };
}

const raceRows = (date, venues) =>
  venues.map((v) => ({
    race_id: `${date}-${String(v).padStart(2, "0")}-01`,
    start_time: "10:30:00",
  }));

const FIXED_NOW = new Date("2026-09-20T03:00:00Z"); // 2026-09-20 12:00 JST
const ok = (html) => new Response(html, { status: 200 });

/** politeFetch の差し替え: 会場ごとの応答を返し、同時実行数の最大値を記録する */
function stubFetch(byVenue = {}, fallback = () => ok(NO_NOTICES)) {
  const stats = { calls: [], inFlight: 0, maxInFlight: 0 };
  const fn = async (url) => {
    const jcd = Number(new URL(url).searchParams.get("jcd"));
    stats.calls.push(jcd);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    stats.inFlight--;
    const handler = byVenue[jcd] ?? fallback;
    const result = handler(jcd);
    if (result instanceof Error) throw result;
    return result;
  };
  fn.stats = stats;
  return fn;
}

const runJob = ({ store, client, politeFetch, now = FIXED_NOW, ...rest }) =>
  runScrapeJob({
    job: "race_notices",
    store,
    run: runRaceNoticesJob,
    now: () => now,
    worker: "w-test",
    modeGated: true,
    client,
    politeFetch,
    ...rest,
  });

const liveStore = (extra = {}) =>
  createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "live" } },
    ...extra,
  });

const writes = (client, table) =>
  client.calls.filter((c) => c.table === table && c.op === "upsert");

// ---------------------------------------------------------------------------
// (a) モード・二重起動
// ---------------------------------------------------------------------------
{
  const date = "2026-09-20";
  const client = createFakeClient({
    tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
  });

  // off
  const offStore = createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "off" } },
  });
  const offFetch = stubFetch();
  const off = await runJob({ store: offStore, client, politeFetch: offFetch });
  check(
    "off: 何もしない（200・skipped。取得もDBの読み書きもしない）",
    off.status === 200 &&
      off.body.skipped === "mode_off" &&
      offFetch.stats.calls.length === 0 &&
      client.calls.length === 0,
    show({
      status: off.status,
      body: off.body,
      fetches: offFetch.stats.calls.length,
      dbCalls: client.calls.length,
    }),
  );

  // 行なし
  const noRowStore = createMemoryStore();
  const noRow = await runJob({
    store: noRowStore,
    client,
    politeFetch: offFetch,
  });
  check(
    "ジョブ状態の行が無い: off として何もしない（行を作るだけ）",
    noRow.body.skipped === "mode_off" &&
      offFetch.stats.calls.length === 0 &&
      client.calls.length === 0 &&
      noRowStore.state.get("race_notices")?.mode === "off",
  );

  // shadow: 取得・解析のみ
  const shadowClient = createFakeClient({
    tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
  });
  const shadowStore = createMemoryStore({
    rows: { race_notices: { job: "race_notices", mode: "shadow" } },
  });
  const shadowFetch = stubFetch({}, () => ok(WITH_NOTICES));
  const shadow = await runJob({
    store: shadowStore,
    client: shadowClient,
    politeFetch: shadowFetch,
    now: new Date("2017-12-24T03:00:00Z"),
  });
  const report = shadowStore.state.get("race_notices").last_report;
  check(
    "shadow: 取得・解析はする（9件の通知を解析）が、race_special_notes・race_notices_health へ書かない。解析結果のダイジェストを記録する",
    shadow.status === 200 &&
      shadowFetch.stats.calls.length === 1 &&
      report?.notesParsed === 9 &&
      report?.notesInserted === 0 &&
      report?.healthWritten === 0 &&
      typeof report?.digest === "string" &&
      !shadowClient.calls.some((c) => c.op === "upsert"),
    show({ status: shadow.status, report }),
  );

  // live（通知あり）: 書く
  const liveClient = createFakeClient({
    tables: { races: raceRows("2017-12-24", [12]), racer_profiles: [] },
  });
  const liveFetch = stubFetch({}, () => ok(WITH_NOTICES));
  const live = await runJob({
    store: liveStore(),
    client: liveClient,
    politeFetch: liveFetch,
    now: new Date("2017-12-24T03:00:00Z"),
  });
  const noteWrite = writes(liveClient, "race_special_notes")[0];
  check(
    "live: 解析した通知9件を、重複を無視する upsert（onConflict=venue_code,race_date,category,detail_text）に渡し、集計行を1件書く。既存の一意キーのため、同日・同内容の別選手の2件（待機行動違反・落水失格の各1組）は潰れて7件が保存される（現行の弱点の記録。T4b-11-3の発見）",
    live.status === 200 &&
      noteWrite?.rows.length === 9 &&
      noteWrite.opts.ignoreDuplicates === true &&
      noteWrite.opts.onConflict ===
        "venue_code,race_date,category,detail_text" &&
      live.body.notesParsed === 9 &&
      live.body.notesInserted === 7 &&
      liveClient.state.race_notices_health.length === 1,
    show(live.body),
  );
  check(
    "shadow のダイジェストと live のダイジェストは、同じ解析結果で一致する（shadow で解析の一致を確認できる）",
    live.body.digest === report.digest,
    `${live.body.digest} / ${report.digest}`,
  );

  // 二重の起動（cron-job.org と Vercel Cron）: リースを持っている間は、もう一方は何もしない
  const heldStore = liveStore({ leaseHeld: true });
  const heldFetch = stubFetch();
  const heldClient = createFakeClient({
    tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
  });
  const held = await runJob({
    store: heldStore,
    client: heldClient,
    politeFetch: heldFetch,
  });
  check(
    "二重の起動: リースを他の実行が持っていれば、何もしない（取得もDB書き込みもしない）",
    held.body.skipped === "lease_held" &&
      heldFetch.stats.calls.length === 0 &&
      !heldClient.calls.some((c) => c.op === "upsert"),
    show(held.body),
  );

  // 二重の起動が「同時」に来た場合（cron-job.org と Vercel Cron が同じ分に叩く）。実際のリースと同じく、
  // 取得した実行がある間は、もう一方は取れない
  const shared = createFakeClient({
    tables: { races: raceRows(date, [1, 2, 3]), racer_profiles: [] },
  });
  const sharedStore = liveStore();
  const realAcquire = sharedStore.acquireLease;
  sharedStore.acquireLease = async (job, worker, leaseSec, now) => {
    if (sharedStore.state.get(job).claimed_by) return false;
    return realAcquire(job, worker, leaseSec, now);
  };
  const sharedFetch = stubFetch();
  const [a, b] = await Promise.all([
    runJob({ store: sharedStore, client: shared, politeFetch: sharedFetch }),
    runJob({ store: sharedStore, client: shared, politeFetch: sharedFetch }),
  ]);
  const skipped = [a, b].filter((r) => r.body.skipped === "lease_held");
  check(
    "二重の起動（同時）: 片方だけが処理し（各会場を1回だけ取得）、もう一方は lease_held で何もしない。処理が済んだ後、リースは解放される",
    skipped.length === 1 &&
      sharedFetch.stats.calls.length === 3 &&
      writes(shared, "race_notices_health").length === 1 &&
      sharedStore.state.get("race_notices").claimed_by === null,
    show({
      skipped: skipped.length,
      fetches: sharedFetch.stats.calls.length,
      healthWrites: writes(shared, "race_notices_health").length,
    }),
  );
}

// ---------------------------------------------------------------------------
// (b) DB障害を200にしない（G13）
// ---------------------------------------------------------------------------
{
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
    now: new Date("2017-12-24T03:00:00Z"),
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
    now: new Date("2017-12-24T03:00:00Z"),
  };
  const n1 = await runJob({ store: liveStore(), ...opts });
  const n2 = await runJob({ store: liveStore(), ...opts });
  check(
    "通知: 同じページを2回処理しても、race_special_notes は7件のまま（2回目の新規保存は0件）",
    n1.body.notesInserted === 7 &&
      n2.body.notesInserted === 0 &&
      c3.state.race_special_notes.length === 7,
    show({
      n1: n1.body.notesInserted,
      n2: n2.body.notesInserted,
      rows: c3.state.race_special_notes.length,
    }),
  );
}

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

// ---------------------------------------------------------------------------
// (h) 配線
// ---------------------------------------------------------------------------
{
  const def = SCRAPE_JOBS.race_notices;
  check(
    "レジストリ: race_notices は continuous（窓なし・ジョブ単位のリース）で、取得先ホスト boatrace.jp のブレーカーを見る。リースは cron の間隔（10分）より短い",
    def?.kind === "continuous" &&
      def.hosts?.includes("boatrace.jp") &&
      def.leaseSec < 600,
    show(def),
  );
  const mod = await import("../../api/cron/race-notices.js");
  check(
    "api/cron/race-notices.js: config.maxDuration がレジストリの maxDurationSec と一致し、ハンドラーを export する",
    typeof mod.default === "function" &&
      mod.config?.maxDuration === def.maxDurationSec,
    show(mod.config),
  );
  const src = fs.readFileSync(
    new URL("../../api/cron/race-notices.js", import.meta.url),
    "utf8",
  );
  check(
    "api/cron/race-notices.js: waitUntil を使わず、共通ラッパ経由（処理の完了後に応答する）",
    !/waitUntil/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")) &&
      /createScrapeCronHandler/.test(src),
  );

  const vercel = JSON.parse(
    fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  const cron = vercel.crons.find((c) => c.path === "/api/cron/race-notices");
  // UTC→JSTの起動時刻（分）に換算する
  const expand = (field, max) => {
    const out = new Set();
    for (const part of field.split(",")) {
      const [range, step] = part.split("/");
      const [lo, hi] =
        range === "*"
          ? [0, max]
          : range.includes("-")
            ? range.split("-").map(Number)
            : [Number(range), step ? max : Number(range)];
      for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.add(v);
    }
    return out;
  };
  const [min, hour] = (cron?.schedule ?? "").split(" ");
  const times = [];
  for (const h of expand(hour ?? "", 23))
    for (const m of expand(min ?? "", 59)) times.push(((h + 9) % 24) * 60 + m);
  times.sort((a, b) => a - b);
  check(
    `vercel.json: /api/cron/race-notices は JST 07:00〜23:50 の10分ごと（${times.length}回。07:00を含み、06:50・00:00は含まない）`,
    times.length === (23 - 7 + 1) * 6 &&
      times[0] === 7 * 60 &&
      times.at(-1) === 23 * 60 + 50 &&
      times.every((t, i) => i === 0 || t - times[i - 1] === 10),
    `${times.length}回 ${times[0]}〜${times.at(-1)}`,
  );
  check(
    "vercel.json: regions・functions には触れていない（リージョンの変更はユーザー承認待ち）",
    !("regions" in vercel) && !("functions" in vercel),
  );
}

if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
out.log("\n✅ 全ての検証に成功");
