/**
 * 選手ページ（/racer/:racerId）を検索エンジンにインデックスさせるかの判定（集客レーン、2026-10-02）。
 *
 * ページ側の noindex（RacerProfile.jsx）と sitemap（scripts/generate-sitemap.js）の両方がこの関数を使う。
 * 片方だけ条件を変えると「sitemap に載せたのに noindex」「index なのに sitemap に無い」になるため。
 *
 * 条件（第1段階、2026-10-02 ユーザー承認）:
 *   - ニュースがある選手（従来の条件。docs/design/racer-news-feature/plan.md）、または
 *   - 最新の出走の級が A1 で、その出走が直近30日以内（現役の A1 選手。2026-10-02 時点で322人）
 * 当初案の「180日で60走以上」は、この2条件を満たす A1 選手全員が満たしていた（322人＝322人）ので外した。
 * A2 への拡大は、4週間の観測（インデックス未登録の増加・サイト全体の表示と順位）を見て判断する。
 *
 * 級は race_entries.grade（"A1" 等、「級」は付かない）。racer_profiles.grade_at_scrape（"A1級"）とは表記が違う。
 * 級は 1/1 と 7/1 に切り替わる（審査期間とは別。公式「級別審査」）。
 * 検証: scripts/maintenance/verify-racer-index-policy.js
 */
export const RACER_INDEX_GRADES = Object.freeze(new Set(["A1"]));
export const RACER_INDEX_ACTIVE_DAYS = 30;

/**
 * @param {{ hasNews: boolean, latestGrade: string|null, latestRaceDate: string|null, activeSince: string }} p
 *   latestRaceDate・activeSince は YYYY-MM-DD（JST）。activeSince は「今日 − RACER_INDEX_ACTIVE_DAYS 日」
 * @returns {boolean}
 */
export function isRacerIndexable({
  hasNews,
  latestGrade,
  latestRaceDate,
  activeSince,
}) {
  if (hasNews) return true;
  if (!RACER_INDEX_GRADES.has(latestGrade)) return false;
  return Boolean(latestRaceDate) && latestRaceDate >= activeSince;
}
