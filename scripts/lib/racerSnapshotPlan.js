/**
 * 選手ページのスナップショット（BOA-848）を、このビルドで作るか・どの選手を作るかを決める。
 *
 * - 作るのは sitemap に載る選手だけ（isRacerIndexable の集合。scripts/generate-sitemap.js が毎日書く
 *   public/sitemap.xml をそのまま使う）。noindex のページは作らない
 * - 本番のビルド（VERCEL_ENV=production）だけで全員を作る。Preview・手元のビルドでは作らない
 *   （本番 DB に数千のリクエストを送らないため）
 * - RACER_SNAPSHOT_LIMIT（正の整数）があれば、本番以外でもその人数だけ作る（Preview で確かめる用）。
 *   本番では無視する（Preview 用の設定が本番に残って、人数が欠けたまま配ることを防ぐ）
 *
 * @param {{ vercelEnv?: string, limit?: string, sitemapXml: string }} input
 * @returns {{ ids: string[], reason: string }} ids が空なら作らない
 */
export function planRacerSnapshots({ vercelEnv, limit, sitemapXml }) {
  const allIds = [
    ...sitemapXml.matchAll(
      /<loc>https:\/\/www\.boat-ai\.jp\/racer\/(\d{4})<\/loc>/g,
    ),
  ].map((m) => m[1]);
  const ids = [...new Set(allIds)];

  if (vercelEnv === "production") {
    const note = limit
      ? `（RACER_SNAPSHOT_LIMIT=${limit} は本番では無視）`
      : "";
    return { ids, reason: `本番のビルド: sitemap の ${ids.length} 人${note}` };
  }

  if (limit === undefined || limit === "") {
    return {
      ids: [],
      reason: `本番以外のビルド（VERCEL_ENV=${vercelEnv ?? "なし"}）では作らない。RACER_SNAPSHOT_LIMIT で人数を指定すれば作る`,
    };
  }

  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) {
    return {
      ids: [],
      reason: `RACER_SNAPSHOT_LIMIT=${limit} は正の整数ではないので作らない`,
    };
  }
  return {
    ids: ids.slice(0, n),
    reason: `RACER_SNAPSHOT_LIMIT=${n}: sitemap の ${ids.length} 人のうち先頭 ${Math.min(n, ids.length)} 人`,
  };
}
