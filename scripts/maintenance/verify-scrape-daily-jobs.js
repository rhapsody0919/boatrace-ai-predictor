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
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { resolveTargetDate } from "../lib/scrapeJobs/dailyJob.js";














import { createFakeSupabaseClient as createFakeClient } from "../lib/scrapeJobs/testing/fakeSupabaseClient.js";
import {
  byName,
  runScrapeDailyJobsScenes5,
  runScrapeDailyJobsScenes6,
  runScrapeDailyJobsScenes7,
} from "./verifyData/scrape-daily-jobs-scenes-5.js";
import { runScrapeDailyJobsScenes1 } from "./verifyData/scrape-daily-jobs-scenes-1.js";
import { runScrapeDailyJobsScenes2 } from "./verifyData/scrape-daily-jobs-scenes-2.js";
import { runScrapeDailyJobsScenes3 } from "./verifyData/scrape-daily-jobs-scenes-3.js";
import { runScrapeDailyJobsScenes4 } from "./verifyData/scrape-daily-jobs-scenes-4.js";
import { runScrapeDailyJobsScenes8 } from "./verifyData/scrape-daily-jobs-scenes-6.js";
import { runScrapeDailyJobsScenes9 } from "./verifyData/scrape-daily-jobs-scenes-7.js";
import { runScrapeDailyJobsScenes10 } from "./verifyData/scrape-daily-jobs-scenes-8.js";
import { runScrapeDailyJobsScenes11 } from "./verifyData/scrape-daily-jobs-scenes-9.js";

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FIXTURES = new URL("../lib/__fixtures__/pointRank/", import.meta.url);
const POINT_RANK_G1 = fs.readFileSync(
  new URL("g1-day4-with-table.html", FIXTURES),
  "utf8",
);
const POINT_RANK_HAYAMI = fs.readFileSync(
  new URL("g1-hayami-synthetic.html", FIXTURES),
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

// ---- 後半の場面（verifyData/scrape-daily-jobs-scenes-1.js・scrape-daily-jobs-scenes-2.js・scrape-daily-jobs-scenes-3.js・scrape-daily-jobs-scenes-4.js） ----
await runScrapeDailyJobsScenes1({ check, show, jst, POINT_RANK_G1, POINT_RANK_NONE, createFakeFetch, liveRow, runJob, throwingFetch, strictClient });
await runScrapeDailyJobsScenes2({ check, show, jst, POINT_RANK_G1, POINT_RANK_NONE, liveRow, runJob });
await runScrapeDailyJobsScenes3({ check, show, POINT_RANK_HAYAMI, EC, createFakeFetch });
await runScrapeDailyJobsScenes4({ check, show, same, jst, liveRow, runJob });

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
  const written = await writeEntryCourseRows(failing, [{ race_id: "a" }], {
    throwOnError: false,
  });
  let threw = false;
  try {
    await writeEntryCourseRows(failing, [{ race_id: "a" }]);
  } catch {
    threw = true;
  }
  check(
    "進入コース: 書き込みエラーは、既定（BOA-391）で例外。throwOnError: false のときだけログのみ(0件書き込み)",
    written === 0 && threw,
  );
}

// ---- 後半の場面（verifyData/scrape-daily-jobs-scenes-5.js） ----
runScrapeDailyJobsScenes5({ check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob });
const fukuoka = byName("福岡");

// ---- 後半の場面（verifyData/scrape-daily-jobs-scenes-5.js） ----
await runScrapeDailyJobsScenes6({ check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob, fukuoka });
// 従来の run() の部品: 既定は global fetch・throwOnError 無しで、書き込みエラーはログのみ
{
  const { writeMotorStatsRows, toMotorStatsRow } =
    await import("../daily/scrape-venue-motor-stats.js");
  const failing = createFakeClient({
    failOn: { "venue_motor_stats:upsert": "x" },
  });
  const written = await writeMotorStatsRows(failing, [{ a: 1 }], {
    throwOnError: false,
  });
  let threw = false;
  try {
    await writeMotorStatsRows(failing, [{ a: 1 }]);
  } catch {
    threw = true;
  }
  const sample = toMotorStatsRow(fukuoka, { motorNumber: 43 }, "2026-09-19");
  check(
    "モーター成績: 書き込みエラーは既定（BOA-391）で例外・throwOnError: false のときだけログのみ。行の組み立ては従来と同じ列",
    written === 0 &&
      threw &&
      sample.venue_code === 22 &&
      sample.scraped_date === "2026-09-19" &&
      sample.source_template === "genericTable" &&
      Object.keys(sample).length === 19,
    show(sample),
  );
}

// ---- 後半の場面（verifyData/scrape-daily-jobs-scenes-5.js・scrape-daily-jobs-scenes-6.js・scrape-daily-jobs-scenes-7.js・scrape-daily-jobs-scenes-8.js・scrape-daily-jobs-scenes-9.js） ----
runScrapeDailyJobsScenes7({ check, show, same, jst, MOTOR, createFakeFetch, liveRow, runJob, fukuoka });
await runScrapeDailyJobsScenes8({ check, show, jst, liveRow, runJob });
await runScrapeDailyJobsScenes9({ check, show, same, jst, liveRow, runJob, throwingFetch, strictClient });
await runScrapeDailyJobsScenes10({ check, show, same, jst, sleep, liveRow, runJob });
runScrapeDailyJobsScenes11({ check, show, same, jst });

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
    // maxDuration は Vercel がビルド時に読む config のリテラル。本文の字でなく export の値で見る
    const mod = await import(
      new URL(`../../api/cron/${file}.js`, import.meta.url)
    );
    const maxDuration = mod.config?.maxDuration;
    check(
      `配線 ${job}: api/cron/${file}.js の maxDuration(${maxDuration}) がレジストリ(${SCRAPE_JOBS[job].maxDurationSec})と一致し、ハンドラーを export する`,
      maxDuration === SCRAPE_JOBS[job].maxDurationSec &&
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
        yml.includes(
          `node scripts/maintenance/gha-skip-gate.js ${skipVar} --wait`,
        ) &&
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
      show({
        first: jstText[0],
        last: jstText.at(-1),
        targets: [...targets],
        lastEndJst,
      }),
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
