import fs from "node:fs";
import path from "node:path";
import { addDaysToDateString } from "../lib/dateUtils.js";
import {
  COVERAGE_METRICS,
  ODDS_FULL_GRID_SINCE,
} from "../lib/dataHealth/coverageSpec.js";
import {
  DETECTION_LAG,
  classifyExpectedUnpublished,
  summarizeDetectionLags,
} from "../lib/scrapeJobs/expectedUnpublished.js";
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
import { toNumberOrNull, round1 } from "./dataHealthReportScraped.js";

// 行が「最初に」保存された時刻を created_at が表すテーブル（マイグレーション071、WS2）。
// created_at は INSERT 時の DEFAULT now() で、UPSERTの更新では触られないため、初回の取得時刻になる。
// 他のテーブルの created_at は、この保証が無い（または別の意味の列）ため、従来どおり「弱い」列として扱う
const FIRST_SAVED_TIMING_TABLES = new Set([
  "exhibition_data",
  "race_entries",
  "race_start_timings",
]);

// 実際の取得（スクレイピング・予測生成・確定）時刻を表す列
const STRONG_TIMING_COLUMN =
  /^(scraped_at|scraped_date|captured_at|predicted_at|result_at|last_checked_at|fetched_at)$/;
// 行の作成・更新時刻。upsertで上書きされうる/初回挿入時刻のみのため、取得時刻としては弱い
const WEAK_TIMING_COLUMN = /^(created_at|updated_at)$/;

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

export {
  datesFrom,
  summarizeDetectionLagSlots,
  classifyTimingColumns,
  summarizeMonthly,
  summarizeFreshness,
  buildReportParams,
  writeReportJson,
};
