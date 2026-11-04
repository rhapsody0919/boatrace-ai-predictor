/**
 * SNS の本文・題に入れる「何日目」と「大会名（SG・G1 だけ）」（BOA-1309、オーナー 2026-11-04「全ての SNS に日付・何日目・レース名・締切の時刻を記載」）。
 *
 * 画面と文言・規則を食い違わせないため、日目の文は会場カードの getVenueSeriesDayLabel（raceDetailHeading.js、中で getSeriesDayLabel）で作る。規則は画面と同じ:
 * (1) series_day・is_final_day は自レースに無ければ同じ会場の他のレースの最初の値で補う（BOA-509。当日はレースごとに入る時点がずれる）
 * (2) 同じ会場の全レースが中止確定なら日目を出さない（BOA-658。公式は翌日に同じ日目を振り直す）
 * (3) 最終日の印は、どれか1レースでも立てば最終日（会場カード getVenueSeriesDayLabel と同じ。1R は false・12R は true の日があった）
 * 日目は公式の出走表の値で、日付から数えない。Node と画面の両方から import するので、ブラウザ専用の依存を持ち込まない。
 * 検証: scripts/maintenance/verify-sns-race-labels.js
 */
import { getVenueSeriesDayLabel } from "./raceDetailHeading.js";

/**
 * 日目の ja の文言（src/locales/ja/common.json の raceDetailPage.seriesDay*。JSON の import は Node と Vite で書き方が違うので写しを持ち、
 * 食い違いは verify-sns-race-labels.js が locales と照合して止める）
 */
export const JA_SERIES_DAY = {
  "raceDetailPage.seriesDayFirst": "初日",
  "raceDetailPage.seriesDayFinal": "最終日",
  "raceDetailPage.seriesDayNth": "{{day}}日目",
};

/**
 * 日目の文言だけを持つ ja の t（getSeriesDayLabel に渡す）。知らないキーは投げる（黙って空にしない）
 * @param {string} key @param {Record<string, unknown>} [params]
 */
export function jaSeriesT(key, params = {}) {
  const text = JA_SERIES_DAY[key];
  if (text === undefined)
    throw new Error(`jaSeriesT: 日目の文言に無いキー ${key}`);
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k]));
}

/** 大会名を付けるグレード（races.race_grade の語彙）。一般戦・G2・G3 は付けない */
export const SERIES_TITLE_GRADES = ["SG", "G1"];

/**
 * 何日目の文（「初日」「N日目」「最終日」）。出せないときは null（「—」も出さない）
 * @param {Array<{raceId: string, seriesDay?: number|null, isFinalDay?: boolean|null, cancellationStatus?: string|null, result?: object|null}>} venueRaces 同じ会場・同じ日のレース
 * @param {string} raceId 対象のレース
 * @param {(key: string, params?: object) => string} [t]
 * @returns {string|null}
 */
export function seriesDayTextOf(venueRaces, raceId, t = jaSeriesT) {
  if (!venueRaces.some((r) => r.raceId === raceId)) return null;
  // 会場カードと同じ関数（同じ会場で補う・全レース中止確定は出さない・どれか1レースでも最終日）。日目は会場・日で同じ値
  return getVenueSeriesDayLabel(venueRaces, t);
}

/**
 * 大会名（SG・G1 のときだけ）。race_conditions.race_title、無ければ race_series.title を NFKC にし、続く空白を1つにする（画面の見出しと同じ NFKC）
 * @param {{grade?: string|null, raceTitle?: string|null, seriesTitle?: string|null}} p
 * @returns {string|null}
 */
export function seriesTitleOf({
  grade = null,
  raceTitle = null,
  seriesTitle = null,
}) {
  if (!SERIES_TITLE_GRADES.includes(grade)) return null;
  // 空の文字列は無いものとして扱う（節の名前へ落とす）
  const raw = raceTitle?.trim() ? raceTitle : seriesTitle;
  if (typeof raw !== "string") return null;
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim() || null;
}
