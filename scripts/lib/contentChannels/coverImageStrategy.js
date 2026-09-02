/**
 * ブログ/note/YouTubeサムネイルのカバー画像調達方法を、ネタ種別ごとに決める。
 * 2026-09-02、ユーザーレビューで確定した方針:
 * 「実画面が存在するネタはスクリーンショット、存在しないネタはDataQuoteCard
 *  （ブランド準拠のデータカード静止画）」の使い分け（docs/reference/brand-kit.md参照）。
 *
 * @param {{sourceId: string, route?: string, tabId?: string}} topic ネタ供給モジュールの候補
 * @returns {{type: "screenshot", path: string} | {type: "data-card"}}
 */
export function getCoverImageStrategy(topic) {
  switch (topic.sourceId) {
    case "new-feature":
      // missingContentIndex検知の対象ルートをそのままスクリーンショットする
      return { type: "screenshot", path: topic.route };
    case "data-insight":
      // 分析ツールの該当タブをスクリーンショットする
      return {
        type: "screenshot",
        path: `/winning-technique?tab=${topic.tabId}`,
      };
    case "venue-characteristic":
    case "daily-result":
      // 対応する実画面が無いためDataQuoteCardで代替する
      return { type: "data-card" };
    default:
      throw new Error(
        `未知のネタ種別 "${topic.sourceId}" に対するカバー画像戦略が定義されていません`,
      );
  }
}
