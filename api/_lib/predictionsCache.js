/**
 * /api/predictions/{date}（api/predictions/[date].js）の CDN キャッシュの長さを、日付から決める。
 *
 * レースの日付は JST。以前は当日かどうかを UTC の日付（toISOString）で比べていたため、JST 0:00〜8:59 は
 * 当日 D を「過去」と判定し、s-maxage=86400 を付けていた（BOA-848 第2段の確認で判明）。朝の取り込み途中の内容が
 * 次のデプロイまで CDN に残りうる。JST の今日より前の日付だけを過去として長くする（今日・未来は短いまま）
 *
 * 検証: scripts/maintenance/verify-predictions-cache.js
 */

const SHORT = "s-maxage=300, stale-while-revalidate=60";
const LONG = "s-maxage=86400, stale-while-revalidate=3600";

/** JST の今日（YYYY-MM-DD） */
export function jstDate(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().split("T")[0];
}

/**
 * @param {string} date - YYYY-MM-DD（JST）
 * @param {number} nowMs
 * @returns {string} Cache-Control の値
 */
export function predictionsCacheControl(date, nowMs) {
  // 今日のデータ: 5分キャッシュ（morning-init が全レースを逐次ロードする間に
  //   古い部分データがキャッシュされても 5分以内に正しいデータへ更新される）
  // 過去データ: 1日キャッシュ
  return date < jstDate(nowMs) ? LONG : SHORT;
}
