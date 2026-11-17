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

/**
 * 龍神レーダーのレースページがある最初の日付。races テーブル（本体）は 2025-12-03 から（2025-12-02 は12レースだけ
 * 入っている）。それより前は長期データ（kb_archive）だけで、レースページは「予測データはまだありません」になる
 */
export const RACE_PAGE_FROM = "2025-12-03";

/**
 * 類似レースの1件のリンク先（2026-10-06 ユーザー指摘）。レースページがある日付は龍神レーダーの /race/{race_id}、
 * それより前は公式サイトの結果ページ
 * @param {string} raceId YYYY-MM-DD-VV-RR
 * @returns {{internal: boolean, href: string}|null}
 */
export function similarRaceLink(raceId) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(
    String(raceId ?? ""),
  );
  if (!m) return null;
  const [, y, mo, d, venue, rn] = m;
  if (`${y}-${mo}-${d}` >= RACE_PAGE_FROM)
    return { internal: true, href: `/race/${raceId}` };
  return {
    internal: false,
    href: `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${Number(rn)}&jcd=${venue}&hd=${y}${mo}${d}`,
  };
}

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

const K = "aiPredictionTab.analogy.similar.values";
const six = (arr, f) => (Array.isArray(arr) ? arr.map(f).join("/") : "—");
const pct = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : "—");
const rankText = (r, t) => (r ? t(`${K}.rank`, { n: r }) : "—");

function raceNumberBand(d, t) {
  return isNum(d.rn)
    ? t(`${K}.rnBand`, {
        band: t(`${K}.bands.${Math.floor((d.rn - 1) / 4)}`),
        rn: d.rn,
      })
    : "—";
}

function classAll6(d) {
  const c = (d.cls ?? []).map((v) => CLASS[v] ?? "—");
  return c.length && c.every((x) => x === c[0])
    ? `${c[0]}×6`
    : c.join("/") || "—";
}

function winGapBand(d, t) {
  const g = gapOf(d.nat);
  return g
    ? minus(t(`${K}.gap`, { gap: g.gap.toFixed(2), band: g.band + 1 }))
    : "—";
}

function topBoatText(d, t) {
  const b = topBoat(d.nat);
  return b ? t("aiPredictionTab.analogy.boat", { n: b }) : "—";
}

function exhTimeDiff6(d) {
  return minus(
    six(d.exh_diff, (v) =>
      isNum(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "—",
    ),
  );
}

/** 項目のキー → (表示用の値, i18n) の整形。ここに無いキーは "—" */
const ITEM_FORMATTERS = {
  venue: (d, t) => (isNum(d.venue) ? venueLabel(d.venue, t) : "—"),
  race_number_band: raceNumberBand,
  race_number: (d) => (isNum(d.rn) ? `${d.rn}R` : "—"),
  grade: (d, t) =>
    d.grade ? t(`aiPredictionTab.analogy.grades.${d.grade}`, d.grade) : "—",
  grade_bin: (d, t) =>
    d.grade ? t(`${K}.${d.grade === "ippan" ? "ippan" : "notIppan"}`) : "—",
  round: (d, t) =>
    d.round
      ? t(`aiPredictionTab.analogy.outlook.roundNames.${d.round}`, d.round)
      : "—",
  series_day: (d, t) => (isNum(d.sday) ? t(`${K}.day`, { n: d.sday }) : "—"),
  is_final_day: (d, t) =>
    isNum(d.final) ? t(`${K}.${d.final ? "final" : "notFinal"}`) : "—",
  class_all6: classAll6,
  n_A1: (d, t) =>
    t(`${K}.nA1`, { n: (d.cls ?? []).filter((v) => v === 4).length }),
  b1_class: (d) => CLASS[d.cls?.[0]] ?? "—",
  win_gap_band: winGapBand,
  top_boat: topBoatText,
  nat_win_6: (d) => six(d.nat, (v) => fx(v, 2)),
  nat_win_rank_4: (d) => six(d.nat_rank, (v) => fx(v, 0)),
  b1_nat_win: (d) => fx(d.nat?.[0], 2),
  loc_win_6: (d) => six(d.loc, (v) => fx(v, 2)),
  recent_win30_6: (d) => six(d.rw, pct),
  recent_top3_30_6: (d) => six(d.rt3, pct),
  st_mean30_6: (d) => six(d.st, (v) => fx(v, 2)),
  b1_st_rank_band: (d, t) => rankText(b1Rank(d.st, false), t),
  motor_2_6: (d) => six(d.motor, (v) => fx(v, 1)),
  b1_motor_rank_band: (d, t) => rankText(b1Rank(d.motor), t),
  boat_2_6: (d) => six(d.boat, (v) => fx(v, 1)),
  b1_boat_rank_band: (d, t) => rankText(b1Rank(d.boat), t),
  age_6: (d) => six(d.age, (v) => fx(v, 0)),
  weight_6: (d) => six(d.weight, (v) => fx(v, 1)),
  n_local: (d, t) =>
    Array.isArray(d.local)
      ? t(`${K}.local`, { n: d.local.filter((v) => v === 1).length })
      : "—",
  weather: (d, t) =>
    isNum(d.weather) && WEATHER[d.weather]
      ? t(`${K}.weather.${WEATHER[d.weather]}`)
      : "—",
  wind_bin: (d) => (isNum(d.ws) ? `${d.ws}m` : "—"),
  wind_vector: (d) => (isNum(d.ws) ? `${d.ws}m` : "—"),
  wave_bin: (d) => (isNum(d.wave) ? `${d.wave}cm` : "—"),
  exh_time_diff_6: exhTimeDiff6,
};

/**
 * 1項目の表示（今日の値・各件の値）
 * @param {string} key 33項目のキー
 * @param {object|null} d 表示用の値（display_row）。無ければ "—"
 * @param {(key: string, opts?: object) => string} t i18n
 */
export function itemValue(key, d, t) {
  if (!d) return "—";
  return Object.hasOwn(ITEM_FORMATTERS, key) ? ITEM_FORMATTERS[key](d, t) : "—";
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
