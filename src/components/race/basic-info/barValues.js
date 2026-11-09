import {
  filterRecords,
  computeRates,
  SMALL_SAMPLE_THRESHOLD,
} from "../basicInfoStats";
import { bestOf } from "../../../utils/bestOf";

export const findOfficialRow = (officialRates, boatNumber) =>
  (officialRates ?? []).find((r) => r.boat_number === boatNumber) ?? null;

// 表示用の1艇分の値を計算する（value/n/isSmallSample/loading）
function valueFor(p, ctx) {
  const {
    metric,
    scope,
    grade,
    period,
    venueCode,
    needsOwnAggregation,
    officialRates,
    officialAvgSt,
    recordsOf,
    periodAnchor,
  } = ctx;

  if (!needsOwnAggregation && metric === "avgSt") {
    // 公式の平均STは全国の値だけ（当地の公式の平均STは無い）
    const v =
      scope === "local"
        ? null
        : ((officialAvgSt?.rows ?? []).find((r) => r.boatNumber === p.number)
            ?.avgSt ?? null);
    return {
      value: v,
      n: null,
      isSmallSample: false,
      loading: officialAvgSt === undefined,
    };
  }
  if (!needsOwnAggregation) {
    const row = findOfficialRow(officialRates, p.number);
    if (!row)
      return {
        value: null,
        n: null,
        isSmallSample: false,
        loading: officialRates === null,
      };
    const value =
      scope === "local"
        ? metric === "winRate"
          ? row.local_win_rate
          : metric === "top2Rate"
            ? row.local_2rate
            : row.local_3rate
        : metric === "winRate"
          ? row.win_rate
          : metric === "top2Rate"
            ? row.global_2rate
            : row.global_3rate;
    return {
      value: value === null || value === undefined ? null : Number(value),
      n: null,
      isSmallSample: false,
      loading: false,
    };
  }

  const records = recordsOf(p.racerId);
  if (records === undefined)
    return { value: null, n: null, isSmallSample: false, loading: true };
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
