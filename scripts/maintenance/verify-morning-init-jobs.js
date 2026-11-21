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


import { createSupabaseStore } from "../lib/scrapeJobs/store.js";

import { createFakeSupabaseClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";

import {
  evaluateJobStates,
  formatDailySummary,
} from "../lib/scrapeJobs/monitor.js";
import { runRacesInitJob } from "../lib/racesInit/job.js";

import {
  PREDICT_CODE_HASH_JOB,
  PREDICT_LOGIC_FILES,
  computePredictCodeHash,
  hashFiles,
} from "../lib/racesInit/predictCodeCheck.js";








import { runMorningInitJobsScenesB1 } from "./verifyData/morning-init-jobs-scenes-b-1.js";
import {
  runMorningInitJobsScenesB2,
  runMorningInitJobsScenesB3,
  runMorningInitJobsScenesB4,
} from "./verifyData/morning-init-jobs-scenes-b-2.js";

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

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-b-1.js） ----
await runMorningInitJobsScenesB1({ check, show, same, jst, clone, GOLDEN_VENUE, DATE, JOB, fakeVenue, newEnv });

/** { の中身を割った 4/5 */
function mijPredictCode4() {
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
}

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-b-2.js） ----
await runMorningInitJobsScenesB2({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4 });

/** { の中身を割った 2/4 */
function mijWiring2() {
  const read = (p) =>
    fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  return { read };
}

/** { の中身を割った 3/4 */
function mijWiring3({ def, pc, read }) {
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
  return { offenders };
}

/** { の中身を割った 4/4 */
function mijWiring4({ offenders }) {
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

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-b-2.js） ----
await runMorningInitJobsScenesB3({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4 });

completed = true;
if (failures > 0) {
  out.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}

// ---- 後半の場面（verifyData/morning-init-jobs-scenes-b-2.js） ----
runMorningInitJobsScenesB4({ out, check, show, same, PCEXPECT_HTML, PCEXPECT_DIGEST, DATE, JOB, newEnv, mijPredictCode4, mijWiring2, mijWiring3, mijWiring4 });
