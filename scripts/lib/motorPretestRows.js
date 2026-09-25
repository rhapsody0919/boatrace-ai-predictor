/**
 * 前検タイム（N23、motor_pretest_stats）の、行の組み立て・期待件数の算出・書き込み。
 * 日次ジョブ（motorPretestJob.js）と、過去分の一括取得CLI（scripts/maintenance/motor-pretest-backfill.js）が共有する
 * （取得ロジックを二重実装しない。.claude/rules/data-acquisition.md §1）。
 *
 * 期待件数の算出（完了の定義A）: 観測から分母を作らない。その日の (会場, 選手) の期待は、DBの races・race_entries から
 * 決める（会場＝races にその日のレースがある会場、選手＝その会場のレースの race_entries の登録番号）。確定中止
 * （races.cancellation_status='confirmed'）のレースの選手は分母から除き、除外した件数を報告する。ページには、節の全選手
 * （その日に走らない選手を含む）が載るため、期待の選手はページの部分集合になる。
 */
import { upsertChangedRows } from "./unchangedRows.js";
import { isCancellationConfirmed } from "./cancellationStatus.js";

export const MOTOR_PRETEST_TABLE = Object.freeze({
  table: "motor_pretest_stats",
  onConflict: "race_date,venue_code,racer_id",
  keyColumns: Object.freeze(["race_date", "venue_code", "racer_id"]),
});

/** 保存する列（キー・値・開催名）。created_at・updated_at は、DBの DEFAULT と、書き込み側の stampUpdatedAt が扱う */
export const MOTOR_PRETEST_VALUE_COLUMNS = Object.freeze([
  "racer_class",
  "motor_number",
  "motor_2rate",
  "boat_number",
  "boat_2rate",
  "pretest_time",
  "pretest_rank",
  "series_title",
]);

/**
 * パース結果から、保存する行を作る（純関数）。
 *
 * @param {{venueCode: number, date: string, parsed: {seriesTitle: string|null, rows: Array<Object>}}} params
 */
export function buildMotorPretestRows({ venueCode, date, parsed }) {
  return parsed.rows.map((row) => ({
    race_date: date,
    venue_code: venueCode,
    racer_id: row.racer_id,
    racer_class: row.racer_class,
    motor_number: row.motor_number,
    motor_2rate: row.motor_2rate,
    boat_number: row.boat_number,
    boat_2rate: row.boat_2rate,
    pretest_time: row.pretest_time,
    pretest_rank: row.pretest_rank,
    series_title: parsed.seriesTitle,
  }));
}

/**
 * 変更のある行だけを書く（変更の無い行は書かない。取得時刻 updated_at は、変更のある行にだけ設定する）。
 * テーブルが無い（マイグレーション090が未適用）ときは、成功にせず、理由の分かるエラーにする。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {Array<Object>} rows
 * @param {{dryRun?: boolean, now?: Date|null}} [options]
 * @returns {Promise<number>} 書き込んだ行数（dryRun では書くはずの行数）
 */
export async function writeMotorPretestRows(
  client,
  rows,
  { dryRun = false, now = null } = {},
) {
  if (rows.length === 0) return 0;
  const result = await upsertChangedRows(
    client,
    MOTOR_PRETEST_TABLE.table,
    rows,
    {
      onConflict: MOTOR_PRETEST_TABLE.onConflict,
      keyColumns: [...MOTOR_PRETEST_TABLE.keyColumns],
      // 既存行は、日付ごとに取得する（1日で最大24会場×約50人＝約1,200行のため、1回の取得は1日分のみ）
      chunkColumn: "race_date",
      chunkSize: 1,
      stampUpdatedAt: true,
      dryRun,
      now,
      label: MOTOR_PRETEST_TABLE.table,
    },
  );
  if (result.error) {
    const raw = result.error.message ?? String(result.error);
    // PostgREST: PGRST205「Could not find the table 'public.x' in the schema cache」、直接接続: 42P01「relation ... does not exist」
    if (/Could not find the table|does not exist/i.test(raw)) {
      throw new Error(
        `${MOTOR_PRETEST_TABLE.table} がありません（マイグレーション090が未適用の可能性）: ${raw}`,
      );
    }
    throw result.error;
  }
  return dryRun ? result.toWrite.length : result.written;
}

/**
 * その日の、取得する会場と、期待する選手（会場ごと）。races・race_entries からのみ作る。読み取りに失敗したら例外
 * （「レースが無い」と誤判定しない）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<{
 *   venues: Array<{venueCode: number}>,
 *   expectedByVenue: Map<number, Set<number>>,
 *   raceCount: number,
 *   excludedCancelledRaces: number,
 * }>}
 */
export async function loadExpectedRacers(client, date) {
  const races = await client
    .from("races")
    .select("race_id, venue_code, cancellation_status")
    .eq("race_date", date);
  if (races.error) {
    throw new Error(
      `前検タイム: racesの取得に失敗しました: ${races.error.message}`,
    );
  }
  const rows = races.data ?? [];
  const venueCodes = [...new Set(rows.map((r) => r.venue_code))].sort(
    (a, b) => a - b,
  );
  const live = rows.filter(
    (r) => !isCancellationConfirmed(r.cancellation_status),
  );
  const venueByRace = new Map(rows.map((r) => [r.race_id, r.venue_code]));
  const expectedByVenue = new Map(venueCodes.map((v) => [v, new Set()]));

  const ids = live.map((r) => r.race_id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const entries = await client
      .from("race_entries")
      .select("race_id, racer_id")
      .in("race_id", chunk);
    if (entries.error) {
      throw new Error(
        `前検タイム: race_entriesの取得に失敗しました: ${entries.error.message}`,
      );
    }
    for (const e of entries.data ?? []) {
      if (e.racer_id === null || e.racer_id === undefined) continue;
      expectedByVenue.get(venueByRace.get(e.race_id))?.add(e.racer_id);
    }
  }
  return {
    venues: venueCodes.map((venueCode) => ({ venueCode })),
    expectedByVenue,
    raceCount: rows.length,
    excludedCancelledRaces: rows.length - live.length,
  };
}

/**
 * 会場1つ分の、期待した選手がページに載っているか・前検タイムが入っているかの集計（純関数）。
 *
 * @param {Array<{racer_id: number, pretest_time: number|null}>} rows ページの行
 * @param {Set<number>} expected 期待する選手
 */
export function summarizeVenueCoverage(rows, expected) {
  const present = new Set(rows.map((r) => r.racer_id));
  const missing = [...expected]
    .filter((id) => !present.has(id))
    .sort((a, b) => a - b);
  const expectedRows = rows.filter((r) => expected.has(r.racer_id));
  return {
    pageRows: rows.length,
    expected: expected.size,
    missing,
    pretestFilled: rows.filter((r) => r.pretest_time !== null).length,
    expectedWithTime: expectedRows.filter((r) => r.pretest_time !== null)
      .length,
  };
}
