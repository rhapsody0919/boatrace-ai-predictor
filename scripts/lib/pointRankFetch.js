// ポイントランクのページの取得 fetchPointRank と取得の定数（USER_AGENT・FETCH_HEADERS・FETCH_TIMEOUT_MS）。scripts/daily/scrape-point-rank.js から字のまま移した（pointRankRun.js の fetch 部）。

import * as cheerio from "cheerio";
import { parsePointRankTable, parsePointRankAsOf } from "./pointRankParser.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

const FETCH_TIMEOUT_MS = 15000;

/**
 * 1会場分の得点率一覧を取得・パース
 * @returns {Promise<{kind: "error", message: string} | {kind: "none"} |
 *   {kind: "table", rows: Array<Object>}>}
 */
async function fetchPointRank(
  date,
  venueCode,
  { fetchImpl = fetch, attempts = 2, retryDelayMs = 3000 } = {},
) {
  const ymd = date.replace(/-/g, "");
  const jcd = String(venueCode).padStart(2, "0");
  const url = `https://www.boatrace.jp/owpc/pc/race/pointrank?jcd=${jcd}&hd=${ymd}`;

  // 一時的な失敗（5xx・タイムアウト）に備えて再試行する（既定は1回だけ再試行。Vercelは politeFetch が
  // バックオフ・再試行をするため、attempts: 1 で二重にしない）
  let lastError = "unknown";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
      } else {
        const $ = cheerio.load(await res.text());
        const rows = parsePointRankTable($);
        return rows === null
          ? { kind: "none" }
          : { kind: "table", rows, asOf: parsePointRankAsOf($) };
      }
    } catch (err) {
      lastError = err.message;
    }
    if (attempt < attempts)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  return { kind: "error", message: lastError };
}

export { fetchPointRank };
