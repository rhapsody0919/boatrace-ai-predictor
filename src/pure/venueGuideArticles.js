/**
 * 会場ページの「<会場>の攻略記事」に出す記事を選ぶ（BOA-1692 GS02 V2）。
 * 入力は記事のメタデータの一覧（src/data/blogPosts.js の blogPosts）と会場名（t(`venues.${code}`) の ja）。
 *
 * - category が「場別攻略」かつ tags に会場名を完全一致で含む記事だけ（「津」が他の語に当たらない）
 * - 開催向けの記事（tags に「得点率」「勝負駆け」）は出さない。データ分析の記事は混ぜない
 * - 画面に出す題（venueGuideTitle）に率（n%）か「1着率」が残る記事は出さない。同じ画面の V1 の表
 *   （直近1年の進入コース別の1着率）と、期間の違う同じ指標を並べないため（fan-reactions.md）。
 *   例: kiryu-course2-course3-period-comparison（題が「1着率の差は確認できない」、本文は 10/20 起点の
 *   2コース 11.9% で V1 の表の 12.0% と食い違う）
 * - 並びは 基本ガイド（id が venue- で始まる）→ 水面と風（id が -water-wind-guide で終わる）→ 残りは date の
 *   新しい順（同じ日は id 順）。最大3本
 */

export const VENUE_GUIDE_CATEGORY = "場別攻略";
export const MAX_VENUE_GUIDE_ARTICLES = 3;
const MEET_TAGS = ["得点率", "勝負駆け"];
const TITLE_SEPARATORS = ["｜", " - ", " — "];
const SAME_METRIC_IN_TITLE = /\d\s*[%％]|1着率/;

/**
 * 題を「｜」「 - 」「 — 」のうち最初に出る物の前まで切る
 * @param {string} title
 * @returns {string}
 */
export function venueGuideTitle(title) {
  const cut = TITLE_SEPARATORS.map((sep) => title.indexOf(sep))
    .filter((i) => i > 0)
    .reduce((min, i) => Math.min(min, i), title.length);
  return title.slice(0, cut).trim();
}

/** @param {{id: string}} post */
function rankOf(post) {
  if (post.id.startsWith("venue-")) return 0;
  if (post.id.endsWith("-water-wind-guide")) return 1;
  return 2;
}

/**
 * @template {{id: string, title: string, date: string, category: string, tags: string[]}} P
 * @param {P[]} posts
 * @param {string} venueName
 * @returns {P[]}
 */
export function selectVenueGuideArticles(posts, venueName) {
  if (!venueName) return [];
  return posts
    .filter(
      (post) =>
        post.category === VENUE_GUIDE_CATEGORY &&
        post.tags.includes(venueName) &&
        !post.tags.some((tag) => MEET_TAGS.includes(tag)) &&
        !SAME_METRIC_IN_TITLE.test(venueGuideTitle(post.title)),
    )
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_VENUE_GUIDE_ARTICLES);
}
