/**
 * verify-scrape-daily-jobs.js - 日次・低頻度ジョブ（B2 得点率・B4 進入コース別選手成績・B3 会場別モーター成績・
 * B5 選手ニュース・B6 選手プロフィール・期別成績）の Vercel Cron 実装（WS4b、tasks.md T4b-12〜T4b-16）の検証。
 * DBにも取得先にも接続しない（インメモリのSupabaseクライアント・fetch・時計・ストアを差し替える）。
 *
 * 確認すること:
 *   (a) 対象日: 実行が遅れても（GitHub Actionsの遅延起動と同じ時刻でも）、対象日は指定時刻から解決され、翌日の races を
 *       引かない（G1・G2の再発防止）。補足の起動は、同じ対象日を処理する
 *   (b) off・行なし・075未適用: 何も取得せず、何も書かない（マージしても本番の挙動が変わらない）
 *   (c) shadow は取得・解析のみで一切書かず、対象日を処理済みにしない。live は書く。同じ対象日の2回目は何もしない（冪等）
 *   (d) 0件の扱い: 期待があるのに0件はエラー（対象日を処理済みにしない）。仕様上の空（期待0件）は正常で処理済み
 *   (e) 会場ごとのジョブ: 一時的な失敗の会場だけを補足の起動が再取得する・shadow の処理済みを live が飛ばさない・
 *       成否履歴は last_report（git push・fs なし）・同じ日の再実行で連続失敗日数を増やさない・構造変化の通知
 *   (f) 選手ニュース: 要確認リストはDBの表・shadow は書かない・二重の起動で増えない・取得失敗はエラー
 *   (g) 選手プロフィール・期別成績: チャンクの再開位置（cursor）の前進・対象日・モードの一致・系統的な失敗で前進しない・
 *       同時取得でも先頭からの連続した範囲だけを処理済みとする・従来の逐次実行と同じ挙動
 *   (h) 監視: ジョブ自身の通知（last_report.alerts）・月次ジョブを起動しない日に誤報しない
 *   (i) 配線: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算）・GitHub側を止める変数（既定は現行動作）
 *
 * 実行: node scripts/maintenance/verify-scrape-daily-jobs.js
 */
import fs from "node:fs";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import {
  SCRAPE_JOBS,
  isScheduledDate,
  validateRegistry,
} from "../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../lib/scrapeJobs/dailyJob.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { FetchError } from "../lib/scrapeJobs/politeFetch.js";
import {
  isTransientReason,
  previouslySettledVenues,
  reasonFromError,
  updateHealthForDate,
} from "../lib/scrapeJobs/venueJobSupport.js";
import { evaluateJobStates } from "../lib/scrapeJobs/monitor.js";
import { runPointRankJob } from "../lib/pointRankJob.js";
import { run as runPointRank } from "../daily/scrape-point-rank.js";
import { runVenueEntryCourseStatsJob } from "../lib/venueEntryCourseStatsJob.js";
import { runVenueMotorStatsJob } from "../lib/venueMotorStatsJob.js";
import { runRacerNewsJob } from "../lib/racerNewsJob.js";
import { runRacerProfilesJob } from "../lib/racerProfilesJob.js";
import {
  buildPopulation,
  runRacerProfileSync,
  parseArgs as parseProfileArgs,
} from "../lib/racerProfileSync.js";
import {
  createDbPendingStore,
  mergePendingLists,
} from "../lib/racerNews/pendingReview.js";
import { VENUE_MOTOR_STATS_CONFIG } from "../lib/venueMotorStats/venueConfig.js";

// 検証の対象コードが出すログは捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) out.log(`✅ ${label}`);
  else {
    failures++;
    out.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const show = (v) => JSON.stringify(v);
const same = (a, b) => show(a) === show(b);
const jst = (text) => new Date(`${text}+09:00`);
const clone = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FIXTURES = new URL("../lib/__fixtures__/pointRank/", import.meta.url);
const POINT_RANK_G1 = fs.readFileSync(
  new URL("g1-day4-with-table.html", FIXTURES),
  "utf8",
);
const POINT_RANK_NONE = fs.readFileSync(
  new URL("g3-no-data.html", FIXTURES),
  "utf8",
);
const EC_FIXTURES = new URL(
  "../lib/venueEntryCourseStats/__fixtures__/",
  import.meta.url,
);
const EC = (name) => fs.readFileSync(new URL(name, EC_FIXTURES), "utf8");
const MOTOR_FIXTURES = new URL(
  "../lib/venueMotorStats/__fixtures__/",
  import.meta.url,
);
const MOTOR = (name) =>
  fs.readFileSync(new URL(`${name}.html`, MOTOR_FIXTURES), "utf8");

// ---------------------------------------------------------------------------
// 道具: インメモリのSupabaseクライアント（PostgREST の、この検証に必要な部分だけ）
// ---------------------------------------------------------------------------
function createFakeClient({ tables = {}, failOn = {} } = {}) {
  const data = Object.fromEntries(
    Object.entries(tables).map(([k, rows]) => [k, rows.map(clone)]),
  );
  const writes = [];
  const calls = [];
  const likeRe = (pattern) =>
    new RegExp(
      `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
    );

  function from(table) {
    const q = {
      op: "select",
      filters: [],
      orders: [],
      range: null,
      limitN: null,
      single: false,
      returning: false,
      payload: null,
      opts: null,
    };
    const b = {
      select() {
        if (q.op !== "select") q.returning = true;
        return b;
      },
      eq(c, v) {
        q.filters.push((r) => r[c] === v);
        return b;
      },
      in(c, vs) {
        q.filters.push((r) => vs.includes(r[c]));
        return b;
      },
      like(c, p) {
        const re = likeRe(p);
        q.filters.push((r) => re.test(String(r[c])));
        return b;
      },
      gte(c, v) {
        q.filters.push((r) => r[c] >= v);
        return b;
      },
      not(c, op, v) {
        if (op === "is" && v === null) q.filters.push((r) => r[c] != null);
        else throw new Error(`fake: not(${c}, ${op}) は未対応`);
        return b;
      },
      order(c, { ascending = true } = {}) {
        q.orders.push([c, ascending]);
        return b;
      },
      range(a, z) {
        q.range = [a, z];
        return b;
      },
      limit(n) {
        q.limitN = n;
        return b;
      },
      maybeSingle() {
        q.single = true;
        return b;
      },
      insert(rows) {
        q.op = "insert";
        q.payload = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      upsert(rows, opts) {
        q.op = "upsert";
        q.payload = Array.isArray(rows) ? rows : [rows];
        q.opts = opts ?? {};
        return b;
      },
      update(patch) {
        q.op = "update";
        q.payload = patch;
        return b;
      },
      then(resolve, reject) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
    function exec() {
      calls.push({ table, op: q.op });
      const failure = failOn[`${table}:${q.op}`];
      if (failure) return { data: null, error: { message: failure } };
      const rows = (data[table] ??= []);
      const matched = () => rows.filter((r) => q.filters.every((f) => f(r)));
      if (q.op === "select") {
        let found = matched();
        for (const [c, asc] of [...q.orders].reverse()) {
          found = [...found].sort(
            (x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1),
          );
        }
        if (q.range) found = found.slice(q.range[0], q.range[1] + 1);
        if (q.limitN !== null) found = found.slice(0, q.limitN);
        const copies = found.map(clone);
        return { data: q.single ? (copies[0] ?? null) : copies, error: null };
      }
      if (q.op === "insert") {
        for (const r of q.payload) rows.push(clone(r));
        writes.push({ table, op: "insert", count: q.payload.length });
        return { data: q.returning ? q.payload.map(clone) : null, error: null };
      }
      if (q.op === "upsert") {
        const keys = String(q.opts.onConflict ?? "")
          .split(",")
          .filter(Boolean);
        const touched = [];
        for (const r of q.payload) {
          const existing = rows.find((e) => keys.every((k) => e[k] === r[k]));
          if (existing) {
            if (!q.opts.ignoreDuplicates) {
              Object.assign(existing, clone(r));
              touched.push(existing);
            }
          } else {
            const created = clone(r);
            rows.push(created);
            touched.push(created);
          }
        }
        writes.push({ table, op: "upsert", count: q.payload.length });
        return { data: q.returning ? touched.map(clone) : null, error: null };
      }
      // update
      const hit = matched();
      for (const r of hit) Object.assign(r, clone(q.payload));
      writes.push({ table, op: "update", count: hit.length });
      return { data: q.returning ? hit.map(clone) : null, error: null };
    }
    return b;
  }

  return {
    from,
    data,
    writes,
    calls,
    writesTo: (table) => writes.filter((w) => w.table === table),
    /** どんな呼び出しもエラーにする（off・行なし・075未適用の検証用） */
    get callCount() {
      return calls.length;
    },
  };
}

/** 偽の politeFetch: URL → HTML（または Error・Response）。呼び出しを記録し、同時実行数の最大値も測る */
function createFakeFetch(resolve) {
  const log = [];
  let active = 0;
  let maxActive = 0;
  async function fetchImpl(url, init) {
    log.push(String(url));
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await sleep(2);
      const r = await resolve(String(url), init);
      if (r instanceof Error) throw r;
      if (r instanceof Response) return r;
      return new Response(r, { status: 200 });
    } finally {
      active--;
    }
  }
  fetchImpl.log = log;
  Object.defineProperty(fetchImpl, "maxActive", { get: () => maxActive });
  return fetchImpl;
}

const liveRow = (job) => ({
  job,
  mode: "live",
  consecutive_failures: 0,
});

async function runJob({ job, run, store, client, politeFetch, at, query }) {
  return runScrapeJob({
    job,
    run,
    store,
    client,
    politeFetch,
    query,
    now: typeof at === "function" ? at : () => at,
    worker: "verify",
  });
}

const throwingFetch = () => {
  const f = async () => {
    f.count++;
    throw new Error("取得してはいけません");
  };
  f.count = 0;
  return f;
};
const strictClient = () => ({
  from() {
    throw new Error("DBへアクセスしてはいけません");
  },
});

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
    ["racer_profiles", "2026-10-02T03:00:00", "2026-10-02", "月次の窓の始まり(UTC 18:00)"],
    ["racer_profiles", "2026-10-02T05:50:00", "2026-10-02", "月次の窓の終わり(UTC 20:50)"],
    ["racer_profiles", "2026-10-02T02:59:00", "2026-10-01", "指定時刻の前は前日"],
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

// ===========================================================================
// (c)(d) 得点率（B2）
// ===========================================================================
const POINT_RANK_TABLES = () => ({
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
const pointRankFetch = (overrides = {}) =>
  createFakeFetch((url) => {
    const jcd = new URL(url).searchParams.get("jcd");
    if (jcd in overrides) return overrides[jcd];
    return jcd === "05" ? POINT_RANK_G1 : POINT_RANK_NONE;
  });
{
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

// ===========================================================================
// (e) 会場ごとのジョブ（B4 進入コース別選手成績・B3 会場別モーター成績）
// ===========================================================================
const EC_HOST_FIXTURE = {
  "www.boatrace-tokoname.jp": "tokoname.html", // 8 常滑（通常）
  "www.boatrace-tokuyama.jp": "tokuyama.html", // 18 徳山（通常）
  "www.boatrace-karatsu.jp": "karatsu.html", // 23 唐津（通常）
  "www.boatrace-mikuni.jp": "mikuni.html", // 10 三国（非開催: no_active_meet）
};
const ecTables = () => ({
  races: [
    { race_id: "2026-09-19-08-01", start_time: "10:30:00" },
    { race_id: "2026-09-19-08-02", start_time: "11:00:00" },
    { race_id: "2026-09-19-18-01", start_time: "10:30:00" },
    { race_id: "2026-09-19-23-01", start_time: "10:30:00" },
    { race_id: "2026-09-19-04-01", start_time: "10:30:00" }, // 対象外の会場
  ],
  race_entries: [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({
      race_id: "2026-09-19-08-01",
      boat_number: n,
      racer_id: 4000 + n,
    })),
  ],
});
const ecFetch = (overrides = {}) =>
  createFakeFetch((url) => {
    const host = new URL(url).hostname;
    if (host in overrides) return overrides[host];
    return EC(EC_HOST_FIXTURE[host]);
  });
{
  const at = jst("2026-09-19T20:00:00");
  const runIt = (store, client, fetchImpl, when = at, deps = {}) =>
    runJob({
      job: "entry_course_stats",
      run: (ctx) => runVenueEntryCourseStatsJob(ctx, { delayMs: 0, ...deps }),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });

  // live: 開催のある会場だけ取得・書き込み。racer_id は出走表から引く。成否履歴は last_report
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const fetchImpl = ecFetch();
    const res = await runIt(store, client, fetchImpl);
    const rows = client.data.venue_entry_course_stats ?? [];
    const row = store.state.get("entry_course_stats");
    check(
      "進入コース: 開催のある3会場(常滑2R・徳山1R・唐津1R)の4ページだけを取得する（三国・その他の対象会場は取得しない）",
      fetchImpl.log.length === 4 && res.status === 200,
      show({ log: fetchImpl.log, body: res.body }),
    );
    check(
      "進入コース: 4レース×36行=144行を書く。racer_id は自社の出走表から引く(常滑1R)。対象日を処理済みにする",
      rows.length === 144 &&
        rows.filter(
          (r) => r.race_id === "2026-09-19-08-01" && r.racer_id === 4001,
        ).length > 0 &&
        row.last_target_date === "2026-09-19",
      show({ n: rows.length, target: row.last_target_date }),
    );
    check(
      "進入コース: 成否履歴は last_report.health（git push・fs なし）。書き込み済みの会場は settledVenues",
      same(Object.keys(row.last_report.health).sort(), ["18", "23", "8"]) &&
        row.last_report.health["8"].consecutiveFailDays === 0 &&
        same(row.last_report.settledVenues, [8, 18, 23]),
      show(row.last_report),
    );
    check(
      "進入コース: 同時取得は会場間のみ(上限3)。1会場内は逐次",
      fetchImpl.maxActive <= 3,
      String(fetchImpl.maxActive),
    );
  }

  // shadow は書かない・処理済みにしない。shadow で取得済みの会場を、live が飛ばさない
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: {
        entry_course_stats: {
          ...liveRow("entry_course_stats"),
          mode: "shadow",
        },
      },
    });
    const fetchImpl = ecFetch();
    await runIt(store, client, fetchImpl);
    const afterShadow = store.state.get("entry_course_stats");
    check(
      "進入コース shadow: 書き込まない・処理済みにしない・settledVenues は空",
      client.writesTo("venue_entry_course_stats").length === 0 &&
        afterShadow.last_target_date === undefined &&
        same(afterShadow.last_report.settledVenues, []),
      show(afterShadow.last_report),
    );
    afterShadow.mode = "live";
    const before = fetchImpl.log.length;
    await runIt(store, client, fetchImpl, jst("2026-09-19T22:30:00"));
    check(
      "進入コース: shadow で取得した会場を、live へ切り替えた同じ日の起動が飛ばさず、全て取得して書く",
      fetchImpl.log.length - before === 4 &&
        (client.data.venue_entry_course_stats ?? []).length === 144,
      show({ fetched: fetchImpl.log.length - before }),
    );
  }

  // 一時的な失敗の会場だけを、補足の起動が再取得する
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const flaky = new FetchError("https://x", 3, new Error("ECONNRESET"));
    const first = ecFetch({ "www.boatrace-tokuyama.jp": flaky });
    const res1 = await runIt(store, client, first);
    const row = store.state.get("entry_course_stats");
    check(
      "進入コース: 徳山だけ取得失敗(network_error)。他の会場は書く。対象日を処理済みにしない(incomplete)。徳山は settled でない",
      res1.status === 200 &&
        res1.body.incomplete === true &&
        row.last_target_date === undefined &&
        same(row.last_report.settledVenues, [8, 23]) &&
        row.last_report.health["18"].lastReason === "network_error" &&
        isTransientReason(row.last_report.health["18"].lastReason),
      show({ body: res1.body, report: row.last_report }),
    );
    const second = ecFetch();
    const res2 = await runIt(store, client, second, jst("2026-09-19T22:30:00"));
    check(
      "進入コース: 補足の起動(22:30)は、書き込み済みでない徳山だけを再取得し、成功したら対象日を処理済みにする",
      res2.status === 200 &&
        second.log.length === 1 &&
        second.log[0].includes("tokuyama") &&
        row.last_target_date === "2026-09-19" &&
        row.last_report.health["18"].consecutiveFailDays === 0 &&
        same(row.last_report.settledVenues, [8, 18, 23]),
      show({ log: second.log, report: row.last_report }),
    );
    const third = ecFetch();
    const res3 = await runIt(store, client, third, jst("2026-09-20T00:30:00"));
    check(
      "進入コース: 00:30 の補足の起動は、処理済みの対象日(09-19)なので、何も取得しない",
      res3.body.skipped === "already_done" && third.log.length === 0,
      show(res3.body),
    );
  }

  // 全会場が解析0行（期待あり）はエラー。構造変化の会場は、履歴に積み、14日連続で通知
  {
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const allBroken = ecFetch({
      "www.boatrace-tokoname.jp": "<html><body>x</body></html>",
      "www.boatrace-tokuyama.jp": "<html><body>x</body></html>",
      "www.boatrace-karatsu.jp": "<html><body>x</body></html>",
    });
    const res = await runIt(store, client, allBroken);
    check(
      "進入コース: 取得した3会場の全てで解析0行は、0件エラー(500)。対象日を処理済みにしない",
      res.status === 500 &&
        /0件/.test(res.body.error ?? "") &&
        store.state.get("entry_course_stats").last_target_date === undefined,
      show(res.body),
    );
  }
  {
    // 徳山だけ構造変化(13日連続の履歴あり)。他は正常 → 14日目に通知が last_report.alerts に入る
    const client = createFakeClient({ tables: ecTables() });
    const store = createMemoryStore({
      rows: {
        entry_course_stats: {
          ...liveRow("entry_course_stats"),
          last_report: {
            date: "2026-09-18",
            mode: "live",
            health: {
              18: {
                consecutiveFailDays: 13,
                lastReason: "entry_course_table_not_found",
                lastCheckedDate: "2026-09-18",
              },
            },
          },
        },
      },
    });
    const broken = ecFetch({
      "www.boatrace-tokuyama.jp": "<html><body>x</body></html>",
    });
    const res = await runIt(store, client, broken);
    const report = store.state.get("entry_course_stats").last_report;
    check(
      "進入コース: 構造変化の疑いが14日連続になった会場は、last_report.alerts に入る(monitor がSlackへ通知)。他会場の分は書く",
      res.status === 200 &&
        report.health["18"].consecutiveFailDays === 14 &&
        report.alerts.length === 1 &&
        report.alerts[0].key === "drift:18" &&
        /徳山/.test(report.alerts[0].text) &&
        (client.data.venue_entry_course_stats ?? []).length > 0,
      show(report.alerts),
    );
  }

  // 書き込みエラーは、実行の失敗（従来はログのみ）
  {
    const client = createFakeClient({
      tables: ecTables(),
      failOn: { "venue_entry_course_stats:upsert": "disk full" },
    });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const res = await runIt(store, client, ecFetch());
    check(
      "進入コース: 書き込みエラーは、エラー(500)。処理済みにしない・書き込み済みの会場も記録しない",
      res.status === 500 &&
        store.state.get("entry_course_stats").last_target_date === undefined,
      show(res.body),
    );
  }

  // races が0件は、エラー（朝の初期化の失敗を成功にしない）
  {
    const client = createFakeClient({ tables: { races: [] } });
    const store = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const res = await runIt(store, client, ecFetch());
    check(
      "進入コース: 対象日の races が0件は、エラー。対象会場に開催が無いだけ(他の会場はある)なら、期待0件で正常",
      res.status === 500 && /races が0件/.test(res.body.error ?? ""),
      show(res.body),
    );
    const client2 = createFakeClient({
      tables: {
        races: [{ race_id: "2026-09-19-04-01", start_time: "10:30:00" }],
      },
    });
    const store2 = createMemoryStore({
      rows: { entry_course_stats: liveRow("entry_course_stats") },
    });
    const fetchImpl = ecFetch();
    const res2 = await runIt(store2, client2, fetchImpl);
    check(
      "進入コース: 対象10会場に開催が無い日(戸田のみ開催)は、取得せず正常・処理済み",
      res2.status === 200 &&
        fetchImpl.log.length === 0 &&
        store2.state.get("entry_course_stats").last_target_date ===
          "2026-09-19",
      show(res2.body),
    );
  }

  // CLI 互換: scrapeVenue の既定の挙動（global fetch を使う createHtmlFetcher・書き込みエラーはログのみ）
  {
    const { createHtmlFetcher, writeEntryCourseRows } =
      await import("../daily/scrape-venue-entry-course-stats.js");
    const fetcher = createHtmlFetcher(
      async () => new Response("", { status: 503 }),
    );
    let reason = null;
    try {
      await fetcher("http://x/");
    } catch (error) {
      reason = error.message;
    }
    check(
      "進入コース: HTTPエラーは http_XXX の理由コード（従来と同じ）",
      reason === "http_503",
      reason,
    );
    const failing = createFakeClient({
      failOn: { "venue_entry_course_stats:upsert": "x" },
    });
    const written = await writeEntryCourseRows(failing, [{ race_id: "a" }]);
    let threw = false;
    try {
      await writeEntryCourseRows(failing, [{ race_id: "a" }], {
        throwOnError: true,
      });
    } catch {
      threw = true;
    }
    check(
      "進入コース: 書き込みエラーは、既定ではログのみ(従来どおり0件書き込み)・throwOnError で例外",
      written === 0 && threw,
    );
  }
}

// 同じ日の再実行は、連続失敗日数を増やさない（履歴の冪等）
{
  let entry;
  const fail = {
    success: false,
    reason: "table_not_found",
    date: "2026-09-19",
  };
  entry = updateHealthForDate(entry, fail);
  entry = updateHealthForDate(entry, fail);
  entry = updateHealthForDate(entry, fail);
  check(
    "履歴: 同じ日に3回失敗しても、連続失敗日数は1（補足の起動で増えない）",
    entry.consecutiveFailDays === 1 && entry.lastReason === "table_not_found",
    show(entry),
  );
  entry = updateHealthForDate(entry, { ...fail, date: "2026-09-20" });
  check("履歴: 翌日も失敗なら2", entry.consecutiveFailDays === 2, show(entry));
  entry = updateHealthForDate(entry, {
    success: true,
    reason: null,
    date: "2026-09-20",
  });
  check(
    "履歴: 同じ日に、失敗の後で成功すれば、その日の失敗を取り消して0(連続日数は前日までの分でなく、成功でリセット)",
    entry.consecutiveFailDays === 0 && entry.lastReason === null,
    show(entry),
  );
  check(
    "理由コード: timeout・network_error・http_5xx・breaker_open は一時的。構造の理由(no_data_rows等)・http_404は一時的でない",
    ["timeout", "network_error", "http_503", "http_429", "breaker_open"].every(
      isTransientReason,
    ) &&
      ["no_data_rows", "entry_course_table_not_found", "http_404", null].every(
        (r) => !isTransientReason(r),
      ),
  );
  check(
    "理由コード: FetchError(タイムアウト由来)→timeout、FetchError(その他)→network_error、それ以外はメッセージのまま",
    reasonFromError(
      new FetchError(
        "u",
        3,
        Object.assign(new Error("a"), { name: "AbortError" }),
      ),
    ) === "timeout" &&
      reasonFromError(new FetchError("u", 3, new Error("x"))) ===
        "network_error" &&
      reasonFromError(new Error("http_404")) === "http_404",
  );
}

{
  const report = (mode, date, settled) => ({
    mode,
    date,
    settledVenues: settled,
  });
  const set = (r, date, mode) => [...previouslySettledVenues(r, date, mode)];
  check(
    "書き込み済みの会場の引き継ぎ: live 同士・同じ日だけ引き継ぐ。shadow の記録・別の日・現在が shadow の場合は引き継がない",
    same(
      set(report("live", "2026-09-19", [8, 18]), "2026-09-19", "live"),
      [8, 18],
    ) &&
      same(
        set(report("shadow", "2026-09-19", [8]), "2026-09-19", "live"),
        [],
      ) &&
      same(set(report("live", "2026-09-18", [8]), "2026-09-19", "live"), []) &&
      same(
        set(report("live", "2026-09-19", [8]), "2026-09-19", "shadow"),
        [],
      ) &&
      same(set(null, "2026-09-19", "live"), []),
  );
}

// ---- B3 会場別モーター成績 --------------------------------------------------
{
  const byName = (name) =>
    VENUE_MOTOR_STATS_CONFIG.find((v) => v.name === name);
  const fukuoka = byName("福岡");
  const ashiya = byName("芦屋");
  const gamagori = byName("蒲郡");
  const venueConfig = [fukuoka, ashiya, gamagori];
  const motorFetch = (overrides = {}) =>
    createFakeFetch((url) => {
      if (url in overrides) return overrides[url];
      if (url === fukuoka.url) return MOTOR("fukuoka");
      if (url === ashiya.url) return MOTOR("ashiya");
      if (url === gamagori.url) return MOTOR("gamagori");
      return new Response("", { status: 404 });
    });
  const at = jst("2026-09-19T06:00:00");
  const runIt = (store, client, fetchImpl, when = at) =>
    runJob({
      job: "venue_motor_stats",
      run: (ctx) => runVenueMotorStatsJob(ctx, { venueConfig }),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });

  // 実パーサー（3会場）で、live: 書き込み・scraped_date は対象日・履歴は last_report
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: { venue_motor_stats: liveRow("venue_motor_stats") },
    });
    const fetchImpl = motorFetch();
    const res = await runIt(store, client, fetchImpl);
    const rows = client.data.venue_motor_stats ?? [];
    const row = store.state.get("venue_motor_stats");
    check(
      "モーター成績 live: 3会場(福岡65・芦屋・蒲郡)を取得・解析して書く。scraped_date は対象日。処理済みにする",
      res.status === 200 &&
        rows.length > 65 &&
        rows.every((r) => r.scraped_date === "2026-09-19") &&
        rows.filter((r) => r.venue_code === 22).length === 65 &&
        row.last_target_date === "2026-09-19" &&
        same(Object.keys(row.last_report.health).sort(), ["21", "22", "7"]),
      show({ n: rows.length, body: res.body }),
    );
    check(
      "モーター成績: 会場の同時取得は上限内(4)。各会場は1リクエスト",
      fetchImpl.log.length === 3 && fetchImpl.maxActive <= 4,
      show({ n: fetchImpl.log.length, max: fetchImpl.maxActive }),
    );
  }
  // shadow は書かない
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: {
        venue_motor_stats: { ...liveRow("venue_motor_stats"), mode: "shadow" },
      },
    });
    await runIt(store, client, motorFetch());
    check(
      "モーター成績 shadow: 取得・解析のみ。venue_motor_stats へ書かず、処理済みにしない",
      client.writesTo("venue_motor_stats").length === 0 &&
        store.state.get("venue_motor_stats").last_target_date === undefined,
    );
  }
  // 一時的な失敗(http_503)の会場だけを、補足の起動(08:00)が再取得する。構造の失敗(no_data)は再取得しない
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: { venue_motor_stats: liveRow("venue_motor_stats") },
    });
    const first = motorFetch({
      [ashiya.url]: new Response("", { status: 503 }),
    });
    const res1 = await runIt(store, client, first);
    const row = store.state.get("venue_motor_stats");
    check(
      "モーター成績: 芦屋が503。他会場は書く。incomplete(処理済みにしない)。履歴に http_503",
      res1.status === 200 &&
        res1.body.incomplete === true &&
        row.last_target_date === undefined &&
        row.last_report.health["21"].lastReason === "http_503",
      show({ body: res1.body, health: row.last_report?.health }),
    );
    const second = motorFetch();
    const res2 = await runIt(store, client, second, jst("2026-09-19T08:00:00"));
    check(
      "モーター成績: 補足の起動(08:00)は芦屋だけを再取得して、処理済みにする",
      res2.status === 200 &&
        second.log.length === 1 &&
        second.log[0] === ashiya.url &&
        row.last_target_date === "2026-09-19",
      show({ log: second.log }),
    );
  }
  // 全会場が解析0行(期待あり)は0件エラー
  {
    const client = createFakeClient();
    const store = createMemoryStore({
      rows: { venue_motor_stats: liveRow("venue_motor_stats") },
    });
    const res = await runIt(
      store,
      client,
      motorFetch({
        [fukuoka.url]: "<html></html>",
        [ashiya.url]: "<html></html>",
        [gamagori.url]: "<html></html>",
      }),
    );
    check(
      "モーター成績: 取得した全会場で0行は、0件エラー(500)",
      res.status === 500 && /0件/.test(res.body.error ?? ""),
      show(res.body),
    );
  }
  // 従来の run() の部品: 既定は global fetch・throwOnError 無しで、書き込みエラーはログのみ
  {
    const { writeMotorStatsRows, toMotorStatsRow } =
      await import("../daily/scrape-venue-motor-stats.js");
    const failing = createFakeClient({
      failOn: { "venue_motor_stats:upsert": "x" },
    });
    const written = await writeMotorStatsRows(failing, [{ a: 1 }]);
    let threw = false;
    try {
      await writeMotorStatsRows(failing, [{ a: 1 }], { throwOnError: true });
    } catch {
      threw = true;
    }
    const sample = toMotorStatsRow(fukuoka, { motorNumber: 43 }, "2026-09-19");
    check(
      "モーター成績: 書き込みエラーは既定ではログのみ・throwOnError で例外。行の組み立ては従来と同じ列",
      written === 0 &&
        threw &&
        sample.venue_code === 22 &&
        sample.scraped_date === "2026-09-19" &&
        sample.source_template === "genericTable" &&
        Object.keys(sample).length === 19,
      show(sample),
    );
  }
}

// ===========================================================================
// (f) 選手ニュース（B5）
// ===========================================================================
const NEWS_BASE = "https://www.boatrace.jp/owpc/pc/site/news/racer";
const newsHtml = (items) =>
  `<ul class="news4_newsList">${items
    .map(
      (i) =>
        `<li><a href="${i.href}"><span class="news4_newsTitle">${i.title}</span><span class="news4_dateText">${i.date}</span></a></li>`,
    )
    .join("")}</ul>`;
const NEWS_SEPT = newsHtml([
  {
    href: "/owpc/pc/site/news/n1",
    title: "登録第4444号 山田 太郎選手（東京支部）通算1000勝達成",
    date: "2026/09/10",
  },
  {
    href: "/owpc/pc/site/news/n2",
    title: "登録第9999号 鈴木 一郎選手（大阪支部）通算500勝達成",
    date: "2026/09/11",
  },
  {
    href: "/owpc/pc/site/news/n3",
    title: "登録第1234号 佐藤選手 達成のお知らせ",
    date: "2026/09/12",
  },
  {
    href: "/owpc/pc/site/news/n4",
    title: "施設メンテナンスのお知らせ",
    date: "2026/09/13",
  },
]);
const NEWS_AUG = newsHtml([
  {
    href: "/owpc/pc/site/news/n5",
    title: "登録第4444号 山田 太郎選手（東京支部）通算900勝達成",
    date: "2026/08/20",
  },
]);
const newsFetch = (overrides = {}) =>
  createFakeFetch((url) => {
    if (url in overrides) return overrides[url];
    if (url === `${NEWS_BASE}/2026/09/`) return NEWS_SEPT;
    if (url === `${NEWS_BASE}/2026/08/`) return NEWS_AUG;
    return new Response("", { status: 404 });
  });
const newsTables = () => ({
  racer_profiles: [{ racer_id: 4444, name: "山田 太郎", branch: "東京" }],
  racer_news: [],
  racer_news_pending: [],
});
{
  const at = jst("2026-09-19T23:10:00");
  const runIt = (store, client, fetchImpl, when = at) =>
    runJob({
      job: "racer_news",
      run: (ctx) => runRacerNewsJob(ctx),
      store,
      client,
      politeFetch: fetchImpl,
      at: when,
    });

  // shadow: 取得・解析・照合のみ。書かない
  {
    const client = createFakeClient({ tables: newsTables() });
    const store = createMemoryStore({
      rows: { racer_news: { ...liveRow("racer_news"), mode: "shadow" } },
    });
    const fetchImpl = newsFetch();
    const res = await runIt(store, client, fetchImpl);
    const report = store.state.get("racer_news").last_report;
    check(
      "選手ニュース shadow: 当月・前月の一覧を取得し、生成2・要確認2・対象外1を数えるが、racer_news・racer_news_pending へ書かない",
      res.status === 200 &&
        fetchImpl.log.length === 2 &&
        report.generated === 2 &&
        report.pending === 2 &&
        report.skipped === 1 &&
        client.writesTo("racer_news").length === 0 &&
        client.writesTo("racer_news_pending").length === 0 &&
        store.state.get("racer_news").last_target_date === undefined,
      show({ body: res.body, report }),
    );
  }

  // live: racer_news へ2件・要確認リスト(DBの表)へ2件。pending.json(fs)には書かない
  const client = createFakeClient({ tables: newsTables() });
  {
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(store, client, newsFetch());
    const news = client.data.racer_news;
    const pending = client.data.racer_news_pending;
    check(
      "選手ニュース live: 照合を通過した2件(当月・前月)を racer_news へ、選手を特定できない・見出しの形式が違う2件を要確認リスト(DB)へ書く",
      res.status === 200 &&
        news.length === 2 &&
        news.every((n) => n.racer_id === 4444 && /山田太郎/.test(n.title)) &&
        pending.length === 2 &&
        pending.every((p) => p.status === "pending") &&
        pending.some((p) => /見つかりません/.test(p.reason)) &&
        pending.some((p) => /抽出できません/.test(p.reason)) &&
        store.state.get("racer_news").last_target_date === "2026-09-19",
      show({ n: news.length, p: pending.length, body: res.body }),
    );
  }
  // 冪等: 別の実行(補足の起動・GitHub Actionsとの並走)でも、処理済みの記事は増えない
  {
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(
      store,
      client,
      newsFetch(),
      jst("2026-09-20T01:10:00"),
    );
    check(
      "選手ニュース: 処理済みの記事(racer_news・要確認リストに記録済み)は、二度目の実行で増えない(生成0・要確認0)",
      res.status === 200 &&
        client.data.racer_news.length === 2 &&
        client.data.racer_news_pending.length === 2 &&
        res.body.generated === 0 &&
        res.body.pending === 0 &&
        res.body.skipped === 5 &&
        store.state.get("racer_news").last_target_date === "2026-09-19",
      show(res.body),
    );
  }
  // 取得失敗はエラー（一覧の1ページだけでも）
  for (const [label, overrides] of [
    [
      "当月の一覧の取得失敗",
      { [`${NEWS_BASE}/2026/09/`]: new FetchError("u", 3, new Error("x")) },
    ],
    [
      "当月・前月とも取得失敗",
      {
        [`${NEWS_BASE}/2026/09/`]: new FetchError("u", 3, new Error("x")),
        [`${NEWS_BASE}/2026/08/`]: new Response("", { status: 503 }),
      },
    ],
  ]) {
    const c = createFakeClient({ tables: newsTables() });
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(store, c, newsFetch(overrides));
    check(
      `選手ニュース: ${label}は、エラー(500)。対象日を処理済みにしない（補足の起動が再試行する）`,
      res.status === 500 &&
        store.state.get("racer_news").last_target_date === undefined,
      show(res.body),
    );
  }
  // 記事の処理エラー（DBの書き込み失敗）はエラー
  {
    const c = createFakeClient({
      tables: newsTables(),
      failOn: { "racer_news:insert": "disk full" },
    });
    const store = createMemoryStore({
      rows: { racer_news: liveRow("racer_news") },
    });
    const res = await runIt(store, c, newsFetch());
    check(
      "選手ニュース: racer_news の書き込みエラーは、エラー(500)（ログだけで成功にしない）",
      res.status === 500 &&
        store.state.get("racer_news").last_target_date === undefined,
      show(res.body),
    );
  }

  // 要確認リストのDBストア: 追加は冪等・承認/却下の反映・未確認の一覧・移行期間の統合(DB優先)
  {
    const c = createFakeClient({ tables: { racer_news_pending: [] } });
    const store = createDbPendingStore(c);
    const item = {
      id: "grade-announcement-https://x/1",
      source: "grade-announcement",
      reason: "テスト",
      candidate: { racerId: 1 },
      sourceUrl: "https://x/1",
      sourceName: "公式",
      detectedAt: "2026-09-19",
    };
    await store.addPendingItem(item);
    await store.addPendingItem(item);
    check(
      "要確認リスト(DB): 同じ id の追加は冪等(1行)。未確認の一覧・処理済みの判定(source_url)ができる",
      c.data.racer_news_pending.length === 1 &&
        (await store.listPending()).length === 1 &&
        (await store.hasItemForSourceUrl("https://x/1")) === true &&
        (await store.hasItemForSourceUrl("https://x/2")) === false,
    );
    await store.updateStatus(item.id, "approved");
    const row = c.data.racer_news_pending[0];
    let missing = null;
    try {
      await store.updateStatus("no-such-id", "rejected");
    } catch (error) {
      missing = error.message;
    }
    check(
      "要確認リスト(DB): 承認を反映すると status=approved・resolved_at が入り、未確認の一覧から消える。存在しない id は例外",
      row.status === "approved" &&
        typeof row.resolved_at === "string" &&
        (await store.listPending()).length === 0 &&
        /見つかりません/.test(missing ?? ""),
      show({ row, missing }),
    );
    const merged = mergePendingLists(
      [{ id: "a", status: "approved" }],
      [
        { id: "a", status: "pending" },
        { id: "b", status: "pending" },
      ],
    );
    check(
      "要確認リスト: DB と pending.json の統合は、id で重複を除き、DB を優先する(DBで承認済みの項目が、ファイルの未確認で復活しない)",
      merged.length === 2 &&
        merged.find((m) => m.id === "a").status === "approved" &&
        merged.find((m) => m.id === "b").status === "pending",
      show(merged),
    );
    const failing = createDbPendingStore(
      createFakeClient({ failOn: { "racer_news_pending:select": "no table" } }),
    );
    let msg = "";
    try {
      await failing.listPending();
    } catch (error) {
      msg = error.message;
    }
    check(
      "要確認リスト(DB): DBエラーは、握りつぶさず、意味のあるメッセージの例外",
      /racer_news_pending.*取得に失敗/.test(msg),
      msg,
    );
  }
}

// ===========================================================================
// (g) 選手プロフィール・期別成績（B6）: チャンクの再開位置
// ===========================================================================
const summaryOf = ({
  processed = 100,
  last = 4099,
  remaining = 1500,
  fail = 0,
  attempts,
  aborted = false,
  saveErrors = 0,
  targetCount,
} = {}) => {
  const total = attempts ?? processed;
  return {
    targetCount: targetCount ?? processed,
    processedPrefix: processed,
    lastProcessedRacerId: processed > 0 ? last : null,
    remaining,
    aborted,
    deadlineStopped: remaining > 0 && !aborted,
    durationSeconds: 1,
    profile: {
      successCount: 0,
      failCount: 0,
      saveErrorCount: saveErrors,
      failedRacerIds: [],
    },
    season: {
      successCount: Math.max(
        0,
        total - fail - Math.min(10, Math.max(0, total - fail)),
      ),
      unchangedCount: Math.min(10, Math.max(0, total - fail)),
      noDataCount: 0,
      failCount: fail,
      failedRacerIds: [],
    },
  };
};
{
  const at = (t) => jst(`2026-10-${t}`);
  const stubSync = (...summaries) => {
    const calls = [];
    const fn = async (args) => {
      calls.push(args);
      return {
        summary: summaries[Math.min(calls.length - 1, summaries.length - 1)],
      };
    };
    fn.calls = calls;
    return fn;
  };
  const runIt = (store, sync, when, { query, mode } = {}) => {
    if (mode) store.state.get("racer_profiles").mode = mode;
    return runJob({
      job: "racer_profiles",
      run: (ctx) =>
        runRacerProfilesJob(ctx, { sync, log: () => {}, logError: () => {} }),
      store,
      client: strictClient(),
      politeFetch: throwingFetch(),
      at: when,
      query,
    });
  };
  const newStore = (extra = {}) =>
    createMemoryStore({
      rows: { racer_profiles: { ...liveRow("racer_profiles"), ...extra } },
    });

  // 先頭 → 中間 → 最後。処理済みは最後のチャンクの完了時だけ
  {
    const store = newStore();
    const sync = stubSync(
      summaryOf({ processed: 110, last: 4099, remaining: 1500 }),
      summaryOf({ processed: 110, last: 4321, remaining: 800 }),
      summaryOf({
        processed: 800,
        last: 5210,
        remaining: 0,
        fail: 200,
        attempts: 1627,
      }),
    );
    const r1 = await runIt(store, sync, at("02T03:00:00"));
    const row = store.state.get("racer_profiles");
    check(
      "選手プロフィール 1回目: 先頭(afterRacerId=null)から、同時4・上限300人・politeFetch(再試行は無効)で処理。cursor に最後の登録番号(4099)。対象日は処理済みにしない",
      r1.status === 200 &&
        sync.calls[0].options.afterRacerId === null &&
        sync.calls[0].options.limit === 300 &&
        sync.calls[0].options.concurrency === 4 &&
        sync.calls[0].deps.fetchRetries === 0 &&
        row.cursor.afterRacerId === 4099 &&
        row.cursor.done === false &&
        row.cursor.targetDate === "2026-10-02" &&
        row.cursor.mode === "live" &&
        row.last_target_date === undefined &&
        r1.body.incomplete === true,
      show({ cursor: row.cursor, body: r1.body }),
    );
    const r2 = await runIt(store, sync, at("02T03:10:00"));
    check(
      "選手プロフィール 2回目(10分後): 前回の最後の登録番号(4099)より後から再開し、cursor が前進する(4321)。まだ処理済みにしない",
      r2.status === 200 &&
        sync.calls[1].options.afterRacerId === 4099 &&
        row.cursor.afterRacerId === 4321 &&
        row.cursor.stats.chunks === 2 &&
        row.last_target_date === undefined,
      show(row.cursor),
    );
    const r3 = await runIt(store, sync, at("02T03:20:00"));
    check(
      "選手プロフィール 最後のチャンク(残り0): 対象日を処理済みにする。cursor は done。失敗率が5%超なら last_report.alerts に通知(期限つき)",
      r3.status === 200 &&
        r3.body.done === true &&
        row.last_target_date === "2026-10-02" &&
        row.cursor.done === true &&
        row.last_report.alerts.length === 1 &&
        row.last_report.alerts[0].key === "season_fail_rate" &&
        new Date(row.last_report.alerts[0].until) > at("02T03:20:00") &&
        new Date(row.last_report.alerts[0].until) < at("05T00:00:00"),
      show({ report: row.last_report, cursor: row.cursor }),
    );
    const r4 = await runIt(store, sync, at("02T03:30:00"));
    check(
      "選手プロフィール: 処理済みの対象日の以降の起動(03:30〜05:50)は、何もしない(取得しない・sync を呼ばない)",
      r4.body.skipped === "already_done" && sync.calls.length === 3,
      show(r4.body),
    );
    const sync2 = stubSync(
      summaryOf({ processed: 110, last: 1500, remaining: 900 }),
    );
    await runIt(store, sync2, jst("2026-11-02T03:00:00"));
    check(
      "選手プロフィール: 翌月(対象日が変わる)は、前月の cursor を引き継がず、先頭から",
      sync2.calls[0].options.afterRacerId === null &&
        row.cursor.targetDate === "2026-11-02" &&
        row.cursor.afterRacerId === 1500,
      show(row.cursor),
    );
  }

  // モード違いの cursor は引き継がない（shadow の進捗を live が使わない）
  {
    const store = newStore({
      cursor: {
        targetDate: "2026-10-02",
        mode: "shadow",
        afterRacerId: 4500,
        done: false,
        stats: {},
      },
    });
    const sync = stubSync(summaryOf());
    await runIt(store, sync, at("02T03:00:00"));
    check(
      "選手プロフィール: shadow の cursor は、live に引き継がない(先頭から処理する)",
      sync.calls[0].options.afterRacerId === null &&
        sync.calls[0].options.dryRun === false,
      show(sync.calls[0].options),
    );
  }
  // shadow: dryRun・cursor は shadow 専用・完了後は sync を呼ばない・対象日を処理済みにしない
  {
    const store = newStore({ mode: "shadow" });
    const sync = stubSync(
      summaryOf({ processed: 300, last: 5000, remaining: 0 }),
    );
    await runIt(store, sync, at("02T03:00:00"));
    const row = store.state.get("racer_profiles");
    const before = sync.calls.length;
    await runIt(store, sync, at("02T03:10:00"));
    check(
      "選手プロフィール shadow: dryRun(書かない)で処理・cursor.mode=shadow・完了後の起動は sync を呼ばない・対象日を処理済みにしない",
      sync.calls[0].options.dryRun === true &&
        row.cursor.mode === "shadow" &&
        row.cursor.done === true &&
        sync.calls.length === before &&
        row.last_target_date === undefined,
      show(row.cursor),
    );
  }
  // 系統的な失敗（連続失敗・新規プロフィールの保存のDBエラー）: エラー・cursor を進めない
  for (const [label, summary] of [
    [
      "連続20件の失敗で中断",
      summaryOf({ processed: 40, aborted: true, remaining: 1500 }),
    ],
    ["新規選手のプロフィール保存のDBエラー", summaryOf({ saveErrors: 2 })],
  ]) {
    const prior = {
      targetDate: "2026-10-02",
      mode: "live",
      afterRacerId: 4099,
      done: false,
      stats: {},
    };
    const store = newStore({ cursor: prior });
    const res = await runIt(store, stubSync(summary), at("02T03:10:00"));
    const row = store.state.get("racer_profiles");
    check(
      `選手プロフィール: ${label}は、エラー(500)。cursor は進めず、次の起動が同じチャンクをやり直す`,
      res.status === 500 &&
        same(row.cursor, prior) &&
        row.consecutive_failures === 1,
      show({ body: res.body, cursor: row.cursor }),
    );
  }
  // 散発的な失敗(4%程度)は、進捗を止めない
  {
    const store = newStore();
    const res = await runIt(
      store,
      stubSync(summaryOf({ processed: 110, fail: 6, remaining: 1500 })),
      at("02T03:00:00"),
    );
    check(
      "選手プロフィール: 散発的な失敗(6/110)は、進捗を止めない(200・cursor 前進)",
      res.status === 200 &&
        store.state.get("racer_profiles").cursor.afterRacerId === 4099,
      show(res.body),
    );
  }
  // 0件エラーは、十分な母数(10人以上)があるときだけ
  {
    const store = newStore();
    const res = await runIt(
      store,
      stubSync(
        summaryOf({
          processed: 300,
          attempts: 300,
          fail: 300,
          remaining: 1000,
        }),
      ),
      at("02T03:00:00"),
    );
    check(
      "選手プロフィール: 期別成績を300人取得して1件も解析できなかった(0件)は、エラー(500)",
      res.status === 500 && /0件/.test(res.body.error ?? ""),
      show(res.body),
    );
    const prior = {
      targetDate: "2026-10-02",
      mode: "live",
      afterRacerId: 5200,
      done: false,
      stats: {},
    };
    const store2 = newStore({ cursor: prior });
    const res2 = await runIt(
      store2,
      stubSync(
        summaryOf({
          processed: 3,
          attempts: 3,
          fail: 3,
          last: 5210,
          remaining: 0,
        }),
      ),
      at("02T03:30:00"),
    );
    check(
      "選手プロフィール: 最後の数人(3人)が失敗しても、母数が小さいため0件エラーにせず、サイクルを完了する",
      res2.status === 200 &&
        store2.state.get("racer_profiles").cursor.done === true,
      show(res2.body),
    );
  }
  // 最初のチャンクで対象が0人はエラー。再開後に対象が0人(全員処理済み)は完了
  {
    const store = newStore();
    const res = await runIt(
      store,
      stubSync(summaryOf({ processed: 0, targetCount: 0, remaining: 0 })),
      at("02T03:00:00"),
    );
    check(
      "選手プロフィール: 最初のチャンクで対象選手が0人は、エラー(0件を成功にしない)",
      res.status === 500 && /対象選手が0件/.test(res.body.error ?? ""),
      show(res.body),
    );
    const store2 = newStore({
      cursor: {
        targetDate: "2026-10-02",
        mode: "live",
        afterRacerId: 5210,
        done: false,
        stats: {},
      },
    });
    const res2 = await runIt(
      store2,
      stubSync(summaryOf({ processed: 0, targetCount: 0, remaining: 0 })),
      at("02T03:40:00"),
    );
    check(
      "選手プロフィール: 再開後に対象が0人(前回までに全員処理済み)は、完了として対象日を処理済みにする",
      res2.status === 200 &&
        store2.state.get("racer_profiles").last_target_date === "2026-10-02",
      show(res2.body),
    );
  }
  // 手動の動作確認: ?chunk=N
  {
    const store = newStore();
    const sync = stubSync(summaryOf({ processed: 5, remaining: 1600 }));
    await runIt(store, sync, at("02T03:00:00"), { query: { chunk: "5" } });
    const bad = await runIt(
      newStore(),
      stubSync(summaryOf()),
      at("02T03:00:00"),
      {
        query: { chunk: "abc" },
      },
    );
    check(
      "選手プロフィール: ?chunk=5 で1回の処理人数を5人にできる。不正な値は、無視せずエラー(500)",
      sync.calls[0].options.limit === 5 &&
        bad.status === 500 &&
        /chunk/.test(bad.body.error ?? ""),
      show(bad.body),
    );
  }

  // ---- 実際の runRacerProfileSync（偽のSupabase・偽の公式サイト）での、チャンク・同時取得の挙動 ----
  const seasonHtml = (ability) => {
    const rows = [
      ["勝率", "6.87"],
      ["2連対率", "54.30%"],
      ["3連対率", "70.10%"],
      ["出走回数", "116回"],
      ["優出回数", "2回"],
      ["優勝回数", "1回"],
      ["平均スタートタイミング", "0.16"],
      ["フライング回数", "0回"],
      ["出遅れ回数（選手責任）", "0回"],
      ["能力指数", String(ability)],
    ];
    const tbody = rows
      .map(([k, v]) => `<tbody><tr><th>${k}</th><td>${v}</td></tr></tbody>`)
      .join("");
    return `<div class="text"><p class="h-alignR">集計期間：2025/11/01-2026/04/30</p></div><div class="table1"><table>${tbody}</table></div>`;
  };
  const ids = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010];
  const profileTables = () => ({
    racer_profiles: ids.map((id) => ({
      racer_id: id,
      ability_index: 40,
      flying_count_period: 0,
      false_start_count_period: 0,
      period_label: "old",
      official_win_rate_period: 1,
    })),
    race_entries: [],
  });
  const noSleep = () => Promise.resolve();
  const baseOptions = (extra) => ({
    ...parseProfileArgs([]),
    delayMs: 0,
    ...extra,
  });
  const seasonFetch = (latency = () => 0, hook = () => {}) => {
    const log = [];
    let active = 0;
    let maxActive = 0;
    const fn = async (url) => {
      const id = Number(new URL(String(url)).searchParams.get("toban"));
      log.push(id);
      active++;
      maxActive = Math.max(maxActive, active);
      hook(id, log.length);
      try {
        await sleep(latency(id));
        return new Response(seasonHtml(50 + (id % 10)), { status: 200 });
      } finally {
        active--;
      }
    };
    fn.log = log;
    Object.defineProperty(fn, "maxActive", { get: () => maxActive });
    return fn;
  };
  const deps = (fetchImpl, extra = {}) => ({
    fetchImpl,
    sleep: noSleep,
    log: () => {},
    logError: () => {},
    ...extra,
  });

  // afterRacerId: その番号より大きい選手だけ（件数の増減があっても位置がずれない）
  {
    const registered = new Map(ids.map((id) => [id, {}]));
    check(
      "選手プロフィール: buildPopulation は afterRacerId より大きい登録番号だけを、昇順・limit つきで返す。指定なしは従来どおり",
      same(
        buildPopulation({
          registered,
          recentIds: new Set([1500]),
          racerIds: null,
          limit: 3,
          offset: 0,
          afterRacerId: 1004,
        }),
        [1005, 1006, 1007],
      ) &&
        same(
          buildPopulation({
            registered,
            recentIds: new Set(),
            racerIds: null,
            limit: 3,
            offset: 0,
          }),
          [1001, 1002, 1003],
        ) &&
        same(
          buildPopulation({
            registered,
            recentIds: new Set(),
            racerIds: null,
            limit: null,
            offset: 0,
            afterRacerId: 1010,
          }),
          [],
        ),
    );
  }
  // チャンク（逐次）: 1005〜1007 を処理し、残り3人。書き込みは対象の3人だけ
  {
    const client = createFakeClient({ tables: profileTables() });
    const fetchImpl = seasonFetch();
    const { summary } = await runRacerProfileSync({
      client,
      options: baseOptions({ afterRacerId: 1004, limit: 3 }),
      deps: deps(fetchImpl),
    });
    const updated = client.data.racer_profiles
      .filter((r) => r.period_label !== "old")
      .map((r) => r.racer_id);
    check(
      "選手プロフィール(実処理): afterRacerId=1004・limit=3 で 1005〜1007 だけを処理・書き込み。再開位置=1007・残り3人",
      same(fetchImpl.log, [1005, 1006, 1007]) &&
        same(updated, [1005, 1006, 1007]) &&
        summary.processedPrefix === 3 &&
        summary.lastProcessedRacerId === 1007 &&
        summary.remaining === 3 &&
        summary.resumed === true,
      show({
        log: fetchImpl.log,
        updated,
        prefix: summary.processedPrefix,
        last: summary.lastProcessedRacerId,
        remaining: summary.remaining,
      }),
    );
    const next = await runRacerProfileSync({
      client,
      options: baseOptions({ afterRacerId: 1007, limit: 300 }),
      deps: deps(seasonFetch()),
    });
    check(
      "選手プロフィール(実処理): 次のチャンク(1007より後・limit=300)で残りを全て処理し、残り0(完了)。既に処理した選手は再取得しない",
      next.summary.remaining === 0 &&
        next.summary.lastProcessedRacerId === 1010 &&
        next.summary.targetCount === 3,
      show({
        remaining: next.summary.remaining,
        last: next.summary.lastProcessedRacerId,
      }),
    );
    const done = await runRacerProfileSync({
      client,
      options: baseOptions({ afterRacerId: 1010, limit: 300 }),
      deps: deps(seasonFetch()),
    });
    check(
      "選手プロフィール(実処理): 再開位置が最後の選手なら対象0人・残り0で、失敗判定にしない(verdict ok)",
      done.summary.targetCount === 0 &&
        done.summary.remaining === 0 &&
        done.verdict.ok === true,
      show(done.verdict),
    );
  }
  // 同時取得: 上限を守る・遅い選手がいても、先頭からの連続した範囲だけを処理済みとする
  {
    const client = createFakeClient({ tables: profileTables() });
    // 番号が小さい選手ほど遅い（完了の順序が、着手の順序と逆になる）
    const fetchImpl = seasonFetch(
      (id) => (1011 - id) * 4,
      () => {},
    );
    let started = 0;
    const { summary } = await runRacerProfileSync({
      client,
      options: baseOptions({ concurrency: 3 }),
      deps: deps(fetchImpl, {
        shouldStop: () => started++ >= 5, // 6人目の着手前に、ソフトデッドラインを過ぎる
      }),
    });
    const processed = client.data.racer_profiles
      .filter((r) => r.period_label !== "old")
      .map((r) => r.racer_id)
      .sort((a, b) => a - b);
    const last = summary.lastProcessedRacerId;
    const contiguous = ids
      .filter((id) => id <= last)
      .every((id) => processed.includes(id));
    check(
      "選手プロフィール(同時3): 同時取得は3人まで。ソフトデッドラインで中断しても、再開位置(最後の登録番号)までの選手は全て処理済み(欠けがない)",
      fetchImpl.maxActive <= 3 &&
        summary.deadlineStopped === true &&
        summary.processedPrefix >= 3 &&
        contiguous &&
        summary.remaining === ids.length - summary.processedPrefix &&
        summary.stoppedEarly === false,
      show({
        max: fetchImpl.maxActive,
        processed,
        last,
        prefix: summary.processedPrefix,
        remaining: summary.remaining,
      }),
    );
  }
  // 従来（CLI）: 同時1・オプション無しは、昇順の逐次。再試行は従来どおり（fetchRetries 既定）
  {
    const client = createFakeClient({ tables: profileTables() });
    const fetchImpl = seasonFetch();
    const { summary, verdict } = await runRacerProfileSync({
      client,
      options: baseOptions({}),
      deps: deps(fetchImpl),
    });
    check(
      "選手プロフィール(従来のCLI): 同時1・昇順の逐次で全10人を処理する。同時に走るのは1人。verdict ok",
      same(fetchImpl.log, ids) &&
        fetchImpl.maxActive === 1 &&
        summary.season.successCount === 10 &&
        verdict.ok === true &&
        summary.remaining === 0,
      show({ log: fetchImpl.log, max: fetchImpl.maxActive, verdict }),
    );
    const failing = { count: 0 };
    const failFetch = async () => {
      failing.count++;
      return new Response("", { status: 500 });
    };
    await runRacerProfileSync({
      client: createFakeClient({ tables: profileTables() }),
      options: baseOptions({ racerIds: [1001] }),
      deps: deps(failFetch),
    });
    const withRetries = failing.count;
    failing.count = 0;
    await runRacerProfileSync({
      client: createFakeClient({ tables: profileTables() }),
      options: baseOptions({ racerIds: [1001] }),
      deps: deps(failFetch, { fetchRetries: 0 }),
    });
    check(
      "選手プロフィール: 再試行は、既定では従来どおり3回試行。fetchRetries=0(politeFetch を使う Vercel)なら1回だけ(二重に再試行しない)",
      withRetries === 3 && failing.count === 1,
      show({ withRetries, without: failing.count }),
    );
  }
}

// ===========================================================================
// (h) 監視: ジョブ自身の通知・月次ジョブの誤報の抑制
// ===========================================================================
{
  const overdue = (job, lastTarget, when, mode = "live") =>
    evaluateJobStates(
      [{ job, mode, consecutive_failures: 0, last_target_date: lastTarget }],
      jst(when),
    ).filter((a) => a.kind === "daily_overdue");
  check(
    "監視: 日次ジョブ(得点率)が、指定時刻の3時間後を過ぎても対象日を処理していなければ、従来どおり通知する",
    overdue("point_rank", "2026-09-18", "2026-09-19T22:30:00").length === 0 &&
      overdue("point_rank", "2026-09-18", "2026-09-20T01:10:00").length === 1 &&
      overdue("point_rank", "2026-09-19", "2026-09-20T01:10:00").length === 0,
  );
  check(
    "監視: 月次ジョブ(選手プロフィール)は、起動する日(JST 毎月2日、5月・11月は9日・16日も)の指定時刻(03:00)の3時間後(06:00)まで未処理なら通知する",
    overdue("racer_profiles", "2026-09-02", "2026-10-02T04:00:00").length ===
      0 &&
      overdue("racer_profiles", "2026-09-02", "2026-10-02T06:10:00").length ===
        1 &&
      overdue("racer_profiles", "2026-04-02", "2026-05-09T07:00:00").length ===
        1 &&
      overdue("racer_profiles", "2026-10-02", "2026-10-02T07:00:00").length ===
        0,
  );
  check(
    "監視: 月次ジョブを、起動しない日(毎月3日以降・6月の9日等)に、日次の未処理として誤報しない",
    overdue("racer_profiles", "2026-09-02", "2026-09-20T15:00:00").length ===
      0 &&
      overdue("racer_profiles", "2026-05-02", "2026-06-09T07:00:00").length ===
        0 &&
      overdue("racer_profiles", null, "2026-09-05T07:00:00").length === 0,
  );
  const reportAlerts = (row, when = "2026-09-19T23:00:00") =>
    evaluateJobStates([{ consecutive_failures: 0, ...row }], jst(when)).filter(
      (a) => a.kind === "job_report",
    );
  const a1 = reportAlerts({
    job: "venue_motor_stats",
    mode: "live",
    last_report: {
      alerts: [
        {
          key: "drift:23",
          text: "会場公式サイトの構造変化の疑い 唐津: table_not_found が14日連続",
        },
      ],
    },
  });
  check(
    "監視: last_report.alerts は、ジョブ名つきの通知(key: report:{job}:{key})になる。shadow でも通知し、off は通知しない",
    a1.length === 1 &&
      a1[0].key === "report:venue_motor_stats:drift:23" &&
      /唐津/.test(a1[0].text) &&
      reportAlerts({
        job: "venue_motor_stats",
        mode: "shadow",
        last_report: { alerts: [{ key: "k", text: "t" }] },
      }).length === 1 &&
      reportAlerts({
        job: "venue_motor_stats",
        mode: "off",
        last_report: { alerts: [{ key: "k", text: "t" }] },
      }).length === 0,
    show(a1),
  );
  check(
    "監視: until を過ぎた通知は出さない（月次の1回きりの事象が、last_report が残る間ずっと再通知されない）。形式が不正な項目は無視",
    reportAlerts(
      {
        job: "racer_profiles",
        mode: "live",
        last_report: {
          alerts: [
            {
              key: "season_fail_rate",
              text: "t",
              until: "2026-10-03T00:00:00.000Z",
            },
          ],
        },
      },
      "2026-10-02T12:00:00",
    ).length === 1 &&
      reportAlerts(
        {
          job: "racer_profiles",
          mode: "live",
          last_report: {
            alerts: [
              {
                key: "season_fail_rate",
                text: "t",
                until: "2026-10-03T00:00:00.000Z",
              },
            ],
          },
        },
        "2026-10-20T12:00:00",
      ).length === 0 &&
      reportAlerts({
        job: "racer_profiles",
        mode: "live",
        last_report: { alerts: [{ key: 1 }, null, "x"] },
      }).length === 0,
  );
  check(
    "レジストリ: isScheduledDate（runDaysOfMonth）。毎日のジョブは常に true。レジストリ全体が検査を通る",
    isScheduledDate(SCRAPE_JOBS.point_rank, "2026-09-20") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-09-02") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-09-01") === false &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-09-09") === false &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-05-09") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-11-16") === true &&
      isScheduledDate(SCRAPE_JOBS.racer_profiles, "2026-06-16") === false &&
      same(validateRegistry(), []),
    show(validateRegistry()),
  );
  check(
    "レジストリ: runDaysOfMonth の不正な定義は検査で検出する",
    validateRegistry({
      x: {
        kind: "daily",
        targetTimeJst: "09:00",
        leaseSec: 60,
        maxDurationSec: 60,
        hosts: [],
        runDaysOfMonth: { default: [] },
      },
    }).length === 1,
  );
}

// ===========================================================================
// (i) 配線: api/cron・vercel.json・レジストリ・GitHub側を止める変数
// ===========================================================================
{
  const root = new URL("../../", import.meta.url);
  const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
  const vercel = JSON.parse(read("vercel.json"));
  const cronsFor = (path) =>
    vercel.crons.filter((c) => c.path === path).map((c) => c.schedule);
  // [レジストリのジョブ, APIファイル, エンドポイント, 期待するcron(UTC), 起動時刻のJST(コメントと照合)]
  const wiring = [
    [
      "point_rank",
      "point-rank",
      ["0 13 * * *", "30 14,16 * * *"],
      ["22:00", "23:30", "01:30"],
      "SKIP_POINT_RANK_ON_GHA",
      "scrape-point-rank.yml",
      "node scripts/daily/scrape-point-rank.js",
    ],
    [
      "entry_course_stats",
      "entry-course-stats",
      ["0 11 * * *", "30 13 * * *", "30 15 * * *"],
      ["20:00", "22:30", "00:30"],
      "SKIP_ENTRY_COURSE_ON_GHA",
      "scrape-venue-entry-course-stats.yml",
      "node scripts/daily/scrape-venue-entry-course-stats.js",
    ],
    [
      "venue_motor_stats",
      "venue-motor-stats",
      ["0 21 * * *", "0 23 * * *"],
      ["06:00", "08:00"],
      "SKIP_MOTOR_STATS_ON_GHA",
      "scrape-venue-motor-stats.yml",
      "node scripts/daily/scrape-venue-motor-stats.js",
    ],
    [
      "racer_news",
      "racer-news",
      ["10 14 * * *", "10 16 * * *"],
      ["23:10", "01:10"],
      "SKIP_RACER_NEWS_ON_GHA",
      "collect-racer-news.yml",
      "node scripts/daily/collect-racer-news.js",
    ],
    [
      "racer_profiles",
      "racer-profiles",
      ["*/10 18-20 1 * *", "*/10 18-20 8,15 5,11 *"],
      null,
      "SKIP_RACER_SEASON_ON_GHA",
      "scrape-racer-season-stats.yml",
      "node scripts/maintenance/scrape-racer-profiles.js",
    ],
  ];
  for (const [
    job,
    file,
    schedules,
    jstTimes,
    skipVar,
    workflow,
    command,
  ] of wiring) {
    const src = read(`api/cron/${file}.js`);
    const literal = Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]);
    const mod = await import(
      new URL(`../../api/cron/${file}.js`, import.meta.url)
    );
    check(
      `配線 ${job}: api/cron/${file}.js の maxDuration(${literal}) がレジストリ(${SCRAPE_JOBS[job].maxDurationSec})と一致し、ハンドラーを export する`,
      literal === SCRAPE_JOBS[job].maxDurationSec &&
        mod.config.maxDuration === literal &&
        typeof mod.default === "function" &&
        SCRAPE_JOBS[job].kind === "daily",
    );
    check(
      `配線 ${job}: vercel.json の cron（UTC）が設計どおり ${show(schedules)}`,
      same(cronsFor(`/api/cron/${file}`), schedules),
      show(cronsFor(`/api/cron/${file}`)),
    );
    if (jstTimes) {
      // UTC→JST（+9時間）の換算が、コメントの JST と一致する。最初の起動は指定時刻ちょうど。
      // 補足の起動も、同じ対象日に解決される（日付をまたいでも前日のまま）
      const instants = schedules.flatMap((s) => {
        const [min, hours] = s.split(" ");
        return hours
          .split(",")
          .map((h) => new Date(Date.UTC(2026, 8, 19, Number(h), Number(min))));
      });
      const jstText = instants.map((d) => {
        const j = new Date(d.getTime() + 9 * 3600 * 1000);
        return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
      });
      const targets = instants.map((d) =>
        resolveTargetDate(d, SCRAPE_JOBS[job].targetTimeJst),
      );
      check(
        `配線 ${job}: cron の JST 換算が ${show(jstTimes)}。最初の起動が指定時刻(${SCRAPE_JOBS[job].targetTimeJst})で、補足の起動も同じ対象日に解決される`,
        same(jstText, jstTimes) &&
          jstText[0] === SCRAPE_JOBS[job].targetTimeJst &&
          new Set(targets).size === 1,
        show({ jstText, targets }),
      );
    }
    const yml = read(`.github/workflows/${workflow}`);
    // フェイルセーフ付きSKIP: 変数が true のときだけ gate ジョブが起動し（未設定・falseは skipped → 従来どおり実行）、
    // 取得ジョブは gate の判定がスキップのときだけ止まる。変数は gate のステップにだけ渡し、取得のコマンドには渡さない
    check(
      `GitHub側 ${workflow}: リポジトリ変数 ${skipVar}=true のときだけ gate ジョブが判定し、Vercelが健全なときだけ取得ジョブを止める（未設定・falseは gate が skipped で従来どおり実行、gate の失敗も実行）。実行コマンドは変えない`,
      yml.includes(`if: \${{ vars.${skipVar} == 'true' }}`) &&
        yml.includes(`node scripts/maintenance/gha-skip-gate.js ${skipVar} --wait`) &&
        yml.includes("needs: gate") &&
        yml.includes(
          "if: ${{ !cancelled() && needs.gate.outputs.skip != 'true' }}",
        ) &&
        yml.includes("continue-on-error: true") &&
        yml.includes(command) &&
        !yml.includes(`vars.${skipVar} != 'true'`) &&
        [...yml.matchAll(new RegExp(`^\\s*${skipVar}:`, "gm"))].length === 1,
    );
  }
  // 選手プロフィール（月次）: 従来のGitHub Actions（scrape-racer-season-stats.yml）と同じ夜間・同じ日付の式。
  // UTC 18:00〜20:50 は JST の翌日 03:00〜05:50（UTC基準の1日・8日・15日は、JST の2日・9日・16日）
  {
    const crons = cronsFor("/api/cron/racer-profiles");
    const yml = read(".github/workflows/scrape-racer-season-stats.yml");
    const ghDays = [...yml.matchAll(/cron: '0 18 (\S+) (\S+) \*'/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    const vercelDays = crons.map((c) => c.split(" ").slice(2, 4).join(" "));
    check(
      "配線 racer_profiles: cron の日付(UTC基準の1日、5月・11月の8日・15日)が、GitHub側 scrape-racer-season-stats.yml の cron 式と同じ。時刻は UTC 18〜20時の10分刻み",
      same(vercelDays, ghDays) &&
        same(vercelDays, ["1 *", "8,15 5,11"]) &&
        crons.every((c) => c.startsWith("*/10 18-20 ")),
      show({ vercelDays, ghDays }),
    );
    const slots = [18, 19, 20].flatMap((h) =>
      [0, 10, 20, 30, 40, 50].map((m) => new Date(Date.UTC(2026, 9, 1, h, m))),
    );
    const jstText = slots.map((d) => {
      const j = new Date(d.getTime() + 9 * 3600 * 1000);
      return `${j.toISOString().slice(5, 10)} ${j.toISOString().slice(11, 16)}`;
    });
    const targets = new Set(
      slots.map((d) =>
        resolveTargetDate(d, SCRAPE_JOBS.racer_profiles.targetTimeJst),
      ),
    );
    const lastEnd =
      slots.at(-1).getTime() +
      SCRAPE_JOBS.racer_profiles.maxDurationSec * 1000 +
      9 * 3600 * 1000;
    const lastEndJst = new Date(lastEnd).toISOString().slice(11, 16);
    check(
      "配線 racer_profiles: UTC 18:00〜20:50 ＝ JST 翌日 03:00〜05:50（夜間）。最初の起動が指定時刻(03:00)ちょうどで、全ての起動が同じ対象日(10-02)に解決され、最後のチャンクの終了(05:55)が 07:00 JST 前",
      jstText[0] === "10-02 03:00" &&
        jstText.at(-1) === "10-02 05:50" &&
        SCRAPE_JOBS.racer_profiles.targetTimeJst === "03:00" &&
        same([...targets], ["2026-10-02"]) &&
        lastEndJst < "07:00",
      show({ first: jstText[0], last: jstText.at(-1), targets: [...targets], lastEndJst }),
    );
    // 起動日: UTC 基準の日付に、JST では +1日（UTC 18時台は JST の翌日）。レジストリの runDaysOfMonth は JST の日で持つ
    const [first, second] = vercelDays.map((d) => d.split(" "));
    const utcDefault = first[0].split(",").map(Number);
    const utcBoost = second[0].split(",").map(Number);
    const boostMonths = second[1].split(",").map(Number);
    const expected = { default: utcDefault.map((d) => d + 1) };
    for (const m of boostMonths) {
      expected[m] = [...utcDefault, ...utcBoost].map((d) => d + 1);
    }
    check(
      "配線 racer_profiles: レジストリの runDaysOfMonth は JST の日（cron の UTC 日付+1。毎月2日、5月・11月は9日・16日も）",
      same(SCRAPE_JOBS.racer_profiles.runDaysOfMonth, expected) &&
        same(expected, { default: [2], 5: [2, 9, 16], 11: [2, 9, 16] }),
      show({ registry: SCRAPE_JOBS.racer_profiles.runDaysOfMonth, expected }),
    );
  }

  // git push・fs・child_process に依存しない（Vercel Functionで動く）
  const strip = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
      .join("\n");
  for (const file of [
    "scripts/lib/pointRankJob.js",
    "scripts/lib/venueEntryCourseStatsJob.js",
    "scripts/lib/venueMotorStatsJob.js",
    "scripts/lib/racerNewsJob.js",
    "scripts/lib/racerProfilesJob.js",
    "scripts/lib/scrapeJobs/venueDailyJob.js",
    "scripts/lib/scrapeJobs/venueJobSupport.js",
  ]) {
    const code = strip(read(file));
    check(
      `Vercel対応 ${file}: fs・child_process・git・new Date() の直接利用がない（時計は ctx.now・対象日は ctx.targetDate）`,
      !/from\s+["'](node:)?fs["']|child_process|execSync|writeFileSync|git push|new Date\(\)/.test(
        code,
      ),
    );
  }
}

out.log(failures === 0 ? "\nALL PASS" : `\n${failures} 件の検証が失敗しました`);
process.exit(failures === 0 ? 0 : 1);
