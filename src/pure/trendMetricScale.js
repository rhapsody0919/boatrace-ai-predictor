/**
 * 推移の図（TrendChart・TrendTooltip）の指標ごとの尺度（オーナー 2026-11-26、時系列の残り44件の前提 PR-0）。
 * 図は指標の名前で分岐せず、ここの設定を受け取る。新しい指標（ST の生値・展示タイム・展示順位・得点率など）は
 * ここに1行足すか、図へ scale を直に渡す。
 *
 * - step: 縦軸の上下の余白と端の丸めの単位
 * - tickStep: 目盛りの間隔
 * - invert: 小さいほど良い指標を上に描く（平均ST・展示タイム・順位）
 * - digits: 値の小数の桁（右端の札・吹き出し）。目盛りは tickDigits
 * - unit: 値に付ける字（"%" 等）。unitKey は縦軸の頭に出す訳の鍵（無ければ unit をそのまま出す）
 */

export const TREND_SCALES = Object.freeze({
  top2Rate: Object.freeze({
    step: 5,
    tickStep: 10,
    invert: false,
    digits: 1,
    tickDigits: 0,
    unit: "%",
    unitKey: null,
  }),
  top3Rate: Object.freeze({
    step: 5,
    tickStep: 10,
    invert: false,
    digits: 1,
    tickDigits: 0,
    unit: "%",
    unitKey: null,
  }),
  avgSt: Object.freeze({
    step: 0.01,
    tickStep: 0.02,
    invert: true,
    digits: 2,
    tickDigits: 2,
    unit: "",
    unitKey: "basicInfo.trend.unitSec",
  }),
});

/**
 * @param {string} metric
 * @returns {{step:number, tickStep:number, invert:boolean, digits:number, tickDigits:number, unit:string, unitKey:string|null}}
 */
export function trendScaleOf(metric) {
  const scale = TREND_SCALES[metric];
  if (!scale) throw new Error(`推移の尺度が無い指標: ${metric}`);
  return scale;
}

/** 値の字（右端の札・吹き出し）。単位つき */
export function formatTrendValue(value, scale) {
  return `${value.toFixed(scale.digits)}${scale.unit}`;
}
