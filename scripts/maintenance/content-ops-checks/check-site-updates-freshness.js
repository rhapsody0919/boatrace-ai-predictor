/**
 * 更新のお知らせ（src/data/siteUpdates.js）の最新の日付が古くないかを見る（読むだけ）。
 * 書き手は窓口で、候補は scripts/maintenance/site-updates-candidates.js が出す（docs/design/site-updates/）。
 * 11/22 の分で4日止まった（2026-11-26 オーナーの指摘）ので、session-start-check で古さを出す。
 * 検証: scripts/maintenance/verify-site-updates-freshness.js
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");
const DATA_FILE = "src/data/siteUpdates.js";
export const SITE_UPDATES_STALE_DAYS = 7;

/** データの本文から、SITE_UPDATES の中の最も新しい date（YYYY-MM-DD）を返す。無ければ null */
export function latestUpdateDate(text) {
  const start = text.indexOf("export const SITE_UPDATES");
  if (start < 0) return null;
  const end = text.indexOf("export const SITE_MAKING", start);
  const body = text.slice(start, end < 0 ? undefined : end);
  const dates = [...body.matchAll(/date:\s*"(\d{4}-\d{2}-\d{2})"/g)].map(
    (m) => m[1],
  );
  return dates.length ? dates.sort().at(-1) : null;
}

/** 最新の日付と今日（JST の暦日）から鮮度を判定する（純関数） */
export function judgeSiteUpdatesFreshness(latestDate, now = new Date()) {
  if (!latestDate) {
    return { stale: null, error: `${DATA_FILE} から日付を読めない` };
  }
  const todayJst = new Date(now.getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
  const ageDays = Math.round(
    (Date.parse(todayJst) - Date.parse(latestDate)) / 86400000,
  );
  const stale = ageDays >= SITE_UPDATES_STALE_DAYS;
  return {
    latestDate,
    ageDays,
    stale,
    staleThresholdDays: SITE_UPDATES_STALE_DAYS,
    command: stale
      ? `git fetch origin master && node scripts/maintenance/site-updates-candidates.js で候補を出し、ファンに見える変更を ${DATA_FILE} に足して PR にする（書き手は窓口）`
      : undefined,
  };
}

export async function checkSiteUpdatesFreshness(now = new Date()) {
  try {
    const text = await fs.readFile(path.join(REPO_ROOT, DATA_FILE), "utf-8");
    return judgeSiteUpdatesFreshness(latestUpdateDate(text), now);
  } catch (error) {
    return { stale: null, error: `${DATA_FILE} を読めない: ${error.message}` };
  }
}
