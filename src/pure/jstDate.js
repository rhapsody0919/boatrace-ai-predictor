const JST_OFFSET = 9 * 60; // UTC+9 in minutes

/**
 * 現在のJST日時を取得
 * @param {Date} [now] - 基準時刻（既定は現在時刻）
 * @returns {Date} JST日時のDateオブジェクト
 */
export const getJSTNow = (now = new Date()) => {
  return new Date(now.getTime() + JST_OFFSET * 60 * 1000);
};

/**
 * N日前の日付をJSTで取得
 * @param {number} days - 何日前か
 * @param {Date} [now] - 基準時刻（既定は現在時刻）
 * @returns {string} YYYY-MM-DD形式
 */
export const getDaysAgoJST = (days, now = new Date()) => {
  const jstNow = getJSTNow(now);
  const target = new Date(jstNow.getTime() - days * 24 * 60 * 60 * 1000);
  return target.toISOString().split("T")[0];
};

// 曜日の字。src/constants の WEEKDAYS と同じ並び（src/pure は定数を読めないので持つ。一致は verify-jst-date-format-pure.js が見る）
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * YYYY-MM-DD（日本の暦日。レースの開催日等）を年・月・日・曜日に分ける。
 * 文字列の年月日をそのまま使い、実行環境のタイムゾーンに左右されないようにする。
 * `new Date(dateStr + "T00:00:00+09:00")` をローカル時刻の getDate() で読むと、
 * JST より西（UTC のサーバー・海外のブラウザ）で前日になる（ADR 0089、BOA-1092）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {{year: number, month: number, day: number, weekday: string}}
 */
export const splitJstDate = (dateStr) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const weekday =
    WEEKDAYS_JA[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return { year, month, day, weekday };
};

/**
 * 日付フォーマット（フル形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string} YYYY年M月D日(曜日) 形式
 */
export const formatDate = (dateStr) => {
  const { year, month, day, weekday } = splitJstDate(dateStr);
  return `${year}年${month}月${day}日(${weekday})`;
};
