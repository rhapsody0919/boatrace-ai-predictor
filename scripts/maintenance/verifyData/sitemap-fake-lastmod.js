/**
 * sitemap-fake-lastmod.js - scripts/lib/sitemapLastmod.js の写し（sitemap-generator.js が scripts/generate-sitemap.js からの
 * import だけをここへ向ける。verify ではない）。laterDate・renderUrlEntry は本物のまま。
 * gitLastCommitDate だけを、記事の md ごとに git を起こさず決まった日（FAKE_COMMIT_DATE）を返す偽にする
 * （本物の gitLastCommitDate は verify-sitemap-lastmod.js が直に確かめる。記事は数百本あり、毎回 git を起こすと遅い）。
 */
export { laterDate, renderUrlEntry } from "../../lib/sitemapLastmod.js";

export const FAKE_COMMIT_DATE = "2026-01-15";
export const gitLastCommitCalls = [];

export function gitLastCommitDate(filePath) {
  gitLastCommitCalls.push(String(filePath));
  return FAKE_COMMIT_DATE;
}
