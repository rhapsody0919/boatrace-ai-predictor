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
import {
  BLOCKED_STATUSES,
  FetchError,
  backoffMs,
  decideHostByCanary,
  describeBlockedResponse,
  fetchOnce,
  parseRetryAfterMs,
  probeHostWithCanary,
} from "./politeFetchParts.js";

// FetchError・403 の応答の説明・Retry-After の解釈は politeFetchParts.js へ移した（ここから従来どおり import できる）
export { FetchError, describeBlockedResponse, parseRetryAfterMs };

const RETRYABLE_STATUSES = new Set([429, 503]);

export const DEFAULT_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

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

/** createPoliteFetch の引数の既定値（3つに分けて、1つの関数の複雑さを抑える） */
const httpConfig = ({
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
  now = () => Date.now(),
  timeoutMs = 15000,
  userAgent = DEFAULT_USER_AGENT,
} = {}) => ({ fetchImpl, sleep, random, now, timeoutMs, userAgent });

const retryConfig = ({
  maxRetries = 2,
  baseDelayMs = 1000,
  maxDelayMs = 10000,
  jitterMs = 500,
  maxConcurrent = 20,
} = {}) => ({ maxRetries, baseDelayMs, maxDelayMs, jitterMs, maxConcurrent });

const policyConfig = ({
  breaker,
  blockPathKeys = DEFAULT_BLOCK_PATH_KEYS,
  canaryUrls = DEFAULT_CANARY_URLS,
  // false: 429/503 をブレーカーの連続の失敗に数えない（段階を上げない）。利用者の要求（/api/odds/live）用。
  // Retry-After が10秒を超えるときにその時間開くのは同じ（#1983 の審査 P2 の決定）
  countOverload = true,
  // 取得の数を数える（fetchCounter.js。1回の fetch＝再試行・カナリアも1件。BOA-1145 P3）。無ければ数えない
  counter = null,
} = {}) => ({ breaker, blockPathKeys, canaryUrls, countOverload, counter });

/** ホスト・パスの試行の印を外す（取得しなかった・結果が出なかったとき） */
const abortProbes = (breaker, hostKey, pathKey, guarded) => {
  breaker?.abortProbe(hostKey);
  if (guarded) breaker?.abortProbe(pathKey);
};

/**
 * 取得の段（politeFetch の1回の中身）は、await の位置と段数を保ったまま小さな関数に分けるため、generator にして
 * yield で値を渡し、この run が await で受ける（yield 1つ＝元の await 1つ。async の関数を await で呼ぶと段が増え、
 * 並行の取得でブレーカーの状態を見る順が変わりうる）。yield* の委譲は段を増やさない。
 */
const run = async (gen) => {
  let step = gen.next();
  while (!step.done) {
    let value;
    let failure = null;
    try {
      value = await step.value;
    } catch (error) {
      failure = { error };
    }
    step = failure ? gen.throw(failure.error) : gen.next(value);
  }
  return step.value;
};

/** 応答の処理で「もう一度取る」を表す印 */
const RETRY = Symbol("retry");

/**
 * ブレーカーの確認: 先に予約なしで両方を見る（パスが開いているのにホストの半開の試行を DB で予約して、全体の試行を止めないため）。
 * パスの確認が失敗したら、ホストの半開の試行を予約していたら戻す（取得しないため）。ホストの半開の試行は、要求された
 * ページではなくカナリアのページで行う（閉じたら要求されたページを取る）
 */
function* checkBreakers(env, { hostKey, pathKey, guarded }) {
  const { breaker, canaryUrls } = env;
  yield breaker.check(hostKey, { reserve: false });
  if (guarded) yield breaker.check(pathKey, { reserve: false });
  const hostCheck = yield breaker.check(hostKey);
  if (guarded) {
    try {
      yield breaker.check(pathKey);
    } catch (error) {
      breaker.abortProbe(hostKey);
      throw error;
    }
  }
  const canaryUrl = canaryUrls[hostKey];
  if (hostCheck?.probe && canaryUrl) {
    try {
      yield probeHostWithCanary(env, hostKey, canaryUrl);
    } catch (error) {
      if (guarded) breaker.abortProbe(pathKey);
      throw error;
    }
  }
}

/**
 * 登録したパスの 403: 再試行せず、パスのブレーカーを開いて BreakerOpenError を投げる（ブレーカーが無ければ応答を返す）。
 * 同じプロセスで既に開いていた（並行の要求の 403 が後から届いた）ならカナリアを取らない。ホストは応答した
 * （過負荷ではない）ので、ホストの数え方は従来どおり成功の側
 */
function* onGuardedBlocked(env, response, { hostKey, pathKey }) {
  const { breaker, now } = env;
  if (!breaker) return response;
  const reason = yield describeBlockedResponse(response);
  const wasOpen = breaker.snapshot(pathKey).openUntil > now();
  yield breaker.recordSuccess(hostKey);
  yield breaker.recordBlocked(pathKey, reason);
  if (!wasOpen) {
    console.warn(`⚠️ ${pathKey}: 拒否された（${reason}）`);
    yield decideHostByCanary(env, hostKey);
  }
  throw new BreakerOpenError(pathKey, breaker.snapshot(pathKey).openUntil);
}

/**
 * 429/503。Retry-After が再試行の上限（10秒）を超える: 再試行せず、ホストをその時間（上限60分）開く
 * （spec §5.1、BOA-1145 P4a ④b）。それ以外は連続の失敗に数え、再試行の回数が残っていれば待って RETRY を返す
 */
function* onRetryable(env, response, { hostKey, pathKey, guarded }, attempt) {
  const { breaker, now, maxDelayMs, maxRetries, sleep } = env;
  if (guarded) breaker?.abortProbe(pathKey);
  const retryAfterMs = parseRetryAfterMs(
    response.headers.get("retry-after"),
    now(),
  );
  if (retryAfterMs !== null && retryAfterMs > maxDelayMs) {
    yield breaker?.recordRetryAfter(
      hostKey,
      retryAfterMs,
      `HTTP ${response.status} Retry-After ${Math.round(retryAfterMs / 1000)}s`,
    );
    return response;
  }
  if (env.countOverload)
    yield breaker?.recordFailure(hostKey, `HTTP ${response.status}`);
  else breaker?.abortProbe(hostKey);
  if (attempt < maxRetries) {
    yield sleep(backoffMs(env, attempt, retryAfterMs));
    return RETRY;
  }
  return response;
}

/** 応答ごとの記録。返す応答か、もう一度取る印（RETRY）。登録したパスのブレーカーは、2xx・3xx でだけ閉じる（半開の試行が 404・500・保守のページでも閉じない） */
function* onResponse(env, response, keys, attempt) {
  const { breaker } = env;
  if (keys.guarded && BLOCKED_STATUSES.has(response.status)) {
    return yield* onGuardedBlocked(env, response, keys);
  }
  if (env.retryableStatuses.has(response.status)) {
    return yield* onRetryable(env, response, keys, attempt);
  }
  yield breaker?.recordSuccess(keys.hostKey);
  if (keys.guarded) {
    if (response.ok) yield breaker?.recordSuccess(keys.pathKey);
    else breaker?.abortProbe(keys.pathKey);
  }
  return response;
}

/** 1回の politeFetch（セマフォの中で動く）。ループは必ず return か throw で終わる（maxRetries >= 0 のため） */
function* politeFetchSteps(env, url, init) {
  const { breaker, maxRetries, sleep } = env;
  const hostKey = hostKeyOf(url);
  const pathKey = pathKeyOf(url);
  const keys = { hostKey, pathKey, guarded: env.blockPathKeys.has(pathKey) };
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (breaker) yield* checkBreakers(env, keys);
    let response;
    try {
      response = yield fetchOnce(env, url, init);
    } catch (error) {
      abortProbes(breaker, hostKey, pathKey, keys.guarded);
      lastError = error;
      if (attempt < maxRetries) {
        yield sleep(backoffMs(env, attempt, null));
        continue;
      }
      throw new FetchError(url, attempt + 1, error);
    }
    const out = yield* onResponse(env, response, keys, attempt);
    if (out !== RETRY) return out;
  }
  throw new FetchError(url, maxRetries + 1, lastError);
}

const politeFetchLoop = (env, url, init) => run(politeFetchSteps(env, url, init));

/**
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {ReturnType<import("./circuitBreaker.js").createCircuitBreaker>} [options.breaker]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random] 0以上1未満
 * @param {() => number} [options.now] epoch ms（Retry-After の日付形式の解釈用）
 */
export function createPoliteFetch(options) {
  const env = {
    ...httpConfig(options),
    ...retryConfig(options),
    ...policyConfig(options),
    // カナリアを取っている最中のホスト（同じプロセスで同時に 403 が重なっても1件にする）
    canaryRunning: new Set(),
    retryableStatuses: RETRYABLE_STATUSES,
  };
  const semaphore = createSemaphore(env.maxConcurrent);

  /**
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async function politeFetch(url, init = {}) {
    return semaphore.run(() => politeFetchLoop(env, url, init));
  }

  return politeFetch;
}
