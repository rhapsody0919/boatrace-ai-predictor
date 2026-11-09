import {
  filterRecords,
  computeRates,
  SMALL_SAMPLE_THRESHOLD,
} from "../basicInfoStats";
import { bestOf } from "../../../utils/bestOf";

export const findOfficialRow = (officialRates, boatNumber) =>
  (officialRates ?? []).find((r) => r.boat_number === boatNumber) ?? null;

const NO_VALUE = { value: null, n: null, isSmallSample: false };

const LOCAL_RATE_KEYS = { winRate: "local_win_rate", top2Rate: "local_2rate" };
const GLOBAL_RATE_KEYS = { winRate: "win_rate", top2Rate: "global_2rate" };

// 公式の平均STは全国の値だけ（当地の公式の平均STは無い）
function officialAvgStValue(p, scope, officialAvgSt) {
  const v =
    scope === "local"
      ? null
      : ((officialAvgSt?.rows ?? []).find((r) => r.boatNumber === p.number)
          ?.avgSt ?? null);
  return { ...NO_VALUE, value: v, loading: officialAvgSt === undefined };
}

function officialRateValue(p, ctx) {
  const { metric, scope, officialRates } = ctx;
  const row = findOfficialRow(officialRates, p.number);
  if (!row) return { ...NO_VALUE, loading: officialRates === null };
  const value =
    scope === "local"
      ? row[LOCAL_RATE_KEYS[metric] ?? "local_3rate"]
      : row[GLOBAL_RATE_KEYS[metric] ?? "global_3rate"];
  return {
    ...NO_VALUE,
    value: value === null || value === undefined ? null : Number(value),
    loading: false,
  };
}

// 自社集計（records から絞って計算する）
function ownAggregationValue(p, ctx) {
  const { metric, scope, grade, period, venueCode, recordsOf, periodAnchor } =
    ctx;
  const records = recordsOf(p.racerId);
  if (records === undefined) return { ...NO_VALUE, loading: true };
  const filtered = filterRecords(records ?? [], {
    venueCode,
    scope,
    grade,
    period,
    now: periodAnchor,
  });
  const rates = computeRates(filtered);
  if (metric === "avgSt") {
    return {
      value: rates.avgSt,
      n: rates.avgStN,
      isSmallSample: rates.avgStN > 0 && rates.avgStN < SMALL_SAMPLE_THRESHOLD,
      loading: false,
    };
  }
  return {
    value: rates[metric],
    n: rates.n,
    isSmallSample: rates.n > 0 && rates.n < SMALL_SAMPLE_THRESHOLD,
    loading: false,
  };
}

// 表示用の1艇分の値を計算する（value/n/isSmallSample/loading）
function valueFor(p, ctx) {
  const { metric, scope, needsOwnAggregation, officialAvgSt } = ctx;
  if (needsOwnAggregation) return ownAggregationValue(p, ctx);
  if (metric === "avgSt") return officialAvgStValue(p, scope, officialAvgSt);
  return officialRateValue(p, ctx);
}

export function computeBarValues(sortedPlayers, ctx) {
  const { metric } = ctx;
  // 平均STは小数2桁で表示する。棒の長さも表示と同じ桁で決める。生の値で決めると、同じ「0.13」の
  // 艇どうしで棒の長さが18ポイント違い、「差は数字で見て」の注記と食い違った（#1064 ファン評価3周目）
  return sortedPlayers.map((p) => {
    const v = valueFor(p, ctx);
    return metric === "avgSt" && typeof v.value === "number"
      ? { boat: p.number, ...v, value: Math.round(v.value * 100) / 100 }
      : { boat: p.number, ...v };
  });
}

// 棒の長さの尺度・表示の桁・最良の艇を決める
export function buildBarScale(values, metric, needsOwnAggregation) {
  const numericValues = values
    .map((v) => v.value)
    .filter((v) => v !== null && v !== undefined);
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;

  // 勝率(公式値)・平均STは0-100%のスケールではない（勝率は0〜9程度の点数、
  // STは秒数）ため、6艇内の相対最小最大でバーの長さを決める。
  // 2連対率/3連対率、および自社集計に切り替わった勝率(1着率%)は
  // 素直に0-100%スケールで表示する
  const isRelativeScaleMetric =
    metric === "avgSt" || (metric === "winRate" && !needsOwnAggregation);

  const barWidthPercent = (value) => {
    if (value === null || value === undefined) return 0;
    if (isRelativeScaleMetric) {
      if (maxValue === minValue) return 50;
      const ratio = (value - minValue) / (maxValue - minValue);
      // STのみ「小さいほど良い」ため反転する
      const r = metric === "avgSt" ? 1 - ratio : ratio;
      // 最下位の艇も短い棒を残す（10〜100%）。0%だと棒が空になり、6.70 と 7.58 の差が
      // 「0対ほぼ半分」に見えて、勝率が無いようにも読めた（BOA-618）
      return 10 + r * 90;
    }
    return Math.max(0, Math.min(100, value));
  };

  // 6艇の中で最良の値（同値は全部）に金枠を付ける（race-detail-ui-unify R1）。
  // 棒は艇色のまま、値のラベルで示す（R4）。表示と同じ桁で比べる
  const valueDigits =
    metric === "avgSt"
      ? 3
      : metric === "winRate" && !needsOwnAggregation
        ? 2
        : 1;
  // 走数が少ない値（棒を薄く出しているもの）は比べない。条件で絞ると「2走で2連対率100%」の
  // ような値が最良になり、金枠が最も当てにならない値に付く
  const bestBoats = bestOf(
    values
      .filter((v) => !v.loading && !v.isSmallSample)
      .map(({ boat, value }) => ({ boat, value })),
    metric === "avgSt" ? "min" : "max",
    { digits: valueDigits },
  );

  return { isRelativeScaleMetric, barWidthPercent, valueDigits, bestBoats };
}
