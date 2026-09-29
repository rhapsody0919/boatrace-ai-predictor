/**
 * 節（race_series、マイグレーション084）から「その日が節の何日目か」を導く（BOA-501）。
 *
 * 本筋は、出走表ページの日別タブから読む scrapeSeriesDay（scripts/lib/raceListParser.js）。
 * ただしタブが取れない・ラベルが既知の3パターン（初日・Ｎ日目・最終日）に当たらないと null になり、
 * race_conditions.series_day が当日に埋まらず、過去日を遡って埋める経路も無かった
 * （2026-09-28 の実測で、2025-12-02 以降の 10,115 レースが NULL）。
 * そこで、ページから読めなかったときだけ、節の開始日からの引き算で補う。
 *
 * 導出の規則（084_race_series.sql の設計どおり）:
 *   日目 = race_date − start_date + 1
 *
 * 導出はページの値と完全には一致しない。節の途中で丸一日が中止になると、公式は同じ日目を振り直すため、
 * それ以降の日は導出が1日ぶん進みすぎる。2026-02-03〜2026-09-28 の実測（ページから読めた 3,064 会場×日）で、
 * 一致 3,056・不一致 8（0.26%）。不一致は全て「導出 = ページ + 1」で、節の途中に全レース中止の日がある節だった
 * （戸田 2026-09-18〜24 の 09-21、蒲郡 2026-09-21〜28 の 09-22）。
 * したがって **ページから読めた値を必ず優先し**、導出は欠けているところだけを埋める。
 *
 * 中止日を数えて補正する案・節の中の既知の日を起点にする案も実測したが、
 * 前者は「最終日」がページ上 total_days に振り直される分だけ新たにずれ、後者は一致が 3,056→3,058 と
 * ほとんど変わらなかったため、単純な引き算のままにしている（KISS）。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" を UTC のミリ秒にする（不正な文字列は NaN） */
function toUtcMs(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))
    ? Date.parse(`${dateStr}T00:00:00Z`)
    : NaN;
}

/**
 * 節の開始日から、その日が何日目かを出す（純関数）。1未満になる・日付が不正な場合は null。
 *
 * @param {string} raceDate YYYY-MM-DD
 * @param {string} startDate YYYY-MM-DD（race_series.start_date）
 * @returns {number|null}
 */
export function deriveSeriesDay(raceDate, startDate) {
  const a = toUtcMs(raceDate);
  const b = toUtcMs(startDate);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const day = Math.round((a - b) / DAY_MS) + 1;
  return day >= 1 ? day : null;
}

/**
 * 会場ごとに、節の行を開始日の昇順で並べた索引を作る（純関数）。
 *
 * @param {Array<{venue_code: number, start_date: string, end_date: string}>} seriesRows
 * @returns {Map<number, Array<{venue_code: number, start_date: string, end_date: string}>>}
 */
export function indexSeriesByVenue(seriesRows) {
  const byVenue = new Map();
  for (const row of seriesRows) {
    const venue = Number(row.venue_code);
    if (!byVenue.has(venue)) byVenue.set(venue, []);
    byVenue.get(venue).push(row);
  }
  for (const rows of byVenue.values()) {
    rows.sort((a, b) =>
      String(a.start_date).localeCompare(String(b.start_date)),
    );
  }
  return byVenue;
}

/**
 * 会場・日付を含む節を、索引から引く（純関数）。見つからなければ null。
 * 節の期間は重ならない前提だが、万一重なったときは開始日が最も遅いものを採る。
 *
 * @param {ReturnType<typeof indexSeriesByVenue>} byVenue
 * @param {number} venueCode
 * @param {string} date YYYY-MM-DD
 */
export function findSeriesFor(byVenue, venueCode, date) {
  const rows = byVenue.get(Number(venueCode));
  if (!rows) return null;
  let found = null;
  for (const row of rows) {
    if (String(row.start_date) > date) break;
    if (String(row.end_date) >= date) found = row;
  }
  return found;
}

/**
 * 会場の節の中（開始日以降・指定日より前）に、中止・順延（確定）のレースがあるか（BOA-501）。
 *
 * @param {Array<{venue_code: number, race_date: string}>} cancelledRaces cancellation_status='confirmed' のレース
 * @param {number} venueCode
 * @param {string} startDate YYYY-MM-DD
 * @param {string} date YYYY-MM-DD（この日は含めない）
 */
export function hasCancellationBefore(
  cancelledRaces,
  venueCode,
  startDate,
  date,
) {
  return cancelledRaces.some(
    (r) =>
      r.venue_code === venueCode &&
      r.race_date >= startDate &&
      r.race_date < date,
  );
}

/**
 * ある1日について、会場コード → 何日目 の対応を作る（純関数）。
 *
 * @param {Array<{venue_code: number, start_date: string, end_date: string}>} seriesRows
 * @param {string} date YYYY-MM-DD
 * @returns {Map<number, number>} 導出できた会場だけを持つ
 */
export function buildSeriesDayByVenue(
  seriesRows,
  date,
  { cancelledRaces = [] } = {},
) {
  const byVenue = indexSeriesByVenue(seriesRows);
  const result = new Map();
  for (const venueCode of byVenue.keys()) {
    const series = findSeriesFor(byVenue, venueCode, date);
    if (!series) continue;
    // 節の中で、その日より前に中止・順延（確定）のレースがあれば、導出しない。公式は中止・順延の日に日目を
    // 振らないため、暦日からの引き算とずれる（津 2026-09-23 は公式2日目・導出3。BOA-501）
    if (
      hasCancellationBefore(cancelledRaces, venueCode, series.start_date, date)
    ) {
      continue;
    }
    const day = deriveSeriesDay(date, series.start_date);
    if (day !== null) result.set(venueCode, day);
  }
  return result;
}

/**
 * 指定日に開催中の節を、全会場ぶんまとめて1回読み、会場コード → 何日目 の Map にする。
 *
 * 読み取りに失敗したら、空の Map を返して続行する（例外にしない）。series_day はページから読めるのが本筋で、
 * これはその欠けを補うためのもの。節が読めないことで、レース情報の更新そのものを止めてはならない
 * （スケジュールの読み取り createScheduleLoader が throwOnError なのとは、必要度が違う）。
 *
 * @param {string} date YYYY-MM-DD
 * @param {{client: import("@supabase/supabase-js").SupabaseClient}} options
 * @returns {Promise<Map<number, number>>}
 */
export async function loadSeriesDayByVenue(date, { client }) {
  const warn = (reason) => {
    console.warn(
      `⚠️ 節（race_series）を読めませんでした。日目のフォールバックは行いません: ${reason}`,
    );
    return new Map();
  };
  try {
    // 開催中の節は最大24行（1会場1節）。ページングは要らない
    const { data, error } = await client
      .from("race_series")
      .select("venue_code, start_date, end_date")
      .lte("start_date", date)
      .gte("end_date", date);
    if (error) return warn(error.message);
    const seriesRows = data ?? [];
    if (seriesRows.length === 0) return new Map();
    // 節の中の中止・順延（確定）。読めなければ、ずれた日目を書くより、補わない方を選ぶ（空の Map）
    const minStart = seriesRows.reduce(
      (m, r) => (r.start_date < m ? r.start_date : m),
      date,
    );
    const cancelled = await client
      .from("races")
      .select("venue_code, race_date")
      .eq("cancellation_status", "confirmed")
      .gte("race_date", minStart)
      .lt("race_date", date);
    if (cancelled.error) return warn(cancelled.error.message);
    return buildSeriesDayByVenue(seriesRows, date, {
      cancelledRaces: cancelled.data ?? [],
    });
  } catch (e) {
    // 例外（通信の断・テーブル未適用など）でも、呼び出し側を止めない
    return warn(e?.message ?? String(e));
  }
}

/**
 * 過去分のバックフィルの計画（純関数。DBに触れない）。
 *
 * race_conditions は「行が無い」レースが大半（2026-09-28 の実測で NULL 10,115 件のうち 10,099 件は行そのものが無い。
 * 2025-12・2026-01 は出走表の取得が動いていなかった期間）。そのため、行のあるものは更新、無いものは挿入に分ける。
 * 既に series_day が入っている行は触らない。節が無い会場×日は埋めず、skipped に理由つきで残す。
 *
 * @param {Object} input
 * @param {Array<{race_id: string, race_date: string, venue_code: number}>} input.races 中止確定を除いた対象レース
 * @param {Map<string, number|null>} input.existingSeriesDay race_id → 既存の series_day（行が無い race_id は持たない）
 * @param {Array<{venue_code: number, start_date: string, end_date: string}>} input.seriesRows
 * @param {Array<{venue_code: number, race_date: string}>} [input.cancelledRaces] 中止・順延（確定）のレース。
 *   節の中でその日より前にあれば、そのレースは埋めない（skipped の series_has_cancellation）
 * @returns {{
 *   inserts: Array<{race_id: string, series_day: number}>,
 *   updates: Array<{race_id: string, series_day: number}>,
 *   skipped: Array<{race_id: string, race_date: string, venue_code: number, reason: "no_series"|"bad_dates"|"series_has_cancellation"}>,
 *   alreadyFilled: number,
 * }}
 */
export function planSeriesDayBackfill({
  races,
  existingSeriesDay,
  seriesRows,
  cancelledRaces = [],
}) {
  const byVenue = indexSeriesByVenue(seriesRows);
  const inserts = [];
  const updates = [];
  const skipped = [];
  let alreadyFilled = 0;

  for (const race of races) {
    const hasRow = existingSeriesDay.has(race.race_id);
    if (hasRow && existingSeriesDay.get(race.race_id) != null) {
      alreadyFilled++;
      continue;
    }
    const series = findSeriesFor(byVenue, race.venue_code, race.race_date);
    if (!series) {
      skipped.push({ ...race, reason: "no_series" });
      continue;
    }
    // 節の中で、その日より前に中止・順延（確定）があれば、導出はずれるため埋めない（BOA-501）
    if (
      hasCancellationBefore(
        cancelledRaces,
        race.venue_code,
        series.start_date,
        race.race_date,
      )
    ) {
      skipped.push({ ...race, reason: "series_has_cancellation" });
      continue;
    }
    const seriesDay = deriveSeriesDay(race.race_date, series.start_date);
    if (seriesDay === null) {
      skipped.push({ ...race, reason: "bad_dates" });
      continue;
    }
    (hasRow ? updates : inserts).push({
      race_id: race.race_id,
      series_day: seriesDay,
    });
  }
  return { inserts, updates, skipped, alreadyFilled };
}
