#!/usr/bin/env node
/**
 * データ健全性の実測レポート（WS1、docs/design/scraping-vercel-consolidation/orchestration.md）
 *
 * 本番DBを読み取り専用で実測し、データ取得の「完了の定義」（.claude/rules/data-acquisition.md）の
 * A（存在充足率）・B（窓内取得率）を判定するための指標を出力する。
 *
 * 出力:
 *   - 標準出力: 日本語Markdownの要約（閾値を下回る項目を先頭に列挙）
 *   - data/analysis/data-health/YYYY-MM-DD.json: 機械可読な結果（同日再実行は上書き）
 *
 * 存在充足率の分母の定義（BOA-381）:
 *   - rank4〜6: 失格・欠場・転覆等で6艇が完走しないレースは、公式が最後の順位を付けない（欠損ではない）。
 *     艇別の着欄（race_start_timings.finish_mark）で完走艇数を確定できるレースは、完走艇数まで順位が
 *     付いているかで判定する。確定できずrank4〜6に欠けがあるレースは「判定不能」として分母外に件数を出す
 *   - 全券種オッズ（trio・exacta・quinella・wide、5種すべて）: 全通り取得の開始日（2026-09-17）以降のみが
 *     期待件数の対象。それ以前の日は「対象外(取得開始前)」として分母から外す。trifecta_all は対象外を設けない
 *
 * 使い方:
 *   node scripts/analysis/data-health-report.js [--end-date YYYY-MM-DD] [--skip-gh]
 *        [--cache-file <path>] [--compare-dates YYYY-MM-DD,YYYY-MM-DD] [--out-dir <dir>]
 *
 *   --end-date       集計期間の最終日（既定: 昨日JST。当日は結果が未確定のため含めない）
 *   --cache-file     DBの生結果のキャッシュ（クエリごとにSQLのハッシュで照合。SQLや期間が変わったクエリは再実行する）
 *   --compare-dates  窓内取得率を、指定日だけで再集計して併記する（過去の実測値との突合用）
 *   --skip-gh        GitHub Actions（gh CLI）の鮮度確認を省略する
 *
 * SQLの実行方法: Supabase Management API の read-only エンドポイントを使う。
 * 理由: information_schema・pg_total_relation_size 等のカタログ参照が必要で supabase-js
 * （PostgREST）では発行できないこと、read-only エンドポイントにより書き込みが構造的に不可能に
 * なることの2点。環境変数: SUPABASE_URL, SUPABASE_ACCESS_TOKEN。
 *
 * Disk IO予算（BOA-357）への配慮: 全てサーバー側集計、クエリは逐次実行（並列にしない）、
 * 期間は日別14日・窓内7日・月別のみ全期間（GROUP BY 1本）。race_odds等の全件走査はしない。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import {
  addDaysToDateString,
  getTodayDateJST,
  getYesterdayDateJST,
} from "../lib/dateUtils.js";
import { collectAlerts } from "./dataHealthReportAlerts.js";
import { COVERAGE_DAYS, WINDOW_DAYS } from "./dataHealthReportConfig.js";
import { renderMarkdown } from "./dataHealthReportMarkdown.js";
import { buildQueries } from "./dataHealthReportQueries.js";
import { collectScrapedTimestamps } from "./dataHealthReportScraped.js";
import {
  datesFrom,
  summarizeCoverage,
  summarizeRankDetail,
  summarizeWindows,
  summarizeDetectionLagSlots,
  classifyTimingColumns,
  summarizeMonthly,
  summarizeFreshness,
  buildReportParams,
  writeReportJson,
} from "./dataHealthReportSummaries.js";

// 公開の名前は変えない（verify-data-health-report.js・verify-data-health-job.js が読む）
export { buildQueries };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "../..");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 引数・SQL実行
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    endDate: getYesterdayDateJST(),
    defaultEndDate: getYesterdayDateJST(),
    skipGh: false,
    cacheFile: null,
    compareDates: [],
    outDir: path.join(REPO_ROOT, "data/analysis/data-health"),
  };
  const takeValue = (i, name) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} には値が必要です`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-gh") opts.skipGh = true;
    else if (arg === "--end-date") opts.endDate = takeValue(i++, arg);
    else if (arg === "--cache-file") opts.cacheFile = takeValue(i++, arg);
    else if (arg === "--out-dir") opts.outDir = takeValue(i++, arg);
    else if (arg === "--compare-dates")
      opts.compareDates = takeValue(i++, arg).split(",").filter(Boolean);
    else throw new Error(`未知の引数: ${arg}`);
  }
  for (const d of [opts.endDate, ...opts.compareDates]) {
    if (!DATE_PATTERN.test(d ?? ""))
      throw new Error(`日付はYYYY-MM-DD形式で指定してください: ${d}`);
  }
  return opts;
}

/** Management APIのread-onlyエンドポイントでSQLを1本実行する */
async function runSql(query) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!accessToken || !supabaseUrl) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN と SUPABASE_URL が必要です（.env.local を確認）",
    );
  }
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `SQL実行に失敗 (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  return JSON.parse(body);
}

const RETRY_LIMIT = 2;
const RETRY_WAIT_MS = 20000;

/** 接続タイムアウト等、クエリ実行前の一時的な失敗のみ待ってから再試行する。それ以外は即失敗 */
async function runSqlWithRetry(query) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runSql(query);
    } catch (error) {
      // 接続確立前の失敗のみ再試行する。statement timeout等はクエリ自体が重い/DBが逼迫している
      // 状態のため、同じクエリを再発行して負荷を上乗せしない
      const transient =
        /HTTP 5\d\d/.test(error.message) &&
        /connection timeout|ECONNRESET|fetch failed/i.test(error.message) &&
        !/statement timeout/i.test(error.message);
      if (!transient || attempt >= RETRY_LIMIT) throw error;
      console.error(
        `  一時的な失敗のため${RETRY_WAIT_MS / 1000}秒後に再試行: ${error.message.slice(0, 120)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
    }
  }
}

/** クエリを逐次実行する（並列化しない）。cacheFileがあれば再利用・保存する */
const UNCACHED_QUERIES = new Set(["timingColumns", "tableExistence"]);
const hashSql = (sql) => createHash("sha256").update(sql).digest("hex");

/**
 * クエリを逐次実行する（並列化しない）。
 * キャッシュはクエリごとに「SQL文字列のハッシュ」で照合する。期間やSQLが変わったクエリは
 * 古い結果を再利用せず、再実行する（別期間のキャッシュで別期間のラベルを付ける事故を防ぐ）
 */
async function fetchRaw(queries, cacheFile) {
  const cache =
    cacheFile && fs.existsSync(cacheFile)
      ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
      : {};
  const raw = {};
  for (const [name, sql] of Object.entries(queries)) {
    const hash = hashSql(sql);
    // スキーマ（列・テーブルの有無）は、マイグレーション適用後に変わるためキャッシュしない
    // （古いキャッシュで「未適用」と判定し続けるのを防ぐ。カタログ参照のみで軽い）
    if (!UNCACHED_QUERIES.has(name) && cache[name]?.hash === hash) {
      const { savedAt } = cache[name];
      const age = savedAt
        ? `${Math.round((Date.now() - new Date(savedAt).getTime()) / 60000)}分経過`
        : "経過時間不明";
      console.error(`  query ${name}: キャッシュ使用（DB非接続、${age}）`);
      raw[name] = cache[name].rows;
      continue;
    }
    const startedAt = Date.now();
    const rows = await runSqlWithRetry(sql);
    raw[name] = rows;
    cache[name] = { hash, rows, savedAt: new Date().toISOString() };
    console.error(`  query ${name}: ${Date.now() - startedAt}ms`);
    // 途中で失敗しても取得済みの結果を再利用できるよう、1クエリごとに保存する
    if (cacheFile) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// GitHub Actions（gh CLI、任意）
// ---------------------------------------------------------------------------

function ghJson(args) {
  const out = execFileSync("gh", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

// ワークフローのcron式から、最終successの許容経過時間を推定する。
// 日(day-of-month)指定=月次相当(35日)、曜日指定=週次相当(8日)、分が「スラッシュN」形式で
// 1日に複数回実行=12時間、それ以外=日次相当(48時間)。複数のcronがある場合は最も厳しい値を採る。
// cronが無い（手動実行のみ）場合はnull（経過時間では判定しない）
function expectedMaxSuccessHours(workflowFile) {
  const yaml = fs.readFileSync(
    path.join(REPO_ROOT, ".github/workflows", workflowFile),
    "utf8",
  );
  const crons = [...yaml.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1].trim().split(/\s+/),
  );
  if (crons.length === 0) return null;
  const limitOf = ([minute, , dayOfMonth, , dayOfWeek]) => {
    if (dayOfMonth !== "*") return 24 * 35;
    if (dayOfWeek !== "*") return 24 * 8;
    return minute.startsWith("*/") ? 12 : 48;
  };
  return Math.min(...crons.map(limitOf));
}

const RECENT_RUNS_LIMIT = 30;

function collectWorkflowStatus(file, now) {
  try {
    const listArgs = (limit, extra = []) => [
      "run",
      "list",
      "--workflow",
      file,
      "--limit",
      String(limit),
      "--json",
      "createdAt,conclusion,status,url",
      ...extra,
    ];
    const recent = ghJson(listArgs(RECENT_RUNS_LIMIT));
    const last = recent[0];
    // `--status success` 単独では、実行頻度の高いワークフローで古い結果が返ることを実測で確認した
    // （同一ワークフローで呼び出しごとに最終successが数日単位でずれた）。
    // 直近N件の中のsuccessと突き合わせ、新しい方を採る
    const [filteredSuccess] = ghJson(listArgs(1, ["--status", "success"]));
    const recentSuccess = recent.find((r) => r.conclusion === "success");
    const lastSuccess = [filteredSuccess, recentSuccess]
      .filter(Boolean)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    const hoursSince = (iso) =>
      iso
        ? Math.round(((now - new Date(iso).getTime()) / 3600000) * 10) / 10
        : null;
    return {
      workflow: file,
      noRunHistory: last === undefined,
      lastRunAt: last?.createdAt ?? null,
      lastRunConclusion: last?.conclusion || last?.status || null,
      lastSuccessAt: lastSuccess?.createdAt ?? null,
      hoursSinceLastSuccess: hoursSince(lastSuccess?.createdAt),
      expectedMaxSuccessHours: expectedMaxSuccessHours(file),
    };
  } catch (error) {
    // 1ワークフローの取得失敗で、他のワークフローの結果まで捨てない
    return {
      workflow: file,
      error: String(error.message).split("\n")[0],
    };
  }
}

function collectWorkflowFreshness(now) {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
  } catch (error) {
    return {
      skipped: true,
      reason: `gh CLIが使えないためスキップ: ${String(error.message).split("\n")[0]}`,
      items: [],
    };
  }
  const items = fs
    .readdirSync(path.join(REPO_ROOT, ".github/workflows"))
    .filter((f) => /^scrape-.*\.ya?ml$/.test(f))
    .sort()
    .map((file) => collectWorkflowStatus(file, now));
  return { skipped: false, items };
}

function buildReport({
  opts,
  raw,
  scrapedTimestamps,
  runDate,
  coverageStart,
  windowStart,
  windowDates,
}) {
  const coverageDates = datesFrom(coverageStart, COVERAGE_DAYS);
  const compareRows = raw.windows.filter((r) =>
    opts.compareDates.includes(r.d),
  );
  return {
    generatedAt: new Date().toISOString(),
    params: buildReportParams({
      runDate,
      coverageStart,
      windowStart,
      endDate: opts.endDate,
      windowDates,
    }),
    coverage: {
      perDay: raw.coverage,
      aggregate: summarizeCoverage(raw.coverage),
      rankDetail: summarizeRankDetail(raw.coverage),
      missingDates: coverageDates.filter(
        (d) => !raw.coverage.some((r) => r.d === d),
      ),
    },
    windows: {
      perDay: raw.windows,
      missingDates: windowDates.filter(
        (d) => !raw.windows.some((r) => r.d === d),
      ),
      aggregate: summarizeWindows(raw.windows),
      weekday: summarizeWindows(raw.windows, { weekendFilter: false }),
      weekend: summarizeWindows(raw.windows, { weekendFilter: true }),
      compare:
        compareRows.length > 0
          ? {
              dates: opts.compareDates,
              aggregate: summarizeWindows(raw.windows, {
                onlyDates: opts.compareDates,
              }),
            }
          : null,
    },
    // 共通の summarizeDetectionLags は内部で detectionLagOf を使う（計測式を二重に書かない）。
    detectionLag: summarizeDetectionLagSlots(raw.detectionLag ?? []),
    timingColumns: classifyTimingColumns(raw.timingColumns, raw.tableExistence),
    scrapedTimestamps,
    monthlyResults: summarizeMonthly(raw.monthly),
    freshness: summarizeFreshness(raw.freshness),
    latest: raw.latest.map((r) => ({ key: r.k, value: r.v })),
    workflows: opts.skipGh
      ? { skipped: true, reason: "--skip-gh 指定", items: [] }
      : collectWorkflowFreshness(Date.now()),
    dbSize: {
      databaseBytes: Number(raw.dbSize[0].bytes),
      topTables: raw.tableSizes.map((r) => ({
        table: r.table_name,
        bytes: Number(r.bytes),
      })),
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const coverageStart = addDaysToDateString(opts.endDate, -(COVERAGE_DAYS - 1));
  const windowStart = addDaysToDateString(opts.endDate, -(WINDOW_DAYS - 1));
  const windowDates = datesFrom(windowStart, WINDOW_DAYS);
  // 窓内取得率の対象期間外の日付を黙って無視しない（比較したつもりで比較されない事故を防ぐ）
  const outOfWindow = opts.compareDates.filter((d) => !windowDates.includes(d));
  if (outOfWindow.length > 0) {
    throw new Error(
      `--compare-dates は窓内取得率の期間(${windowStart}〜${opts.endDate})内で指定してください: ${outOfWindow.join(", ")}`,
    );
  }
  // 日付の決定は1回だけ行う（JST日付をまたぐ実行でrunDateがずれるのを防ぐ）
  const runDate = getTodayDateJST();

  const queries = buildQueries({
    coverageStart,
    windowStart,
    endDate: opts.endDate,
  });
  const raw = await fetchRaw(queries, opts.cacheFile);

  // 取得時刻（created_at）の分布。列が無い（マイグレーション071が未適用の）テーブルはクエリを発行しない
  const scrapedTimestamps = await collectScrapedTimestamps({
    timingColumns: raw.timingColumns,
    windowStart,
    endDate: opts.endDate,
    fetch: (queries) => fetchRaw(queries, opts.cacheFile),
  });

  const report = buildReport({
    opts,
    raw,
    scrapedTimestamps,
    runDate,
    coverageStart,
    windowStart,
    windowDates,
  });
  report.alerts = collectAlerts(report);

  const jsonPath = writeReportJson(report, opts, runDate);

  console.log(renderMarkdown(report));
  console.error(`JSONを保存: ${path.relative(REPO_ROOT, jsonPath)}`);
}

// importされた場合（クエリ検証等）は実行しない。DBへの意図しない実行を防ぐ
if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error("data-health-report 実行中にエラー:", error.message);
    process.exit(1);
  });
}

export {
  buildScrapedTimestampQuery,
  summarizeScrapedTimestamp,
  collectScrapedTimestamps,
} from "./dataHealthReportScraped.js";

export {
  summarizeCoverage,
  summarizeRankDetail,
  summarizeWindows,
  summarizeDetectionLagRow,
} from "./dataHealthReportSummaries.js";
