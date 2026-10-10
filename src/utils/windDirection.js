/**
 * 風向の表示（BOA-819）。
 *
 * race_conditions.wind_direction（日ごとのレースの JSON の weather.windDirection も同じ値）は、直前情報ページの
 * 風向アイコン `is-windN` を「1=北 … 16=北北西」と方位名にしたもの（scripts/lib/beforeinfoWeather.js）。
 * 実際のアイコンは、会場ごとに北の向きが違う水面の図（方位マーク `is-directionM`）に対する向きで、本当の方位ではない。
 * 画面に出すときは会場ごとの角度を引いて本当の方位に直す。DB の値は変えない（龍神ソナーのモデルが
 * この基準のまま読み、同じ表で直している。src/utils/analogyRaceFeatures.js の windOffsetFor）。
 *
 * 角度の表は scripts/ml/analogy/wind_basis.json の offsets_deg（(方位マーク M − 9) × 22.5°）の写し。
 * 一致は scripts/maintenance/verify-wind-direction-display.js が確かめる。
 * 検証（2026-10-10）: 2026-09 の全場 3,835 レースで公式の競走成績（K ファイル）の風向と比べ、直した後の一致は 77.8%
 * （直す前 8.2%）、観測時刻のある 1,736 レースでは 100%（残りは 2R 以降の直前情報が前のレースの時点の気象のため）
 */

export const WIND_DIRECTIONS = Object.freeze([
  "北",
  "北北東",
  "北東",
  "東北東",
  "東",
  "東南東",
  "南東",
  "南南東",
  "南",
  "南南西",
  "南西",
  "西南西",
  "西",
  "西北西",
  "北西",
  "北北西",
]);

/** 会場コード → 画面の風向から引く角度（度） */
export const VENUE_WIND_OFFSET_DEG = Object.freeze({
  1: 112.5,
  2: 157.5,
  3: 247.5,
  4: 270,
  5: 0,
  6: 90,
  7: 45,
  8: 0,
  9: 337.5,
  10: 112.5,
  11: 90,
  12: 90,
  13: 22.5,
  14: 135,
  15: 315,
  16: 90,
  17: 45,
  18: 315,
  19: 45,
  20: 22.5,
  21: 180,
  22: 202.5,
  23: 67.5,
  24: 225,
});

/**
 * DB の風向（アイコンの番号を方位名にしたもの）を本当の方位にする。
 * 16方位の名前でない値（無風など）はそのまま返す。会場が分からなければ null（ずれた方位を出さない）
 * @param {string|null|undefined} label
 * @param {number|string|null|undefined} venueCode
 * @returns {string|null}
 */
export function trueWindDirection(label, venueCode) {
  if (label == null || label === "") return null;
  const i = WIND_DIRECTIONS.indexOf(label);
  if (i < 0) return label;
  const offset = VENUE_WIND_OFFSET_DEG[Number(venueCode)];
  if (offset == null) return null;
  const deg = (((i * 22.5 - offset) % 360) + 360) % 360;
  return WIND_DIRECTIONS[deg / 22.5];
}

/**
 * ホームストレッチ（スタート → 1マーク）に対する今日の風（BOA-809、2026-10-10 ユーザー決定）。
 * 公式の直前情報の水面の図はスタンドが下・1マークが右（公式の用語集「スタンドから水面を見たとき右手に見えるブイ」）で、
 * 風向アイコンの矢印は風が吹いていく向き（徳山 2026-10-06 10R の is-wind15 は左上向きで、K ファイルでは北の風）。
 * DB の風向はこのアイコンの番号なので、矢印が右向き（「東」＝5番）が追い風で、会場によらない。
 * 区分は BOA-211（scripts/analysis/analyze-weather-in-escape.js の windBin）と同じ: 追い風から ±45° 以内は追い風、
 * 135° 以上は向かい風、ほかは横風。風速1m以下・無風は区分しない
 * @param {string|null|undefined} label DB の風向（アイコンの番号の名前）
 * @param {number|string|null|undefined} venueCode 会場が分からなければ null
 * @param {number|null|undefined} speed 風速（m）
 * @returns {"tail"|"head"|"cross"|null}
 */
export function windRelation(label, venueCode, speed) {
  if (speed == null || !(speed > 1)) return null;
  if (VENUE_WIND_OFFSET_DEG[Number(venueCode)] == null) return null;
  const i = WIND_DIRECTIONS.indexOf(label);
  if (i < 0) return null;
  const deg = (i - 4) * 22.5;
  const phi = Math.abs(deg > 180 ? deg - 360 : deg);
  if (phi <= 45) return "tail";
  if (phi >= 135) return "head";
  return "cross";
}
