/**
 * 取得先（boatrace.jp 等）への、負荷に配慮した取得（ADR-0067・BOA-368、plan.md §2.2・§8）。
 *
 *   - タイムアウト: 15秒（ヘッダーと本文の両方。scripts/lib/supabaseClient.js の fetchWithTimeout はヘッダーのみで、
 *     本文の読み取りが止まると関数の最大実行時間まで固まるため、ここでは本文も含める）
 *   - 429/503: 指数バックオフ＋ジッターで最大2回まで再試行（Retry-After があれば尊重する。上限10秒）。Retry-After が10秒を
 *     超えるときは再試行せず、ホストのブレーカーをその時間（上限60分）開いて、その応答を返す（BOA-1145 P4a ④b）。
 *     上限に達したら、429/503 のままの応答を返す（呼び出し側が判断する）
 *   - ネットワークエラー・タイムアウト: 同じ再試行。上限に達したら FetchError を投げる
 *   - サーキットブレーカー: 取得の前に breaker.check() を呼び、開いていれば BreakerOpenError を投げる
 *     （取得しない）。429/503 は breaker.recordFailure() に、それ以外の応答は recordSuccess() に渡す。
 *     ネットワークエラー・タイムアウトは、ブレーカーの失敗としては数えない（こちらのネットワークの問題と
 *     取得先の過負荷を区別できないため。plan.md §8は「429/503が5件以上」）
 *   - 拒否（403。BOA-1145）: 登録したパス（blockPathKeys。既定はレジストリの各ジョブの breakerUrls。今は boatrace.jp の
 *     beforeinfo だけ）に限り、再試行せず、そのパス単位のキー（pathKeyOf。例 host:boatrace.jp/owpc/pc/race/beforeinfo）で
 *     breaker.recordBlocked() を呼んで1回で開き、BreakerOpenError を投げる（呼び出し側は既存の breaker_open の扱いになり、
 *     ジョブの連続失敗に数えない＝GHA の肩代わりの条件に入らない）。登録したパスは、取得の前にパスのキーも check() する。
 *     同じホストの他のページ（odds・racelist 等）は巻き込まない。登録していないパスの 403 は従来どおり成功の側
 *     （BOATCAST は未公開のファイルを 403 で返すのが通常。ADR-0067 の追記 2026-09-21・2026-10-26）
 *   - カナリア（BOA-1145 P4a ③、spec §5.1）: 登録したパスが 403 で開いたら、その場で軽いページ（canaryUrls。boatrace.jp は
 *     race/index）を1件だけ取る。403 ならホスト全体のブレーカーを開く（60分から段階で倍、上限6時間）。2xx・3xx ならパスだけの
 *     拒否と判断し、ホストは開かない。同じプロセスで同じパスの 403 が続いても、カナリアは開いた最初の1回だけ
 *   - ホストの半開（同）: ホストのブレーカーの期限が来たら、要求されたページではなく canaryUrls のページで1件試す
 *     （止められたパスを試して開き直さない）。2xx・3xx で閉じ、その後に要求されたページを取る。403 は段階を上げて開き直す
 *   - 403 の記録（同）: 応答のヘッダ（Server・server-timing）・Akamai の参照番号・本文の先頭200字を、ブレーカーの
 *     last_error に残す（拒否の理由の切り分け。追加の取得はしない。describeBlockedResponse）
 *   - 並列度の上限: この関数の同時実行数を maxConcurrent に抑える（ジョブ単位の並列度とは別の、最後の砦）
 *   - User-Agent: 未指定なら BoatraceAIBot/1.0（既存のスクレイパーと同じ）
 *
 * 戻り値は、本文を読み込み済みの標準の Response（text()・json() が使える）。
 */
import { HOST_JOB_PREFIX, SCRAPE_JOBS } from "./registry.js";
import { BreakerOpenError } from "./circuitBreaker.js";
import { createSemaphore } from "./concurrency.js";

export const DEFAULT_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

const RETRYABLE_STATUSES = new Set([429, 503]);
// 取得先の拒否。待っても数分では戻らない見込みが高いため、再試行せず、そのパスのブレーカーを開く（BOA-1145）
const BLOCKED_STATUSES = new Set([403]);
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

/** 拒否（403）のブレーカーのキー。ホストのキー＋パス（クエリは含めない。例: host:boatrace.jp/owpc/pc/race/beforeinfo） */
export function pathKeyOf(url) {
  return `${hostKeyOf(url)}${new URL(url).pathname}`;
}

/** 403 でパスのブレーカーを開くパスのキー（レジストリの各ジョブの breakerUrls から） */
export const DEFAULT_BLOCK_PATH_KEYS = new Set(
  Object.values(SCRAPE_JOBS).flatMap((def) =>
    (def.breakerUrls ?? []).map(pathKeyOf),
  ),
);

/**
 * ホストのカナリア（パスが 403 で開いたときと、ホストの半開の試行で取る軽いページ）。ホストのキー → URL。
 * 載せていないホスト（race.boatcast.jp 等）はカナリアを取らない（BOATCAST は未公開のファイルを 403 で返すのが通常）
 */
export const DEFAULT_CANARY_URLS = Object.freeze({
  [`${HOST_JOB_PREFIX}boatrace.jp`]:
    "https://www.boatrace.jp/owpc/pc/race/index",
});

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
  blockPathKeys = DEFAULT_BLOCK_PATH_KEYS,
  canaryUrls = DEFAULT_CANARY_URLS,
  // false: 429/503 をブレーカーの連続の失敗に数えない（段階を上げない）。利用者の要求（/api/odds/live）用。
  // Retry-After が10秒を超えるときにその時間開くのは同じ（#1983 の審査 P2 の決定）
  countOverload = true,
} = {}) {
  const semaphore = createSemaphore(maxConcurrent);
  // カナリアを取っている最中のホスト（同じプロセスで同時に 403 が重なっても1件にする）
  const canaryRunning = new Set();

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
   * カナリア（半開の試行・パスが開いた直後の確認）の 429/503。通常の取得と同じく、Retry-After が10秒を超えるならその時間
   * （上限60分）開き、それ以外は連続の失敗に数える（#1983 の審査 P3・Codex の P1）
   */
  const recordCanaryOverload = async (hostKey, response) => {
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
  const probeHostWithCanary = async (hostKey, canaryUrl) => {
    let response;
    try {
      response = await fetchOnce(canaryUrl, {});
    } catch (error) {
      breaker.abortProbe(hostKey);
      throw new FetchError(canaryUrl, 1, error);
    }
    if (BLOCKED_STATUSES.has(response.status)) {
      const reason = await describeBlockedResponse(response);
      console.warn(`⚠️ ${hostKey}: 半開のカナリアが拒否された（${reason}）`);
      await breaker.recordBlocked(hostKey, reason);
    } else if (RETRYABLE_STATUSES.has(response.status)) {
      await recordCanaryOverload(hostKey, response);
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
  const decideHostByCanary = async (hostKey) => {
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
        await probeHostWithCanary(hostKey, canaryUrl).catch(() => {});
        return;
      }
      let response;
      try {
        response = await fetchOnce(canaryUrl, {});
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
      } else if (RETRYABLE_STATUSES.has(response.status)) {
        await recordCanaryOverload(hostKey, response);
      } else {
        await breaker.recordSuccess(hostKey);
      }
    } finally {
      canaryRunning.delete(hostKey);
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
      const pathKey = pathKeyOf(url);
      const guarded = blockPathKeys.has(pathKey);
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (breaker) {
          // 先に予約なしで両方を見る（パスが開いているのにホストの半開の試行を DB で予約して、全体の試行を止めないため）
          await breaker.check(hostKey, { reserve: false });
          if (guarded) await breaker.check(pathKey, { reserve: false });
          const hostCheck = await breaker.check(hostKey);
          if (guarded) {
            try {
              await breaker.check(pathKey);
            } catch (error) {
              // ホストの半開の試行を予約していたら戻す（取得しないため）
              breaker.abortProbe(hostKey);
              throw error;
            }
          }
          const canaryUrl = canaryUrls[hostKey];
          if (hostCheck?.probe && canaryUrl) {
            // ホストの半開の試行は、要求されたページではなくカナリアのページで行う（閉じたら要求されたページを取る）
            try {
              await probeHostWithCanary(hostKey, canaryUrl);
            } catch (error) {
              if (guarded) breaker.abortProbe(pathKey);
              throw error;
            }
          }
        }
        let response;
        try {
          response = await fetchOnce(url, init);
        } catch (error) {
          breaker?.abortProbe(hostKey);
          if (guarded) breaker?.abortProbe(pathKey);
          lastError = error;
          if (attempt < maxRetries) {
            await sleep(backoffMs(attempt, null));
            continue;
          }
          throw new FetchError(url, attempt + 1, error);
        }
        if (guarded && BLOCKED_STATUSES.has(response.status)) {
          if (!breaker) return response;
          const reason = await describeBlockedResponse(response);
          // 同じプロセスで既に開いていた（並行の要求の 403 が後から届いた）ならカナリアを取らない
          const wasOpen = breaker.snapshot(pathKey).openUntil > now();
          // ホストは応答した（過負荷ではない）: ホストの数え方は従来どおり成功の側
          await breaker.recordSuccess(hostKey);
          await breaker.recordBlocked(pathKey, reason);
          if (!wasOpen) {
            console.warn(`⚠️ ${pathKey}: 拒否された（${reason}）`);
            await decideHostByCanary(hostKey);
          }
          throw new BreakerOpenError(
            pathKey,
            breaker.snapshot(pathKey).openUntil,
          );
        }
        if (RETRYABLE_STATUSES.has(response.status)) {
          if (guarded) breaker?.abortProbe(pathKey);
          const retryAfterMs = parseRetryAfterMs(
            response.headers.get("retry-after"),
            now(),
          );
          if (retryAfterMs !== null && retryAfterMs > maxDelayMs) {
            // 待つ時間が再試行の上限（10秒）を超える: 再試行せず、ホストをその時間（上限60分）開く（spec §5.1、BOA-1145 P4a ④b）
            await breaker?.recordRetryAfter(
              hostKey,
              retryAfterMs,
              `HTTP ${response.status} Retry-After ${Math.round(retryAfterMs / 1000)}s`,
            );
            return response;
          }
          if (countOverload)
            await breaker?.recordFailure(hostKey, `HTTP ${response.status}`);
          else breaker?.abortProbe(hostKey);
          if (attempt < maxRetries) {
            await sleep(backoffMs(attempt, retryAfterMs));
            continue;
          }
          return response;
        }
        await breaker?.recordSuccess(hostKey);
        if (guarded) {
          // 登録したパスのブレーカーは、2xx・3xx でだけ閉じる（半開の試行が 404・500・保守のページでも閉じない）
          if (response.ok) await breaker?.recordSuccess(pathKey);
          else breaker?.abortProbe(pathKey);
        }
        return response;
      }
      // ループは必ず return か throw で終わる（maxRetries >= 0 のため）
      throw new FetchError(url, maxRetries + 1, lastError);
    });
  }

  return politeFetch;
}
