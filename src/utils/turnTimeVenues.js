/**
 * オリジナル展示の「まわり足」が会場独自の計測で、他場と値の水準が違う会場（会場コード）。
 *
 * 住之江（12）・尼崎（13）・徳山（18）は、まわり足が 11〜12秒台（2026-10-03 実測の中央値
 * 11.63・11.56・11.73。12秒台も毎節出る）で、他場（おおむね5秒台）と比べられない。値・項目名は公式の
 * ファイルのとおりで、保存の誤りではない（各会場の公式に「独自計測値」の記載）。
 * 計測区間は一次情報で確かめられていないので、画面には区間を書かない。
 *
 * 出典: docs/design/scraping-vercel-consolidation/data-catalog.md の E12
 * （データ取得レーン #1221）。scripts/lib/boatcast/publicMap.js で直線の項目が無い
 * 会場（TWO）と同じ3場。src から scripts は読まないので、ここに別に持つ
 */
export const DISTINCT_TURN_TIME_VENUE_CODES = Object.freeze([12, 13, 18]);

/**
 * @param {number|string|null|undefined} venueCode 会場コード（"12" でも 12 でもよい）
 * @returns {boolean}
 */
export function hasDistinctTurnTime(venueCode) {
  return DISTINCT_TURN_TIME_VENUE_CODES.includes(Number(venueCode));
}
