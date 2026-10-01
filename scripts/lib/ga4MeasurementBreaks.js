/**
 * GA4 の計測方法が変わった日（この日の前後で PV を比較してはいけない日）の一覧と、
 * レポートに出す注記（集客レーン、2026-10-01）。
 *
 * PV を出すレポート（i18n-demand-report.js・monthly-pv-trend-report.js）は、集計期間や
 * 前回レポートとの比較がこの日をまたぐときに注記を出す。/growth-pdca・/growth-report の手順書を
 * 読まなくても、出力を見た人が誤読しないようにするため。
 * 検証: scripts/maintenance/verify-ga4-measurement-breaks.js
 */

export const GA4_PV_BREAKS = Object.freeze([
  Object.freeze({
    // この日の 13時 JST ごろに本番へ反映。この日を含む以前と、翌日以降を比べない
    date: "2026-09-29",
    ref: "PR#935（BOA-531）・拡張計測「ブラウザの履歴イベントに基づくページの変更」OFF",
    description:
      'page_view を1経路に統一した。以前は会場・レース詳細等の閲覧が "/" に誤帰属していたため、以後は "/" の PV が下がり、会場・レース詳細の PV が上がって見える。需要の変化ではない',
  }),
  Object.freeze({
    date: "2026-10-01",
    ref: "GA4 管理画面の内部トラフィック除外（ユーザー設定）",
    description:
      "運営者の内部トラフィックを除外した。以後は PV・ユーザー数が運営者の閲覧分だけ下がって見える。需要の変化ではない",
  }),
]);

/**
 * 期間 [startDate, endDate]（YYYY-MM-DD、両端を含む）が計測の切れ目をまたぐものを返す。
 * 切れ目の日は「切り替わりの途中の日」なので、期間がその日を含み、かつ前後どちらかの日も含むときにまたぐとみなす
 * @param {string} startDate
 * @param {string} endDate
 * @returns {typeof GA4_PV_BREAKS[number][]}
 */
export function ga4PvBreaksWithin(startDate, endDate) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    throw new Error(
      `ga4PvBreaksWithin: 日付は YYYY-MM-DD で渡してください（${startDate}〜${endDate}）`,
    );
  }
  return GA4_PV_BREAKS.filter(
    (b) => startDate <= b.date && b.date <= endDate && startDate < endDate,
  );
}

/**
 * @param {typeof GA4_PV_BREAKS[number][]} breaks
 * @returns {string} 該当が無ければ空文字
 */
export function formatGa4PvBreakNotice(breaks) {
  if (breaks.length === 0) return "";
  return [
    "⚠️ GA4 の計測方法が変わった日をまたいでいます。この日の前後で PV を比較しないでください",
    ...breaks.map((b) => `  - ${b.date}: ${b.description}（${b.ref}）`),
  ].join("\n");
}
