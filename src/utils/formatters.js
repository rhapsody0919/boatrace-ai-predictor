/**
 * フォーマット関数
 * 日付、パーセント、金額等のフォーマット処理を一元管理
 */

import { WEEKDAYS } from "../constants";

/**
 * パーセント表示
 * @param {number} rate - 0-1の割合
 * @returns {string} パーセント文字列 (例: "75.5%")
 */
export const formatPercent = (rate) => (rate * 100).toFixed(1) + "%";

/**
 * 日付フォーマット（フル形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string} YYYY年M月D日(曜日) 形式
 */
export const formatDate = (dateStr) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return `${year}年${month}月${day}日(${weekday})`;
};

/**
 * 日付フォーマット（短縮形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string} M/D(曜日) 形式
 */
export const formatDateShort = (dateStr) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return `${month}/${day}(${weekday})`;
};

/**
 * 日付フォーマット（複数形式を返す）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {Object} full, short, yearMonth の各形式
 */
export const formatDateObject = (dateStr) => {
  const date = new Date(dateStr + "T00:00:00+09:00");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return {
    full: `${year}年${month}月${day}日(${weekday})`,
    short: `${month}/${day}(${weekday})`,
    yearMonth: `${year}年${month}月`,
  };
};

/**
 * 最終更新日時フォーマット
 * @param {string} isoString - ISO 8601形式の日時
 * @returns {string} YYYY/M/D HH:MM 形式
 */
/**
 * 金額フォーマット
 * @param {number} amount - 金額
 * @returns {string} カンマ区切り+円 (例: "1,234円")
 */
export const formatPayout = (amount) => amount.toLocaleString() + "円";

/**
 * 回収率フォーマット
 * @param {number} rate - 回収率 (1.0 = 100%)
 * @returns {string} パーセント文字列 (例: "125.5%")
 */
export const formatRecoveryRate = (rate) => (rate * 100).toFixed(1) + "%";
