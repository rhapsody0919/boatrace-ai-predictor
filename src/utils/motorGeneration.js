/**
 * モーターの世代（入れ替え単位）の判定。
 *
 * ボートレース場は概ね年1回モーターを全基入れ替え、モーター番号は新世代でも再利用される。
 * そのため「会場×モーター番号」だけで過去のレースを集めると、入れ替え前の別モーターの
 * 成績が混ざる。世代の区切りは venue_motor_start_dates（BOATCAST bc_mst の使用開始日、
 * N26。新しい日付が現れるたびに追記される履歴）の最新の日付を使う。
 */

/**
 * 会場の使用開始日の行から、現行世代の開始日（最新の日付）を返す。
 * 行が無い（まだ取得できていない）場合は null。
 * @param {ReadonlyArray<{start_date: string}>} rows
 * @returns {string|null} YYYY-MM-DD
 */
export function currentMotorGenerationStart(rows) {
  return (rows ?? []).reduce(
    (latest, row) =>
      latest === null || row.start_date > latest ? row.start_date : latest,
    null,
  );
}

/**
 * race_id（YYYY-MM-DD-VV-RR）のレースが、generationStart 以降（当日を含む）に行われたか。
 * 使用開始日の当日から新モーターが使われるため、当日は現行世代に含める。
 * @param {string} raceId
 * @param {string} generationStart YYYY-MM-DD
 * @returns {boolean}
 */
export function isInMotorGeneration(raceId, generationStart) {
  return raceId.slice(0, 10) >= generationStart;
}

/**
 * 使用開始日（YYYY-MM-DD）の画面表示。既定は「2026/8/6」、short で「8/6」。
 * 数字だけの表記なので4言語で共通にする（2026-09-29 ユーザー判断 B で画面に出す）
 * @param {string|null} date
 * @param {{short?: boolean}} [options]
 * @returns {string}
 */
export function formatGenerationDate(date, { short = false } = {}) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return short ? `${m}/${d}` : `${y}/${m}/${d}`;
}

/**
 * 「baseDate から days 日遡る期間」の開始が、使用開始日で切り詰められるか
 * （generationStart > baseDate − days）。入れ替えから日が浅く、短い方の期間
 * （直近1ヶ月）まで切り詰められると、期間の切り替えを押しても中身が変わらない
 * @param {string|null} generationStart YYYY-MM-DD
 * @param {string} baseDate YYYY-MM-DD
 * @param {number} days
 * @returns {boolean}
 */
export function isClippedByGeneration(generationStart, baseDate, days) {
  if (!generationStart) return false;
  const start = new Date(`${baseDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return generationStart > start.toISOString().split("T")[0];
}
