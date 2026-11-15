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
// 存在充足率の指標・分母の定義・集計SQLは、汎用の日次監視（scripts/lib/dataHealth/）と共有する（二重実装しない）
import {
  COVERAGE_METRICS,
  ODDS_FULL_GRID_SINCE,
} from "../lib/dataHealth/coverageSpec.js";
// 想定内の未公開（朝の最初のレースの、発走60分前のオッズ）の定義は、監視（scripts/lib/scrapeJobs/monitor.js）と共有する（BOA-386）
import {
  DETECTION_LAG,
  classifyExpectedUnpublished,
  summarizeDetectionLags,
} from "../lib/scrapeJobs/expectedUnpublished.js";
import { collectAlerts } from "./dataHealthReportAlerts.js";
import {
  COVERAGE_DAYS,
  COVERAGE_THRESHOLD,
  EXPECTED_UNPUBLISHED_MINUTES,
  KNOWN_INCIDENTS,
  LATER_WINDOW_MINUTES,
  TIMING_TABLES,
  WINDOW_DAYS,
  WINDOW_MINUTES,
  WINDOW_THRESHOLD,
  isApplicableDay,
  metricDenominator,
  rate,
  weekdayOf,
} from "./dataHealthReportConfig.js";
import { renderMarkdown } from "./dataHealthReportMarkdown.js";
import { buildQueries } from "./dataHealthReportQueries.js";

// 公開の名前は変えない（verify-data-health-report.js・verify-data-health-job.js が読む）
export { buildQueries };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, "../..");
dotenv.config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 行が「最初に」保存された時刻を created_at が表すテーブル（マイグレーション071、WS2）。
// created_at は INSERT 時の DEFAULT now() で、UPSERTの更新では触られないため、初回の取得時刻になる。
// 他のテーブルの created_at は、この保証が無い（または別の意味の列）ため、従来どおり「弱い」列として扱う
const FIRST_SAVED_TIMING_TABLES = new Set([
  "exhibition_data",
  "race_entries",
  "race_start_timings",
]);
// 取得時刻の分布を出す対象。minutes は「発走m分前までに保存されたレースの割合」を出す基準時刻。
// exhibition_data は展示取得の窓（30/15/10分前）と体重だけの窓（60分前。BOA-500）、race_entries は出走表更新の窓（60分前）。
// BOA-500 以降、exhibition_data の最初の保存は発走60分前の体重だけの行になるため、展示の取得時刻は「値が揃った時刻」で見る。
// race_start_timings は発走後に保存されるため、基準時刻は無い（発走後に保存された割合のみ）
const SCRAPED_TIMESTAMP_TABLES = [
  { table: "exhibition_data", minutes: [60, 30, 15, 10], hasValueFilled: true },
  { table: "race_entries", minutes: [60], hasValueFilled: false },
  { table: "race_start_timings", minutes: [], hasValueFilled: false },
];
// 実際の取得（スクレイピング・予測生成・確定）時刻を表す列
const STRONG_TIMING_COLUMN =
  /^(scraped_at|scraped_date|captured_at|predicted_at|result_at|last_checked_at|fetched_at)$/;
// 行の作成・更新時刻。upsertで上書きされうる/初回挿入時刻のみのため、取得時刻としては弱い
const WEAK_TIMING_COLUMN = /^(created_at|updated_at)$/;

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

// ---------------------------------------------------------------------------
// SQL（日付はDATE_PATTERN検証済みの文字列のみ埋め込む）
// ---------------------------------------------------------------------------

/**
 * 取得時刻（created_at）の分布のクエリ（テーブルごとに1本、サーバー側集計）。
 * 「発走時刻 − 行が最初に保存された時刻」（分。発走前に保存されていれば正、発走後なら負）を、
 * レースごとに1値（そのレースの行のうち最も早い created_at）で出し、created_at が非NULLのレースだけを
 * 分母にする（マイグレーション071より前に保存された行はNULLで、含めない）。
 * 期間は窓内取得率と同じ直近7日。主キー（race_id）の範囲検索のみ（Disk IO予算への配慮）。
 *
 * @param {{table: string, minutes: number[], hasValueFilled: boolean}} spec
 */
export function buildScrapedTimestampQuery(
  { table, minutes, hasValueFilled },
  { windowStart, endDate },
) {
  const endExclusive = addDaysToDateString(endDate, 1);
  const hits = minutes
    .map((m) => `count(*) filter (where lead_min >= ${m}) as hit_${m}`)
    .join(",\n    ");
  const percentiles = (col) =>
    [10, 50, 90]
      .map(
        (q) =>
          `percentile_cont(${q / 100}) within group (order by ${col}) as ${col}_p${q}`,
      )
      .join(",\n    ");
  return `
with base as (
  select r.race_id,
      (r.race_date::timestamp + r.start_time) at time zone 'Asia/Tokyo' as dl
  from races r
  where r.race_date between '${windowStart}' and '${endDate}'
    and r.start_time is not null
    and r.cancellation_status is distinct from 'confirmed'
), t as (
  select x.race_id, count(*) as rows_total,
      -- マイグレーション071より前の行（created_atがNULL）が混ざるレースは、最も早い保存時刻を
      -- 特定できないため除く（NULLを無視すると、後から保存された行の時刻を初回と誤る）
      case when count(x.created_at) = count(*) then min(x.created_at) end as first_created_at${
        hasValueFilled
          ? `,
      -- 展示タイムが入っている行の updated_at の最大値＝展示タイムが揃った時刻の上限の近似
      -- （値が変わった最後の時刻。展示タイム以外の列が後から変わると、その分だけ遅く出る）
      case when count(x.created_at) = count(*)
          then max(x.updated_at) filter (where x.exhibition_time is not null) end as value_filled_at`
          : ""
      }
  from ${table} x
  where x.race_id >= '${windowStart}' and x.race_id < '${endExclusive}'
  group by x.race_id
), l as (
  select t.rows_total,
      (extract(epoch from (b.dl - t.first_created_at)) / 60.0)::float8 as lead_min${
        hasValueFilled
          ? `,
      (extract(epoch from (b.dl - t.value_filled_at)) / 60.0)::float8 as filled_lead_min`
          : ""
      }
  from base b left join t on t.race_id = b.race_id
)
select
    count(*) as races_in_period,
    count(rows_total) as races_with_rows,
    count(lead_min) as races_with_created_at,
    count(*) filter (where lead_min < 0) as saved_after_start,
    ${percentiles("lead_min")}${hits ? `,\n    ${hits}` : ""}${
      hasValueFilled
        ? `,
    count(filled_lead_min) as races_with_value_filled,
    ${percentiles("filled_lead_min")}`
        : ""
    }
from l`;
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
// 集計（純粋関数）
// ---------------------------------------------------------------------------

const isWeekend = (dateStr) => ["土", "日"].includes(weekdayOf(dateStr));

const datesFrom = (start, days) =>
  Array.from({ length: days }, (_, i) => addDaysToDateString(start, i));

const sum = (rows, key) => rows.reduce((acc, r) => acc + Number(r[key]), 0);
// 列が無い行（--cache-file の、この列を追加する前のキャッシュ）は0として数える
const sumOrZero = (rows, key) =>
  rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

export function summarizeCoverage(perDay) {
  const excluded = sum(perDay, "excluded");
  return COVERAGE_METRICS.map((metric) => {
    const { key, label } = metric;
    const applicable = perDay.filter((d) => isApplicableDay(metric, d.d));
    const numerator = sum(applicable, key);
    const denominator = applicable.reduce(
      (acc, d) => acc + metricDenominator(metric, d),
      0,
    );
    const dayRates = applicable
      .filter((d) => metricDenominator(metric, d) > 0)
      .map((d) => ({
        date: d.d,
        rate: Number(d[key]) / metricDenominator(metric, d),
      }));
    const worst = dayRates.reduce(
      (min, cur) => (min === null || cur.rate < min.rate ? cur : min),
      null,
    );
    // 取得開始前で対象外の日（分母から外した日）。中止除外後のレース数で数える
    const notApplicableDays = perDay.filter(
      (d) => !isApplicableDay(metric, d.d),
    );
    const notApplicableRaces = sum(notApplicableDays, "denom");
    const value = rate(numerator, denominator);
    return {
      metric: key,
      label,
      numerator,
      denominator,
      excluded,
      rate: value,
      since: metric.since ?? null,
      notApplicableDays: notApplicableDays.length,
      notApplicableRaces,
      // 分母0（データが1件も無い）は最悪の状態なので、達成扱いにせず未達として扱う。
      // ただし期間の全日が取得開始前で対象外の場合は、対象が無いだけで欠損ではない
      belowThreshold:
        value === null
          ? !(notApplicableRaces > 0 && applicable.length === 0)
          : value < COVERAGE_THRESHOLD,
      daysBelowThreshold: dayRates.filter((d) => d.rate < COVERAGE_THRESHOLD)
        .length,
      worstDay: worst,
    };
  });
}

/**
 * rank4〜6の判定の内訳（BOA-381）。分母に入れなかったレースの件数を、欠損に混ぜず別に出す。
 * lowerBoundRate は、判定不能を全て欠損とみなした場合の充足率（下限）
 */
export function summarizeRankDetail(perDay) {
  const determined = sum(perDay, "rank_determined");
  const full = sum(perDay, "rank_full");
  const numerator = sum(perDay, "rank4_6");
  const undetermined = sum(perDay, "rank_undetermined");
  const denominator = sum(perDay, "rank_denom");
  return {
    denominator,
    numerator,
    // 完走艇数を確定できたレース（艇別の着欄から）／確定できないがrank4〜6がそろっているレース
    determinedRaces: determined,
    fullRaces: full,
    // 分母外
    undeterminedRaces: undetermined,
    undeterminedAbsentHintRaces: sum(perDay, "rank_undetermined_absent_hint"),
    finishersAtMost3Races: sum(perDay, "rank_le3"),
    noResultRaces: sum(perDay, "rank_no_result"),
    lowerBoundRate: rate(numerator, denominator + undetermined),
    // 参考（BOA-362）: 順位に非完走艇が入っているレース
    pollutedConfirmedRaces: sum(perDay, "rank_polluted_confirmed"),
    absentSuspectRaces: sum(perDay, "rank_absent_suspect"),
    // 変更前の定義（中止除外後の全レースを分母に、rank4・5・6がすべてある）。比較用
    legacyDefinition: {
      numerator: sum(perDay, "rank4_6_all_present"),
      denominator: sum(perDay, "denom"),
      rate: rate(sum(perDay, "rank4_6_all_present"), sum(perDay, "denom")),
    },
  };
}

export function summarizeWindows(
  rows,
  { onlyDates = null, weekendFilter = null } = {},
) {
  const filtered = rows.filter(
    (r) =>
      (onlyDates === null || onlyDates.includes(r.d)) &&
      (weekendFilter === null || isWeekend(r.d) === weekendFilter),
  );
  return WINDOW_MINUTES.map((m) => {
    const ofWindow = filtered.filter((r) => Number(r.m) === m);
    const races = sum(ofWindow, "races");
    const inWindow = sum(ofWindow, "in_window");
    const value = rate(inWindow, races);
    // 既知の障害期間と窓が重なる(レース,窓)を除いた値
    const racesClean = sum(ofWindow, "races_clean");
    const inWindowClean = sum(ofWindow, "in_window_clean");
    // 想定内の未公開（第1レースの-60分窓で、後続の窓で公開が確認できたもの。定義は expectedUnpublished.js）を分母から外した値。
    // 外した件数は structural に別に残す（黙って除外しない）。閾値の判定は、この値で行う
    const structural = sumOrZero(ofWindow, "structural");
    const racesAdjusted = races - structural;
    const rateAdjusted = rate(inWindow, racesAdjusted);
    return {
      minutesBefore: m,
      races,
      inWindow,
      rate: value,
      structural,
      racesAdjusted,
      rateAdjusted,
      firstRace: sumOrZero(ofWindow, "first_race"),
      firstRaceInWindow: sumOrZero(ofWindow, "first_race_in_window"),
      belowThreshold: rateAdjusted === null || rateAdjusted < WINDOW_THRESHOLD,
      excludedRaces: races - racesClean,
      racesClean,
      inWindowClean,
      rateClean: rate(inWindowClean, racesClean),
    };
  });
}

/** 監視と同じ confirmed のスロットを計測し、既存の集計行の形式へ変換する。 */
function summarizeDetectionLagSlots(slots) {
  const classified = classifyExpectedUnpublished(slots, {
    siblingSlots: slots,
  });
  const lag = summarizeDetectionLags(slots, classified, slots);
  if (lag.total === 0) return null;
  return summarizeDetectionLagRow({
    total: lag.total,
    measured: lag.measured,
    unmeasured: lag.unmeasured,
    within_threshold: lag.within,
    p50_min: lag.p50Min,
    p95_min: lag.p95Min,
    max_min: lag.maxMin,
  });
}

/**
 * 発売開始の検知の遅れ（想定内の未公開のレースだけを対象）の集計行を、レポート用の値にする。
 * 監視と共通の計測結果を集計行の形で受け取る。row が無い・
 * 対象が0件なら null を返す（無理に0で埋めない）
 */
export function summarizeDetectionLagRow(row) {
  if (!row) return null;
  const total = Number(row.total);
  const measured = Number(row.measured);
  return {
    total,
    measured,
    unmeasured: Number(row.unmeasured),
    within: Number(row.within_threshold),
    over: measured - Number(row.within_threshold),
    rate: measured > 0 ? Number(row.within_threshold) / measured : null,
    p50Min: round1(toNumberOrNull(row.p50_min)),
    p95Min: round1(toNumberOrNull(row.p95_min)),
    maxMin: round1(toNumberOrNull(row.max_min)),
    belowThreshold:
      measured > 0 &&
      Number(row.within_threshold) / measured < DETECTION_LAG.rate,
  };
}

/** 取得時刻列の有無を、テーブル別に「計測可 / 弱(created_at等のみ) / 計測不能」に分類する */
function classifyTimingColumns(columnRows, existingTables) {
  const existing = new Set(existingTables.map((r) => r.table_name));
  return TIMING_TABLES.map((table) => {
    if (!existing.has(table)) {
      return {
        table,
        exists: false,
        columns: [],
        quality: "table_missing",
        unmeasurable: true,
      };
    }
    const columns = columnRows
      .filter((r) => r.table_name === table)
      .map((r) => r.column_name);
    const strong = columns.filter(
      (c) =>
        STRONG_TIMING_COLUMN.test(c) ||
        (c === "created_at" && FIRST_SAVED_TIMING_TABLES.has(table)),
    );
    const weak = columns.filter((c) => WEAK_TIMING_COLUMN.test(c));
    const quality =
      strong.length > 0 ? "measurable" : weak.length > 0 ? "weak" : "none";
    return {
      table,
      exists: true,
      columns,
      strongColumns: strong,
      quality,
      // 取得時刻列が無い、または行の作成/更新時刻しか無い場合はタイミングを計測できない
      unmeasurable: quality !== "measurable",
    };
  });
}

function summarizeMonthly(rows) {
  return rows.map((r) => {
    const denom = Number(r.denom);
    const total = Number(r.total);
    const withResult = Number(r.with_result);
    return {
      month: r.month,
      days: Number(r.days),
      total,
      excluded: Number(r.excluded),
      denominator: denom,
      withResult,
      rateAll: rate(withResult, total),
      rateExcludingCancelled: rate(withResult, denom),
      noResultRow: Number(r.no_result_row),
      rowWithoutRank1: Number(r.row_without_rank1),
      zeroResultDays: Number(r.zero_result_days),
      partialDays: Number(r.partial_days),
      belowThreshold:
        rate(withResult, denom) === null ||
        rate(withResult, denom) < COVERAGE_THRESHOLD,
    };
  });
}

function summarizeFreshness(rows) {
  return rows.map((r) => ({
    table: r.t,
    count: Number(r.n),
    latestTime: r.latest_time,
    latestDate: r.latest_date,
    empty: Number(r.n) === 0,
  }));
}

const toNumberOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);
const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

/**
 * 取得時刻の分布のクエリ結果を、レポート用の値にする（純粋関数）。
 * 分母は created_at が非NULLのレース（マイグレーション071より前の行はNULLで含まれない）
 */
export function summarizeScrapedTimestamp(spec, row) {
  const denominator = Number(row.races_with_created_at);
  const distribution = (key) => ({
    p10: round1(toNumberOrNull(row[`${key}_p10`])),
    p50: round1(toNumberOrNull(row[`${key}_p50`])),
    p90: round1(toNumberOrNull(row[`${key}_p90`])),
  });
  return {
    table: spec.table,
    applied: true,
    racesInPeriod: Number(row.races_in_period),
    racesWithRows: Number(row.races_with_rows),
    racesWithCreatedAt: denominator,
    savedAfterStart: Number(row.saved_after_start),
    // 発走の何分前に保存されたか（分。正=発走前、負=発走後）
    leadMinutes: distribution("lead_min"),
    // 発走m分前までに（窓の中心より前に）保存されていたレースの割合（累積）
    savedBy: spec.minutes.map((m) => ({
      minutesBefore: m,
      hit: Number(row[`hit_${m}`]),
      denominator,
      rate: rate(Number(row[`hit_${m}`]), denominator),
    })),
    valueFilled: spec.hasValueFilled
      ? {
          races: Number(row.races_with_value_filled),
          leadMinutes: distribution("filled_lead_min"),
        }
      : null,
  };
}

/**
 * 取得時刻（created_at・updated_at）の分布を集める。列が無い（マイグレーション071が未適用の）
 * テーブルは、クエリを発行せず「未適用のため計測不能」とする。
 * 計測に失敗しても、レポート全体は失敗させない（エラーを結果に残す）。
 *
 * @param {{timingColumns: Array<{table_name: string, column_name: string}>,
 *   windowStart: string, endDate: string,
 *   fetch: (queries: Record<string, string>) => Promise<Record<string, Object[]>>}} args
 */
export async function collectScrapedTimestamps({
  timingColumns,
  windowStart,
  endDate,
  fetch,
}) {
  const hasColumns = (table) =>
    ["created_at", "updated_at"].every((column) =>
      timingColumns.some(
        (r) => r.table_name === table && r.column_name === column,
      ),
    );
  const specs = SCRAPED_TIMESTAMP_TABLES.map((spec) => ({
    spec,
    applied: hasColumns(spec.table),
  }));
  const appliedSpecs = specs.filter((s) => s.applied).map((s) => s.spec);
  const unmeasured = (spec) => ({
    table: spec.table,
    applied: false,
    reason:
      "created_at・updated_at 列が無いため計測不能（マイグレーション071が未適用）",
  });
  if (appliedSpecs.length === 0) {
    return {
      period: { start: windowStart, end: endDate },
      error: null,
      tables: specs.map((s) => unmeasured(s.spec)),
    };
  }
  try {
    const queries = Object.fromEntries(
      appliedSpecs.map((spec) => [
        `scraped_${spec.table}`,
        buildScrapedTimestampQuery(spec, { windowStart, endDate }),
      ]),
    );
    const raw = await fetch(queries);
    return {
      period: { start: windowStart, end: endDate },
      error: null,
      tables: specs.map(({ spec, applied }) =>
        applied
          ? summarizeScrapedTimestamp(spec, raw[`scraped_${spec.table}`][0])
          : unmeasured(spec),
      ),
    };
  } catch (error) {
    return {
      period: { start: windowStart, end: endDate },
      error: `取得時刻の計測に失敗（他の指標は影響なし）: ${error.message}`,
      tables: specs.map((s) => unmeasured(s.spec)),
    };
  }
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

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function buildReportParams({
  runDate,
  coverageStart,
  windowStart,
  endDate,
  windowDates,
}) {
  return {
    reportDate: runDate,
    thresholds: { coverage: COVERAGE_THRESHOLD, window: WINDOW_THRESHOLD },
    coverage: {
      start: coverageStart,
      end: endDate,
      days: COVERAGE_DAYS,
    },
    windows: {
      start: windowStart,
      end: endDate,
      days: WINDOW_DAYS,
      weekendDays: windowDates.filter(isWeekend).length,
      minutesBefore: WINDOW_MINUTES,
    },
    denominatorRule: "races.cancellation_status='confirmed' を除外",
    // 指標ごとの分母の定義（BOA-381）
    metricDenominators: {
      rank4_6:
        "艇別の着欄(race_start_timings.finish_mark)が6艇分そろい、完走艇数が4以上のレース＋着欄を確定できないがrank4〜6がそろっているレース。着欄を確定できずrank4〜6に欠けがあるレースは判定不能（分母外）、完走3艇以下・結果なしも分母外",
      windowExpectedUnpublished: `窓内取得率（発走${EXPECTED_UNPUBLISHED_MINUTES}分前）は、各会場・日の第1レース（races の最小のレース番号）が窓内に取れておらず、後続の窓（${LATER_WINDOW_MINUTES.join("・")}分前）のどれかに取れているもの（後で公開された。想定内の未公開）を、閾値判定の分母から外す。外した件数と、除外なしの値も併記する`,
      oddsFullGrid: `trio_all・exacta_all・quinella_all・wide_all と、5種すべて(odds_all)は、${ODDS_FULL_GRID_SINCE}以降のレースのみを分母にする（全通り取得の開始日。それ以前は対象外）。trifecta_all は取得開始前の対象外を設けない（2026-07-12以降に保存がある）`,
    },
    oddsFullGridSince: ODDS_FULL_GRID_SINCE,
    knownIncidents: KNOWN_INCIDENTS,
  };
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

/** レポートのJSONを保存し、そのパスを返す */
function writeReportJson(report, opts, runDate) {
  fs.mkdirSync(opts.outDir, { recursive: true });
  // 既定の集計期間（昨日まで）以外、またはGitHub Actions確認を省略した実行は、
  // 当日のベースラインJSONを上書きしない（内容が欠けた/別期間のJSONで置き換わるのを防ぐ）
  const fileSuffix = [
    opts.endDate === opts.defaultEndDate ? "" : `_end-${opts.endDate}`,
    opts.skipGh ? "_skip-gh" : "",
  ].join("");
  const jsonPath = path.join(opts.outDir, `${runDate}${fileSuffix}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  return jsonPath;
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
