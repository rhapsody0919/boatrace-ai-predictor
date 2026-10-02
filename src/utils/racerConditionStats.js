// 選手ページの成績集計で共有する純関数（node からも import できるよう、サービス層から分けている）
import { isPlaceHit, isShowHit } from "../../scripts/lib/hitCalculator.js";
import {
  ROUGH_WAVE_CM,
  WAVE_EXCLUDED_VENUE_CODES,
} from "../components/race/basicInfoStats.js";

/**
 * 1走分の勝敗を{win, top2, top3}アキュムレータに加算する共通ロジック。
 * aggregateRacerVenueBoatStats（単一集計）・aggregateRacerCrossStats（グループ別集計）・
 * aggregateRacerConditionStats（条件別、BOA-336）が同じ勝率/2連率/3連率の判定を使う
 * （ADR-0063、BOA-159レビューで発見）。着順の付かない走（unranked）は数えない。
 * @returns {boolean} 勝利（1着）だったか
 */
export function tallyWinPlaceShow(totals, row) {
  if (row.unranked) return false;
  const isWin = row.rank1 === row.boatNumber;
  if (isWin) totals.win += 1;
  if (isPlaceHit(row.boatNumber, row.rank1, row.rank2)) totals.top2 += 1;
  if (isShowHit(row.boatNumber, row.rank1, row.rank2, row.rank3)) {
    totals.top3 += 1;
  }
  return isWin;
}

/** 「強風」とみなす風速の下限（m）。予想モデル scripts/lib/turnPrediction.js の `windSpeed >= 5` と同じ */
export const STRONG_WIND_MS = 5;

// レース条件別の成績の行（BOA-336）。group は表の小見出し、match は1走がその条件に入るか。
// 天候は雪（約0.6%）・台風（約0.1%）が選手あたりほぼ0走になるので雨にまとめる。
// 波高は江戸川（5cm刻みで最小5cm）を母数から外す（basicInfoStats の WAVE_EXCLUDED_VENUE_CODES と同じ）
const RACER_CONDITION_ROWS = [
  {
    key: "sunny",
    group: "天候",
    label: "晴",
    match: (r) => r.weather === "晴",
  },
  {
    key: "cloudy",
    group: "天候",
    label: "曇り",
    match: (r) => r.weather === "曇り",
  },
  {
    key: "rainy",
    group: "天候",
    label: "雨・雪・台風",
    match: (r) => ["雨", "雪", "台風"].includes(r.weather),
  },
  {
    key: "windStrong",
    group: "風速",
    label: `風${STRONG_WIND_MS}m以上`,
    match: (r) => r.windSpeed != null && r.windSpeed >= STRONG_WIND_MS,
  },
  {
    key: "windWeak",
    group: "風速",
    label: `風${STRONG_WIND_MS}m未満`,
    match: (r) => r.windSpeed != null && r.windSpeed < STRONG_WIND_MS,
  },
  {
    key: "waveRough",
    group: "波高",
    label: `波${ROUGH_WAVE_CM}cm以上`,
    match: (r) =>
      r.waveHeight != null &&
      !WAVE_EXCLUDED_VENUE_CODES.has(Number(r.venueCode)) &&
      r.waveHeight >= ROUGH_WAVE_CM,
  },
  {
    key: "waveCalm",
    group: "波高",
    label: `波${ROUGH_WAVE_CM}cm未満`,
    match: (r) =>
      r.waveHeight != null &&
      !WAVE_EXCLUDED_VENUE_CODES.has(Number(r.venueCode)) &&
      r.waveHeight < ROUGH_WAVE_CM,
  },
];

/** レース条件別の行を出す最少の走数（会場別・枠番別の表と同じ5走） */
export const RACER_CONDITION_MIN_RUNS = 5;

function rateRow(g) {
  return {
    n: g.n,
    winRate: g.n > 0 ? g.win / g.n : null,
    top2Rate: g.n > 0 ? g.top2 / g.n : null,
    top3Rate: g.n > 0 ? g.top3 / g.n : null,
  };
}

/**
 * getRacerRaceHistory() の履歴を、天候・風速・波高ごとに集計する純粋関数（BOA-336）。
 *
 * 会場・枠番などのフィルタには連動しない（全会場・全条件の履歴から集計する）。
 * 母数の数え方は aggregateRacerVenueBoatStats と同じ（着順の付かない走も1走に数え、
 * 1着・2連対・3連対には数えない）。全体の行と各条件の行で同じ数え方なので、差を比べられる。
 * 全体は「天候・風速・波高のいずれかが取れている走」に限る（race_conditions の無い走を
 * 全体にだけ混ぜると、条件の行との差に条件以外の要因が入る）。
 *
 * @param {Array} history getRacerRaceHistory() の戻り値
 * @returns {{overall: {n, winRate, top2Rate, top3Rate},
 *            rows: Array<{key, group, label, n, winRate, top2Rate, top3Rate}>}}
 *   rows は RACER_CONDITION_MIN_RUNS 走未満の条件を含まない
 */
export function aggregateRacerConditionStats(history) {
  const overall = { n: 0, win: 0, top2: 0, top3: 0 };
  const groups = new Map(
    RACER_CONDITION_ROWS.map((d) => [
      d.key,
      { n: 0, win: 0, top2: 0, top3: 0 },
    ]),
  );
  for (const row of history ?? []) {
    if (row.weather == null && row.windSpeed == null && row.waveHeight == null)
      continue;
    overall.n += 1;
    tallyWinPlaceShow(overall, row);
    for (const def of RACER_CONDITION_ROWS) {
      if (!def.match(row)) continue;
      const g = groups.get(def.key);
      g.n += 1;
      tallyWinPlaceShow(g, row);
    }
  }
  return {
    overall: rateRow(overall),
    rows: RACER_CONDITION_ROWS.map((def) => ({
      key: def.key,
      group: def.group,
      label: def.label,
      ...rateRow(groups.get(def.key)),
    })).filter((r) => r.n >= RACER_CONDITION_MIN_RUNS),
  };
}
