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
 * - tipValue: 吹き出しに値の行（「直近30走の◯◯」）を出すか。走ごとの生の値は2行目と重なるので出さない
 * - min: 縦軸の下の端の下限（負にならない値）
 * - flags・dimOthers・dots・dropZero: 走ごとの生の値の図（R-36）だけ。F・L の印の帯、選んでいない艇を薄く、選んだ艇に点、ST の .12 の書き方
 * - 今節の走の図（直前情報の今節の足 R-47・R-119、BOA-885 承認のモック）だけ: alignStart は横を各艇の1走目からそろえる、
 *   bridgeGaps は値の無い走を挟んで前後を点線でつなぐ、dotLabel は選んだ艇の点の中に着順、runAxisKey は横の目盛りを「N走」にする訳の鍵、
 *   tipValueKey は吹き出しの値の行の訳の鍵、tipSt: false は吹き出しに ST を出さない
 */

// 今節の走の図の共通（タイムは小さいほど速いので上に描く）
const MEET_RUN = Object.freeze({
  invert: true,
  digits: 2,
  tickDigits: 2,
  unit: "",
  unitKey: "basicInfo.trend.unitSec",
  tipValue: true,
  tipValueKey: "basicInfo.trend.tipValueRun",
  tipSt: false,
  dimOthers: true,
  // 薄くした1号艇の白・2号艇の黒にも縁を残す（地に溶けて消える。visual-designer 11/26）
  dimHalo: true,
  alignStart: true,
  bridgeGaps: true,
  dotLabel: true,
  runAxisKey: "beforeInfo.meetFormRunN",
});

// 今節の日付の横軸の図（R-43・R-45）。値の無い走は線を切り、公式の記号は上の帯に出す
const MEET_DAY = Object.freeze({
  ...MEET_RUN,
  alignStart: false,
  bridgeGaps: false,
  runAxisKey: null,
  flags: true,
});
const MEET_SPARK = Object.freeze({
  ...MEET_DAY,
  dotLabel: false,
  dots: true,
  height: 160,
  // 1艇だけの図: 線は 2px（6艇の中で目立たせる 3px は基準の破線が負ける）、点は大きく地の色の輪、帯は記号があるときだけ
  strokeW: 2,
  dotR: 3.5,
  bandIfAny: true,
});

export const TREND_SCALES = Object.freeze({
  top2Rate: Object.freeze({
    step: 5,
    tickStep: 10,
    invert: false,
    digits: 1,
    tickDigits: 0,
    unit: "%",
    unitKey: null,
    tipValue: true,
  }),
  top3Rate: Object.freeze({
    step: 5,
    tickStep: 10,
    invert: false,
    digits: 1,
    tickDigits: 0,
    unit: "%",
    unitKey: null,
    tipValue: true,
  }),
  avgSt: Object.freeze({
    step: 0.01,
    tickStep: 0.02,
    invert: true,
    digits: 2,
    tickDigits: 2,
    unit: "",
    unitKey: "basicInfo.trend.unitSec",
    tipValue: true,
  }),
  // 走ごとの生の ST（窓の平均でなく1走の値。枠別の ST 履歴 R-36、11/26）。フライング・出遅れは値を持たず印で描く
  st: Object.freeze({
    step: 0.05,
    tickStep: 0.05,
    invert: true,
    digits: 2,
    tickDigits: 2,
    unit: "",
    unitKey: "basicInfo.trend.unitSec",
    tipValue: false,
    min: 0,
    labelEvery: 2,
    flags: true,
    dimOthers: true,
    dots: true,
    dropZero: true,
  }),
  exhibition: Object.freeze({ ...MEET_RUN, step: 0.02, tickStep: 0.05 }),
  // 今節タブの6艇の推移（R-43、オーナー 2026-11-26「重ねて日付で」）。横軸は日付（点の xr）なので1走目そろえ・N走の目盛りは使わない。
  // 値の無い走は線を切る（走らない日と同じ扱い）。値の無い走の公式の記号（F・L・欠・転等）は上の帯に出す
  meetDaySt: Object.freeze({ ...MEET_DAY, step: 0.05, tickStep: 0.05, min: 0 }),
  meetDayExhibition: Object.freeze({ ...MEET_DAY, step: 0.02, tickStep: 0.05 }),
  // 今節の詳細の小さな線（R-45、選んだ1艇。オーナー 2026-11-27「基準との差の小さな図に」）。上の6艇の推移と
  // 同じ日付の横軸で、着順の数字は上に任せて小さな点だけ。低い図（height）にし、縦は値の近くまで詰める
  meetSparkSt: Object.freeze({
    ...MEET_SPARK,
    step: 0.02,
    tickStep: 0.05,
    min: 0,
  }),
  meetSparkExhibition: Object.freeze({
    ...MEET_SPARK,
    step: 0.02,
    tickStep: 0.05,
  }),
  lap: Object.freeze({ ...MEET_RUN, step: 0.1, tickStep: 0.5 }),
  turn: Object.freeze({ ...MEET_RUN, step: 0.05, tickStep: 0.2 }),
  straight: Object.freeze({ ...MEET_RUN, step: 0.05, tickStep: 0.2 }),
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
