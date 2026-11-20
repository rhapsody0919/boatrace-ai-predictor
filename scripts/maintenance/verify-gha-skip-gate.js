/**
 * verify-gha-skip-gate.js - フェイルセーフ付きSKIP（scripts/lib/ghaSkipGate.js、scripts/maintenance/gha-skip-gate.js、
 * scripts/daily/scrape-scheduled.js・日次ワークフローの配線）の検証。DBにもネットワークにも接続しない（偽のclientを使う）。
 *
 * 確認すること:
 *   (a) 変数が未設定・false・空・未知の値: clientを一切呼ばず（DBを読まず）、常に「実行」（現行と同じ）
 *   肩代わり（実行）は「mode=live・Vercel が起動していない・取得先のブレーカーが閉じている・直近の失敗が 403・
 *   接続の失敗でない」ときだけ（docs/design/scraping-load-budget/spec.md §0・§8 の P0）。
 *   (b) 窓型（odds・result）: 起動が新しい → スキップ（連続失敗があっても）。起動が古い・記録なし → 実行。
 *       mode が live 以外・行なし → スキップ（どこからも取らない）。取得先のブレーカー（ホスト・403 のパス）が開いている、
 *       直近の失敗が 403・接続の失敗 → 起動が古くてもスキップ（GitHub の素の fetch で公式を回り込んで叩かない）。
 *       レースの無い時間帯（最終成功が半日前でも、起動が新しい）は誤って実行しない
 *   (c) 日次（point_rank等）: 対象日を処理済み・指定時刻以降に Vercel が起動した → スキップ。未処理で起動なし → 実行。
 *       指定時刻の直後は retryable
 *   (d) チャンク処理（racer_profiles）: 指定時刻以降に起動があればスキップ。それ以外は実行
 *   (e) 複数ジョブ（SKIP_RESULTS_ON_GHA = result・result_catchup）: どれか1つでも肩代わりの条件を満たせば実行
 *   (f) 失敗・タイムアウト・不正な応答・認証情報なし・不正な行: すべて「スキップ」（確かめられないときは叩かない）
 *   (g) 待機（日次の指定時刻の直後）: Vercelの完了を待って再判定し、上限まで完了しなければ「実行」
 *   (h) RESTクライアント: 該当ジョブの行だけを、service_roleのキーで読む。HTTPエラー・非配列は例外
 *   (i) CLI: 常にskip=true|falseを出力し、変数が未設定なら skip=false、変数が true のあらゆる失敗で skip=true
 *   (j) 配線: 変数とジョブの対応・対象外の変数・ワークフローのgateジョブ・scrape-scheduled.js・vercel.jsonの起動間隔
 *   (k) 変異検証: 判定の要（modeの確認・起動の鮮度・直近の失敗・ブレーカー・対象日の比較・失敗時のスキップ・全ジョブの判定・
 *       タイムアウト・DBを読まない既定）を1つずつ壊したコピーで、この検証が失敗すること
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as realGate from "../lib/ghaSkipGate.js";
import { main as gateMain } from "./gha-skip-gate.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";



import { runGhaSkipGateScenes1, runGhaSkipGateScenes2 } from "./verifyData/gha-skip-gate-scenes-1.js";
import { runGhaSkipGateScenes3 } from "./verifyData/gha-skip-gate-scenes-2.js";
import { runGhaSkipGateScenes4 } from "./verifyData/gha-skip-gate-scenes-3.js";
import { runGhaSkipGateScenes5 } from "./verifyData/gha-skip-gate-scenes-4.js";
import { runGhaSkipGateScenes6 } from "./verifyData/gha-skip-gate-scenes-5.js";
import { runGhaSkipGateScenes7 } from "./verifyData/gha-skip-gate-scenes-6.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const LIB_DIR = path.join(ROOT, "scripts/lib");

const printOut = console.log.bind(console);
const printErr = console.error.bind(console);
console.warn = () => {};

const jst = (text) => new Date(`${text.replace(" ", "T")}:00+09:00`);
const minutesAgo = (now, min) =>
  new Date(now.getTime() - min * 60000).toISOString();
const show = (v) => JSON.stringify(v);

const row = (job, overrides = {}) => ({
  job,
  mode: "live",
  last_tick_at: null,
  last_success_at: null,
  consecutive_failures: 0,
  last_target_date: null,
  breaker_open_until: null,
  ...overrides,
});
const fakeClient = (rows) => {
  const calls = [];
  return {
    calls,
    async readJobStates(keys) {
      calls.push(keys);
      return typeof rows === "function" ? rows(keys) : rows;
    },
  };
};
const throwingClient = () => ({
  calls: [],
  async readJobStates() {
    this.calls.push("called");
    throw new Error("DBを読んではいけない");
  },
});

/**
 * 検証の本体。mod（実物、または壊したコピー）に対して全ての確認をし、record(label, pass, detail) で報告する。
 */
async function suite(mod, record) {
  const decide = async (varName, rows, now, extra = {}) =>
    mod.shouldSkipOnGha({
      varName,
      env: { [varName]: "true" },
      client: fakeClient(rows),
      now,
      logger: null,
      ...extra,
    });
  const skipOf = async (...args) => (await decide(...args)).skip;

  // ---- 後半の場面（verifyData/gha-skip-gate-scenes-1.js） ----
  await runGhaSkipGateScenes1({ jst, minutesAgo, show, row, throwingClient, mod, record, decide, skipOf });

  // ---- (b) 窓型 ----
  const NOW = jst("2026-09-24 12:00");
  const healthy = (o = {}) =>
    row("odds", {
      last_tick_at: minutesAgo(NOW, 2),
      last_success_at: minutesAgo(NOW, 1),
      ...o,
    });
  const V = "SKIP_ODDS_ON_GHA";

  // ---- 後半の場面（verifyData/gha-skip-gate-scenes-1.js・gha-skip-gate-scenes-2.js・gha-skip-gate-scenes-3.js・gha-skip-gate-scenes-4.js・gha-skip-gate-scenes-5.js・gha-skip-gate-scenes-6.js） ----
  await runGhaSkipGateScenes2({ jst, minutesAgo, show, row, throwingClient, mod, record, decide, skipOf, NOW, healthy, V });
  await runGhaSkipGateScenes3({ jst, minutesAgo, show, row, record, mod, decide, skipOf, NOW, healthy, V });
  await runGhaSkipGateScenes4({ jst, minutesAgo, show, row, record, mod, decide, skipOf });
  await runGhaSkipGateScenes5({ jst, minutesAgo, show, row, fakeClient, record, mod, decide });
  await runGhaSkipGateScenes6({ jst, minutesAgo, show, row, fakeClient, throwingClient, mod, record });
  await runGhaSkipGateScenes7({ show, mod, record });
}

// ---------------------------------------------------------------------------
// 変異検証用: 壊したコピーを作って読み込む
// ---------------------------------------------------------------------------
const SOURCE = fs.readFileSync(path.join(LIB_DIR, "ghaSkipGate.js"), "utf8");
const MUTANT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gha-skip-mutants-"));

async function loadMutant(name, replace, by) {
  const found =
    replace instanceof RegExp ? replace.test(SOURCE) : SOURCE.includes(replace);
  if (!found) {
    throw new Error(`変異の対象が見つかりません（${name}）: ${replace}`);
  }
  const mutated = SOURCE.replace(replace, by).replaceAll(
    'from "./scrapeJobs/',
    `from "${pathToFileURL(path.join(LIB_DIR, "scrapeJobs")).href}/`,
  );
  const file = path.join(MUTANT_DIR, `${name}.mjs`);
  fs.writeFileSync(file, mutated);
  return import(pathToFileURL(file).href);
}

const MUTANTS = [
  ["modeの確認を外す", 'if (row.mode !== "live") {', "if (false) {"],
  [
    "窓型: 起動の鮮度の確認を外す（起動中でも肩代わり）",
    "    if (tickFresh) {\n      return noTakeover(",
    "    if (false) {\n      return noTakeover(",
  ],
  [
    "時計の異常（未来の起動）を許す",
    "if (tickAge !== null && tickAge < -1) {",
    "if (false) {",
  ],
  [
    "直近の失敗（403・接続の失敗）の確認を外す（P0）",
    "isFetchFailureError(row.last_error) &&\n    isRecentFailure(row, failureFloorMs)",
    "false",
  ],
  [
    "403 のパスのブレーカーの確認を外す（BOA-1145）",
    "openBreakerKey(pathKeysOf(def), rowsByJob, nowMs) ??",
    "null ??",
  ],
  [
    "ホストのブレーカーの確認を外す（P0）",
    "openBreakerKey(hostKeysOf(def), rowsByJob, nowMs);",
    "null;",
  ],
  [
    "連続失敗で肩代わりを戻す（P0）",
    "    if (tickFresh) {\n      return noTakeover(",
    "    if (tickFresh && !(row.consecutive_failures >= 3)) {\n      return noTakeover(",
  ],
  [
    "失敗の期間の下限（当日の指定時刻・24時間）を外す",
    "if (failedAt < floorMs) return false;",
    "",
  ],
  [
    "日次: 前日の失敗も daily_failures に数える",
    "failedAt >= targetInstant &&",
    "true &&",
  ],
  [
    "展示も肩代わりの対象にする",
    "if (NEVER_TAKEOVER_VARS.includes(varName)) {",
    "if (false) {",
  ],
  [
    "古い失敗も肩代わりを止める理由にする",
    "return failedAt >= tick - TICK_WRITE_INTERVAL_MS;",
    "return true;",
  ],
  [
    "同じ変数の別のジョブの取得先の失敗で、変数ごと止めない",
    "if (veto && unhealthy.length > 0) {",
    "if (false) {",
  ],
  [
    "日次: 取得先と関係ない失敗が続いても肩代わりしない",
    "failures >= policy.maxDailyFailures",
    "false",
  ],
  [
    "last_error の形を広げる（DB の失敗も取得先の失敗に数える）",
    "|fetch failed|",
    "|に失敗しました|network|aborted|fetch failed|",
  ],
  [
    "日次: 指定時刻以降の起動を見ない（Vercel の失敗を肩代わりする）",
    "if (tickFresh || startedSinceTarget) {",
    "if (tickFresh) {",
  ],
  [
    "日次: 対象日でなく、何か処理済みならよいことにする",
    "if (done && done >= target) {",
    "if (done) {",
  ],
  [
    "日次: 前日分までを健全とみなす（対象日を1日戻す）",
    "const target = resolveTargetDate(now, def.targetTimeJst);",
    "const target = resolveTargetDate(new Date(now.getTime() - 86400000), def.targetTimeJst);",
  ],
  [
    "日次: 指定時刻より前の起動を、当日の起動と認める",
    "tick >= targetInstant - policy.dailyStartSkewMin * 60000;",
    "true;",
  ],
  [
    "読み取り失敗を「実行」にする（P0 の前のフェイルオープン）",
    /return skipUnconfirmed\(\s*"read_failed",\s*`Vercelの状態を読み取れない[^`]*`,?\s*\);/,
    'return finish({ skip: false, reason: "read_failed", message: "実行", retryable: false, results: [] });',
  ],
  [
    "タイムアウトを外す",
    "return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));",
    "clearTimeout(timer); return promise;",
  ],
  [
    "全ジョブでなく、1つでも健全ならスキップする",
    "if (unhealthy.length === 0) {",
    "if (unhealthy.length < results.length) {",
  ],
  [
    "変数が false でもDBを読む（既定でDBを読まない、を外す）",
    "if (!isTrue(env[varName])) {",
    "if (false) {",
  ],
  [
    "行なしを肩代わりにする（確かめられないのに叩く）",
    'return noTakeover(\n      "no_row",',
    'return takeover(\n      "no_row",',
  ],
  [
    "mode が live でないとき肩代わりする（人が止めた間に GitHub が取る）",
    'return noTakeover(\n      "mode_not_live",',
    'return takeover(\n      "mode_not_live",',
  ],
  [
    "待機の上限を外す（常に retryable）",
    "sinceTargetMin >= 0 &&\n      sinceTargetMin < policy.dailyWaitGraceMin;",
    "true;",
  ],
];

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
let failures = 0;
const record = (label, pass, detail = "") => {
  if (pass) {
    printOut(`✅ ${label}`);
  } else {
    failures++;
    printErr(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};

await suite(realGate, record);

// (i) CLI
{
  const out = path.join(MUTANT_DIR, "github-output");
  const run = async (argv, env) => {
    fs.writeFileSync(out, "");
    const logs = [];
    const orig = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    let skip;
    try {
      skip = await gateMain(argv, { GITHUB_OUTPUT: out, ...env });
    } finally {
      console.log = orig;
    }
    return { skip, output: fs.readFileSync(out, "utf8"), logs };
  };
  const r1 = await run(["SKIP_POINT_RANK_ON_GHA", "--wait"], {});
  record(
    "CLI: 変数が未設定 → skip=false を GITHUB_OUTPUT に書く（DBを読まない）",
    r1.skip === false && r1.output === "skip=false\n",
    show(r1),
  );
  const r2 = await run(["SKIP_POINT_RANK_ON_GHA"], {
    SKIP_POINT_RANK_ON_GHA: "true",
  });
  record(
    "CLI: 変数が true・認証情報なし → skip=true（DBを読めず、肩代わりの条件を確かめられない）",
    r2.skip === true && r2.output === "skip=true\n",
    show(r2),
  );
  const r3 = await run(["NOT_A_VAR"], {});
  const r4 = await run([], {});
  record(
    "CLI: 未知の変数・引数なし → skip=true（確かめられない）",
    r3.output === "skip=true\n" && r4.output === "skip=true\n",
  );
  const r5 = await gateMain(["SKIP_POINT_RANK_ON_GHA"], {
    SKIP_POINT_RANK_ON_GHA: "true",
    GITHUB_OUTPUT: path.join(MUTANT_DIR, "no-such-dir", "x"),
  });
  record(
    "CLI: GITHUB_OUTPUT に書けなくても、例外にせず判定を返す（認証情報なしのため skip=true）",
    r5 === true,
  );
}

// (j) 配線
{
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const vercel = JSON.parse(read("vercel.json"));
  const targets = realGate.GHA_SKIP_TARGETS;
  record(
    "配線: 対象の全ジョブが、レジストリの窓型・日次ジョブ（判定できる種類）",
    Object.values(targets)
      .flat()
      .every((j) => ["window", "daily"].includes(SCRAPE_JOBS[j]?.kind)),
  );
  record(
    "配線: 予測リフレッシュ（SKIP_ODDS_REFRESH_ON_GHA）は対象外（DBのジョブ状態で判定できない）。レース情報・展示・朝の初期化（races_init）は対象。展示の従来の経路の例外（LEGACY_PATH_JOBS）は無い",
    !("SKIP_ODDS_REFRESH_ON_GHA" in targets) &&
      show(targets.SKIP_RACE_INFO_ON_GHA) === show(["race_info"]) &&
      show(targets.SKIP_EXHIBITION_ON_GHA) === show(["exhibition"]) &&
      show(targets.SKIP_MORNING_INIT_ON_GHA) === show(["races_init"]) &&
      !("LEGACY_PATH_JOBS" in realGate),
  );
  // 日次ワークフロー: gate ジョブ・変数・ジョブ名の対応
  const wf = {
    "scrape-point-rank.yml": "SKIP_POINT_RANK_ON_GHA",
    "scrape-venue-entry-course-stats.yml": "SKIP_ENTRY_COURSE_ON_GHA",
    "scrape-venue-motor-stats.yml": "SKIP_MOTOR_STATS_ON_GHA",
    "collect-racer-news.yml": "SKIP_RACER_NEWS_ON_GHA",
    "scrape-racer-season-stats.yml": "SKIP_RACER_SEASON_ON_GHA",
  };
  let wfOk = true;
  const wfDetail = [];
  for (const [file, varName] of Object.entries(wf)) {
    const yml = read(`.github/workflows/${file}`);
    const ok =
      varName in targets &&
      yml.includes(`if: \${{ vars.${varName} == 'true' }}`) &&
      yml.includes(
        `run: node scripts/maintenance/gha-skip-gate.js ${varName} --wait`,
      ) &&
      yml.includes("skip: ${{ steps.gate.outputs.skip }}") &&
      yml.includes("needs: gate") &&
      yml.includes(
        "if: ${{ !cancelled() && needs.gate.outputs.skip != 'true' }}",
      ) &&
      /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/.test(
        yml.split("Check whether Vercel handles this job")[1] ?? "",
      ) &&
      /SUPABASE_SERVICE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/.test(
        yml.split("Check whether Vercel handles this job")[1] ?? "",
      ) &&
      /steps:\s+- uses: actions\/checkout@v4\s+- uses: actions\/setup-node@v4\s+with:\s+(?:node-version: '22'|node-version-file: \.nvmrc)\s+- name: Check whether Vercel handles this job\s+id: gate\s+continue-on-error: true/.test(
        yml,
      ) &&
      !yml.includes(`vars.${varName} != 'true'`);
    if (!ok) {
      wfOk = false;
      wfDetail.push(file);
    }
  }
  record(
    "配線: 日次5ワークフロー: 変数が true のときだけ gate（checkout・node・判定。npm ci なし・continue-on-error）が動き、取得ジョブは、未設定・false・gateの失敗でも実行、gateがスキップと判定したときだけ止まる",
    wfOk,
    show(wfDetail),
  );
  const sched = read("scripts/daily/scrape-scheduled.js");
  record(
    "配線: scrape-scheduled.js は、SKIP変数がtrueかを先に確認してから（&&の左）Vercelの健全性を確認する（オッズ・結果・Kファイル・レース情報・展示）",
    /import \{ isGhaFetchStopped, shouldSkipOnGha \} from "\.\.\/lib\/ghaSkipGate\.js";/.test(
      sched,
    ) &&
      /isOddsSkippedOnGha\(\) && \(!oddsDue \|\| \(await gateSkips\("SKIP_ODDS_ON_GHA"\)\)\)/.test(
        sched,
      ) &&
      /process\.env\.SKIP_RESULTS_ON_GHA === "true" &&\s*\(!resultsDue/.test(
        sched,
      ) &&
      /process\.env\.SKIP_KFILE_ON_GHA === "true" &&\s*\(!resultsDue/.test(
        sched,
      ) &&
      /process\.env\.SKIP_RACE_INFO_ON_GHA === "true" &&\s*\(!raceInfoDue/.test(
        sched,
      ) &&
      /process\.env\.SKIP_EXHIBITION_ON_GHA === "true" &&\s*\(!exhibitionDue/.test(
        sched,
      ) &&
      !/SKIP_ODDS_REFRESH_ON_GHA"\)/.test(sched),
  );
  const cronOf = (p) =>
    vercel.crons.filter((c) => c.path === p).map((c) => c.schedule);
  record(
    "配線: 窓型ジョブ（odds・result）のVercel Cronは毎分。tick（5分に1回書く）が、運用窓の中で12分以内に更新される前提が成り立つ",
    cronOf("/api/cron/odds").every((s) => s.startsWith("* ")) &&
      cronOf("/api/cron/result").every((s) => s.startsWith("* ")) &&
      realGate.GHA_SKIP_POLICY.tickMaxAgeMin === 12,
    show(cronOf("/api/cron/odds")),
  );
}

// (k) 変異検証
{
  const mutantResults = [];
  for (const [name, replace, by] of MUTANTS) {
    let killed = false;
    let mutantLoadError = "";
    try {
      const mod = await loadMutant(`m${mutantResults.length}`, replace, by);
      let failed = 0;
      try {
        // 変異により、応答しないDBを待ち続ける（タイムアウトの欠落）場合も、検出として扱う
        let timer;
        await Promise.race([
          suite(mod, (_label, pass) => {
            if (!pass) failed++;
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("suite が終わらない")),
              8000,
            );
          }),
        ]).finally(() => clearTimeout(timer));
      } catch {
        failed++; // 変異したモジュールが例外を投げた場合も、検出とみなす
      }
      killed = failed > 0;
    } catch (error) {
      mutantLoadError = error.message;
    }
    mutantResults.push([name, killed, mutantLoadError]);
  }
  for (const [name, killed, loadError] of mutantResults) {
    record(
      `変異検証: 「${name}」を入れたコピーで、この検証が失敗する（検出できる）`,
      killed,
      loadError || "検出されなかった",
    );
  }
}

fs.rmSync(MUTANT_DIR, { recursive: true, force: true });

if (failures > 0) {
  printErr(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
printOut("\nALL PASS");
