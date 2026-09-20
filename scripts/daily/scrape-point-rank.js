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
import { parsePointRankTable } from "../lib/pointRankParser.js";
import { mapWithConcurrency } from "../lib/scrapeJobs/concurrency.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

/**
 * SG/G1（記念競走）は節の4日目以降に必ず得点率表が出る（実測: 徳山G1・桐生SG・
 * 多摩川G1の4日目以降にテーブルあり、徳山G1の1〜3日目は表なし。2026-09-19確認）。
 * 1〜3日目は節によって異なる（2026-09-20実測: 多摩川G1は3日目にも49名の表あり）ため、保守的に
 * 4日目以降のみ「表が無ければ異常」とする（表があれば、日目を問わず書く）。
 * G2/G3/一般戦は表の有無が節ごとに異なるため対象外（2026-09-19の実測: G3の1・2日目と一般戦の1・4・5・6日目は表なし）。
 */
const TABLE_EXPECTED_GRADES = ["SG", "G1"];
const TABLE_EXPECTED_FROM_SERIES_DAY = 4;

const FETCH_TIMEOUT_MS = 15000;

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
 * 対象日に開催中の会場コードとレースグレードのMapを取得
 * @returns {Promise<Map<number, string|null>>} venueCode -> race_grade
 */
async function getActiveVenueGrades(date, client = supabase) {
  const { data, error } = await client
    .from("races")
    .select("race_id, race_grade")
    .like("race_id", `${date}%`);
  if (error) {
    throw new Error(`開催会場一覧の取得エラー: ${error.message}`);
  }
  return buildVenueGrades(data || []);
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
        return rows === null ? { kind: "none" } : { kind: "table", rows };
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
  const venueGrades = await getActiveVenueGrades(targetDate, client);
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
    }));
    console.log(`  ✅ ${name}: ${rows.length}名（開催初日${meetStartDate}）`);
    return { venueCode, expected, raceGrade, seriesDay, meetStartDate, rows };
  };

  const venueCodes = [...venueGrades.keys()].sort((a, b) => a - b);
  const results = await mapWithConcurrency(venueCodes, concurrency, async (venueCode) => {
    if (shouldStop()) return { venueCode, notAttempted: true, rows: [] };
    const result = await processVenue(venueCode);
    // 会場間の待機（サーバー負荷配慮）
    if (venueDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, venueDelayMs));
    }
    return result;
  });

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
    console.log(`🧪 dry-run: racer_series_points ${rows.length}件（書き込みなし）`);
    return { updated: false, count: 0, ...summary };
  }

  const { error } = await client
    .from("racer_series_points")
    .upsert(rows, { onConflict: "venue_code,meet_start_date,racer_id" });
  if (error) {
    failures.push(`racer_series_points 書き込みエラー: ${error.message}`);
    return { updated: false, count: 0, ...summary };
  }

  console.log(`💾 racer_series_points: ${rows.length}件`);
  return { updated: true, count: rows.length, ...summary };
}

async function main() {
  console.log("📋 得点率取得開始");
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
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
