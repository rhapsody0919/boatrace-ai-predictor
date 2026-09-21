/**
 * politeFetch（Response を返す）を、既存のスクレイパー（scrape-to-json.js・scrape-pcexpect.js）が受け取る
 * fetchHtml（URL → HTML 文字列。HTTP エラーは例外）の形にする。タイムアウト・429/503のバックオフ・
 * サーキットブレーカーは politeFetch が担う（ctx.politeFetch）。
 *
 * @param {(url: string, init?: RequestInit) => Promise<Response>} politeFetch
 * @returns {(url: string) => Promise<string>}
 */
export function makeFetchHtml(politeFetch) {
  return async (url) => {
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  };
}
