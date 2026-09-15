/**
 * 選手「期別成績」ページ（公式集計値）の検算スクリプト
 *
 * BOA-321（docs/design/scraping-full-coverage/ FR-2）「自社集計値との検算」対応。
 * `.claude/rules/analysis.md`の「データ精度の検証」パターンに準拠し、
 * コードレビューとは別に集計ロジックの正しさだけを見る検証を行う。
 *
 * 【設計上の重要な訂正（実装時に判明）】
 * plan.md FR-2は当初「期別成績ページの値をracer_aggregated_statsの対応値と突き合わせる」
 * としていたが、racer_aggregated_stats（scripts/analysis/aggregate-racer-stats.js）には
 * 勝率・2連対率・3連対率・優出回数・優勝回数の列が存在せず、また total_races/flying_rate も
 * 選手の全期間（career-to-date）を対象にしており、公式ページの「集計期間（前期/後期、約6ヶ月）」
 * とは期間の粒度が異なるため、直接比較できないことが判明した（flying_rateはT3頻度の全期間集計、
 * 期別成績は特定の半年間のみ）。
 *
 * そのため本スクリプトは racer_aggregated_stats を経由せず、race_entries/race_results/
 * race_start_timings から**公式集計期間と同じ日付範囲**で直接再計算し、期別成績ページの値と
 * 突き合わせる（race_idが"YYYY-MM-DD-会場-レース番号"形式で日付を埋め込んでいるため、
 * racesテーブルへのJOINは不要）。
 *
 * 検証できない項目（本スクリプトの対象外、理由を明記）:
 *   - 優出回数・優勝回数: 大会（開催）単位の優勝戦到達・優勝の判定にはシリーズ/開催の構造が
 *     必要で、series_day（BOA-226）・今節成績（FR-3）の実装が前提になる。FR-3側の課題として残す
 *   - 勝率（公式の重み付けスコア）: 公式の得点配分ルールが一次情報源で未確認のため、
 *     本スクリプトでは1着〜6着の実測件数から一般的に知られる配点（10/8/6/4/2/1点）で近似計算し、
 *     参考値としてのみ報告する（合否判定はしない）
 *   - 出遅れ回数（選手責任）: race_start_timings.is_late_start は「選手側の責任か」までは
 *     区別しないため、乖離があっても自社バグと断定できない（参考比較として報告する）
 *
 * 【初回実行で判明した重要な制約（2026-09-15）】
 * racesテーブルの最古レコードは2025-12-03で、自社DBはそれ以前の履歴を持たない。
 * 現在の公式集計期間（後期=2025-11-01〜2026-04-30）は開始日が自社データ開始日より前のため、
 * 「出走回数」等の絶対値を公式ページと厳密一致させることは構造的に不可能（最低でも2025年11月分
 * が自社側から欠落する）。本スクリプトは自社データ開始日でクランプした上で参考値として比較し、
 * `truncatedWindow: true` の場合は match/withinTolerance を null（判定不能）として報告する
 * （厳密比較ができるようになるのは、自社データ期間に完全に収まる期（2026年前期=2026/5/1-10/31、
 * 2026年11月頃公開予定）が対象になってから）。
 *
 * 使用方法:
 *   node --env-file=.env.local scripts/analysis/verify-racer-season-stats-accuracy.js
 *   node --env-file=.env.local scripts/analysis/verify-racer-season-stats-accuracy.js --limit=10 --verbose
 *   node --env-file=.env.local scripts/analysis/verify-racer-season-stats-accuracy.js --racer=3159
 */

import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";
import { scrapeSeasonStats } from "../lib/racerSeasonStats.js";
import { extractDateFromRaceId } from "../lib/dateUtils.js";

const REQUEST_DELAY_MS = 500;
const CHUNK_SIZE = 200;
const REPORT_DIR = "data/analysis/racer-season-stats";
const REPORT_PATH = path.join(REPORT_DIR, "accuracy-verification.json");

// 許容誤差（%ポイント）。公式ページ側の端数処理（小数第2位四捨五入）による
// わずかなズレを許容するための閾値。
const RATE_TOLERANCE = 1.0;

function parseArgs() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const racerArg = args.find((a) => a.startsWith("--racer="));
  return {
    limit: limitArg ? parseInt(limitArg.split("=")[1], 10) : 20,
    racerId: racerArg ? parseInt(racerArg.split("=")[1], 10) : null,
    verbose: args.includes("--verbose") || args.includes("-v"),
  };
}

let cachedDataMinDate = null;

// 自社racesテーブルの最古レコード日を取得する（キャッシュ）。
// 公式集計期間の開始日がこれより前の場合、その分は自社側から構造的に欠落するため
// 検算を「参考値」に格下げする判定に使う。
async function getDataMinDate() {
  if (cachedDataMinDate) return cachedDataMinDate;
  const { data, error } = await supabase
    .from("races")
    .select("race_date")
    .order("race_date", { ascending: true })
    .limit(1);
  if (error) throw new Error(`races最古日取得エラー: ${error.message}`);
  cachedDataMinDate = data?.[0]?.race_date ?? null;
  return cachedDataMinDate;
}

// racer_profilesから級別の偏りが出ないよう等間隔にサンプリングする
async function getSampleRacerIds(limit) {
  const ids = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("racer_profiles")
      .select("racer_id")
      .order("racer_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`racer_profiles取得エラー: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) ids.push(row.racer_id);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  if (ids.length === 0) return [];
  if (ids.length <= limit) return ids;

  const step = ids.length / limit;
  const sample = [];
  for (let i = 0; i < limit; i++) {
    sample.push(ids[Math.floor(i * step)]);
  }
  return [...new Set(sample)];
}

async function fetchInChunks(table, column, ids, selectCols) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .in(column, chunk);
    if (error) throw new Error(`${table}取得エラー: ${error.message}`);
    if (data) rows.push(...data);
  }
  return rows;
}

// 指定選手の期別成績ページと同じ日付範囲を対象に、race_entries/race_results/
// race_start_timingsから自社再計算値を算出する
async function computeOwnStats(racerId, periodStart, periodEnd) {
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number")
    .eq("racer_id", racerId);
  if (entriesError)
    throw new Error(`race_entries取得エラー: ${entriesError.message}`);

  const periodEntries = (entries || []).filter((e) => {
    const date = extractDateFromRaceId(e.race_id);
    return date >= periodStart && date <= periodEnd;
  });

  if (periodEntries.length === 0) {
    return { starts: 0, placeCounts: {}, flyingCount: 0, falseStartCount: 0 };
  }

  const raceIds = periodEntries.map((e) => e.race_id);

  const results = await fetchInChunks(
    "race_results",
    "race_id",
    raceIds,
    [
      "race_id",
      "rank1",
      "rank2",
      "rank3",
      "rank4",
      "rank5",
      "rank6",
      "is_cancelled",
      "is_no_race",
    ].join(", "),
  );
  const resultsByRaceId = new Map(results.map((r) => [r.race_id, r]));

  const timings = await fetchInChunks(
    "race_start_timings",
    "race_id",
    raceIds,
    "race_id, boat_number, is_flying, is_late_start",
  );
  // race_id+boat_numberの複合キーでO(1)引きできるようMap化する
  // （aggregate-racer-stats.jsのcalculateRacerSTStatsと同じパターン）
  const timingByKey = new Map(
    timings.map((t) => [`${t.race_id}_${t.boat_number}`, t]),
  );

  let starts = 0;
  const placeCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let flyingCount = 0;
  let falseStartCount = 0;

  for (const entry of periodEntries) {
    const result = resultsByRaceId.get(entry.race_id);
    if (result && !result.is_cancelled && !result.is_no_race) {
      starts++;
      for (let place = 1; place <= 6; place++) {
        if (result[`rank${place}`] === entry.boat_number) {
          placeCounts[place]++;
          break;
        }
      }
    }

    const timing = timingByKey.get(`${entry.race_id}_${entry.boat_number}`);
    if (timing) {
      if (timing.is_flying) flyingCount++;
      if (timing.is_late_start) falseStartCount++;
    }
  }

  return { starts, placeCounts, flyingCount, falseStartCount };
}

function withinTolerance(a, b, tolerance) {
  if (a === null || b === null) return null;
  return Math.abs(a - b) <= tolerance;
}

async function verifyRacer(racerId, options) {
  const official = await scrapeSeasonStats(racerId).catch((err) => {
    if (options.verbose)
      console.log(`racer_id=${racerId} 取得エラー: ${err.message}`);
    return null;
  });

  if (!official) {
    return { racerId, status: "fetch_failed" };
  }
  if (official.starts === null) {
    return {
      racerId,
      status: "no_data_in_period",
      periodLabel: official.periodLabel,
    };
  }

  const dataMinDate = await getDataMinDate();
  const truncatedWindow = Boolean(
    dataMinDate && official.periodStart < dataMinDate,
  );
  const effectivePeriodStart =
    truncatedWindow && dataMinDate ? dataMinDate : official.periodStart;

  const own = await computeOwnStats(
    racerId,
    effectivePeriodStart,
    official.periodEnd,
  );

  const ownRentai2 =
    own.starts > 0
      ? ((own.placeCounts[1] + own.placeCounts[2]) / own.starts) * 100
      : null;
  const ownRentai3 =
    own.starts > 0
      ? ((own.placeCounts[1] + own.placeCounts[2] + own.placeCounts[3]) /
          own.starts) *
        100
      : null;
  const ownWinRateApprox =
    own.starts > 0
      ? (own.placeCounts[1] * 10 +
          own.placeCounts[2] * 8 +
          own.placeCounts[3] * 6 +
          own.placeCounts[4] * 4 +
          own.placeCounts[5] * 2 +
          own.placeCounts[6] * 1) /
        own.starts
      : null;

  // truncatedWindow時はofficialとownで対象期間の長さが異なるため、
  // 一致判定（match/withinTolerance）はnull（判定不能）にして参考値として報告する。
  const skipJudgement = truncatedWindow;

  return {
    racerId,
    status: "compared",
    periodLabel: official.periodLabel,
    periodStart: official.periodStart,
    periodEnd: official.periodEnd,
    truncatedWindow,
    effectivePeriodStart,
    starts: {
      official: official.starts,
      own: own.starts,
      match: skipJudgement ? null : official.starts === own.starts,
    },
    rentai2Rate: {
      official: official.rentai2Rate,
      own: ownRentai2 !== null ? Number(ownRentai2.toFixed(2)) : null,
      withinTolerance: skipJudgement
        ? null
        : withinTolerance(official.rentai2Rate, ownRentai2, RATE_TOLERANCE),
    },
    rentai3Rate: {
      official: official.rentai3Rate,
      own: ownRentai3 !== null ? Number(ownRentai3.toFixed(2)) : null,
      withinTolerance: skipJudgement
        ? null
        : withinTolerance(official.rentai3Rate, ownRentai3, RATE_TOLERANCE),
    },
    flyingCount: {
      official: official.flyingCount,
      own: own.flyingCount,
      match: skipJudgement ? null : official.flyingCount === own.flyingCount,
    },
    falseStartCount: {
      official: official.falseStartCount,
      own: own.falseStartCount,
      match: skipJudgement
        ? null
        : official.falseStartCount === own.falseStartCount,
      note: "is_late_startは選手責任の区別をしないため参考値（乖離は自社バグと断定しない）",
    },
    winRateApprox: {
      official: official.winRate,
      ownApprox:
        ownWinRateApprox !== null ? Number(ownWinRateApprox.toFixed(2)) : null,
      note: "配点10/8/6/4/2/1点は一般的に知られる値からの近似。公式の得点配分ルールは未確認のため参考値のみ（合否判定はしない）",
    },
  };
}

async function main() {
  const options = parseArgs();

  console.log("=== 選手期別成績 自社検算スクリプト ===");
  console.log("");

  const targetRacerIds = options.racerId
    ? [options.racerId]
    : await getSampleRacerIds(options.limit);

  console.log(`検証対象racer_id数: ${targetRacerIds.length}件`);
  console.log("");

  const results = [];
  for (let i = 0; i < targetRacerIds.length; i++) {
    const racerId = targetRacerIds[i];
    const progress = `[${i + 1}/${targetRacerIds.length}]`;
    const result = await verifyRacer(racerId, options);
    results.push(result);

    if (options.verbose || result.status !== "compared") {
      console.log(`${progress} racer_id=${racerId} status=${result.status}`);
    }
    if (result.status === "compared") {
      const truncatedNote = result.truncatedWindow
        ? " [参考値:期間クランプ済み]"
        : "";
      console.log(
        `${progress} racer_id=${racerId} starts=${result.starts.official}/${result.starts.own}(match=${result.starts.match}) ` +
          `rentai2=${result.rentai2Rate.official}/${result.rentai2Rate.own}(±${RATE_TOLERANCE}以内=${result.rentai2Rate.withinTolerance}) ` +
          `F=${result.flyingCount.official}/${result.flyingCount.own}(match=${result.flyingCount.match})${truncatedNote}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }

  const compared = results.filter((r) => r.status === "compared");
  const truncated = compared.filter((r) => r.truncatedWindow);
  const strictlyComparable = compared.filter((r) => !r.truncatedWindow);
  const summary = {
    totalSampled: results.length,
    fetchFailedCount: results.filter((r) => r.status === "fetch_failed").length,
    noDataCount: results.filter((r) => r.status === "no_data_in_period").length,
    comparedCount: compared.length,
    truncatedWindowCount: truncated.length,
    truncatedWindowNote:
      truncated.length > 0
        ? "公式集計期間の開始日が自社races最古日（2025-12-03）より前のため、該当分は判定不能（参考値）として扱った"
        : undefined,
    strictlyComparableCount: strictlyComparable.length,
    startsMatchCount: strictlyComparable.filter((r) => r.starts.match).length,
    rentai2WithinToleranceCount: strictlyComparable.filter(
      (r) => r.rentai2Rate.withinTolerance,
    ).length,
    rentai3WithinToleranceCount: strictlyComparable.filter(
      (r) => r.rentai3Rate.withinTolerance,
    ).length,
    flyingCountMatchCount: strictlyComparable.filter((r) => r.flyingCount.match)
      .length,
    falseStartCountMatchCount: strictlyComparable.filter(
      (r) => r.falseStartCount.match,
    ).length,
  };

  console.log("");
  console.log("=== 検算結果サマリー ===");
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      { executedAt: new Date().toISOString(), summary, results },
      null,
      2,
    ),
  );
  console.log("");
  console.log(`レポート保存: ${REPORT_PATH}`);

  const hasMismatch =
    summary.strictlyComparableCount > 0 &&
    (summary.startsMatchCount < summary.strictlyComparableCount ||
      summary.rentai2WithinToleranceCount < summary.strictlyComparableCount);
  if (hasMismatch) {
    console.log("");
    console.log(
      "⚠️ 出走回数または2連対率に許容誤差を超える乖離があります。レポートの詳細を確認してください。",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
