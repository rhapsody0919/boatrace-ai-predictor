/**
 * 本番STと展示STのズレ（|本番ST − 展示ST|）。どちらかが無い（null・undefined）走は null。
 *
 * 欠場艇の行（race_start_timings の finish_mark='欠'、start_timing は NULL）や、展示STの取れなかった行を
 * 0 や片方の値として計算に混ぜない（Math.abs(null - 0.12) は 0.12 になる）。RPC get_race_st_predictability
 * （マイグレーション029）の「両方が非NULLの走だけを比べる」と同じ。
 *
 * @param {number|string|null|undefined} actual 本番ST
 * @param {number|string|null|undefined} exhibition 展示ST
 * @returns {number|null}
 */
export function stDeviation(actual, exhibition) {
  if (actual == null || exhibition == null) return null;
  return Math.abs(Number(actual) - Number(exhibition));
}
