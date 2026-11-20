/**
 * scrape-point-rank.js の純粋な部品（DB に触らない）。
 * 会場ごとの判定・行の組み立て・日ごとの写しの会場の選び方・集計と出力。文は元のまま。
 */
import { VENUE_NAMES } from "./supabaseClient.js";
import { extractVenueCodeFromRaceId } from "./dateUtils.js";
import { isCancellationConfirmed } from "./cancellationStatus.js";

/** 得点率表（pointrank）が出るのは SG/G1 だけ。4日目以降は表が無いと異常（公式ページの仕様変更の疑い） */
export const TABLE_EXPECTED_GRADES = ["SG", "G1"];
export const TABLE_EXPECTED_FROM_SERIES_DAY = 4;

/** 予選の最終日。これより後は表が「４日目１２R終了時点」で止まるので、日ごとの写しは予選中だけ取り直す */
export const QUALIFYING_LAST_SERIES_DAY = 4;

export const DAILY_TABLE = "racer_series_points_daily";

export function isTableExpected(raceGrade, seriesDay) {
  return (
    TABLE_EXPECTED_GRADES.includes(raceGrade) &&
    seriesDay != null &&
    seriesDay >= TABLE_EXPECTED_FROM_SERIES_DAY
  );
}

/** 1会場の取得結果を「書く・書かない・失敗」に分ける */
export function judgeVenue({ raceGrade, seriesDay, fetched }) {
  if (fetched.kind === "error") {
    return {
      write: false,
      failure: `取得失敗: ${fetched.message}`,
      note: null,
    };
  }
  if (fetched.kind === "none") {
    if (isTableExpected(raceGrade, seriesDay)) {
      return {
        write: false,
        failure: `${raceGrade}の${seriesDay}日目なのに得点率表が無い（公式ページの仕様変更の疑い）`,
        note: null,
      };
    }
    if (TABLE_EXPECTED_GRADES.includes(raceGrade) && seriesDay == null) {
      return {
        write: false,
        failure: `${raceGrade}だがseries_day未取得のため、表が無いのが正常か判定できない`,
        note: null,
      };
    }
    return { write: false, failure: null, note: "表なし（対象外の開催/序盤）" };
  }
  if (fetched.rows.length === 0) {
    return {
      write: false,
      failure: "得点率表はあるが行を1件も解析できない（HTML構造変更の疑い）",
      note: null,
    };
  }
  if (seriesDay == null) {
    return {
      write: false,
      failure:
        "得点率表はあるがseries_day未取得でmeet_start_dateを算出できない",
      note: null,
    };
  }
  return { write: true, failure: null, note: null };
}

/** races の行から 会場コード → race_grade（最初の行の値） */
export function buildVenueGrades(races) {
  const venueGrades = new Map();
  for (const r of races) {
    const venueCode = extractVenueCodeFromRaceId(r.race_id);
    if (!venueGrades.get(venueCode)) {
      venueGrades.set(venueCode, r.race_grade ?? null);
    }
  }
  return venueGrades;
}

/** races の行から 会場コード → その日の中止でないレースの最後の番号 */
export function buildVenueLastRaces(races) {
  const lastRaces = new Map();
  for (const r of races) {
    if (isCancellationConfirmed(r.cancellation_status)) continue;
    const venueCode = extractVenueCodeFromRaceId(r.race_id);
    const raceNumber = Number(r.race_id.slice(-2));
    if (raceNumber > (lastRaces.get(venueCode) ?? 0))
      lastRaces.set(venueCode, raceNumber);
  }
  return lastRaces;
}

/** 得点率表の行 → racer_series_points の行 */
export function buildSeriesPointRows(
  fetchedRows,
  { venueCode, meetStartDate, raceGrade },
) {
  return fetchedRows.map((r) => ({
    venue_code: venueCode,
    meet_start_date: meetStartDate,
    racer_id: r.racerId,
    race_grade: raceGrade,
    player_name: r.playerName,
    grade: r.grade,
    rank: r.rank,
    score_rate: r.scoreRate,
    placements: r.placements,
    total_points: r.totalPoints,
    penalty_points: r.penaltyPoints,
    remarks: r.remarks,
    next_race_1: r.nextRace1 ?? null,
    next_race_2: r.nextRace2 ?? null,
    next_series_day: r.nextSeriesDay ?? null,
  }));
}

/**
 * 会場ごとの結果を集計し、racer_series_points に書く行と report の summary を返す。
 * failures は呼び出し元の配列（後の書き込みの失敗も同じ配列に足す）
 */
export function summarizeVenueResults(results, failures) {
  const rows = [];
  const venues = [];
  const venuesNotAttempted = [];
  let expectedVenues = 0;
  let writtenVenues = 0;
  for (const r of results) {
    if (r.notAttempted) {
      venuesNotAttempted.push(r.venueCode);
      continue;
    }
    if (r.failure) failures.push(r.failure);
    if (r.expected) expectedVenues++;
    if (r.rows.length > 0) {
      writtenVenues++;
      rows.push(...r.rows);
    }
    venues.push({
      venueCode: r.venueCode,
      grade: r.raceGrade ?? null,
      seriesDay: r.seriesDay ?? null,
      meetStartDate: r.meetStartDate ?? null,
      rows: r.rows.length,
      nextRaceRows: r.nextRaceRows ?? 0,
      nextRaceUnreadable: r.nextRaceUnreadable ?? 0,
      failed: Boolean(r.failure),
    });
  }

  console.log(
    `📊 期待会場数(SG/G1の${TABLE_EXPECTED_FROM_SERIES_DAY}日目以降)=${expectedVenues}、書き込み会場数=${writtenVenues}、行数=${rows.length}`,
  );

  const summary = {
    expectedVenues,
    writtenVenues,
    failures,
    rowsParsed: rows.length,
    venues,
    venuesNotAttempted,
  };
  return { rows, summary };
}

// ---------------------------------------------------------------------------
// 日ごとの写し（racer_series_points_daily）
// ---------------------------------------------------------------------------

export function buildDailyRows(snapshotDate, venueResults, scrapedAt) {
  return venueResults.flatMap((v) =>
    v.rows.map((row) => ({
      snapshot_date: snapshotDate,
      series_day: v.seriesDay,
      venue_code: row.venue_code,
      racer_id: row.racer_id,
      meet_start_date: row.meet_start_date,
      race_grade: row.race_grade,
      player_name: row.player_name,
      grade: row.grade,
      rank: row.rank,
      score_rate: row.score_rate,
      placements: row.placements,
      total_points: row.total_points,
      penalty_points: row.penalty_points,
      remarks: row.remarks,
      next_race_1: row.next_race_1,
      next_race_2: row.next_race_2,
      next_series_day: row.next_series_day,
      as_of_race: v.asOf.raceNumber,
      scraped_at: scrapedAt,
    })),
  );
}

/** 1会場（SG/G1、グレード既知）の日ごとの写しの判定。write・pending・skipped・failure のどれか（write は pending を伴いうる） */
function dailyVenueVerdict(v, lastRace) {
  const base = {
    venueCode: v.venueCode,
    seriesDay: v.seriesDay,
    asOfSeriesDay: v.asOf?.seriesDay ?? null,
    asOfRace: v.asOf?.raceNumber ?? null,
    lastRace,
  };
  if (!v.asOf) {
    return {
      failure: `${VENUE_NAMES[v.venueCode]}(${v.raceGrade}, ${v.seriesDay}日目): 得点率表の「N日目MR終了時点」を読めない（日ごとの写しを書かない。公式ページの書式変更の疑い）`,
    };
  }
  if (v.asOf.seriesDay === v.seriesDay) {
    return {
      write: true,
      pending:
        lastRace != null && v.asOf.raceNumber < lastRace
          ? { ...base, reason: "race_not_final" }
          : null,
    };
  }
  if (
    v.asOf.seriesDay === v.seriesDay - 1 &&
    v.seriesDay <= QUALIFYING_LAST_SERIES_DAY &&
    lastRace != null
  ) {
    return { pending: { ...base, reason: "day_not_reflected" } };
  }
  return { skipped: base };
}

/**
 * 日ごとの写しに書く会場を選ぶ（純粋関数）。対象は SG/G1 だけ（Shorts 型B の用途。G2 以下は写さない）。
 * pointrank は過去の日付で開いても節の最新の表を返し（後から取り直せない）、予選の後は「４日目１２R終了時点」で止まる。
 *   - 注記を読めない: その日の値か確かめられないので書かず、failure（公式ページの書式変更の疑い）
 *   - 注記の日目 = 対象日の日目: 書く。注記のレース番号が、その日の中止でないレースの最後より前なら、書いたうえで
 *     incomplete（12R の反映前。補足の起動が取り直し、値が変わった行だけ書き直す）
 *   - 注記の日目 = 対象日の日目 − 1、かつ予選中（4日目まで）、かつその日に中止でないレースがある: 書かずに incomplete
 *     （その日の結果がまだ表に出ていない。取り直さないと、その日の値は永久に失う）
 *   - それ以外（5日目以降に予選の後の表、丸一日の中止 等）: 書かずに skipped（report に出す）
 * @param {Array<{venueCode: number, raceGrade: string|null, seriesDay: number, asOf: {seriesDay: number, raceNumber: number}|null, rows: Array<Object>}>} venueResults
 * @param {Map<number, number>} lastRaces venueCode -> その日の中止でないレースの最後の番号（全レース中止の会場は無い）
 * @returns {{write: Array<Object>, skipped: Array<Object>, pending: Array<Object>, failures: string[]}}
 *   pending が空でなければ、呼び出し元は incomplete にする
 */
export function selectDailyVenues(venueResults, lastRaces) {
  const write = [];
  const skipped = [];
  const pending = [];
  const failures = [];
  for (const v of venueResults) {
    if (v.raceGrade == null) {
      // グレードが未取得: SG/G1 か分からないので写さない。黙って落とさず report に出す
      skipped.push({
        venueCode: v.venueCode,
        seriesDay: v.seriesDay,
        reason: "grade_unknown",
      });
      continue;
    }
    if (!TABLE_EXPECTED_GRADES.includes(v.raceGrade)) continue;
    const verdict = dailyVenueVerdict(v, lastRaces.get(v.venueCode) ?? null);
    if (verdict.failure) failures.push(verdict.failure);
    if (verdict.write) write.push(v);
    if (verdict.pending) pending.push(verdict.pending);
    if (verdict.skipped) skipped.push(verdict.skipped);
  }
  return { write, skipped, pending, failures };
}

/** 日ごとの写しに書かない会場（skipped）と取り直す会場（pending）の出力 */
export function logDailyVenueNotes(dailyVenues) {
  for (const v of dailyVenues.skipped)
    console.log(
      v.reason === "grade_unknown"
        ? `  ➖ ${VENUE_NAMES[v.venueCode]}: グレードが未取得のため日ごとの写しに書かない`
        : `  ➖ ${VENUE_NAMES[v.venueCode]}: 表は${v.asOfSeriesDay}日目${v.asOfRace}Rの時点（対象日は${v.seriesDay}日目）。日ごとの写しに書かない`,
    );
  for (const v of dailyVenues.pending)
    console.warn(
      `  ⏳ ${VENUE_NAMES[v.venueCode]}: 表は${v.asOfSeriesDay}日目${v.asOfRace}Rの時点（対象日は${v.seriesDay}日目・最終${v.lastRace}R）。補足の起動で取り直す`,
    );
}

/** 日ごとの写しの書き込みの結果の出力（失敗は呼び出し元が failures に足す） */
export function logDailyWrite(daily) {
  if (daily.tableMissing)
    console.warn(
      `⚠️ ${DAILY_TABLE} が無い（マイグレーション192の未適用）。日ごとの写しを書かずに続ける`,
    );
  else
    console.log(
      `💾 ${DAILY_TABLE}: 書き込み${daily.written}件・変更なし${daily.unchanged}件`,
    );
}

/** report の daily */
export function dailySummary(daily, dailyVenues) {
  return {
    written: daily.written,
    unchanged: daily.unchanged,
    tableMissing: daily.tableMissing,
    venues: dailyVenues.write.map((v) => v.venueCode),
    skippedVenues: dailyVenues.skipped,
    pendingVenues: dailyVenues.pending,
  };
}
