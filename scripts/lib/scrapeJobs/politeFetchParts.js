// politeFetch.js から移した部品: FetchError・403 の応答の説明・Retry-After の解釈・1回の fetch（タイムアウト・数え）・カナリア。
// 設定・ブレーカー・数えは、createPoliteFetch が作る env（fetchImpl・breaker・sleep・random・now・timeoutMs・userAgent・
// maxDelayMs・jitterMs・baseDelayMs・canaryUrls・counter・canaryRunning・retryableStatuses）で受け取る。
import { BreakerOpenError } from "./circuitBreaker.js";

// 取得先の拒否。待っても数分では戻らない見込みが高いため、再試行せず、そのパスのブレーカーを開く（BOA-1145）
export const BLOCKED_STATUSES = new Set([403]);
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

const fromCode = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");
const decodeEntities = (text) =>
  text
    .replace(/&#(\d{1,7});/g, (_, n) => fromCode(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => fromCode(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * 403 の応答を、ブレーカーの記録（last_error、500字まで）に残す1行にする（spec §5.1）。
 * Server・server-timing・Akamai の参照番号（本文の「Reference #18.xxxx」。数値文字参照で書かれることがある）・本文の先頭200字
 * （タグを除き空白を詰めたもの）。本文を読めなくても（読み済み等）ヘッダだけで返す
 * @param {Response} response
 * @returns {Promise<string>}
 */
export async function describeBlockedResponse(response) {
  let body = "";
  try {
    body = await response.clone().text();
  } catch {
    body = "";
  }
  const text = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  const ref = /Reference\s*#\s*([0-9a-f]+(?:\.[0-9a-f]+)+)/i.exec(text)?.[1];
  const parts = [`HTTP ${response.status}`];
  const server = response.headers.get("server");
  if (server) parts.push(`server: ${server.slice(0, 40)}`);
  const timing = response.headers.get("server-timing");
  if (timing) parts.push(`server-timing: ${timing.slice(0, 120)}`);
  if (ref) parts.push(`ref: ${ref}`);
  if (text) parts.push(`body: ${text.slice(0, 200)}`);
  return parts.join(" | ");
}

const isPassStatus = (status) => status >= 200 && status < 400;

/** Retry-After（秒、またはHTTP日付）をミリ秒に。解釈できなければ null */
export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.max(0, Number(text) * 1000);
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export const backoffMs = (env, attempt, retryAfterMs) => {
  const base = retryAfterMs ?? env.baseDelayMs * 2 ** attempt;
  return Math.min(env.maxDelayMs, base) + Math.floor(env.random() * env.jitterMs);
};

// 1回の fetch を数える（数える側の失敗は取得に響かせない）
const count = (env, entry) => {
  try {
    env.counter?.add(entry);
  } catch {
    // 数えるのは監視のため。取得は止めない
  }
};

// タイムアウトはヘッダーと本文の両方に効かせ、本文を読み込んだ Response を返す
const fetchOnceRaw = async (env, url, init) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, env.timeoutMs);
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
    if (!headers.has("user-agent")) headers.set("user-agent", env.userAgent);
    const response = await env.fetchImpl(url, {
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
  } catch (error) {
    if (timedOut && error && typeof error === "object") {
      try {
        error.politeFetchTimedOut = true;
      } catch {
        // 凍結された例外には印を付けられない（network として数える）
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchOnce = async (env, url, init) => {
  try {
    const response = await fetchOnceRaw(env, url, init);
    count(env, { url, status: response.status });
    return response;
  } catch (error) {
    // 呼び出し側の中断（ソフトデッドライン等）は数えない。自前の打ち切りは timeout として数える（審査 P2-3）
    if (!init.signal?.aborted) {
      count(env, { url, error, timedOut: error?.politeFetchTimedOut === true });
    }
    throw error;
  }
};

/**
 * カナリア（半開の試行・パスが開いた直後の確認）の 429/503。通常の取得と同じく、Retry-After が10秒を超えるならその時間
 * （上限60分）開き、それ以外は連続の失敗に数える（#1983 の審査 P3・Codex の P1）
 */
const recordCanaryOverload = async (env, hostKey, response) => {
  const { breaker, now, maxDelayMs } = env;
  const retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    now(),
  );
  if (retryAfterMs !== null && retryAfterMs > maxDelayMs) {
    await breaker.recordRetryAfter(
      hostKey,
      retryAfterMs,
      `HTTP ${response.status} Retry-After ${Math.round(retryAfterMs / 1000)}s`,
    );
  } else {
    await breaker.recordFailure(hostKey, `HTTP ${response.status}`);
  }
};

/**
 * ホストの半開の試行を、カナリアのページで行う（check(hostKey) が試行を予約した後に呼ぶ）。
 * 403 は段階を上げて開き直し、429/503 は開き直して例外を投げる。それ以外の応答（2xx・3xx・404・500・502・504）は閉じて戻る
 * （spec §5.1 の「500・404 は成功の側」。閉じないと期限が過去のまま残り、全ての取得がカナリアに置き換わって詰まり、
 * 期限で見る監視も知らせない。審査 P1-1）。接続の失敗は試行の印だけ外して例外を投げる
 */
export const probeHostWithCanary = async (env, hostKey, canaryUrl) => {
  const { breaker, now } = env;
  let response;
  try {
    response = await fetchOnce(env, canaryUrl, {});
  } catch (error) {
    breaker.abortProbe(hostKey);
    throw new FetchError(canaryUrl, 1, error);
  }
  if (BLOCKED_STATUSES.has(response.status)) {
    const reason = await describeBlockedResponse(response);
    console.warn(`⚠️ ${hostKey}: 半開のカナリアが拒否された（${reason}）`);
    await breaker.recordBlocked(hostKey, reason);
  } else if (env.retryableStatuses.has(response.status)) {
    await recordCanaryOverload(env, hostKey, response);
  } else {
    if (!isPassStatus(response.status)) {
      console.warn(
        `⚠️ ${hostKey}: 半開のカナリア（${canaryUrl}）が HTTP ${response.status}。拒否・過負荷ではないので閉じる`,
      );
    }
    await breaker.recordSuccess(hostKey);
    return;
  }
  throw new BreakerOpenError(
    hostKey,
    Math.max(breaker.snapshot(hostKey).openUntil, now() + 5000),
  );
};

/**
 * パスが 403 で開いた直後に、ホストへ広げるかをカナリアで決める（spec §5.1）。ホストが既に開いている・カナリアの取得に
 * 失敗したときは何もしない（パスのブレーカーは開いたまま）
 */
export const decideHostByCanary = async (env, hostKey) => {
  const { breaker, canaryUrls, canaryRunning } = env;
  const canaryUrl = canaryUrls[hostKey];
  if (!canaryUrl || canaryRunning.has(hostKey)) return;
  canaryRunning.add(hostKey);
  try {
    let reserved;
    try {
      reserved = await breaker.check(hostKey);
    } catch {
      return; // ホストは既に開いている（非常停止を含む）
    }
    if (reserved?.probe) {
      // ホストの半開の試行と重なった: その試行をカナリアで行う
      await probeHostWithCanary(env, hostKey, canaryUrl).catch(() => {});
      return;
    }
    let response;
    try {
      response = await fetchOnce(env, canaryUrl, {});
    } catch (error) {
      console.warn(
        `⚠️ ${hostKey}: カナリア（${canaryUrl}）の取得に失敗。ホストは開かない: ${error?.message ?? error}`,
      );
      return;
    }
    if (BLOCKED_STATUSES.has(response.status)) {
      const reason = await describeBlockedResponse(response);
      console.warn(
        `⚠️ ${hostKey}: カナリアも拒否された。ホスト全体を開く（${reason}）`,
      );
      await breaker.recordBlocked(hostKey, `canary ${reason}`);
    } else if (env.retryableStatuses.has(response.status)) {
      await recordCanaryOverload(env, hostKey, response);
    } else {
      await breaker.recordSuccess(hostKey);
    }
  } finally {
    canaryRunning.delete(hostKey);
  }
};
