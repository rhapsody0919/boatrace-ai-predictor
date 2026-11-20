import { BreakerOpenError } from "./scrapeJobs/circuitBreaker.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};
// supabaseClient.js の FETCH_TIMEOUT_MS と同じ値（Node.js標準fetchの無期限
// ハング不具合対策、PR #639セルフレビュー由来の既存踏襲）
const FETCH_TIMEOUT_MS = 15000;

/**
 * race/information ページを取得する
 * @returns {Promise<{html: string|null, reason: string|null}>}
 */
function informationUrl(venueCode, dateYmd) {
  const jcd = String(venueCode).padStart(2, "0");
  return `https://www.boatrace.jp/owpc/pc/race/information?rno=1&jcd=${jcd}&hd=${dateYmd}`;
}

async function fetchInformationPage(venueCode, dateYmd) {
  const url = informationUrl(venueCode, dateYmd);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return { html: null, reason: `http_${res.status}` };
    const html = await res.text();
    return { html, reason: null };
  } catch (error) {
    if (error.name === "AbortError") {
      return { html: null, reason: "timeout" };
    }
    return { html: null, reason: `fetch_error: ${error.message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * politeFetch（共通ラッパの、タイムアウト・429/503のバックオフ・サーキットブレーカー付きの取得）で
 * race/information ページを取得する関数を作る。戻り値の形は fetchInformationPage と同じ。
 * ブレーカーが開いていて取得しなかった場合の reason は "breaker_open"（構造変化の失敗とは区別する）
 *
 * @param {(url: string, init?: RequestInit) => Promise<Response>} politeFetch
 * @returns {(venueCode: number, dateYmd: string) => Promise<{html: string|null, reason: string|null}>}
 */
export function createInformationFetcher(politeFetch) {
  return async (venueCode, dateYmd) => {
    try {
      const res = await politeFetch(informationUrl(venueCode, dateYmd), {
        headers: FETCH_HEADERS,
      });
      if (!res.ok) return { html: null, reason: `http_${res.status}` };
      return { html: await res.text(), reason: null };
    } catch (error) {
      // 子の FetchStoppedError（非常停止、178）も含める（名前ではなく instanceof で見る）
      if (error instanceof BreakerOpenError) {
        return { html: null, reason: "breaker_open" };
      }
      return {
        html: null,
        reason: `fetch_error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

export { fetchInformationPage };
