/**
 * 展示タイムの推移グラフの縦軸（範囲と目盛り）（BOA-557）。
 *
 * `["dataMin - 0.1", "dataMax + 0.1"]` だと端がデータ次第の半端な値になり、
 * 目盛りが 6.43 / 6.63 / … / 7.14 と読みにくい。端を 0.2 秒の倍数にそろえ、
 * 目盛りも 0.2 秒刻みで明示する。範囲だけ渡すと recharts が5本に等分し、
 * 幅 0.6 秒なら 6.80 / 6.95 / 7.10 … と 0.15 秒刻みになった（ファン評価）。
 * 上下に 0.05 秒以上の余白は残す。
 *
 * @param {Array<number|null|undefined>} values 描く展示タイム
 * @returns {{domain: [number, number], ticks: Array<number>}|null} 値が無ければ null
 */
export function exhibitionTimeAxis(values) {
  const nums = (values ?? []).filter((v) => typeof v === "number");
  if (nums.length === 0) return null;
  // 0.2 秒単位（×5 した整数）で数える。浮動小数の誤差で目盛りがずれないように
  const lo = Math.floor((Math.min(...nums) - 0.05) * 5);
  const hi = Math.ceil((Math.max(...nums) + 0.05) * 5);
  const ticks = [];
  for (let k = lo; k <= hi; k += 1) ticks.push(Number((k / 5).toFixed(1)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}
