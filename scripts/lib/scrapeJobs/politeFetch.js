/**
 * 取得先（boatrace.jp 等）への、負荷に配慮した取得（ADR-0067・BOA-368、plan.md §2.2・§8）。
 *
 *   - タイムアウト: 15秒（ヘッダーと本文の両方。scripts/lib/supabaseClient.js の fetchWithTimeout はヘッダーのみで、
 *     本文の読み取りが止まると関数の最大実行時間まで固まるため、ここでは本文も含める）
 *   - 429/503: 指数バックオフ＋ジッターで最大2回まで再試行（Retry-After があれば尊重する。上限10秒）。
 *     上限に達したら、429/503 のままの応答を返す（呼び出し側が判断する）
 *   - ネットワークエラー・タイムアウト: 同じ再試行。上限に達したら FetchError を投げる
 *   - サーキットブレーカー: 取得の前に breaker.check() を呼び、開いていれば BreakerOpenError を投げる
 *     （取得しない）。429/503 は breaker.recordFailure() に、それ以外の応答は recordSuccess() に渡す。
 *     ネットワークエラー・タイムアウトは、ブレーカーの失敗としては数えない（こちらのネットワークの問題と
 *     取得先の過負荷を区別できないため。plan.md §8は「429/503が5件以上」）
 *   - 並列度の上限: この関数の同時実行数を maxConcurrent に抑える（ジョブ単位の並列度とは別の、最後の砦）
 *   - User-Agent: 未指定なら BoatraceAIBot/1.0（既存のスクレイパーと同じ）
 *
 * 戻り値は、本文を読み込み済みの標準の Response（text()・json() が使える）。
 */
import { HOST_JOB_PREFIX } from "./registry.js";
import { createSemaphore } from "./concurrency.js";

export const DEFAULT_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

const RETRYABLE_STATUSES = new Set([429, 503]);
// 本文を持てないステータス（new Response(body, {status}) が例外になる）
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export class FetchError extends Error {
  constructor(url, attempts, cause) {
    super(
      `取得に失敗しました（${attempts}回試行）: ${url} — ${cause?.message ?? cause}`,
    );
    this.name = "FetchError";
    this.url = url;
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** ブレーカーのキー（scrape_job_state.job）。www・www1 等は同じホストとして扱う */
export function hostKeyOf(url) {
  const hostname = new URL(url).hostname.replace(/^www\d*\./, "");
  return `${HOST_JOB_PREFIX}${hostname}`;
}

/** Retry-After（秒、またはHTTP日付）をミリ秒に。解釈できなければ null */
export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.max(0, Number(text) * 1000);
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/**
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {ReturnType<import("./circuitBreaker.js").createCircuitBreaker>} [options.breaker]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random] 0以上1未満
 * @param {() => number} [options.now] epoch ms（Retry-After の日付形式の解釈用）
 */
export function createPoliteFetch({
  fetchImpl = globalThis.fetch,
  breaker,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  now = () => Date.now(),
  timeoutMs = 15000,
  maxRetries = 2,
  baseDelayMs = 1000,
  maxDelayMs = 10000,
  jitterMs = 500,
  maxConcurrent = 20,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const semaphore = createSemaphore(maxConcurrent);

  const backoffMs = (attempt, retryAfterMs) => {
    const base = retryAfterMs ?? baseDelayMs * 2 ** attempt;
    return Math.min(maxDelayMs, base) + Math.floor(random() * jitterMs);
  };

  // タイムアウトはヘッダーと本文の両方に効かせ、本文を読み込んだ Response を返す
  const fetchOnce = async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 呼び出し側の signal も尊重する（どちらかが中断すれば中断）
    if (init.signal) {
      if (init.signal.aborted) controller.abort();
      else
        init.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
    }
    try {
      const headers = new Headers(init.headers ?? {});
      if (!headers.has("user-agent")) headers.set("user-agent", userAgent);
      const response = await fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const body = await response.arrayBuffer();
      const out = new Response(
        NULL_BODY_STATUSES.has(response.status) || body.byteLength === 0
          ? null
          : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
      Object.defineProperty(out, "url", { value: response.url ?? url });
      return out;
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async function politeFetch(url, init = {}) {
    return semaphore.run(async () => {
      const hostKey = hostKeyOf(url);
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (breaker) await breaker.check(hostKey);
        let response;
        try {
          response = await fetchOnce(url, init);
        } catch (error) {
          breaker?.abortProbe(hostKey);
          lastError = error;
          if (attempt < maxRetries) {
            await sleep(backoffMs(attempt, null));
            continue;
          }
          throw new FetchError(url, attempt + 1, error);
        }
        if (RETRYABLE_STATUSES.has(response.status)) {
          await breaker?.recordFailure(hostKey, `HTTP ${response.status}`);
          if (attempt < maxRetries) {
            await sleep(
              backoffMs(
                attempt,
                parseRetryAfterMs(response.headers.get("retry-after"), now()),
              ),
            );
            continue;
          }
          return response;
        }
        await breaker?.recordSuccess(hostKey);
        return response;
      }
      // ループは必ず return か throw で終わる（maxRetries >= 0 のため）
      throw new FetchError(url, maxRetries + 1, lastError);
    });
  }

  return politeFetch;
}
