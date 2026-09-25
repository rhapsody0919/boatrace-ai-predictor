/**
 * ピットレポート（選手コメント）の公式URL導出と、取得対象レースの判定（BOA-379）
 *
 * 取得側の `scripts/lib/pitReportJob.js` の `buildPitReportUrl` および
 * `scripts/lib/pitReportRows.js` の `isPitReportCandidate` と同じ規則を、画面側にも置く
 * （設計: docs/design/pit-comments/screens.md §3.4・§9）。取得側はNode専用の
 * モジュール群に依存しているため import できず、規則だけを純関数として再掲する。
 * 規則を変える場合は両方を合わせて直すこと。
 */

const RACE_ID_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/;

/** ピットレポートが存在しうるグレード（公式の実測。G3・一般戦は対象外） */
export const PIT_REPORT_GRADES = ["SG", "G1", "G2"];

/** SG以外（G1・G2）で対象になる最小のレース番号 */
export const PIT_REPORT_MIN_RACE_NUMBER_NON_SG = 7;

/**
 * race_id（YYYY-MM-DD-VV-RR）から、公式のピットレポートのページURLを作る。
 * 形式が不正なら null（画面側は例外にせず、リンクを出さないだけにする）
 */
export function buildPitReportUrl(raceId) {
  const m = RACE_ID_RE.exec(String(raceId ?? ""));
  if (!m) return null;
  const [, y, mo, d, venue, race] = m;
  return `https://www.boatrace.jp/owpc/pc/race/pitreport?rno=${Number(race)}&jcd=${venue}&hd=${y}${mo}${d}`;
}

/**
 * 画面がピットレポートを取りにいく候補のレースか。
 *
 * 取得側（isPitReportCandidate）との違いは、`raceGrade` が未取得（NULL）のレースを
 * 候補に含める点だけ（screens.md §9）。races.race_grade は2026-02-03より前の期間で
 * 半数近くがNULLのため、除外すると過去分のバックフィル後にコメントがあっても
 * 画面に出せなくなる。NULLのレースは行が無ければ「対象外」として何も出ないため、
 * 余分に出る表示は無い（空振りのSELECTが1往復増えるだけ）。
 *
 * @param {{raceGrade: string|null|undefined, raceNumber: number}} params
 */
export function isPitReportCandidate({ raceGrade, raceNumber }) {
  if (!Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 12) {
    return false;
  }
  if (raceGrade == null) return true;
  if (!PIT_REPORT_GRADES.includes(raceGrade)) return false;
  if (raceGrade === "SG") return true;
  return raceNumber >= PIT_REPORT_MIN_RACE_NUMBER_NON_SG;
}
