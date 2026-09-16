/**
 * 日付ユーティリティ（バックエンド用）
 * JST（日本標準時）での日付処理を一元管理
 */

const JST_OFFSET = 9 * 60; // UTC+9 in minutes

/**
 * 今日の日付をJSTで取得
 * @returns {string} YYYY-MM-DD形式
 */
export function getTodayDateJST() {
  const now = new Date();
  const jstDate = new Date(now.getTime() + JST_OFFSET * 60 * 1000);
  return jstDate.toISOString().split("T")[0];
}

/**
 * 昨日の日付をJSTで取得
 * @returns {string} YYYY-MM-DD形式
 */
export function getYesterdayDateJST() {
  const now = new Date();
  const jstNow = new Date(now.getTime() + JST_OFFSET * 60 * 1000);
  const yesterday = new Date(jstNow.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().split("T")[0];
}

/**
 * N日前の日付をJSTで取得
 * @param {number} days - 何日前か
 * @returns {string} YYYY-MM-DD形式
 */
export function getDateDaysAgo(days) {
  const now = new Date();
  const jstNow = new Date(now.getTime() + JST_OFFSET * 60 * 1000);
  const target = new Date(jstNow.getTime() - days * 24 * 60 * 60 * 1000);
  return target.toISOString().split("T")[0];
}

/**
 * 日付をURL用フォーマット（YYYYMMDD）に変換
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {string} YYYYMMDD形式
 */
export function formatDateForUrl(dateStr) {
  return dateStr.replace(/-/g, "");
}

/**
 * CLIの--date=引数から日付を取得
 * @param {string[]} args - process.argv.slice(2)
 * @returns {string|null} YYYY-MM-DD形式またはnull
 */
export function parseDateArg(args = process.argv.slice(2)) {
  const dateArg = args.find((arg) => arg.startsWith("--date="));
  return dateArg ? dateArg.split("=")[1] : null;
}

/**
 * 現在のJSTの時刻を取得
 * @returns {Date} JST時刻のDateオブジェクト
 */
export function getJSTNow() {
  const now = new Date();
  return new Date(now.getTime() + JST_OFFSET * 60 * 1000);
}

/**
 * 今月の開始日と終了日をJSTで取得
 * @returns {Object} { start, end, year, month }
 */
export function getThisMonthRange() {
  const jstNow = getJSTNow();
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth() + 1;
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-31`;
  return { start, end, year, month };
}

/**
 * 先月の開始日と終了日をJSTで取得
 * @returns {Object} { start, end, year, month }
 */
export function getLastMonthRange() {
  const jstNow = getJSTNow();
  let year = jstNow.getUTCFullYear();
  let month = jstNow.getUTCMonth(); // 0-indexed, so this is "last month"

  if (month === 0) {
    month = 12;
    year -= 1;
  }

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-31`;
  return { start, end, year, month };
}

/**
 * 日付文字列から年月日を抽出
 * @param {string} dateStr - YYYY-MM-DD形式
 * @returns {Object} { year, month, day }
 */
export function parseDateInfo(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

/**
 * race_idから日付を抽出
 * @param {string} raceId - YYYY-MM-DD-VV-RR形式
 * @returns {string} YYYY-MM-DD形式
 */
export function extractDateFromRaceId(raceId) {
  return raceId.substring(0, 10);
}

/**
 * race_idから会場コードを抽出
 * @param {string} raceId - YYYY-MM-DD-VV-RR形式
 * @returns {number} 会場コード (1-24)
 */
export function extractVenueCodeFromRaceId(raceId) {
  return parseInt(raceId.substring(11, 13), 10);
}

/**
 * 日付文字列に日数を加算する（実行環境のローカルタイムゾーンに依存しない、UTC基準の計算）
 * @param {string} dateStr - YYYY-MM-DD形式
 * @param {number} days - 加算する日数（負の値で減算）
 * @returns {string} YYYY-MM-DD形式
 */
export function addDaysToDateString(dateStr, days) {
  const { year, month, day } = parseDateInfo(dateStr);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
