/**
 * 今節得点率取得スクリプト（BOA-220/BOA-291、FR-3）
 *
 * boatrace.jp「得点率一覧」ページ（pointrank）を、開催中の全会場に対して
 * 1日1回取得する。SG/G1等の記念競走（予選勝ち上がり制）でのみデータが
 * 存在し、一般戦・特別選抜競走（オールレディース/マスターズ等）は
 * ページ自体にテーブルが無い（scripts/lib/pointRankParser.js参照）。
 * 対象グレードを事前に決め打ちせず、テーブルの有無で判定する。
 * ただし「テーブルが無いのが異常か」の判定（judgeVenue）にだけ、実測に基づく
 * 期待条件（SG/G1かつ4日目以降）を使う。
 *
 * meet_start_date（開催初日）は race_conditions.series_day（BOA-226）を
 * 使って対象日から逆算する。
 *
 * 対象日: 「now - 6時間」のJST日付（resolveTargetDate）。cronは22:00 JSTだが、
 * GitHub Actionsのscheduleは約4時間遅延する実績があり（2026-09-16〜18の3回とも
 * 02:00 JST前後に起動）、単純な「今日のJST日付」だと翌日を指して
 * 「開催会場なし」で0件終了していた（翌日のracesは午前に生成される）。
 * 00:00〜06:00 JSTの起動は前日分ジョブの遅延起動とみなす。
 *
 * 失敗の扱い（.claude/rules/data-acquisition.md 1章）: 「期待件数が0でない限り
 * 0件を成功扱いしない」に従い、次のいずれかで非0終了する。
 *   - 対象日の開催会場が0件 / 取得失敗 / 表はあるが行を解析できない
 *   - SG/G1の4日目以降なのに表が無い（期待件数=このような会場数）
 *   - 表はあるがseries_day未取得でmeet_start_dateを算出できない
 *   - DBの読み書きエラー
 * 表が無いのが正常なケース（一般戦・G3等、SG/G1でも1〜3日目）は成功扱い。
 *
 * GitHub Actionsから日次実行（低頻度・T4相当、BOA-313の対象外）。
 */

import * as cheerio from "cheerio";
import {
  parseDateArg,
  addDaysToDateString,
  extractVenueCodeFromRaceId,
} from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import {
  parsePointRankTable,
  parsePointRankAsOf,
} from "../lib/pointRankParser.js";
import { isGhaFetchStopped } from "../lib/ghaSkipGate.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";
import { upsertWithOptionalColumns } from "../lib/optionalColumns.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import { isScrapeSchemaMissingError } from "../lib/scrapeJobs/schemaErrors.js";

/**
 * マイグレーション159（早見の列、BOA-784）。未適用の DB では、この列を除いて他の列を書き続ける
 */
const NEXT_RACE_COLUMN_GROUPS = {
  "マイグレーション159（早見の列）": [
    "next_race_1",
    "next_race_2",
    "next_series_day",
  ],
};

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

/**
 * SG/G1（記念競走）で「表が無ければ異常」とするのは4日目以降だけ（表があれば、日目を問わず書く）。
 * 2026-09-19〜20 の「1〜3日目は表なし」の実測は、節の前の日の hd と、過去の hd で最新の表が返ることの取り違えで、
 * 根拠になっていない（2026-11-02 official-data-spec: 徳山G1 の節は 9/12〜17、若松G1 は1日目・2日目の晩に52名の表あり）。
 * 1〜3日目に表が出ることは推測で未照合のため、異常の判定は4日目以降のまま（安全側）にする。
 * G2/G3/一般戦は表の有無が節ごとに異なるため対象外（2026-09-19の実測: G3の1・2日目と一般戦の1・4・5・6日目は表なし）。
 */
const TABLE_EXPECTED_GRADES = ["SG", "G1"];
const TABLE_EXPECTED_FROM_SERIES_DAY = 4;

const FETCH_TIMEOUT_MS = 15000;

/**
 * 日ごとの写し（BOA-1210、マイグレーション192）。racer_series_points は節ごとに上書きされるので、
 * 取得の対象日（snapshot_date）をキーに足して同じ値を残す。Shorts 型B は予選最終日の朝に前日の行を読む
 */
const DAILY_TABLE = "racer_series_points_daily";

/**
 * racer_series_points の行（会場ごとの結果）から、日ごとの写しの行を作る（純粋関数）。
 * 呼び出し側が、表の注記の日目（asOf.seriesDay）が対象日の日目と同じ会場だけを渡す
 * @param {string} snapshotDate 取得の対象日（YYYY-MM-DD）
 * @param {Array<{seriesDay: number, asOf: {raceNumber: number}, rows: Array<Object>}>} venueResults 書く会場の結果
 * @param {string} scrapedAt
 */
function buildDailyRows(snapshotDate, venueResults, scrapedAt) {
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
function selectDailyVenues(venueResults, lastRaces) {
  const write = [];
  const skipped = [];
  const pending = [];
  const failures = [];
  for (const v of venueResults) {
    if (!TABLE_EXPECTED_GRADES.includes(v.raceGrade)) continue;
    const lastRace = lastRaces.get(v.venueCode) ?? null;
    const base = {
      venueCode: v.venueCode,
      seriesDay: v.seriesDay,
      asOfSeriesDay: v.asOf?.seriesDay ?? null,
      asOfRace: v.asOf?.raceNumber ?? null,
      lastRace,
    };
    if (!v.asOf) {
      failures.push(
        `${VENUE_NAMES[v.venueCode]}(${v.raceGrade}, ${v.seriesDay}日目): 得点率表の「N日目MR終了時点」を読めない（日ごとの写しを書かない。公式ページの書式変更の疑い）`,
      );
    } else if (v.asOf.seriesDay === v.seriesDay) {
      write.push(v);
      if (lastRace != null && v.asOf.raceNumber < lastRace)
        pending.push({ ...base, reason: "race_not_final" });
    } else if (
      v.asOf.seriesDay === v.seriesDay - 1 &&
      v.seriesDay <= TABLE_EXPECTED_FROM_SERIES_DAY &&
      lastRace != null
    ) {
      pending.push({ ...base, reason: "day_not_reflected" });
    } else {
      skipped.push(base);
    }
  }
  return { write, skipped, pending, failures };
}

/**
 * 日ごとの写しを、値が変わった行と新しい行だけ書く。
 * 表が無い（マイグレーション192の適用前）ときは、書かずに tableMissing を返す（racer_series_points は書き続ける）。
 * それ以外の読み書きの失敗は error を返す（呼び出し元が実行の失敗にする）
 * @returns {Promise<{written: number, unchanged: number, tableMissing: boolean, error: string|null}>}
 */
async function writeDailyRows(client, dailyRows) {
  if (dailyRows.length === 0)
    return { written: 0, unchanged: 0, tableMissing: false, error: null };
  const { written, skipped, error } = await upsertChangedRows(
    client,
    DAILY_TABLE,
    dailyRows,
    {
      onConflict: "snapshot_date,venue_code,racer_id",
      keyColumns: ["snapshot_date", "venue_code", "racer_id"],
      // scraped_at は毎回変わる。比較から外し、値が変わった行にだけ新しい時刻を載せる
      ignoreColumns: ["scraped_at"],
      chunkColumn: "snapshot_date",
      // 1日の行は SG/G1 の会場数×約52行。上限の1000行ちょうどで返ったら、切れた疑いとして書かずに止める
      fullPageRows: 1000,
      failOnFetchError: true,
      label: DAILY_TABLE,
    },
  );
  // 包み直したメッセージには表の名前が必ず入るので、元のエラー（cause）で判定する（別の表の不在と取り違えない）
  if (
    error &&
    isScrapeSchemaMissingError(error.cause ?? error, [DAILY_TABLE])
  ) {
    return { written: 0, unchanged: 0, tableMissing: true, error: null };
  }
  if (error)
    return {
      // バッチの途中で失敗したときも、書けた件数は残す
      written,
      unchanged: skipped,
      tableMissing: false,
      error: `${DAILY_TABLE} 書き込みエラー: ${error.message}`,
    };
  return { written, unchanged: skipped, tableMissing: false, error: null };
}

/** GitHub Actionsのschedule遅延の許容時間（実測約4時間+余裕） */
const SCHEDULE_DELAY_TOLERANCE_HOURS = 6;

/**
 * 既定の対象日（YYYY-MM-DD）。「now - 遅延許容時間」のJST日付。
 * 22:00 JST起動なら当日、00:00〜06:00 JSTの遅延起動なら前日になる
 */
function resolveTargetDate(now = new Date()) {
  const shifted = new Date(
    now.getTime() - SCHEDULE_DELAY_TOLERANCE_HOURS * 60 * 60 * 1000,
  );
  const jst = new Date(shifted.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

/** 表の存在が期待される会場か（表が無ければ異常とみなす条件） */
function isTableExpected(raceGrade, seriesDay) {
  return (
    TABLE_EXPECTED_GRADES.includes(raceGrade) &&
    seriesDay != null &&
    seriesDay >= TABLE_EXPECTED_FROM_SERIES_DAY
  );
}

/**
 * 1会場の取得結果を判定する（純粋関数）
 * @param {{raceGrade: string|null, seriesDay: number|null,
 *   fetched: {kind: "error", message: string} | {kind: "none"} |
 *            {kind: "table", rows: Array<Object>}}} input
 * @returns {{write: boolean, failure: string|null, note: string|null}}
 *   write=trueなら rows をDBへ書く。failureがあればジョブを失敗させる
 */
function judgeVenue({ raceGrade, seriesDay, fetched }) {
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

/**
 * racesの行から会場ごとのグレードを求める（純粋関数）
 * race_gradeはレース単位で、初期INSERT時にNULLの行がありうる。
 * 会場のグレードは最初に見つかった非NULLを採用する（NULLの行で上書きしない）
 * @param {Array<{race_id: string, race_grade: string|null}>} races
 * @returns {Map<number, string|null>} venueCode -> race_grade
 */
function buildVenueGrades(races) {
  const venueGrades = new Map();
  for (const r of races) {
    const venueCode = extractVenueCodeFromRaceId(r.race_id);
    if (!venueGrades.get(venueCode)) {
      venueGrades.set(venueCode, r.race_grade ?? null);
    }
  }
  return venueGrades;
}

/**
 * 会場ごとの、その日の中止でない（cancellation_status が 'confirmed' でない）レースの最後の番号（純粋関数）。
 * 全レースが中止の会場は入らない
 * @param {Array<{race_id: string, cancellation_status?: string|null}>} races
 * @returns {Map<number, number>}
 */
function buildVenueLastRaces(races) {
  const lastRaces = new Map();
  for (const r of races) {
    if (r.cancellation_status === "confirmed") continue;
    const venueCode = extractVenueCodeFromRaceId(r.race_id);
    const raceNumber = Number(r.race_id.slice(-2));
    if (raceNumber > (lastRaces.get(venueCode) ?? 0))
      lastRaces.set(venueCode, raceNumber);
  }
  return lastRaces;
}

/**
 * 対象日に開催中の会場コードとレースグレード、中止でないレースの最後の番号を取得
 * @returns {Promise<{venueGrades: Map<number, string|null>, lastRaces: Map<number, number>}>}
 */
async function getActiveVenueGrades(date, client = supabase) {
  const { data, error } = await client
    .from("races")
    .select("race_id, race_grade, cancellation_status")
    .like("race_id", `${date}%`);
  if (error) {
    throw new Error(`開催会場一覧の取得エラー: ${error.message}`);
  }
  return {
    venueGrades: buildVenueGrades(data || []),
    lastRaces: buildVenueLastRaces(data || []),
  };
}

/**
 * 対象日・会場の series_day を race_conditions から取得する
 * @returns {Promise<number|null>} 未取得（行なし・全レースNULL）は null
 */
async function getSeriesDay(date, venueCode, client = supabase) {
  const jcd = String(venueCode).padStart(2, "0");
  const { data, error } = await client
    .from("race_conditions")
    .select("race_id, series_day")
    .like("race_id", `${date}-${jcd}-%`)
    .not("series_day", "is", null)
    .order("race_id")
    .limit(1);
  if (error) {
    throw new Error(
      `${VENUE_NAMES[venueCode]} series_day取得エラー: ${error.message}`,
    );
  }
  return data && data.length > 0 ? data[0].series_day : null;
}

/**
 * 1会場分の得点率一覧を取得・パース
 * @returns {Promise<{kind: "error", message: string} | {kind: "none"} |
 *   {kind: "table", rows: Array<Object>}>}
 */
async function fetchPointRank(
  date,
  venueCode,
  { fetchImpl = fetch, attempts = 2, retryDelayMs = 3000 } = {},
) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/pointrank?jcd=${jcd}&hd=${ymd}`;

  // 一時的な失敗（5xx・タイムアウト）に備えて再試行する（既定は1回だけ再試行。Vercelは politeFetch が
  // バックオフ・再試行をするため、attempts: 1 で二重にしない）
  let lastError = "unknown";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
      } else {
        const $ = cheerio.load(await res.text());
        const rows = parsePointRankTable($);
        return rows === null
          ? { kind: "none" }
          : { kind: "table", rows, asOf: parsePointRankAsOf($) };
      }
    } catch (err) {
      lastError = err.message;
    }
    if (attempt < attempts)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { kind: "error", message: lastError };
}

/**
 * 得点率更新処理
 * @param {string} [date] - YYYY-MM-DD（省略時はresolveTargetDate()）
 * @param {Object} [options] 省略時は従来どおり（GitHub Actions・CLI。逐次・会場間1秒待機・global fetch・module の supabase）
 * @param {import("@supabase/supabase-js").SupabaseClient} [options.client] Supabase（Vercel: 共通ラッパの ctx.client）
 * @param {typeof fetch} [options.fetchImpl] 取得（Vercel: politeFetch）
 * @param {number} [options.attempts] 会場1件の取得の試行回数（既定2。Vercelは politeFetch が再試行するため1）
 * @param {number} [options.concurrency] 会場の同時取得数（既定1）
 * @param {number} [options.venueDelayMs] 会場ごとの待機（既定1000。同時取得のとき、各実行の会場の後に入る）
 * @param {boolean} [options.dryRun] true なら取得・解析までで、DBへ書かない（Vercel の shadow）
 * @param {() => boolean} [options.shouldStop] true を返したら、以降の会場に着手しない（ソフトデッドライン）
 * @returns {Promise<{updated: boolean, count: number, expectedVenues: number,
 *   writtenVenues: number, failures: string[], rowsParsed: number, venues: Array<Object>,
 *   venuesNotAttempted: number[]}>}
 *   expectedVenues: 表があるはずの会場数（SG/G1の4日目以降）。
 *   failuresが空でなければ呼び出し元は失敗扱いにすること。
 *   venuesNotAttempted が空でなければ、ソフトデッドラインで着手しなかった会場がある
 */
export async function run(date, options = {}) {
  const {
    client = supabase,
    fetchImpl = fetch,
    attempts = 2,
    concurrency = 1,
    venueDelayMs = 1000,
    dryRun = false,
    shouldStop = () => false,
  } = options;
  const targetDate = date || resolveTargetDate();
  const failures = [];
  const { venueGrades, lastRaces } = await getActiveVenueGrades(
    targetDate,
    client,
  );
  if (venueGrades.size === 0) {
    failures.push(
      `${targetDate}: 開催会場が0件（racesテーブル未生成、または対象日の誤りの疑い）`,
    );
    return {
      updated: false,
      count: 0,
      expectedVenues: 0,
      writtenVenues: 0,
      failures,
      rowsParsed: 0,
      venues: [],
      venuesNotAttempted: [],
    };
  }

  // 会場ごとの処理（取得・series_day・判定）。結果は会場コード順に集計する
  const processVenue = async (venueCode) => {
    const name = VENUE_NAMES[venueCode];
    const raceGrade = venueGrades.get(venueCode) ?? null;
    const fetched = await fetchPointRank(targetDate, venueCode, {
      fetchImpl,
      attempts,
    });
    // series_dayは、meet_start_dateの算出（表あり）か表の要否判定（SG/G1）にだけ要る。
    // 一般戦で表なしの会場のためにDBを引かない
    let seriesDay = null;
    if (fetched.kind === "table" || TABLE_EXPECTED_GRADES.includes(raceGrade)) {
      try {
        seriesDay = await getSeriesDay(targetDate, venueCode, client);
      } catch (err) {
        // 他会場の取得済みデータを捨てないよう、失敗として記録して続行する
        console.error(`  ❌ ${name}: ${err.message}`);
        return { venueCode, failure: `${name}: ${err.message}`, rows: [] };
      }
    }
    const expected = isTableExpected(raceGrade, seriesDay);

    const verdict = judgeVenue({ raceGrade, seriesDay, fetched });
    if (verdict.failure) {
      console.error(`  ❌ ${name}: ${verdict.failure}`);
      return {
        venueCode,
        expected,
        raceGrade,
        seriesDay,
        failure: `${name}(${raceGrade}, ${seriesDay ?? "?"}日目): ${verdict.failure}`,
        rows: [],
      };
    }
    if (!verdict.write) {
      console.log(
        `  ➖ ${name}(${raceGrade}, ${seriesDay ?? "?"}日目): ${verdict.note}`,
      );
      return { venueCode, expected, raceGrade, seriesDay, rows: [] };
    }
    const meetStartDate = addDaysToDateString(targetDate, -(seriesDay - 1));
    const rows = fetched.rows.map((r) => ({
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
    // 早見の書式が想定と違う（空欄でないのに番号を読めない）行。書き込みは止めず、報告に出す（BOA-784）
    const nextRaceUnreadable = fetched.rows.filter(
      (r) => r.nextRaceUnreadable,
    ).length;
    const nextRaceRows = rows.filter((r) => r.next_race_1 != null).length;
    console.log(
      `  ✅ ${name}: ${rows.length}名（開催初日${meetStartDate}、早見あり${nextRaceRows}名${nextRaceUnreadable > 0 ? `、⚠️ 早見を読めない${nextRaceUnreadable}名` : ""}）`,
    );
    return {
      venueCode,
      expected,
      raceGrade,
      seriesDay,
      meetStartDate,
      asOf: fetched.asOf ?? null,
      rows,
      nextRaceRows,
      nextRaceUnreadable,
    };
  };

  const venueCodes = [...venueGrades.keys()].sort((a, b) => a - b);
  const results = await mapWithConcurrency(
    venueCodes,
    concurrency,
    async (venueCode) => {
      if (shouldStop()) return { venueCode, notAttempted: true, rows: [] };
      const result = await processVenue(venueCode);
      // 会場間の待機（サーバー負荷配慮）
      if (venueDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, venueDelayMs));
      }
      return result;
    },
  );

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

  if (rows.length === 0) {
    // 表が無いのが正常な日（一般戦・序盤のみ）はここに来る。異常はfailuresに入っている
    console.log("📭 得点率: 書き込みデータなし");
    return { updated: false, count: 0, ...summary };
  }

  if (dryRun) {
    console.log(
      `🧪 dry-run: racer_series_points ${rows.length}件（書き込みなし）`,
    );
    return { updated: false, count: 0, ...summary };
  }

  // scraped_at は DEFAULT now() だが、DEFAULT は INSERT のときしか効かない。開催期間中は同じ行を
  // 毎日更新するため、載せないと初回挿入時の値が残り続ける（BOA-463）
  const scrapedAt = new Date().toISOString();
  const { error } = await upsertWithOptionalColumns(
    client,
    "racer_series_points",
    rows.map((row) => ({ ...row, scraped_at: scrapedAt })),
    {
      onConflict: "venue_code,meet_start_date,racer_id",
      optionalColumnGroups: NEXT_RACE_COLUMN_GROUPS,
    },
  );
  if (error)
    failures.push(`racer_series_points 書き込みエラー: ${error.message}`);
  else console.log(`💾 racer_series_points: ${rows.length}件`);

  // racer_series_points の書き込みに失敗しても、写しは書く（その日の値は後から取り直せない）
  const dailyVenues = selectDailyVenues(
    results.filter((r) => !r.notAttempted && r.rows.length > 0),
    lastRaces,
  );
  failures.push(...dailyVenues.failures);
  for (const v of dailyVenues.skipped)
    console.log(
      `  ➖ ${VENUE_NAMES[v.venueCode]}: 表は${v.asOfSeriesDay}日目${v.asOfRace}Rの時点（対象日は${v.seriesDay}日目）。日ごとの写しに書かない`,
    );
  for (const v of dailyVenues.pending)
    console.warn(
      `  ⏳ ${VENUE_NAMES[v.venueCode]}: 表は${v.asOfSeriesDay}日目${v.asOfRace}Rの時点（対象日は${v.seriesDay}日目・最終${v.lastRace}R）。補足の起動で取り直す`,
    );
  const daily = await writeDailyRows(
    client,
    buildDailyRows(targetDate, dailyVenues.write, scrapedAt),
  );
  if (daily.error) failures.push(daily.error);
  else if (daily.tableMissing)
    console.warn(
      `⚠️ ${DAILY_TABLE} が無い（マイグレーション192の未適用）。日ごとの写しを書かずに続ける`,
    );
  else
    console.log(
      `💾 ${DAILY_TABLE}: 書き込み${daily.written}件・変更なし${daily.unchanged}件`,
    );
  return {
    updated: !error,
    count: error ? 0 : rows.length,
    ...summary,
    daily: {
      written: daily.written,
      unchanged: daily.unchanged,
      tableMissing: daily.tableMissing,
      venues: dailyVenues.write.map((v) => v.venueCode),
      skippedVenues: dailyVenues.skipped,
      pendingVenues: dailyVenues.pending,
    },
  };
}

async function main() {
  console.log("📋 得点率取得開始");
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }
  // 取得の非常停止（fetch_stop、マイグレーション178）が立っていれば、SKIP 変数に関係なく公式へ取りに行かない（ADR-0101 決定6、BOA-1145 P4a ④a）
  if ((await isGhaFetchStopped()).stopped) {
    console.log("⏭️ 取得の非常停止中のため、取得を行わない");
    return;
  }
  const date = parseDateArg() || resolveTargetDate();
  console.log(`📅 対象日: ${date}`);
  const { failures } = await run(date);
  if (failures.length > 0) {
    console.error(`❌ 得点率取得に失敗（${failures.length}件）:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("🏁 完了");
}

export const _internal = {
  buildDailyRows,
  buildVenueLastRaces,
  selectDailyVenues,
  writeDailyRows,
  resolveTargetDate,
  isTableExpected,
  judgeVenue,
  buildVenueGrades,
  getActiveVenueGrades,
  getSeriesDay,
  fetchPointRank,
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}
