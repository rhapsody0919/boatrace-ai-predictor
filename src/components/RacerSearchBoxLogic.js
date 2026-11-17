import {
  extractPeriodNumber,
  uniqueSorted,
  matchesRacerFilters,
} from "./racer/racerFilterUtils";

export const EMPTY_RANGE = { min: null, max: null };

// ひらがな→カタカナ変換＋空白除去＋小文字化して比較する。
// racer_profiles.name/name_kana は姓名間に不揃いな全角スペースを含むため、
// 検索クエリ・照合対象の双方から空白を除去してから部分一致させる
export function normalize(str) {
  if (!str) return "";
  return str
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function buildFilterOptions(racers) {
  if (!racers) {
    return { branches: [], periods: [], hometowns: [] };
  }
  return {
    branches: uniqueSorted(racers.map((r) => r.branch)),
    periods: Array.from(
      new Set(racers.map((r) => r.registration_period).filter(Boolean)),
    ).sort((a, b) => extractPeriodNumber(b) - extractPeriodNumber(a)),
    hometowns: uniqueSorted(racers.map((r) => r.hometown)),
  };
}

export function hasActiveFilter({
  branch,
  heightRange,
  weightRange,
  grade,
  period,
  hometown,
}) {
  return (
    branch !== "" ||
    heightRange.min != null ||
    heightRange.max != null ||
    weightRange.min != null ||
    weightRange.max != null ||
    grade.length > 0 ||
    period.length > 0 ||
    hometown.length > 0
  );
}

function matchesQueryAndFilters(r, normalizedQuery, filters) {
  if (normalizedQuery.length > 0) {
    const nameMatch =
      normalize(r.name).includes(normalizedQuery) ||
      normalize(r.name_kana).includes(normalizedQuery);
    if (!nameMatch) return false;
  }
  return matchesRacerFilters(r, filters);
}

export function selectMatches(racers, normalizedQuery, filters, active) {
  return (normalizedQuery.length > 0 || active) && racers
    ? racers.filter((r) => matchesQueryAndFilters(r, normalizedQuery, filters))
    : [];
}
