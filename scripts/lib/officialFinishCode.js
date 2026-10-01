/**
 * 公式の成績コード（Kファイルの着順欄。01〜06・F・L0・L1・K0・K1・S0・S1・S2 等）を、
 * race_start_timings.official_finish_code に書く行へ変換する（BOA-553。純粋関数）。
 *
 * 結果ページ由来の finish_mark（転・落・欠・妨 等の文字）では、責任の有無（S0 と S1、K0 と K1）を区別できない。
 * 公式のモーター2連率は、S0（選手責任外の失格）・K0（選手責任外の欠場）を分母に入れない（BOA-549 の実測）。
 * 責任の有無まで持つのは Kファイルだけで、アーカイブ（kb_archive_boats.finish_raw）は、本体テーブルとの
 * 重複を避けるため 2025-12-02 で打ち切っている（kb-backfill.js）。そこで本体の艇単位の表に列を足して持つ。
 *
 * 値は Kファイルの表記のまま（全角は正規化済み。kbFileParser が返す finish_raw）。読み替えはしない。
 */
import { parseKText } from "./kbFileParser.js";

export const OFFICIAL_FINISH_CODE_COLUMN = "official_finish_code";

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Kファイルのテキストから、艇ごとの成績コードの行を作る。
 *
 * @param {string} text Kファイル（デコード済み）
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Array<{race_id: string, boat_number: number, official_finish_code: string}>}
 */
export function buildOfficialFinishCodeRows(text, dateStr) {
  const rows = [];
  for (const venue of parseKText(text).venues) {
    for (const race of venue.races) {
      const raceId = `${dateStr}-${pad2(venue.venue_code)}-${pad2(race.race_number)}`;
      for (const row of race.rows ?? []) {
        const code =
          typeof row.finish_raw === "string" ? row.finish_raw.trim() : "";
        if (!code || !Number.isInteger(row.boat_number)) continue;
        rows.push({
          race_id: raceId,
          boat_number: row.boat_number,
          [OFFICIAL_FINISH_CODE_COLUMN]: code,
        });
      }
    }
  }
  return rows;
}
