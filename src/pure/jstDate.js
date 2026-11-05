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
