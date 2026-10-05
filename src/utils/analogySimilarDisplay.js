/**
 * 類似レースの33項目の表示（spec B-6・B-7「今日: …」と1件ずつの値）。純粋関数。
 * 入力は朝のバッチの表示用の値（scripts/ml/analogy/v16_similar.py の display_columns の1件分）。
 * 今日の展示の時点で決まる値（天候・風・波・展示タイムの差）は、展示後の今日の値（facts の exhibition）で上書きする。
 */
import { venueLabel } from "./analogyFormat.js";

const CLASS = { 4: "A1", 3: "A2", 2: "B1", 1: "B2" };
const GAP_EDGES = [-1.91, -1.14, -0.49, 0.19];
const WEATHER = ["sunny", "cloudy", "rain", "snow", "fog", "typhoon"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fx = (v, d) => (isNum(v) ? v.toFixed(d) : "—");
const minus = (s) => s.replace(/(^|[^0-9.])-(?=\d)/g, "$1−");

/** 勝率差（1号艇 − 2〜6号艇の最大、小数2桁）と5段階の帯（v16_similar.gap_band と同じ。無ければ null） */
export function gapOf(nat) {
  if (!Array.isArray(nat) || !isNum(nat[0])) return null;
  const others = nat.slice(1).filter(isNum);
  if (!others.length) return null;
  const gap = Math.round((nat[0] - Math.max(...others)) * 100) / 100;
  const band = GAP_EDGES.filter((e) => gap >= e).length;
  return { gap, band };
}

/** 1号艇の6艇中の順位（1 + 1号艇より良い艇の数。v16_similar._b1_rank と同じ。hib＝大きいほど良い） */
export function b1Rank(values, hib = true) {
  if (!Array.isArray(values) || !isNum(values[0])) return null;
  return (
    1 +
    values
      .slice(1)
      .filter((v) => isNum(v) && (hib ? v > values[0] : v < values[0])).length
  );
}

/** 勝率トップの艇（同率は艇番の小さいほう） */
export function topBoat(nat) {
  if (!Array.isArray(nat) || !nat.some(isNum)) return null;
  let best = 0;
  nat.forEach((v, i) => {
    if (isNum(v) && (!isNum(nat[best]) || v > nat[best])) best = i;
  });
  return best + 1;
}

/**
 * 1項目の表示（今日の値・各件の値）
 * @param {string} key 33項目のキー
 * @param {object|null} d 表示用の値（display_row）。無ければ "—"
 * @param {(key: string, opts?: object) => string} t i18n
 */
export function itemValue(key, d, t) {
  if (!d) return "—";
  const k = "aiPredictionTab.analogy.similar.values";
  const six = (arr, f) => (Array.isArray(arr) ? arr.map(f).join("/") : "—");
  const pct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : "—");
  switch (key) {
    case "venue":
      return isNum(d.venue) ? venueLabel(d.venue, t) : "—";
    case "race_number_band":
      return isNum(d.rn)
        ? t(`${k}.rnBand`, {
            band: t(`${k}.bands.${Math.floor((d.rn - 1) / 4)}`),
            rn: d.rn,
          })
        : "—";
    case "race_number":
      return isNum(d.rn) ? `${d.rn}R` : "—";
    case "grade":
      return d.grade
        ? t(`aiPredictionTab.analogy.grades.${d.grade}`, d.grade)
        : "—";
    case "grade_bin":
      return d.grade
        ? t(`${k}.${d.grade === "ippan" ? "ippan" : "notIppan"}`)
        : "—";
    case "round":
      return d.round
        ? t(`aiPredictionTab.analogy.outlook.roundNames.${d.round}`, d.round)
        : "—";
    case "series_day":
      return isNum(d.sday) ? t(`${k}.day`, { n: d.sday }) : "—";
    case "is_final_day":
      return isNum(d.final) ? t(`${k}.${d.final ? "final" : "notFinal"}`) : "—";
    case "class_all6": {
      const c = (d.cls ?? []).map((v) => CLASS[v] ?? "—");
      return c.length && c.every((x) => x === c[0])
        ? `${c[0]}×6`
        : c.join("/") || "—";
    }
    case "n_A1":
      return t(`${k}.nA1`, { n: (d.cls ?? []).filter((v) => v === 4).length });
    case "b1_class":
      return CLASS[d.cls?.[0]] ?? "—";
    case "win_gap_band": {
      const g = gapOf(d.nat);
      return g
        ? minus(t(`${k}.gap`, { gap: g.gap.toFixed(2), band: g.band + 1 }))
        : "—";
    }
    case "top_boat": {
      const b = topBoat(d.nat);
      return b ? t("aiPredictionTab.analogy.boat", { n: b }) : "—";
    }
    case "nat_win_6":
      return six(d.nat, (v) => fx(v, 2));
    case "nat_win_rank_4":
      return six(d.nat_rank, (v) => fx(v, 0));
    case "b1_nat_win":
      return fx(d.nat?.[0], 2);
    case "loc_win_6":
      return six(d.loc, (v) => fx(v, 2));
    case "recent_win30_6":
      return six(d.rw, pct);
    case "recent_top3_30_6":
      return six(d.rt3, pct);
    case "st_mean30_6":
      return six(d.st, (v) => fx(v, 2));
    case "b1_st_rank_band": {
      const r = b1Rank(d.st, false);
      return r ? t(`${k}.rank`, { n: r }) : "—";
    }
    case "motor_2_6":
      return six(d.motor, (v) => fx(v, 1));
    case "b1_motor_rank_band": {
      const r = b1Rank(d.motor);
      return r ? t(`${k}.rank`, { n: r }) : "—";
    }
    case "boat_2_6":
      return six(d.boat, (v) => fx(v, 1));
    case "b1_boat_rank_band": {
      const r = b1Rank(d.boat);
      return r ? t(`${k}.rank`, { n: r }) : "—";
    }
    case "age_6":
      return six(d.age, (v) => fx(v, 0));
    case "weight_6":
      return six(d.weight, (v) => fx(v, 1));
    case "n_local":
      return Array.isArray(d.local)
        ? t(`${k}.local`, { n: d.local.filter((v) => v === 1).length })
        : "—";
    case "weather":
      return isNum(d.weather) && WEATHER[d.weather]
        ? t(`${k}.weather.${WEATHER[d.weather]}`)
        : "—";
    case "wind_bin":
    case "wind_vector":
      return isNum(d.ws) ? `${d.ws}m` : "—";
    case "wave_bin":
      return isNum(d.wave) ? `${d.wave}cm` : "—";
    case "exh_time_diff_6":
      return minus(
        six(d.exh_diff, (v) =>
          isNum(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "—",
        ),
      );
    default:
      return "—";
  }
}

/**
 * 今日の表示用の値。展示後は、展示の時点で決まる値を今日の展示（facts の exhibition）で上書きする
 * @param {object|null} racecardDisplay similar の today_display
 * @param {object|null} exhibition facts の exhibition（展示後だけ）
 */
export function todayDisplay(racecardDisplay, exhibition) {
  if (!racecardDisplay) return null;
  if (!exhibition) return racecardDisplay;
  const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  return {
    ...racecardDisplay,
    weather: exhibition.weather_code ?? null,
    ws: exhibition.wind_speed ?? null,
    wave: exhibition.wave_height ?? null,
    exh_diff: Array.isArray(exhibition.exh_time_diff)
      ? exhibition.exh_time_diff.map(r2)
      : null,
  };
}
