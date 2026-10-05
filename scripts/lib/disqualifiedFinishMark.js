/**
 * BOA-582(2): 失格（Kファイルの成績コード S0〜S2）の艇の着欄（finish_mark）を、結果ページから決める（純関数）。
 *
 * Kファイルの成績コードは、失格を S0（選手責任外）・S1・S2 に分けるだけで、結果ページの着欄の表記
 * （転・落・沈・妨・エ・失）は決まらない（2026-09-21〜30 の実測: S0→転・落・エ・失、S1→転・落・エ・沈、S2→妨）。
 * そこで、失格の艇がいるレースだけ結果ページを取り直し、その艇の着欄を読む。
 * 着欄が失格の表記でない（Kと食い違う）艇・着順表に無い艇は書かずに異常とする。
 * CLI: scripts/maintenance/backfill-disqualified-finish-marks.js
 */

/** 結果ページの着欄（NFKC 正規化後）で、K の失格コードに対応しうる表記（raceResultParser.js の FINISH_MARKS のうち、返還されないもの） */
export const DISQUALIFIED_MARKS = Object.freeze(
  new Set(["転", "落", "沈", "妨", "エ", "失"]),
);

/** K の失格コード（S0・S1・S2） */
export const isDisqualifiedCode = (code) => /^S[0-2]$/.test(code ?? "");

/**
 * 1レース分の書く行を作る。
 *
 * @param {string} raceId
 * @param {{boat_number: number, finish_mark: string|null}[]} parsedBoats 結果ページの着順表（parseRaceResultPage の boats）
 * @param {{boat_number: number, official_finish_code: string}[]} targets そのレースの、着欄が NULL で失格コードの艇（既存の行）
 * @returns {{rows: {race_id: string, boat_number: number, finish_mark: string}[], anomalies: string[]}}
 */
export function buildDisqualifiedMarkRows(raceId, parsedBoats, targets) {
  const rows = [];
  const anomalies = [];
  for (const t of targets) {
    const boat = parsedBoats.find((b) => b.boat_number === t.boat_number);
    if (!boat) {
      anomalies.push(`${raceId} ${t.boat_number}号艇: 着順表に無い`);
      continue;
    }
    if (!DISQUALIFIED_MARKS.has(boat.finish_mark)) {
      anomalies.push(
        `${raceId} ${t.boat_number}号艇: 着欄「${boat.finish_mark}」は失格（${t.official_finish_code}）と合わない`,
      );
      continue;
    }
    rows.push({
      race_id: raceId,
      boat_number: t.boat_number,
      finish_mark: boat.finish_mark,
    });
  }
  return { rows, anomalies };
}

/**
 * BOA-667: 公式の着順表の行の順（official_row）を、取り直した結果ページから既存の行へ写す。
 * DB の着・着欄から導けないレース（非完走の記号が2種類以上・着欄が NULL の艇がいる）だけが対象
 * （導けるレースは docs/issues/boa-667-official-row-backfill.md の SQL が埋める）。
 * 着順表に無い艇（既存の行はあるのにページに無い）は書かずに異常とする。
 *
 * @param {string} raceId
 * @param {{boat_number: number, official_row: number}[]} parsedBoats parseRaceResultPage の boats
 * @param {{boat_number: number}[]} targets そのレースの、official_row が NULL の既存の行
 * @returns {{rows: {race_id: string, boat_number: number, official_row: number}[], anomalies: string[]}}
 */
export function buildOfficialRowRows(raceId, parsedBoats, targets) {
  const rows = [];
  const anomalies = [];
  for (const t of targets) {
    const boat = parsedBoats.find((b) => b.boat_number === t.boat_number);
    if (!boat || !Number.isInteger(boat.official_row)) {
      anomalies.push(
        `${raceId} ${t.boat_number}号艇: 着順表に無い（行の順を書かない）`,
      );
      continue;
    }
    rows.push({
      race_id: raceId,
      boat_number: t.boat_number,
      official_row: boat.official_row,
    });
  }
  return { rows, anomalies };
}
