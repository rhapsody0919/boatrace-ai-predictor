/**
 * verify-morning-init-jobs.js - 朝の初期化（A8、races-init）と公式コンピュータ予想（B1、pcexpect）の Vercel Cron 実装
 * （WS4b、tasks.md T4b-07-4〜6・T4b-08-2）の検証。DBにも取得先にも接続しない（インメモリのSupabaseクライアント・保存済みの
 * 実ページ・時計・ストアを差し替える）。
 *
 * 確認すること:
 *   (a) 対象日: 実行が遅れても（05:00指定）、対象日は指定時刻から解決される（前日の分を今日として処理しない）
 *   (b) off・行なし・075未適用: 何も取得せず、何も書かない（マージしても本番の挙動が変わらない）
 *   (c) shadow: 取得・解析のみで、データテーブルへは一切書かない。レースごとのダイジェストを cursor に記録し、対象日を処理済みにしない
 *   (d) live: 会場をチャンクで処理し（1回8会場）、進捗を cursor に保存して再開する。全会場と後始末が済んだら対象日を処理済みにし、
 *       以降の起動は何もしない（冪等）。既に races に行のある会場（GitHub Actionsが初期化済み）は、書き込まない
 *   (e) 失敗: 1会場の失敗は他を止めない・指数バックオフで再試行・全て失敗なら実行の失敗（進捗は保存）・ブレーカーは失敗にしない・
 *       0レースの会場は成功にしない・0会場は対象日を済みにしない・後始末の失敗は済みのステップをやり直さない
 *   (f) 会場一覧の再確認（取りこぼし会場。9時前のみ）・ソフトデッドライン・?venues=N・前日の cursor を引き継がない
 *   (g) 統合: 既定の依存（書き込み・予定表・unified）で、インメモリDBに races・race_entries・predictions（standard等・unified）を書き、
 *       shadow のダイジェストが、DBの行から計算したダイジェストと一致する（不一致・欠け・余りの検出を含む）
 *   (h) 予測ロジックの変更検知: 内容ハッシュ・初回の基準・変更時は発走前のレースだけ再生成・二重の再生成なし・失敗で元に戻す
 *   (i) 公式予想のスロット: shadow は書かずダイジェスト・live は race_start_at つきで upsert・未公開は再試行・失敗の扱い
 *   (j) 配線: レジストリ・maxDuration・vercel.json の cron（UTC→JST換算）・GitHub側を止める変数（既定は現行動作）・
 *       fs/execSync/git/process.exit への依存が無い・監視（日次の期限超過・ジョブ自身の通知・疑似の行を出さない）
 *
 * 実行: node scripts/maintenance/verify-morning-init-jobs.js
 */
import fs from "node:fs";
import { runScrapeJob } from "../lib/scrapeJobs/cronWrapper.js";
import { SCRAPE_JOBS, validateRegistry } from "../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../lib/scrapeJobs/dailyJob.js";
import { createSupabaseStore } from "../lib/scrapeJobs/store.js";
import { createMemoryStore } from "../lib/scrapeJobs/testing/memoryStore.js";
import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import { BreakerOpenError } from "../lib/scrapeJobs/circuitBreaker.js";
import {
  evaluateJobStates,
  formatDailySummary,
} from "../lib/scrapeJobs/monitor.js";
import {
  RACES_INIT_VENUES_PER_INVOCATION,
  backoffMinutes,
  createPredictCodeOnTick,
  isBreakerOpenError,
  resolveVenuesLimit,
  runRacesInitJob,
} from "../lib/racesInit/job.js";
import {
  compareRaceDigests,
  digestDbRace,
  digestScrapedRace,
  digestScrapedVenue,
  raceIdOf,
} from "../lib/racesInit/digest.js";
import {
  PREDICT_CODE_HASH_JOB,
  PREDICT_LOGIC_FILES,
  checkPredictCodeChange,
  computePredictCodeHash,
  hashFiles,
} from "../lib/racesInit/predictCodeCheck.js";
import {
  createPcexpectSlotHandler,
  parsePcexpectRaceId,
} from "../lib/scrapeJobs/pcexpectHandlers.js";
import { makeFetchHtml } from "../lib/scrapeJobs/htmlFetch.js";
import { comparePcexpectDigests } from "./check-morning-init-shadow.js";
import { parsePcexpect } from "../daily/scrape-pcexpect.js";

// 検証の対象コードが出すログは捨て、結果の行だけを出す
const out = { log: console.log, error: console.error };
console.log = console.warn = console.error = () => {};

// 途中で process.exit(0) して、最後まで実行されないまま「成功」に見えるのを防ぐ
let completed = false;
process.on("exit", (code) => {
  if (!completed && code === 0) {
    out.error(
      "❌ 検証が最後まで実行されませんでした（途中で process.exit された）",
    );
    process.exitCode = 1;
  }
});

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
const jst = (text) => new Date(`${text.replace(" ", "T")}:00+09:00`);
const clone = (v) => JSON.parse(JSON.stringify(v));

const FX = new URL("../lib/racesInit/__fixtures__/", import.meta.url);
const GOLDEN_VENUE = JSON.parse(
  fs.readFileSync(new URL("golden-venue-01.json", FX), "utf8"),
);
const PCEXPECT_HTML = fs.readFileSync(
  new URL("pcexpect-12-12.html", FX),
  "utf8",
);
const PCEXPECT_DIGEST = "c2ada2c442417b09";
const DATE = "2026-09-21";
const JOB = "races_init";
const DATA_TABLES = [
  "races",
  "race_entries",
  "predictions",
  "race_conditions",
  "exhibition_data",
  "external_predictions",
];

// ---------------------------------------------------------------------------
// 道具
// ---------------------------------------------------------------------------

/** 12レース・各6艇の会場（ダイジェスト・書き込みの検証用。選手・モーターは会場・レースごとに一意） */
function fakeVenue(code, { races = 12, racers = 6 } = {}) {
  return {
    placeCd: code,
    placeName: `会場${code}`,
    races: Array.from({ length: races }, (_, i) => {
      const raceNo = i + 1;
      return {
        placeCd: code,
        raceNo,
        startTime: `${String(9 + Math.floor(raceNo / 3)).padStart(2, "0")}:${String((raceNo % 3) * 20).padStart(2, "0")}`,
        racers: Array.from({ length: racers }, (_, j) => ({
          lane: j + 1,
          racerId: code * 1000 + raceNo * 10 + j,
          grade: "B1",
          age: 30 + j,
          motorNumber: 10 + j,
          boatNumber: 20 + j,
        })),
      };
    }),
  };
}

/** 共通ラッパ（runScrapeJob）を、Supabase 互換のインメモリDBに載せたストアで動かす環境 */
function newEnv({
  mode = "shadow",
  cursor,
  lastReport,
  tables = {},
  rpcs = {},
  failOn = {},
} = {}) {
  const client = createFakeSupabaseClient({
    tables: {
      scrape_job_state: mode
        ? [
            {
              job: JOB,
              mode,
              consecutive_failures: 0,
              ...(cursor ? { cursor } : {}),
              ...(lastReport ? { last_report: lastReport } : {}),
            },
          ]
        : [],
      ...tables,
    },
    rpcs,
    failOn,
  });
  const store = createSupabaseStore(client);
  const row = () => client.data.scrape_job_state.find((r) => r.job === JOB);
  const dataWrites = () =>
    client.writes.filter((w) => DATA_TABLES.includes(w.table));
  const politeFetch = async () => {
    throw new Error("取得してはいけません");
  };
  async function invoke(now, { deps, query, onTick, run } = {}) {
    const at = typeof now === "function" ? now : () => now;
    return runScrapeJob({
      job: JOB,
      store,
      client,
      query,
      run: run ?? ((ctx) => runRacesInitJob(ctx, deps)),
      onTick,
      politeFetch,
      now: at,
      worker: "verify",
    });
  }
  return { client, store, row, dataWrites, invoke };
}

/** runRacesInitJob の依存を、呼び出しを数える偽物にする */
function newDeps({
  venues = [1, 2, 3],
  existing = [],
  failVenues = new Map(),
  clock = null,
  venueCost = 0,
} = {}) {
  const calls = {
    getVenues: 0,
    dates: [],
    opts: [],
    scrape: [],
    write: [],
    slots: 0,
    unified: 0,
    hook: 0,
  };
  const state = { venues, existing, failVenues, unifiedFails: false };
  const deps = {
    getVenues: async (date) => {
      calls.getVenues++;
      calls.dates.push(date);
      return typeof state.venues === "function"
        ? state.venues(calls.getVenues)
        : state.venues;
    },
    scrapeVenue: async (date, code, opts) => {
      calls.scrape.push(code);
      calls.opts.push(opts);
      if (clock) clock.advance(venueCost);
      const failure = state.failVenues.get(code);
      if (failure)
        throw failure instanceof Error ? failure : new Error(failure);
      return fakeVenue(code);
    },
    existingVenueCodes: async () => new Set(state.existing),
    writeVenue: async (venue) => {
      calls.write.push(venue.placeCd);
    },
    ensureSlots: async () => {
      calls.slots++;
      return { jobs: ["odds"], created: 5 };
    },
    ensureUnified: async () => {
      calls.unified++;
      if (state.unifiedFails) throw new Error("unified-down");
      return { missing: 0, generated: 0 };
    },
    triggerDeployHook: async () => {
      calls.hook++;
      return { triggered: true };
    },
  };
  return { deps, calls, state };
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const T0 = jst("2026-09-21 05:00");
const at = (minutes, base = T0) => new Date(base.getTime() + minutes * 60_000);

// ---------------------------------------------------------------------------
// (a) 対象日
// ---------------------------------------------------------------------------
{
  const cases = [
    ["2026-09-21 04:59", "2026-09-20"],
    ["2026-09-21 05:00", "2026-09-21"],
    ["2026-09-21 05:02", "2026-09-21"],
    ["2026-09-21 09:58", "2026-09-21"],
    ["2026-09-22 00:30", "2026-09-21"],
  ];
  for (const [now, expected] of cases) {
    check(
      `(a) 指定 05:00 のジョブ: ${now} JST の起動の対象日は ${expected}`,
      resolveTargetDate(jst(now), SCRAPE_JOBS[JOB].targetTimeJst) === expected,
    );
  }
  const env = newEnv({ mode: "live" });
  const { deps, calls } = newDeps({ venues: [1] });
  await env.invoke(jst("2026-09-21 05:00"), { deps });
  check(
    "(a) 05:00 の起動: 会場一覧は、その日の日付（hd=）で取得し、その日を処理済みにする",
    calls.dates.length >= 1 &&
      calls.dates.every((d) => d === DATE) &&
      env.row().last_target_date === DATE,
    show(calls.dates),
  );
  // 翌日 00:30 に遅れて起動しても、対象日は前日のまま（前日の cursor を続きから処理し、翌日の分を取り違えない）
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({ venues: [1] });
  await env2.invoke(jst("2026-09-22 00:30"), { deps: d2.deps });
  check(
    "(a) 翌日 00:30 の遅れた起動: 対象日は前日（2026-09-21）のまま",
    d2.calls.dates.every((d) => d === "2026-09-21") &&
      env2.row().last_target_date === "2026-09-21",
    show(d2.calls.dates),
  );
}

// ---------------------------------------------------------------------------
// (b) off・行なし・075未適用
// ---------------------------------------------------------------------------
{
  for (const [label, opts] of [
    ["行なし", { mode: null }],
    ["off", { mode: "off" }],
  ]) {
    const env = newEnv(opts);
    const { deps, calls } = newDeps();
    const res = await env.invoke(T0, { deps });
    check(
      `(b) ${label}: 何も取得せず・何も書かない（200・skipped）`,
      res.status === 200 &&
        res.body.skipped === "mode_off" &&
        calls.getVenues === 0 &&
        calls.scrape.length === 0 &&
        calls.write.length === 0 &&
        env.dataWrites().length === 0,
      show(res.body),
    );
  }
  const memory = createMemoryStore({ available: false });
  const { deps, calls } = newDeps();
  const res = await runScrapeJob({
    job: JOB,
    store: memory,
    run: (ctx) => runRacesInitJob(ctx, deps),
    now: () => T0,
    worker: "verify",
  });
  check(
    "(b) 075未適用: 何もせず 200（skipped）",
    res.status === 200 &&
      res.body.skipped === "scrape_schema_not_applied" &&
      calls.getVenues === 0,
  );
}

// ---------------------------------------------------------------------------
// (c) shadow
// ---------------------------------------------------------------------------
{
  const env = newEnv({ mode: "shadow" });
  const { deps, calls } = newDeps({ venues: range(13) });
  const r1 = await env.invoke(T0, { deps });
  const c1 = env.row().cursor;
  check(
    "(c) shadow 1回目: 8会場を処理し、残りは次の起動へ（incomplete）",
    r1.status === 200 &&
      calls.scrape.length === 8 &&
      c1.settled.length === 8 &&
      c1.done === false &&
      env.row().last_target_date === undefined,
    show(r1.body),
  );
  const r2 = await env.invoke(at(2), { deps });
  const c2 = env.row().cursor;
  check(
    "(c) shadow 2回目: 残り5会場を処理し、done（対象日は処理済みにしない＝shadowは書かない）",
    r2.status === 200 &&
      calls.scrape.length === 13 &&
      c2.done === true &&
      c2.settled.length === 13 &&
      env.row().last_target_date === undefined,
    show(r2.body),
  );
  check(
    "(c) shadow: データテーブルへは一切書かない・書き込み関数も呼ばない・後始末（予定表・unified・Deploy Hook）もしない",
    env.dataWrites().length === 0 &&
      calls.write.length === 0 &&
      calls.slots === 0 &&
      calls.unified === 0 &&
      calls.hook === 0,
  );
  check(
    "(c) shadow: レースごとのダイジェスト（13会場×12レース=156）と件数を cursor に記録する",
    Object.keys(c2.digests).length === 156 &&
      c2.races === 156 &&
      c2.entries === 936 &&
      c2.digests[raceIdOf(DATE, 1, 1)]?.length === 12,
    `${Object.keys(c2.digests).length}`,
  );
  check(
    "(c) 1会場の取得は、strict（失敗を例外にする）・politeFetch 由来の fetchHtml・並列度6（会場内で同時12リクエスト）で呼ぶ",
    calls.opts.length > 0 &&
      calls.opts.every(
        (o) =>
          o.strict === true &&
          o.raceConcurrency === 6 &&
          typeof o.fetchHtml === "function",
      ),
    show(calls.opts[0]),
  );
  check(
    "(c) shadow: DBを読まない（races の存在確認をしない）",
    !env.client.calls.some((c) => c.table === "races"),
  );
  const before = calls.scrape.length;
  const r3 = await env.invoke(at(4), { deps });
  check(
    "(c) shadow 完了後の起動: 何も取得しない（cycle_done）",
    r3.body.skipped === "cycle_done" &&
      calls.scrape.length === before &&
      calls.getVenues === 2,
    show(r3.body),
  );
  check(
    "(c) 会場一覧の取得は、計画と再確認（取りこぼし会場）の2回",
    calls.getVenues === 2,
  );
}

// ---------------------------------------------------------------------------
// (d) live: チャンク・再開・冪等・初期化済みの会場
// ---------------------------------------------------------------------------
{
  const env = newEnv({ mode: "live" });
  const { deps, calls } = newDeps({ venues: range(24) });
  const results = [];
  for (let i = 0; i < 3; i++) {
    results.push(await env.invoke(at(2 * i), { deps }));
  }
  check(
    "(d) 24会場: 8・8・8会場の3回の起動で、全会場を処理する（会場の重複なし）",
    same(calls.write, range(24)) &&
      results[0].body.settledThisRun === 8 &&
      results[1].body.settledThisRun === 8 &&
      results[2].body.settledThisRun === 8,
    show(results.map((r) => r.body)),
  );
  check(
    "(d) 全会場が済んだ起動で、後始末（予定表・unified・Deploy Hook）を1回ずつ行い、対象日を処理済みにする",
    results[2].body.done === true &&
      calls.slots === 1 &&
      calls.unified === 1 &&
      calls.hook === 1 &&
      env.row().last_target_date === DATE &&
      env.row().cursor.finalize.slots.created === 5,
    show(results[2].body),
  );
  check(
    "(d) 途中の起動（1・2回目）は、対象日を処理済みにしない",
    results[0].body.done === false && results[1].body.done === false,
  );
  const scrapedBefore = calls.scrape.length;
  const r4 = await env.invoke(at(6), { deps });
  check(
    "(d) 処理済みの日の起動: 何も取得せず何も書かない（already_done。冪等）",
    r4.body.skipped === "already_done" &&
      calls.scrape.length === scrapedBefore &&
      calls.slots === 1 &&
      calls.hook === 1,
    show(r4.body),
  );
  check(
    "(d) 会場は順次（同時に1会場）・1会場の並列度は scrapeVenue に渡す",
    RACES_INIT_VENUES_PER_INVOCATION === 8,
  );
}
{
  // 既に races に行のある会場は、書き込まない（GitHub Actions が初期化済み）
  const env = newEnv({ mode: "live" });
  const { deps, calls } = newDeps({
    venues: [1, 2, 3, 5],
    existing: [1, 2, 3],
  });
  const res = await env.invoke(T0, { deps });
  check(
    "(d) 初期化済みの会場（1・2・3）は処理せず、無い会場（5）だけを書く。Deploy Hook は、書いたので1回",
    res.body.done === true &&
      same(calls.write, [5]) &&
      same(calls.scrape, [5]) &&
      calls.hook === 1 &&
      same(env.row().cursor.existing, [1, 2, 3]),
    show({ res: res.body, write: calls.write }),
  );
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({ venues: [1, 2, 3], existing: [1, 2, 3] });
  const res2 = await env2.invoke(T0, { deps: d2.deps });
  check(
    "(d) 全会場が初期化済み: 取得も書き込みもせず、後始末（予定表・unified）だけ行う。何も書いていないので Deploy Hook は叩かない",
    res2.body.done === true &&
      d2.calls.scrape.length === 0 &&
      d2.calls.write.length === 0 &&
      d2.calls.slots === 1 &&
      d2.calls.unified === 1 &&
      d2.calls.hook === 0 &&
      env2.row().last_target_date === DATE,
    show(res2.body),
  );
  // shadow → live（同じ日）: shadow の進捗を引き継がない
  const env3 = newEnv({
    mode: "live",
    cursor: {
      targetDate: DATE,
      mode: "shadow",
      done: true,
      settled: [1, 2, 3],
      targets: [1, 2, 3],
    },
  });
  const d3 = newDeps({ venues: [1, 2] });
  await env3.invoke(T0, { deps: d3.deps });
  check(
    "(d) shadow で済んだ日でも、live は最初からやり直して書き込む（shadow の cursor を引き継がない）",
    same(d3.calls.write, [1, 2]) && env3.row().last_target_date === DATE,
  );
  const env4 = newEnv({
    mode: "live",
    cursor: {
      targetDate: "2026-09-20",
      mode: "live",
      done: true,
      settled: [1],
      targets: [1],
    },
  });
  const d4 = newDeps({ venues: [1, 2] });
  await env4.invoke(T0, { deps: d4.deps });
  check(
    "(d) 前日の cursor は引き継がない（対象日が違う）",
    same(d4.calls.write, [1, 2]),
  );
}

// ---------------------------------------------------------------------------
// (e) 失敗
// ---------------------------------------------------------------------------
{
  // 1会場の失敗は、他の会場を止めない。指数バックオフで再試行する
  const env = newEnv({ mode: "live" });
  const d = newDeps({
    venues: [1, 2, 3],
    failVenues: new Map([[2, "HTTP 503"]]),
  });
  const r1 = await env.invoke(T0, { deps: d.deps });
  const c1 = env.row().cursor;
  check(
    "(e) 会場2が失敗: 1・3は書き込み、2は済みにしない。実行は成功（一部の失敗）で、対象日は済みにしない",
    r1.status === 200 &&
      same(d.calls.write, [1, 3]) &&
      same(c1.settled, [1, 3]) &&
      c1.attempts["2"] === 1 &&
      c1.done === false &&
      env.row().last_target_date === undefined &&
      r1.body.failures === 1,
    show(r1.body),
  );
  check(
    "(e) 失敗した会場は、2分後まで再試行しない（バックオフ）",
    new Date(c1.retryAfter["2"]).getTime() === at(2).getTime(),
    c1.retryAfter["2"],
  );
  const r2 = await env.invoke(at(1), { deps: d.deps });
  check(
    "(e) バックオフの間の起動は、会場2を取得しない",
    d.calls.scrape.filter((c) => c === 2).length === 1 && r2.status === 200,
  );
  d.state.failVenues.clear();
  const r3 = await env.invoke(at(3), { deps: d.deps });
  check(
    "(e) バックオフが明けたら、会場2を再取得して書き込み、全会場が済み done。失敗の記録は消える",
    r3.body.done === true &&
      same(d.calls.write, [1, 3, 2]) &&
      env.row().last_target_date === DATE &&
      env.row().cursor.lastErrors["2"] === undefined,
    show(r3.body),
  );
  check(
    "(e) バックオフは 2・4・8・16・20分（上限）",
    same([1, 2, 3, 4, 5, 9].map(backoffMinutes), [2, 4, 8, 16, 20, 20]),
  );
}
{
  // 全て失敗 → 実行の失敗。ただし進捗は保存する
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1], failVenues: new Map([[1, "HTTP 503"]]) });
  const r1 = await env.invoke(T0, { deps: d.deps });
  check(
    "(e) 試行した会場が全て失敗: 実行は失敗（500・連続失敗数+1・エラーメッセージ付き）",
    r1.status === 500 &&
      env.row().consecutive_failures === 1 &&
      /全て失敗/.test(env.row().last_error ?? "") &&
      d.calls.write.length === 0,
    show(r1.body),
  );
  const saved = env.row().cursor;
  check(
    "(e) 失敗した起動でも、進捗（試行回数・バックオフ・計画）は保存される（次の起動が計画をやり直さない）",
    saved?.attempts?.["1"] === 1 &&
      typeof saved?.retryAfter?.["1"] === "string" &&
      same(saved?.targets, [1]),
    show(saved),
  );
  const r2 = await env.invoke(at(1), { deps: d.deps });
  check(
    "(e) バックオフの間は、何も試行せず、失敗にもしない（連続失敗数は増えない）",
    r2.status === 200 && d.calls.scrape.length === 1 && d.calls.getVenues === 1,
    show(r2.body),
  );
  d.state.failVenues.clear();
  const r3 = await env.invoke(at(3), { deps: d.deps });
  check(
    "(e) 再試行に成功すると done・連続失敗数は0に戻る",
    r3.body.done === true &&
      env.row().consecutive_failures === 0 &&
      env.row().last_target_date === DATE,
  );
}
{
  // 連続失敗の通知（last_report.alerts）
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1, 2], failVenues: new Map([[2, "HTTP 500"]]) });
  await env.invoke(T0, { deps: d.deps });
  await env.invoke(at(3), { deps: d.deps });
  const alertsAfter2 = env.row().last_report.alerts;
  await env.invoke(at(8), { deps: d.deps });
  const alerts = env.row().last_report.alerts;
  check(
    "(e) 会場が3回連続で失敗したら、ジョブ自身の通知（last_report.alerts）に出す。それまでは出さない",
    alertsAfter2.length === 0 &&
      alerts.length === 1 &&
      alerts[0].key === "venue_failed:2" &&
      /3回連続/.test(alerts[0].text),
    show(alerts),
  );
}
{
  // ブレーカー
  const env = newEnv({ mode: "live" });
  const err = new Error("会場1: 取得に失敗");
  err.cause = new BreakerOpenError("host:boatrace.jp", at(5).getTime());
  const d = newDeps({ venues: [1, 2], failVenues: new Map([[1, err]]) });
  const r = await env.invoke(T0, { deps: d.deps });
  check(
    "(e) サーキットブレーカーが開いている: 失敗にせず、試行回数も増やさず、その起動を終える",
    r.status === 200 &&
      r.body.skipped === "breaker_open" &&
      env.row().consecutive_failures === 0 &&
      d.calls.scrape.length === 1 &&
      env.row().cursor.attempts["1"] === 0 &&
      env.row().cursor.retryAfter["1"] === undefined,
    show(r.body),
  );
  check(
    "(e) isBreakerOpenError: cause の連鎖の中の BreakerOpenError を見つける",
    isBreakerOpenError(err) &&
      !isBreakerOpenError(new Error("x")) &&
      isBreakerOpenError(new BreakerOpenError("h", 1)),
  );
}
{
  // 0レースの会場・0会場
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1] });
  d.deps.scrapeVenue = async () => fakeVenue(1, { races: 12, racers: 0 });
  const r = await env.invoke(T0, { deps: d.deps });
  check(
    "(e) 開催会場一覧にあるのに、出走表が1レースも取れない会場は、成功にしない（書き込まない・失敗として再試行）",
    r.status === 500 &&
      d.calls.write.length === 0 &&
      env.row().last_target_date === undefined,
    show(r.body),
  );
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({ venues: [] });
  const r2 = await env2.invoke(T0, { deps: d2.deps });
  check(
    "(e) 開催会場が0件: 対象日を処理済みにせず、cursor も作らない（次の起動が再確認）。失敗でもない",
    r2.status === 200 &&
      r2.body.noVenues === true &&
      env2.row().last_target_date === undefined &&
      env2.row().cursor === undefined &&
      d2.calls.write.length === 0,
    show(r2.body),
  );
  d2.state.venues = [1];
  const r3 = await env2.invoke(at(2), { deps: d2.deps });
  check(
    "(e) 会場が現れたら、その起動から処理する",
    r3.body.done === true && same(d2.calls.write, [1]),
  );
}
{
  // 後始末の失敗
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: [1, 2] });
  d.state.unifiedFails = true;
  const r1 = await env.invoke(T0, { deps: d.deps });
  const saved = env.row().cursor;
  check(
    "(e) 後始末（unified）の失敗: 実行は失敗・対象日は済みにしない。ただし会場の進捗と、済んだ後始末（予定表）は保存する",
    r1.status === 500 &&
      /unified-down/.test(env.row().last_error ?? "") &&
      same(saved.settled, [1, 2]) &&
      saved.done === false &&
      saved.finalize.slots?.created === 5 &&
      saved.finalize.unified === undefined &&
      env.row().last_target_date === undefined,
    show(r1.body),
  );
  const alerts = env.row().last_report?.alerts ?? [];
  check(
    "(e) 後始末の失敗は、ジョブ自身の通知に出す",
    alerts.some((a) => a.key === "finalize_failed"),
    show(alerts),
  );
  d.state.unifiedFails = false;
  const r2 = await env.invoke(at(2), { deps: d.deps });
  check(
    "(e) 次の起動: 会場は再取得せず・済んだ予定表の生成も繰り返さず、unified だけやり直して done",
    r2.body.done === true &&
      d.calls.scrape.length === 2 &&
      d.calls.slots === 1 &&
      d.calls.unified === 2 &&
      d.calls.hook === 1 &&
      env.row().last_target_date === DATE,
    show({
      scrape: d.calls.scrape,
      slots: d.calls.slots,
      unified: d.calls.unified,
    }),
  );
  // 書き込み失敗（DB）: 会場を済みにしない
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({ venues: [1, 2] });
  const baseWrite = d2.deps.writeVenue;
  d2.deps.writeVenue = async (venue, ctx) => {
    if (venue.placeCd === 2) throw new Error("races書き込みエラー: boom");
    return baseWrite(venue, ctx);
  };
  const r = await env2.invoke(T0, { deps: d2.deps });
  check(
    "(e) 書き込みの失敗: その会場は済みにしない（データの無いまま「済み」にならない）",
    r.status === 200 &&
      same(env2.row().cursor.settled, [1]) &&
      /boom/.test(env2.row().cursor.lastErrors["2"]) &&
      env2.row().last_target_date === undefined,
    show(r.body),
  );
}

// ---------------------------------------------------------------------------
// (f) 会場一覧の再確認・ソフトデッドライン・?venues=N
// ---------------------------------------------------------------------------
{
  const env = newEnv({ mode: "live" });
  const d = newDeps({ venues: (n) => (n === 1 ? [1, 2] : [1, 2, 24]) });
  const r1 = await env.invoke(T0, { deps: d.deps });
  check(
    "(f) 全会場が済んだ後の再確認で、新しい会場（24）が見つかったら、処理の対象に加え、対象日は済みにしない",
    r1.body.done === false &&
      same(env.row().cursor.venues, [1, 2, 24]) &&
      same(env.row().cursor.settled, [1, 2]) &&
      d.calls.slots === 0,
    show(r1.body),
  );
  const r2 = await env.invoke(at(2), { deps: d.deps });
  check(
    "(f) 次の起動で、取りこぼしの会場だけ書き込み、done（再確認は1回だけ）",
    r2.body.done === true &&
      same(d.calls.write, [1, 2, 24]) &&
      d.calls.getVenues === 2,
    show(r2.body),
  );
  const env2 = newEnv({ mode: "live" });
  const d2 = newDeps({ venues: [1, 2] });
  const r3 = await env2.invoke(jst("2026-09-21 09:30"), { deps: d2.deps });
  check(
    "(f) 9時を過ぎた起動では、会場一覧を再確認しない（従来の morning-init と同じ）",
    r3.body.done === true && d2.calls.getVenues === 1,
  );
  // 手動の動作確認
  const env3 = newEnv({ mode: "shadow" });
  const d3 = newDeps({ venues: range(10) });
  await env3.invoke(T0, { deps: d3.deps, query: { venues: "2" } });
  check("(f) ?venues=2: 1回の処理を2会場にする", d3.calls.scrape.length === 2);
  const bad = await newEnv({ mode: "shadow" }).invoke(T0, {
    deps: newDeps().deps,
    query: { venues: "abc" },
  });
  check(
    "(f) ?venues=abc: 不正な値は失敗にする（無視して既定にしない）",
    bad.status === 500 && /venues は1〜24/.test(bad.body.error ?? ""),
    show(bad.body),
  );
  check(
    "(f) resolveVenuesLimit: 未指定は既定・範囲外は例外",
    resolveVenuesLimit({}) === 8 &&
      resolveVenuesLimit({ venues: "24" }) === 24 &&
      (() => {
        try {
          resolveVenuesLimit({ venues: "25" });
          return false;
        } catch {
          return true;
        }
      })(),
  );
  // ソフトデッドライン: 1会場300秒かかる時計。maxDuration 800 − 30 = 770秒の手前で、新しい会場に着手しない
  let clockMs = T0.getTime();
  const clock = { advance: (sec) => (clockMs += sec * 1000) };
  const env4 = newEnv({ mode: "shadow" });
  const d4 = newDeps({ venues: range(10), clock, venueCost: 300 });
  await env4.invoke(() => new Date(clockMs), { deps: d4.deps });
  check(
    "(f) ソフトデッドライン（maxDuration−30秒＝770秒）: 1会場300秒なら3会場で止め、残りは次の起動へ",
    d4.calls.scrape.length === 3 && env4.row().cursor.settled.length === 3,
    show(d4.calls.scrape),
  );
}

// ---------------------------------------------------------------------------
// (g) 統合（既定の依存 × インメモリDB）とダイジェスト
// ---------------------------------------------------------------------------
{
  const rpcs = { ensure_scrape_slots: () => 7 };
  const env = newEnv({
    mode: "live",
    rpcs,
    tables: {
      venues: [{ code: 1, avg_first_win_rate: 0.5 }],
      racer_aggregated_stats: [],
      scrape_job_state: [
        { job: JOB, mode: "live", consecutive_failures: 0 },
        { job: "odds", mode: "live" },
        { job: "result", mode: "shadow" },
        { job: "race_info", mode: "off" },
        { job: "pcexpect", mode: "off" },
        { job: "pseudo", mode: "live" },
      ],
    },
  });
  let hooks = 0;
  const res = await env.invoke(T0, {
    deps: {
      getVenues: async () => [1],
      scrapeVenue: async () => structuredClone(GOLDEN_VENUE),
      triggerDeployHook: async () => {
        hooks++;
        return { triggered: true };
      },
    },
  });
  const d = env.client.data;
  check(
    "(g) 既定の依存で live 1会場: races 12・race_entries 72・standard等 36・unified 12 を書き、done",
    res.status === 200 &&
      res.body.done === true &&
      d.races.length === 12 &&
      d.race_entries.length === 72 &&
      d.predictions.filter((p) => p.model_id !== "unified").length === 36 &&
      d.predictions.filter((p) => p.model_id === "unified").length === 12 &&
      hooks === 1,
    show({
      body: res.body,
      races: d.races?.length,
      entries: d.race_entries?.length,
      preds: d.predictions?.length,
    }),
  );
  const slotCall = env.client.rpcCalls.find(
    (c) => c.name === "ensure_scrape_slots",
  );
  check(
    "(g) 予定表の生成: 有効（shadow・live）な窓型ジョブだけ（odds・result）。off のジョブ・疑似ジョブ（pseudo）は含めない",
    slotCall &&
      same([...new Set(slotCall.args.p_defs.map((x) => x.job))].sort(), [
        "odds",
        "result",
      ]) &&
      slotCall.args.p_date === DATE &&
      slotCall.args.p_skip_lapsed === true &&
      env.row().cursor.finalize.slots.created === 7,
    show(slotCall?.args?.p_defs?.map((x) => x.job)),
  );
  check(
    "(g) 後始末の unified: 欠けたレースがあったので日全体（12レース）を生成した",
    env.row().cursor.finalize.unified.missing === 12 &&
      env.row().cursor.finalize.unified.generated === 12,
    show(env.row().cursor.finalize),
  );

  // ダイジェスト: shadow が記録する値と、（GitHub Actions が書いたのと同じ形の）DBの行から計算する値の一致
  const shadowSummary = digestScrapedVenue(DATE, structuredClone(GOLDEN_VENUE));
  const cmp = compareRaceDigests(
    shadowSummary.digests,
    d.races,
    d.race_entries,
  );
  check(
    "(g) shadow のダイジェストは、書き込まれた races・race_entries の行から計算したダイジェストと、12レース全て一致",
    cmp.matched === 12 &&
      cmp.mismatched.length === 0 &&
      cmp.missingInDb.length === 0 &&
      cmp.extraInDb.length === 0,
    show(cmp),
  );
  // 不一致・欠け・余りの検出
  const races2 = clone(d.races);
  const entries2 = clone(d.race_entries);
  entries2.find(
    (e) => e.race_id === raceIdOf(DATE, 1, 3) && e.boat_number === 2,
  ).racer_id += 1;
  races2.find((r) => r.race_id === raceIdOf(DATE, 1, 5)).start_time =
    "23:59:00";
  const cmp2 = compareRaceDigests(
    shadowSummary.digests,
    races2
      .filter((r) => r.race_id !== raceIdOf(DATE, 1, 7))
      .concat([{ race_id: raceIdOf(DATE, 1, 13), start_time: "20:00:00" }]),
    entries2.concat([
      { race_id: raceIdOf(DATE, 1, 13), boat_number: 1, racer_id: 1 },
    ]),
  );
  check(
    "(g) ダイジェストの比較: 選手の違い・発走時刻の違い（不一致）・DBに無いレース（欠け）・shadowに無いレース（余り）を検出する",
    cmp2.matched === 9 &&
      same(
        cmp2.mismatched.map((m) => m.race_id),
        [raceIdOf(DATE, 1, 3), raceIdOf(DATE, 1, 5)],
      ) &&
      same(cmp2.missingInDb, [raceIdOf(DATE, 1, 7)]) &&
      same(cmp2.extraInDb, [raceIdOf(DATE, 1, 13)]),
    show(cmp2),
  );
  // 中止・順延が確定したレースは、公式の発走予定時刻が仮の値になり、朝にDBへ書いた時刻と一致しない。比較から外す
  const races3 = clone(d.races);
  for (const n of [3, 5]) {
    races3.find((r) => r.race_id === raceIdOf(DATE, 1, n)).start_time =
      "10:06:00";
  }
  const cmp3 = compareRaceDigests(
    shadowSummary.digests,
    races3.concat([{ race_id: raceIdOf(DATE, 1, 13), start_time: "20:00:00" }]),
    d.race_entries.concat([
      { race_id: raceIdOf(DATE, 1, 13), boat_number: 1, racer_id: 1 },
    ]),
    {
      excludeRaceIds: [
        raceIdOf(DATE, 1, 3),
        raceIdOf(DATE, 1, 5),
        raceIdOf(DATE, 1, 13),
      ],
    },
  );
  check(
    "(g) ダイジェストの比較: 中止・順延の確定で発走時刻が仮の値になったレース（excludeRaceIds）は、不一致・余りに数えず excluded に数える",
    cmp3.matched === 10 &&
      cmp3.mismatched.length === 0 &&
      cmp3.extraInDb.length === 0 &&
      cmp3.excluded === 2 &&
      compareRaceDigests(shadowSummary.digests, races3, d.race_entries)
        .mismatched.length === 2,
    show(cmp3),
  );
  check(
    "(g) 選手のいないレースは、ダイジェストに含めない（DBにも行が作られない）",
    digestScrapedRace(DATE, {
      placeCd: 1,
      raceNo: 1,
      startTime: "09:00",
      racers: [],
    }) === null &&
      digestDbRace({ race_id: "x", start_time: "09:00:00" }, []) === null,
  );
  const rid = raceIdOf(DATE, 1, 1);
  check(
    "(g) 同じ内容なら、HH:MM と HH:MM:SS・null と undefined の違いは、ダイジェストに影響しない",
    digestDbRace({ race_id: rid, start_time: "09:00:00" }, [
      {
        boat_number: 1,
        racer_id: 1,
        grade: null,
        age: undefined,
        motor_number: 1,
        boat_number_id: 1,
      },
    ]) ===
      digestScrapedRace(DATE, {
        placeCd: 1,
        raceNo: 1,
        startTime: "09:00",
        racers: [
          {
            lane: 1,
            racerId: 1,
            grade: undefined,
            age: null,
            motorNumber: 1,
            boatNumber: 1,
          },
        ],
      }).digest,
  );
}

// ---------------------------------------------------------------------------
// (h) 予測ロジックの変更検知
// ---------------------------------------------------------------------------
{
  const stateTable = (hash) =>
    hash === undefined
      ? []
      : [{ job: PREDICT_CODE_HASH_JOB, mode: "off", last_report: { hash } }];
  const nowAt = jst("2026-09-21 06:30");
  const schedule = [
    { race_id: "2026-09-21-01-01", start_time: jst("2026-09-21 06:00") }, // 発走済み
    { race_id: "2026-09-21-01-02", start_time: jst("2026-09-21 07:00") },
    { race_id: "2026-09-21-01-03", start_time: jst("2026-09-21 08:00") },
  ];
  const refreshCalls = [];
  const refresh = async (args) => {
    refreshCalls.push(args);
  };
  const getSchedule = async (date) => {
    if (date !== DATE) throw new Error(`日付が違います: ${date}`);
    return schedule;
  };
  const hashOf = (client) =>
    client.data.scrape_job_state.find((r) => r.job === PREDICT_CODE_HASH_JOB)
      ?.last_report?.hash;

  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: null,
      refresh,
      getSchedule,
    });
    check(
      "(h) ハッシュを計算できない: 検知しない（DBにも触れない）",
      r.status === "hash_unavailable" && client.calls.length === 0,
    );
  }
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: [] },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "A",
      refresh,
      getSchedule,
    });
    check(
      "(h) 初回（保存済みのハッシュなし）: 基準を保存するのみ。再生成しない",
      r.status === "baseline" &&
        hashOf(client) === "A" &&
        refreshCalls.length === 0,
    );
  }
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "A",
      refresh,
      getSchedule,
    });
    check(
      "(h) ハッシュが同じ: 何もしない。DBへの問い合わせは、ハッシュの行の読み取り1回だけ",
      r.status === "unchanged" &&
        refreshCalls.length === 0 &&
        client.calls.length === 1 &&
        client.writes.length === 0,
      show(client.calls),
    );
  }
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "B",
      refresh,
      getSchedule,
    });
    const call = refreshCalls.at(-1);
    check(
      "(h) ハッシュが変わった: 発走前の2レースだけ再生成（発走済みは、的中フラグを保つため対象外）。upsert・updated_at を進める・対象日つき",
      r.status === "regenerated" &&
        r.races === 2 &&
        same(call.specificRaceIds, ["2026-09-21-01-02", "2026-09-21-01-03"]) &&
        call.writeMode === "upsert" &&
        call.forceTouchRaces === true &&
        call.isDryRun === false &&
        call.date === DATE &&
        hashOf(client) === "B",
      show({ r, call }),
    );
  }
  {
    const before = refreshCalls.length;
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const results = await Promise.all([
      checkPredictCodeChange({
        client,
        now: () => nowAt,
        hash: "B",
        refresh,
        getSchedule,
      }),
      checkPredictCodeChange({
        client,
        now: () => nowAt,
        hash: "B",
        refresh,
        getSchedule,
      }),
    ]);
    check(
      "(h) 重なった2つの起動: 先に保存済みのハッシュを更新した1つだけが再生成する（もう1つは claimed_elsewhere）",
      refreshCalls.length === before + 1 &&
        results
          .map((x) => x.status)
          .sort()
          .join(",") === "claimed_elsewhere,regenerated",
      show(results),
    );
  }
  {
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const failing = async () => {
      throw new Error("refresh-down");
    };
    let error = null;
    try {
      await checkPredictCodeChange({
        client,
        now: () => nowAt,
        hash: "B",
        refresh: failing,
        getSchedule,
      });
    } catch (e) {
      error = e;
    }
    check(
      "(h) 再生成の失敗: 例外を投げ、保存済みのハッシュを元（A）に戻す（次の起動が再試行できる）",
      error?.message === "refresh-down" && hashOf(client) === "A",
      `${error?.message} ${hashOf(client)}`,
    );
    const before = refreshCalls.length;
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "B",
      refresh,
      getSchedule,
    });
    check(
      "(h) 次の起動で再試行して成功する",
      r.status === "regenerated" &&
        refreshCalls.length === before + 1 &&
        hashOf(client) === "B",
    );
  }
  {
    const before = refreshCalls.length;
    const client = createFakeSupabaseClient({
      tables: { scrape_job_state: stateTable("A") },
    });
    const r = await checkPredictCodeChange({
      client,
      now: () => nowAt,
      hash: "B",
      refresh,
      getSchedule: async () => schedule.slice(0, 1),
    });
    check(
      "(h) 発走前のレースが無い: 再生成せず、ハッシュだけ更新する",
      r.status === "regenerated" &&
        r.races === 0 &&
        refreshCalls.length === before &&
        hashOf(client) === "B",
    );
  }
  {
    const files = PREDICT_LOGIC_FILES.map((rel) => ({
      name: rel,
      content: `// ${rel}`,
    }));
    const base = hashFiles(files);
    const changed = hashFiles(
      files.map((f, i) =>
        i === 1 ? { ...f, content: `${f.content}\n// 変更` } : f,
      ),
    );
    check(
      "(h) ハッシュ: 内容が同じなら同じ・ファイルの内容が変われば変わる・16桁",
      base === hashFiles(files) &&
        base !== changed &&
        /^[0-9a-f]{16}$/.test(base),
    );
    const real = computePredictCodeHash();
    check(
      "(h) デプロイされた予測ロジック（generate-predictions.js ほか4ファイル）のハッシュを計算できる",
      typeof real === "string" &&
        /^[0-9a-f]{16}$/.test(real) &&
        PREDICT_LOGIC_FILES.length === 4 &&
        real === computePredictCodeHash(),
      String(real),
    );
    const edited = computePredictCodeHash({
      readFile: (url) =>
        fs.readFileSync(url, "utf8") +
        (String(url).endsWith("turnPrediction.js") ? "\n// x" : ""),
    });
    check(
      "(h) 依存ファイル（turnPrediction.js）の変更も検知する",
      edited !== real,
    );
    const unreadable = computePredictCodeHash({
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    check(
      "(h) ファイルを読めない: null（例外にせず、検知を止める）",
      unreadable === null,
    );
  }
  {
    // onTick: 共通ラッパは live のときだけ呼ぶ
    let ticks = 0;
    const onTick = createPredictCodeOnTick({
      check: async (args) => {
        ticks++;
        return {
          status: "unchanged",
          hasClient: !!args.client,
          hasNow: typeof args.now === "function",
          hasRefresh: typeof args.refresh === "function",
          hasSchedule: typeof args.getSchedule === "function",
        };
      },
    });
    const shadow = newEnv({ mode: "shadow" });
    await shadow.invoke(T0, { deps: newDeps({ venues: [] }).deps, onTick });
    const off = newEnv({ mode: "off" });
    await off.invoke(T0, { deps: newDeps().deps, onTick });
    const live = newEnv({ mode: "live" });
    const res = await live.invoke(T0, {
      deps: newDeps({ venues: [] }).deps,
      onTick,
    });
    check(
      "(h) onTick: live のときだけ、起動のたびに呼ばれる（shadow・off では呼ばれない）。client・now・refresh・getSchedule を渡す",
      ticks === 1 &&
        res.body.tick?.hasClient &&
        res.body.tick?.hasNow &&
        res.body.tick?.hasRefresh &&
        res.body.tick?.hasSchedule,
      show(res.body),
    );
  }
}

// ---------------------------------------------------------------------------
// (i) 公式予想のスロット
// ---------------------------------------------------------------------------
{
  const RACE_ID = "2026-09-21-12-12";
  const slot = {
    job: "pcexpect",
    race_id: RACE_ID,
    offset_min: -720,
    attempts: 1,
    last_attempt_at: T0.toISOString(),
  };
  const politeFetch = async (url) => {
    politeFetch.urls.push(url);
    return new Response(politeFetch.body, {
      status: politeFetch.status ?? 200,
    });
  };
  politeFetch.urls = [];
  politeFetch.body = PCEXPECT_HTML;

  async function runSlot(
    mode,
    {
      client,
      loadStartTime,
      fetchImpl = politeFetch,
      useDefaultLoader = false,
    } = {},
  ) {
    const store = createMemoryStore({
      rows: { pcexpect: { job: "pcexpect", mode, consecutive_failures: 0 } },
      slots: [slot],
    });
    const c = client ?? createFakeSupabaseClient();
    const res = await runScrapeJob({
      job: "pcexpect",
      store,
      client: c,
      handleSlot: createPcexpectSlotHandler(
        useDefaultLoader
          ? {}
          : {
              loadStartTime:
                loadStartTime ??
                (async () => new Date("2026-09-21T20:30:00+09:00")),
            },
      ),
      politeFetch: fetchImpl,
      now: () => T0,
      worker: "verify",
    });
    return { res, store, client: c };
  }

  check(
    "(i) race_id の解析: 日付・会場・レース番号",
    same(parsePcexpectRaceId(RACE_ID), {
      date: DATE,
      venue_code: 12,
      race_number: 12,
    }),
  );
  const badId = (() => {
    try {
      parsePcexpectRaceId("bad");
      return false;
    } catch {
      return true;
    }
  })();
  check("(i) 不正な race_id は例外", badId);

  const shadow = await runSlot("shadow");
  check(
    "(i) shadow: 取得・解析のみ。DBには一切触れず、payload のダイジェストを予定表の result_digest に記録して完了",
    shadow.res.status === 200 &&
      shadow.store.completed.length === 1 &&
      shadow.store.completed[0].outcome === "ok" &&
      shadow.store.completed[0].resultDigest === PCEXPECT_DIGEST &&
      shadow.client.calls.length === 0 &&
      politeFetch.urls.at(-1) ===
        "https://www.boatrace.jp/owpc/pc/race/pcexpect?hd=20260921&jcd=12&rno=12",
    show(shadow.store.completed),
  );
  const live = await runSlot("live");
  const row = live.client.data.external_predictions?.[0];
  check(
    "(i) live: external_predictions へ upsert（race_start_at は races.start_time の発走時刻）して完了。書き込み1行",
    live.store.completed.length === 1 &&
      live.store.completed[0].rowsWritten === 1 &&
      row?.race_start_at === "2026-09-21T11:30:00.000Z" &&
      row?.race_date === DATE &&
      row?.venue_code === 12 &&
      row?.race_no === 12,
    show(row),
  );
  politeFetch.body = "<html><body>まだ公開されていません</body></html>";
  const empty = await runSlot("live");
  check(
    "(i) 予想が未公開: 完了にせず再試行（no_values）。書き込まない",
    empty.store.completed.length === 0 &&
      empty.store.retried.length === 1 &&
      empty.store.retried[0].outcome === "no_values" &&
      !empty.client.data.external_predictions,
    show(empty.store.retried),
  );
  politeFetch.body = PCEXPECT_HTML;
  const http500 = await runSlot("shadow", {
    fetchImpl: async () => new Response("err", { status: 500 }),
  });
  check(
    "(i) HTTP 500: 完了にせず再試行（error）。連続の失敗にはしない（1スロットの失敗）",
    http500.store.completed.length === 0 &&
      http500.store.retried[0]?.outcome === "error" &&
      /HTTP 500/.test(http500.store.retried[0]?.error ?? ""),
    show(http500.store.retried),
  );
  // 既定の発走時刻の読み取り（races.start_time → race_start_at）
  const withRaces = await runSlot("live", {
    useDefaultLoader: true,
    client: createFakeSupabaseClient({
      tables: { races: [{ race_id: RACE_ID, start_time: "20:30:00" }] },
    }),
  });
  const noRaceRow = await runSlot("live", { useDefaultLoader: true });
  const racesReadFails = await runSlot("live", {
    useDefaultLoader: true,
    client: createFakeSupabaseClient({
      failOn: { "races:select": "races-down" },
    }),
  });
  check(
    "(i) 既定の発走時刻の読み取り: races.start_time（20:30:00）が race_start_at（JST→UTC）になる。races に行が無ければ null。読み取りの失敗は再試行",
    withRaces.client.data.external_predictions?.[0]?.race_start_at ===
      "2026-09-21T11:30:00.000Z" &&
      noRaceRow.client.data.external_predictions?.[0]?.race_start_at === null &&
      racesReadFails.store.completed.length === 0 &&
      racesReadFails.store.retried[0]?.outcome === "error" &&
      /races-down/.test(racesReadFails.store.retried[0]?.error ?? ""),
    show(withRaces.client.data.external_predictions?.[0]),
  );
  const startFail = await runSlot("live", {
    loadStartTime: async () => {
      throw new Error("発走時刻の読み取りに失敗しました");
    },
  });
  check(
    "(i) 発走時刻の読み取りに失敗: 書き込まずに再試行",
    startFail.store.completed.length === 0 &&
      startFail.store.retried[0]?.outcome === "error" &&
      !startFail.client.data.external_predictions,
  );
  const writeFail = await runSlot("live", {
    client: createFakeSupabaseClient({
      failOn: { "external_predictions:upsert": "boom-ep" },
    }),
  });
  check(
    "(i) 書き込みの失敗: 完了にせず再試行",
    writeFail.store.completed.length === 0 &&
      writeFail.store.retried[0]?.outcome === "error",
  );
  const breaker = await runSlot("shadow", {
    fetchImpl: async () => {
      throw new BreakerOpenError("host:boatrace.jp", at(5).getTime());
    },
  });
  check(
    "(i) ブレーカーが開いている: breaker_open で、ブレーカーが閉じる時刻まで再試行を遅らせる",
    breaker.store.retried[0]?.outcome === "breaker_open" &&
      breaker.store.retried[0]?.retryAt?.getTime() === at(5).getTime(),
  );
  // shadow のダイジェストと DB の payload の比較（scripts/maintenance/check-morning-init-shadow.js）
  const dbRow = (raceNo, payload) => ({
    race_date: DATE,
    venue_code: 12,
    race_no: raceNo,
    payload,
  });
  const payload = parsePcexpect(PCEXPECT_HTML);
  const cmp = comparePcexpectDigests(
    [
      { race_id: "2026-09-21-12-12", result_digest: PCEXPECT_DIGEST },
      { race_id: "2026-09-21-12-11", result_digest: PCEXPECT_DIGEST },
      { race_id: "2026-09-21-12-10", result_digest: PCEXPECT_DIGEST },
      { race_id: "2026-09-21-12-09", result_digest: null },
    ],
    [
      dbRow(12, payload),
      dbRow(11, { ...payload, confidence: payload.confidence + 1 }),
    ],
  );
  check(
    "(i) 公式予想のダイジェスト比較: 一致・不一致（payload の違い）・DBに行なし・digest未記録を区別する",
    cmp.matched === 1 &&
      same(
        cmp.mismatched.map((m) => m.race_id),
        ["2026-09-21-12-11"],
      ) &&
      same(cmp.missing, ["2026-09-21-12-10"]) &&
      same(cmp.noDigest, ["2026-09-21-12-09"]),
    show(cmp),
  );
  const fetched = await makeFetchHtml(
    async () => new Response("<p>x</p>", { status: 200 }),
  )("u");
  const fetchErr = await makeFetchHtml(
    async () => new Response("no", { status: 503 }),
  )("u").catch((e) => e);
  check(
    "(i) makeFetchHtml: 本文を返す・HTTP エラーは例外",
    fetched === "<p>x</p>" &&
      fetchErr instanceof Error &&
      /HTTP 503/.test(fetchErr.message),
  );
}

// ---------------------------------------------------------------------------
// (j) 配線・監視
// ---------------------------------------------------------------------------
{
  check(
    "(j) レジストリの整合性（validateRegistry）",
    same(validateRegistry(), []),
  );
  const def = SCRAPE_JOBS[JOB];
  check(
    "(j) races_init: 日次・05:00指定・リース=maxDuration=800秒・取得先 boatrace.jp",
    def.kind === "daily" &&
      def.targetTimeJst === "05:00" &&
      def.leaseSec === 800 &&
      def.maxDurationSec === 800 &&
      same(def.hosts, ["boatrace.jp"]),
  );
  const pc = SCRAPE_JOBS.pcexpect;
  check(
    "(j) pcexpect: 窓型・発走12時間前から30分前まで（許容幅690分）・再試行600秒・リース300秒・20件×3並列（設計どおり）",
    pc.kind === "window" &&
      same(pc.offsets, [-720]) &&
      pc.graceMin === 690 &&
      pc.retrySec === 600 &&
      pc.leaseSec === 300 &&
      pc.claimLimit === 20 &&
      pc.concurrency === 3,
  );
  const read = (p) =>
    fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  const maxDurationOf = (src) => Number(/maxDuration:\s*(\d+)/.exec(src)?.[1]);
  const racesInitApi = read("api/cron/races-init.js");
  const pcexpectApi = read("api/cron/pcexpect.js");
  check(
    "(j) api の maxDuration は、レジストリと同じ値（races-init 800・pcexpect 300）",
    maxDurationOf(racesInitApi) === def.maxDurationSec &&
      maxDurationOf(pcexpectApi) === pc.maxDurationSec,
  );
  check(
    "(j) api/cron/races-init.js は onTick（予測ロジックの変更検知）を渡す。pcexpect.js は handleSlot",
    /onTick:\s*createPredictCodeOnTick\(\)/.test(racesInitApi) &&
      /handleSlot:\s*createPcexpectSlotHandler\(\)/.test(pcexpectApi),
  );

  // vercel.json の cron（UTC）→ JST
  const crons = JSON.parse(read("vercel.json")).crons;
  const jstHours = (schedule) => {
    const hoursField = schedule.split(" ")[1];
    const hours = hoursField.split(",").flatMap((part) => {
      const [a, b] = part.split("-").map(Number);
      return b === undefined
        ? [a]
        : Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
    return hours.map((h) => (h + 9) % 24).sort((x, y) => x - y);
  };
  const cronOf = (path) => crons.filter((c) => c.path === path);
  const ri = cronOf("/api/cron/races-init");
  const pe = cronOf("/api/cron/pcexpect");
  check(
    "(j) vercel.json: races-init は `*/2 20-23,0-14 * * *`（UTC）＝JST 05:00〜23:58の2分ごと（1件だけ登録。朝の初期化に加え、予測ロジックの変更検知を終日行う）",
    ri.length === 1 &&
      ri[0].schedule === "*/2 20-23,0-14 * * *" &&
      same(
        jstHours(ri[0].schedule),
        [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
      ),
    show(ri),
  );
  check(
    "(j) vercel.json: pcexpect は `*/5 20-23,0-14 * * *`（UTC）＝JST 05:00〜23:59の5分ごと（1件だけ登録）",
    pe.length === 1 &&
      pe[0].schedule === "*/5 20-23,0-14 * * *" &&
      same(
        jstHours(pe[0].schedule),
        Array.from({ length: 19 }, (_, i) => i + 5),
      ),
    show(pe),
  );
  check(
    "(j) vercel.json: 関数のリージョンは api/cron/* を syd1（DBに近い）",
    JSON.parse(read("vercel.json")).functions["api/cron/*.js"].regions[0] ===
      "syd1",
  );

  // GitHub 側を止める変数
  const wf = read(".github/workflows/scrape-scheduled.yml");
  const initStep = wf.slice(
    wf.indexOf("- name: Morning initialization"),
    wf.indexOf("- name: Run scraping orchestrator"),
  );
  check(
    "(j) scrape-scheduled.yml: 朝の初期化の段に SKIP_MORNING_INIT_ON_GHA・SKIP_PCEXPECT_ON_GHA をリポジトリ変数から渡す。値は固定しない（既定は未設定＝従来どおり）",
    /SKIP_MORNING_INIT_ON_GHA:\s*\$\{\{\s*vars\.SKIP_MORNING_INIT_ON_GHA\s*\}\}/.test(
      initStep,
    ) &&
      /SKIP_PCEXPECT_ON_GHA:\s*\$\{\{\s*vars\.SKIP_PCEXPECT_ON_GHA\s*\}\}/.test(
        initStep,
      ) &&
      !/SKIP_(MORNING_INIT|PCEXPECT)_ON_GHA:\s*['"]?true/i.test(wf),
  );

  // fs / execSync / git / process.exit に依存しない
  const noDeps = [
    "scripts/lib/racesInit/job.js",
    "scripts/lib/racesInit/digest.js",
    "scripts/lib/scrapeJobs/pcexpectHandlers.js",
    "scripts/lib/scrapeJobs/htmlFetch.js",
    "api/cron/races-init.js",
    "api/cron/pcexpect.js",
  ];
  const offenders = noDeps.filter((p) =>
    /execSync|child_process|process\.exit|from ["'](node:)?fs|git log|data\/races\.json/.test(
      read(p)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    ),
  );
  check(
    "(j) races-init・pcexpect の実装は、fs・execSync・git log・process.exit・races.json に依存しない",
    offenders.length === 0,
    show(offenders),
  );

  // 監視
  const overdue = (lastTargetDate, now) =>
    evaluateJobStates(
      [
        {
          job: JOB,
          mode: "live",
          last_target_date: lastTargetDate,
          consecutive_failures: 0,
        },
      ],
      now,
    ).filter((a) => a.kind === "daily_overdue");
  check(
    "(j) 監視: 05:00指定から3時間（08:00 JST）を過ぎても、その日の初期化が済んでいなければ通知する。済んでいれば通知しない",
    overdue("2026-09-20", jst("2026-09-21 07:59")).length === 0 &&
      overdue("2026-09-20", jst("2026-09-21 08:01")).length === 1 &&
      overdue(DATE, jst("2026-09-21 08:01")).length === 0,
  );
  const withAlert = evaluateJobStates(
    [
      {
        job: JOB,
        mode: "live",
        consecutive_failures: 0,
        last_report: {
          alerts: [
            {
              key: "venue_failed:2",
              text: "会場2が失敗",
              until: "2099-01-01T00:00:00Z",
            },
          ],
        },
      },
    ],
    jst("2026-09-21 06:00"),
  );
  check(
    "(j) 監視: ジョブ自身の通知（会場の連続失敗）を、通知に出す",
    withAlert.some(
      (a) => a.kind === "job_report" && /会場2が失敗/.test(a.text),
    ),
  );
  const noise = evaluateJobStates(
    [{ job: PREDICT_CODE_HASH_JOB, mode: "off", last_report: { hash: "A" } }],
    jst("2026-09-21 12:00"),
  );
  check(
    "(j) 監視: 疑似の行（predict-code-hash）は、通知を出さない",
    noise.length === 0,
  );
  const summary = formatDailySummary({
    date: DATE,
    stats7d: [],
    statsDay: [],
    jobStates: [
      { job: JOB, mode: "live" },
      { job: PREDICT_CODE_HASH_JOB, mode: "off" },
      { job: "host:boatrace.jp", mode: "off" },
    ],
    now: jst("2026-09-22 00:10"),
  });
  const summaryText = summary.attachments[0].blocks[0].text.text;
  check(
    "(j) 日次サマリーのモード一覧: 取得ジョブ（races_init）だけ。疑似の行・ホストの行は出さない",
    /races_init=live/.test(summaryText) &&
      !/predict-code-hash/.test(summaryText) &&
      !/host:/.test(summaryText),
    summaryText,
  );
}

completed = true;
if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}
out.log("\n✅ 全ての検証に合格しました");
