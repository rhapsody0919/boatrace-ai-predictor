/**
 * 出走表（racelist）過去分バックフィルの、行の組み立て・URL・アーカイブパス（純関数。DB・取得先に接続しない）
 *
 * 背景: docs/design/pre-race-full-fields/plan.md §6（N19）。3連率（全国・当地・モーター・ボート）は、
 * Kファイルの累積からの導出を検証したが完全一致率が約5%（30/582）にとどまり不採用、公式の出走表
 * （racelist）ページを直接再取得する方針に切り替えた（2026-09-22、独立レビュー・ユーザー承認）。
 *
 * 上書き方針（最重要）: 実データ確認（2025-12-03-01-07 他）で、同じレースの racelist ページを今再取得すると、
 * win_rate・motor_number・boat_number_id 等は、当時のスナップショット（発走60分前）と異なる値になることを確認した
 * （節の途中のモーター・ボート交換、勝率の当日以降の更新等が理由と推定）。そのため、このモジュールが書く行は
 * 「既存値が NULL の列だけ」に限定する（RACELIST_BACKFILL_COLUMNS）。既に値のある列（win_rate・motor_number・
 * boat_number_id・2連率系列を含む）には、たとえ再取得した値と異なっていても、絶対に触れない。
 * 対象は「3連率がNULLの行」（N19）に限定し、同じ取得で埋められる F数・L数・体重・支部・出身地・欠場フラグも
 * 一緒に埋める（重複取得を避ける。2連率等の他の欠落は別スコープ）。
 */

/** 既存値がNULLのときだけ埋める列（3連率4種 + マイグレーション081の追加列） */
export const RACELIST_BACKFILL_COLUMNS = Object.freeze([
  "global_3rate",
  "local_3rate",
  "motor_3rate",
  "boat_3rate",
  "f_count",
  "l_count",
  "weight_kg",
  "branch",
  "hometown",
  "is_absent",
]);

const RACE_ID_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})$/;

/** race_id（YYYY-MM-DD-VV-RR）を分解する。形式が不正なら例外 */
export function parseRaceId(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  return { date: m[1], venueCode: Number(m[2]), raceNumber: Number(m[3]) };
}

/** 出走表ページのURL（scripts/lib/scrapeJobs/preRaceHandlers.js の fetchRaceInfoDetailed と同じ規則） */
export function buildRacelistUrl(raceId) {
  const { date, venueCode, raceNumber } = parseRaceId(raceId);
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${raceNumber}&jcd=${jcd}&hd=${ymd}`;
}

/** アーカイブ内の相対パス（生HTML・中間JSON共通）。月ごとにディレクトリを分ける（kbArchiveRelPathと同じ考え方） */
export function racelistArchiveRelPath(raceId, extension) {
  const { date } = parseRaceId(raceId);
  return `${date.slice(0, 7)}/${raceId}.${extension}`;
}

/**
 * 1艇分の書き込み行を作る。既存値がNULLの列だけを埋める（既存の値には触れない）。
 * 埋める列が1つも無ければ null を返す（呼び出し側で除外する）。
 *
 * @param {{race_id: string, boat_number: number} & Record<string, unknown>} existingRow race_entries の既存行
 *   （RACELIST_BACKFILL_COLUMNS を含む select 結果）
 * @param {Record<string, unknown>} entry raceListParser.js の entries の1艇分
 * @returns {(Record<string, unknown>)|null}
 */
export function buildFillRow(existingRow, entry) {
  const row = {
    race_id: existingRow.race_id,
    boat_number: existingRow.boat_number,
  };
  let filled = false;
  for (const column of RACELIST_BACKFILL_COLUMNS) {
    const current = existingRow[column];
    if (current !== null && current !== undefined) continue; // 既存の値は上書きしない
    const value = entry[column];
    if (value === null || value === undefined) continue; // 出走表からも取れなければ書かない
    row[column] = value;
    filled = true;
  }
  return filled ? row : null;
}

/**
 * 1レース分の書き込み行を作る。艇番で既存行と出走表のentryを対応付ける。
 *
 * @param {Array<{race_id: string, boat_number: number}>} existingRows 対象レースの既存6行（race_entries）
 * @param {Array<{boat_number: number}>} entries raceListParser.js の parseRaceListPage(...).entries
 * @returns {{rows: Object[], unmatchedBoats: number[]}}
 *   unmatchedBoats: 出走表に対応するentryが無かった既存行の艇番（構造の変更・解析漏れの疑い。呼び出し側で警告する）
 */
export function buildFillRowsForRace(existingRows, entries) {
  const byBoat = new Map(entries.map((e) => [e.boat_number, e]));
  const rows = [];
  const unmatchedBoats = [];
  for (const existing of existingRows) {
    const entry = byBoat.get(existing.boat_number);
    if (!entry) {
      unmatchedBoats.push(existing.boat_number);
      continue;
    }
    const row = buildFillRow(existing, entry);
    if (row) rows.push(row);
  }
  return { rows, unmatchedBoats };
}

/**
 * バックフィル対象のレースID一覧（global_3rate が NULL の行を持つレース）を、本番DBの読み取りで確定する。
 * 読み取りのみ（書き込みなし）。race_entries は主キーが (race_id, boat_number) のため、両方でorderして
 * range によるページングを安定させる。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{from?: string, to?: string, pageSize?: number}} [options]
 *   from/to: race_id の文字列比較で絞り込む日付境界（YYYY-MM-DD）。race_id は YYYY-MM-DD-VV-RR の
 *   ゼロ埋め固定長のため、日付の文字列比較がそのまま日付順になる
 * @returns {Promise<string[]>} 昇順・重複なしの race_id
 */
export async function loadTargetRaceIds(
  client,
  { from, to, pageSize = 1000 } = {},
) {
  const ids = new Set();
  let offset = 0;
  for (;;) {
    // フィルタ（gte/lte）は range() より前に付ける。range() を先に呼ぶと、実装によっては
    // その時点で確定した条件のみでページングしてしまうため（フェイクSupabaseクライアントでの検証で判明）
    let query = client
      .from("race_entries")
      .select("race_id")
      .is("global_3rate", null);
    if (from) query = query.gte("race_id", from);
    if (to) query = query.lte("race_id", `${to}-99-99`);
    query = query
      .order("race_id", { ascending: true })
      .order("boat_number", { ascending: true })
      .range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error)
      throw new Error(
        `race_entries の対象取得に失敗しました: ${error.message}`,
      );
    for (const row of data ?? []) ids.add(row.race_id);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  return [...ids].sort();
}
