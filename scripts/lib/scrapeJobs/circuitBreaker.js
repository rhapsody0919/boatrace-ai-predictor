/**
 * ホスト単位のサーキットブレーカー（BOA-368、plan.md §2.2・§8、ADR-0067）。
 *
 * 取得先が 429/503 を返し続けるときに、全ジョブの取得を止めて、取得先への負荷とIPブロックの危険を抑える。
 * 状態は2層:
 *   - プロセス内: 直近の失敗（429/503）の時刻と連続失敗数、半開の試行中か
 *   - DB（scrape_job_state の `host:<ホスト>` 行の breaker_open_until）: ブレーカーが開いている間、
 *     他のジョブ・他の起動（別プロセス）にも共有する。DBは store 経由（読み取りは TTL でキャッシュする）
 *
 * 状態遷移（plan.md §8の初期値）:
 *   closed    → open:      直近 windowMs（2分）に threshold（5）件、または連続 consecutiveThreshold（3）件の 429/503
 *   open      → half-open: 段階ごとの期間（retryStagesMs: 5分→10分→20分→60分。段階は DB の breaker_level に残す。
 *                          BOA-1145 P4a ④b、spec §5.1）の後。1件だけ試行させる（同じプロセスの同時の呼び出しは、まだ開いている扱い）
 *   half-open → closed:    試行が成功
 *   half-open → open:      試行が失敗。段階を1つ上げて開き直す（最大60分）
 *   Retry-After が10秒を超える 429/503（recordRetryAfter）: 1回で、その時間（上限60分）開く。段階も1つ上げる
 *
 * store が使えない（予定表のテーブルが未適用・DBエラー）場合は、プロセス内の状態のみで動く
 * （ブレーカーの共有ができないだけで、取得は止めない）。
 *
 * 拒否（403）の扱い（BOA-1145）: 取得先が特定のページだけを 403 で拒んだ（2026-10-26 の beforeinfo）。過負荷の 429/503 と
 * 違い、待っても数分では戻らない見込みが高く、叩き続けるほど拒否が長引く恐れがある。recordBlocked は1回で開き、
 * 開く期間を段階（level）で決める: blockOpenMs（30分）× 2^(段階−1)、上限 blockMaxOpenMs（6時間）。つまり 30分→1時間→
 * 2時間→4時間→6時間（spec §5.1。ホスト全体のキーは60分から）。段階と最後に開いた時刻は DB（breaker_level・breaker_opened_at、マイグレーション178）に残し、
 * 別の起動（別プロセス）も同じ段階から上げる（以前は段階がプロセスの中だけで、起動ごとに30分に戻っていた）。
 * 段階を下げる: 成功1回で0にしない。最後に開いてから stepDownMs（24時間）ごとに1段下げる（読むときに引く遅延評価。
 * 書き込みは要らない。effectiveBlockLevel）。閉じた後の絞り: 半開の試行が成功して閉じた時刻（breaker_closed_at）から throttleMs（24時間）は
 * isThrottled が true を返し、共通ラッパがそのジョブの1起動の上限（claimLimit）を半分にする（spec §5.2）。
 * 期限後は同じ半開（1件だけ試行）。キーは呼び出し側が決める（politeFetch はページのパス単位にし、同じホストの他のページを巻き込まない）。
 * 178 の前（列が無い）は段階を DB に残せず、プロセスの中だけで上げる（store.open が列を外して書き直す）。
 *
 * 非常停止（fetch_stop。マイグレーション178、ADR-0101 決定6）: store.read が {untilMs, fetchStop} を返し、fetchStop が true の
 * キー（人が `host:<ホスト>` の行で立てる）は、check が FetchStoppedError を投げる（BreakerOpenError の一種なので、呼び出し側は
 * 既存の breaker_open と同じ扱い＝取らない・ジョブの連続失敗に数えない）。下ろすのも人で、ブレーカーは書かない。
 * 読み取りの TTL（readTtlMs）の間はプロセス内の値で判定するので、立ててから効くまで最大 readTtlMs。
 * 読み取りに失敗したときは直前の値のまま（他の読み取りの失敗と同じく、取得は止めない側。DB が読めないときは
 * スロットの claim も失敗する）。
 */

import {
  MAX_BREAKER_LEVEL,
  adoptWritten,
  blockDurationMs,
  blockDurationOf,
  effectiveBlockLevel,
  levelCapOf,
  normalizeBreakerRead,
  openOverloaded,
  refresh,
  rememberDb,
  safe,
  stateOf,
  wroteUntil,
} from "./circuitBreakerParts.js";

// 段階・期間の純関数は circuitBreakerParts.js へ移した（ここから従来どおり import できる）
export {
  MAX_BREAKER_LEVEL,
  blockDurationMs,
  effectiveBlockLevel,
  normalizeBreakerRead,
};

export class BreakerOpenError extends Error {
  /**
   * @param {string} hostKey
   * @param {number} untilMs ブレーカーが開いている期限（epoch ms）
   */
  constructor(hostKey, untilMs) {
    super(
      `サーキットブレーカーが開いています（${hostKey}、${new Date(untilMs).toISOString()}まで）`,
    );
    this.name = "BreakerOpenError";
    this.hostKey = hostKey;
    this.until = untilMs;
  }
}

/** 非常停止（fetch_stop）が立っている。BreakerOpenError の一種（呼び出し側の breaker_open の扱いをそのまま使う） */
export class FetchStoppedError extends BreakerOpenError {
  /**
   * @param {string} hostKey
   * @param {number} untilMs 次に読み直す時刻（epoch ms。期限ではない。人が下ろすまで止まる）
   */
  constructor(hostKey, untilMs) {
    super(hostKey, untilMs);
    this.message = `取得の非常停止中です（${hostKey} の fetch_stop。人が下ろすまで取りません）`;
    this.name = "FetchStoppedError";
  }
}

/**
 * @typedef {Object} BreakerStore
 * @property {(hostKey: string) => Promise<number | {untilMs: number, fetchStop: boolean, level?: number, openedAtMs?: number}>} read
 *   breaker_open_until（epoch ms。開いていなければ0）・fetch_stop・breaker_level・breaker_opened_at（epoch ms。無ければ0）。
 *   数だけを返すと fetchStop=false・段階0として扱う
 * @property {(hostKey: string, untilMs: number, reason: string, level?: {level: number, openedAtMs: number}) => Promise<void>} open
 *   level を渡すと breaker_level・breaker_opened_at も書く（403・429/503 で開くとき。403 と 429 は同じ段階の列を使う）
 * @property {(hostKey: string, closed?: {closedAtMs: number}) => Promise<void>} close closed を渡すと breaker_closed_at も書く
 */

/**
 * createCircuitBreaker の引数の既定値（2つに分けて、1つの関数の複雑さを抑える）
 */
const timingConfig = ({
  store,
  now = () => Date.now(),
  threshold = 5,
  windowMs = 2 * 60 * 1000,
  consecutiveThreshold = 3,
  retryStagesMs = [5, 10, 20, 60].map((m) => m * 60 * 1000),
  retryAfterMaxMs = 60 * 60 * 1000,
} = {}) => ({ store, now, threshold, windowMs, consecutiveThreshold, retryStagesMs, retryAfterMaxMs });

const blockConfig = ({
  blockOpenMs = 30 * 60 * 1000,
  blockMaxOpenMs = 6 * 60 * 60 * 1000,
  stepDownMs = 24 * 60 * 60 * 1000,
  throttleMs = 24 * 60 * 60 * 1000,
  hostBlockOpenMs = 60 * 60 * 1000,
  readTtlMs = 10 * 1000,
  probeHoldMs = 2 * 60 * 1000,
} = {}) => ({ blockOpenMs, blockMaxOpenMs, stepDownMs, throttleMs, hostBlockOpenMs, readTtlMs, probeHoldMs });

const reserveOf = ({ reserve = true } = {}) => reserve;

/** 半開の試行の予約の口があり、DB に期限（予約の条件）があるか */
const canReserveProbe = (store, s) => Boolean(store?.reserveProbe && s.untilRaw);

const warnReserveFailed = (hostKey, error) =>
  console.warn(
    `⚠️ ${hostKey}: 半開の試行の予約に失敗（プロセスの中の1件で試す）:`,
    error?.message ?? error,
  );

/**
 * 取得の前に呼ぶ。開いていれば BreakerOpenError を投げる。半開の試行を予約したら {probe: true} を返す
 * @param {string} hostKey
 * @returns {Promise<{probe: true} | undefined>}
 */
async function checkHost(env, hostKey, options) {
  const { store, now, cfg } = env;
  const reserve = reserveOf(options);
  const s = stateOf(env, hostKey);
  await refresh(env, hostKey, s);
  // 非常停止は期限・半開より先に見る（半開の試行も取らない）
  if (s.fetchStop) throw new FetchStoppedError(hostKey, now() + cfg.readTtlMs);
  if (s.openUntil === 0) return;
  const t = now();
  if (t < s.openUntil) throw new BreakerOpenError(hostKey, s.openUntil);
  // reserve:false は「開いているか」だけを見る（共通ラッパの起動の前の確認。試行を予約しない）
  if (!reserve) return;
  // 半開: 期限を過ぎた。1件だけ試行させる（呼び出し側が試行のページを選べるよう、予約したことを返す）
  if (s.probing) throw new BreakerOpenError(hostKey, t + 5000);
  // 全体で1件にする: DB の期限が読んだ値のままの行だけを、今＋probeHoldMs に進める（条件つき UPDATE）。1行変わった
  // プロセスだけが試す。他は開いている扱い（BOA-1145 P4a ④c）。DB に期限が無い（プロセスの中だけで開いた）・予約の口が無い・
  // 予約に失敗した（DB の障害）ときは、従来どおりプロセスの中の1件で試す
  if (canReserveProbe(store, s)) {
    const holdUntil = t + cfg.probeHoldMs;
    let reserved = true;
    let reserveFailed = false;
    // 予約を待つ間に、同じプロセスの並行の要求が試さないよう、先に印を立てる（④c の審査 P3-2）
    s.probing = true;
    try {
      reserved = await store.reserveProbe(hostKey, s.untilRaw, holdUntil);
    } catch (error) {
      reserveFailed = true;
      warnReserveFailed(hostKey, error);
    }
    if (!reserved) {
      // 別の起動が先に予約した（または開き直した）: 読み直して、開いている扱い
      s.probing = false;
      await refresh(env, hostKey, s, { force: true });
      throw new BreakerOpenError(hostKey, Math.max(s.openUntil, t + 5000));
    }
    if (!reserveFailed) rememberDb(s, holdUntil);
  }
  s.probing = true;
  return { probe: true };
}

/** 429/503 を受けた */
async function recordHostFailure(env, hostKey, reason = "429/503") {
  const { now, cfg } = env;
  const s = stateOf(env, hostKey);
  const t = now();
  s.events = s.events.filter((e) => t - e < cfg.windowMs);
  s.events.push(t);
  s.consecutive++;
  const shouldOpen =
    s.probing ||
    s.events.length >= cfg.threshold ||
    s.consecutive >= cfg.consecutiveThreshold;
  if (!shouldOpen) return;
  await openOverloaded(env, hostKey, s, t, reason, (level) =>
    cfg.retryStagesMs[Math.min(level, cfg.retryStagesMs.length) - 1],
  );
}

/**
 * Retry-After が10秒を超える 429/503 を受けた（politeFetch は再試行しない）。1回で、その時間（上限 retryAfterMaxMs）開く。
 * 段階は上げない
 * @param {string} hostKey
 * @param {number} retryAfterMs
 * @param {string} [reason]
 */
async function recordHostRetryAfter(env, hostKey, retryAfterMs, reason = "429/503") {
  const { now, cfg } = env;
  const s = stateOf(env, hostKey);
  // 段階は上げない（その時間だけ開く。#1983 の審査 P2 の決定）
  await openOverloaded(
    env,
    hostKey,
    s,
    now(),
    reason,
    () => Math.min(cfg.retryAfterMaxMs, Math.max(0, retryAfterMs)),
    { escalate: false },
  );
}

/**
 * 拒否（403）を受けた。1回で開く。段階を今の段階（24時間ごとに1段下げた値）＋1にし、開く期間は
 * 基準 × 2^(段階−1)、上限 blockMaxOpenMs。基準は、ページのパスのキー（host:…/パス）が blockOpenMs（30分）、
 * ホスト全体のキー（host:…）が hostBlockOpenMs（60分。カナリアの 403 でホストを開くとき。spec §5.1）。
 * 書く前に DB を読み直し（TTL を無視）、別の起動が上げた段階・長い期限を採る。
 * 期限・段階・開いた時刻は store に書き、他のジョブ・他の起動と共有する（半開の試行が 403 でも、ここで段階を上げて開き直す）
 * @param {string} hostKey
 * @param {string} [reason]
 */
async function recordHostBlocked(env, hostKey, reason = "HTTP 403") {
  const { store, now, cfg } = env;
  const s = stateOf(env, hostKey);
  const wasProbing = s.probing;
  await refresh(env, hostKey, s, { force: true });
  const t = now();
  // 既に開いている間（半開の試行でない）に届いた 403（並行の要求の後着）は段階を上げず、期限の長い方だけを残す
  // （#1983 の審査 P1 と同じ穴）
  const alreadyOpen = s.openUntil > t && !wasProbing;
  const current = effectiveBlockLevel(s.level, s.openedAt, t, cfg.stepDownMs);
  const level = alreadyOpen
    ? current
    : Math.min(levelCapOf(cfg, hostKey), current + 1);
  const until = Math.max(
    s.openUntil,
    t + blockDurationOf(cfg, hostKey, Math.max(1, level)),
  );
  if (alreadyOpen && until <= s.openUntil) {
    s.probing = false;
    return;
  }
  s.level = level;
  if (!alreadyOpen) s.openedAt = t;
  s.openUntil = until;
  s.probing = false;
  s.events = [];
  s.consecutive = 0;
  if (store) {
    const wrote = await safe("開放の記録", async () => {
      const result = await store.open(hostKey, s.openUntil, reason, {
        level,
        openedAtMs: s.openedAt,
      });
      return wroteUntil(s, result);
    });
    if (wrote) adoptWritten(s, wrote);
  }
}

/**
 * 自動で閉じた後の絞りの期間か（spec §5.2「閉じた後24時間は1起動の上限を半分」）。check の後に呼ぶ（DB の段階・
 * 閉じた時刻は check の読み取りで同期済み）。開いている間（期限の前）は false（そもそも取らない）。
 * 起点は、最後に開いた後で半開の試行が成功して閉じた時刻（breaker_closed_at）。そこから throttleMs の間 true。
 * （段階の下げとは別に数える。段階1で30分開いて閉じても、閉じてから24時間は絞る）
 */
function isHostThrottled(env, hostKey) {
  const s = stateOf(env, hostKey);
  if (!(s.level > 0) || !(s.closedAt > 0) || s.closedAt < s.openedAt)
    return false;
  const t = env.now();
  if (s.openUntil > t) return false;
  return t - s.closedAt < env.cfg.throttleMs;
}

/** 正常な応答を受けた（429/503 以外） */
async function recordHostSuccess(env, hostKey) {
  const { store, now } = env;
  const s = stateOf(env, hostKey);
  s.consecutive = 0;
  if (!s.probing) return;
  // 半開の試行が成功: 閉じる（閉じた時刻は、閉じた後24時間の絞りの起点。DB の breaker_closed_at、178）
  s.probing = false;
  s.openUntil = 0;
  s.events = [];
  s.closedAt = now();
  if (store) {
    // 閉じるのは、DB の期限が自分の知っている値（予約した期限）のままのときだけ（条件つき）。その間に別の起動が開き直して
    // いれば閉じない（条件のない close は、別の起動の開き直しを全体で消す。④c の審査 P2-2）
    const expectedRaw = s.untilRaw;
    const closed = await safe("クローズの記録", () =>
      store.close(hostKey, { closedAtMs: s.closedAt, expectedRaw }),
    );
    if (closed === false) {
      await refresh(env, hostKey, s, { force: true });
      return;
    }
    rememberDb(s, 0);
  }
}

/** テスト・診断用: 状態の読み取り（プロセス内の値） */
function snapshotOf(env, hostKey) {
  const s = stateOf(env, hostKey);
  return {
    openUntil: s.openUntil,
    probing: s.probing,
    fetchStop: s.fetchStop,
    level: s.level,
    effectiveLevel: effectiveBlockLevel(s.level, s.openedAt, env.now(), env.cfg.stepDownMs),
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    consecutive: s.consecutive,
    recentFailures: s.events.length,
  };
}

/**
 * @param {Object} options
 * @param {BreakerStore} [options.store]
 * @param {() => number} [options.now] epoch ms
 */
export function createCircuitBreaker(options) {
  const { store, now, ...timing } = timingConfig(options);
  const env = { store, now, cfg: { ...timing, ...blockConfig(options) }, hosts: new Map() };
  return {
    check: (hostKey, o) => checkHost(env, hostKey, o),
    recordFailure: (hostKey, reason) => recordHostFailure(env, hostKey, reason),
    recordRetryAfter: (hostKey, retryAfterMs, reason) =>
      recordHostRetryAfter(env, hostKey, retryAfterMs, reason),
    recordBlocked: (hostKey, reason) => recordHostBlocked(env, hostKey, reason),
    isThrottled: (hostKey) => isHostThrottled(env, hostKey),
    recordSuccess: (hostKey) => recordHostSuccess(env, hostKey),
    /**
     * 半開の試行が、429/503 でも正常な応答でもなく終わった（ネットワークエラー・タイムアウト）。
     * 試行中の印だけを外し、次の呼び出しがもう一度試行できるようにする（外さないと、以降ずっと開いたままになる）
     */
    abortProbe: (hostKey) => {
      stateOf(env, hostKey).probing = false;
    },
    snapshot: (hostKey) => snapshotOf(env, hostKey),
  };
}
