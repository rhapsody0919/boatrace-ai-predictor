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

import { createSupabaseStore } from "../lib/scrapeJobs/store.js";

import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";

import {
  evaluateJobStates,
  formatDailySummary,
} from "../lib/scrapeJobs/monitor.js";
import { createPredictCodeOnTick, runRacesInitJob } from "../lib/racesInit/job.js";

import {
  PREDICT_CODE_HASH_JOB,
  PREDICT_LOGIC_FILES,
  checkPredictCodeChange,
  computePredictCodeHash,
  hashFiles,
} from "../lib/racesInit/predictCodeCheck.js";




import { runMorningInitJobsScenes1 } from "./verifyData/morning-init-jobs-scenes-1.js";
import { runMorningInitJobsScenes2 } from "./verifyData/morning-init-jobs-scenes-2.js";
import { runMorningInitJobsScenes3 } from "./verifyData/morning-init-jobs-scenes-3.js";
import {
  runMorningInitJobsScenes4,
  runMorningInitJobsScenes5,
  runMorningInitJobsScenes6,
} from "./verifyData/morning-init-jobs-scenes-4.js";

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
  noProgramVenues = [],
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
    noProgramChecks: [],
  };
  const state = {
    venues,
    existing,
    failVenues,
    unifiedFails: false,
    // イン崩れ注意度の表が読めない回数（BOA-822）。Infinity なら毎回
    inCautionFails: 0,
  };
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
      const inCautionFailed = state.inCautionFails > 0;
      state.inCautionFails--;
      return { missing: 0, generated: 0, inCautionFailed };
    },
    triggerDeployHook: async () => {
      calls.hook++;
      return { triggered: true };
    },
    // 番組の無い中止の会場の確認（BOA-721）。既定は「番組なしではない」（従来どおり失敗にする）
    checkNoProgram: async (date, code) => {
      calls.noProgramChecks.push(code);
      return noProgramVenues.includes(code);
    },
  };
  return { deps, calls, state };
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const T0 = jst("2026-09-21 05:00");
const at = (minutes, base = T0) => new Date(base.getTime() + minutes * 60_000);

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-1.js・morning-init-jobs-scenes-2.js・morning-init-jobs-scenes-3.js） ----
await runMorningInitJobsScenes1({ check, show, same, jst, DATE, JOB, newEnv, newDeps, range, T0, at });
await runMorningInitJobsScenes2({ check, show, same, jst, DATE, fakeVenue, newEnv, newDeps, range, T0, at });
await runMorningInitJobsScenes3({ check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, newEnv, newDeps, T0, at });

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
    // 本数でなく中身で見る: 予測ロジックの各ファイルが一覧に漏れなく・重複なく入り、全て読める（読めないと real は null）
    check(
      "(h) デプロイされた予測ロジック（generate-predictions.js と計算の lib）のハッシュを計算できる",
      typeof real === "string" &&
        /^[0-9a-f]{16}$/.test(real) &&
        ["../../daily/generate-predictions.js", "../turnPrediction.js", "../venueParameters.js", "../winningTechniques.js", "../predictionVolatility.js", "../predictionScoring.js", "../predictionRaceBuild.js", "../predictionRaceFetch.js", "../predictionRefreshSteps.js", "../predictionWriteRows.js"].every((rel) => PREDICT_LOGIC_FILES.includes(rel)) &&
        new Set(PREDICT_LOGIC_FILES).size === PREDICT_LOGIC_FILES.length && real === computePredictCodeHash(),
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

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-4.js） ----
await runMorningInitJobsScenes4({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at });

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
    "(j) pcexpect: 窓型・発走12時間前から30分前まで（許容幅690分）・再試行600秒・リース300秒・6件×3並列（設計どおり）",
    pc.kind === "window" &&
      same(pc.offsets, [-720]) &&
      pc.graceMin === 690 &&
      pc.retrySec === 600 &&
      pc.leaseSec === 300 &&
      pc.claimLimit === 6 &&
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

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-4.js） ----
await runMorningInitJobsScenes5({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at });

completed = true;
if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-4.js） ----
runMorningInitJobsScenes6({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, newEnv, newDeps, T0, at });
