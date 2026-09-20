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
 *   open      → half-open: openMs（60秒）後。1件だけ試行させる（同じプロセスの同時の呼び出しは、まだ開いている扱い）
 *   half-open → closed:    試行が成功
 *   half-open → open:      試行が失敗。開く期間を2倍にする（最大 maxOpenMs）
 *
 * store が使えない（予定表のテーブルが未適用・DBエラー）場合は、プロセス内の状態のみで動く
 * （ブレーカーの共有ができないだけで、取得は止めない）。
 */

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

/**
 * @typedef {Object} BreakerStore
 * @property {(hostKey: string) => Promise<number>} read breaker_open_until（epoch ms。開いていなければ0）
 * @property {(hostKey: string, untilMs: number, reason: string) => Promise<void>} open
 * @property {(hostKey: string) => Promise<void>} close
 */

/**
 * @param {Object} options
 * @param {BreakerStore} [options.store]
 * @param {() => number} [options.now] epoch ms
 */
export function createCircuitBreaker({
  store,
  now = () => Date.now(),
  threshold = 5,
  windowMs = 2 * 60 * 1000,
  consecutiveThreshold = 3,
  openMs = 60 * 1000,
  maxOpenMs = 10 * 60 * 1000,
  readTtlMs = 10 * 1000,
} = {}) {
  /** @type {Map<string, {events: number[], consecutive: number, openUntil: number, openCount: number, probing: boolean, lastRead: number}>} */
  const hosts = new Map();
  const stateOf = (hostKey) => {
    let s = hosts.get(hostKey);
    if (!s) {
      s = {
        events: [],
        consecutive: 0,
        openUntil: 0,
        openCount: 0,
        probing: false,
        lastRead: -Infinity,
      };
      hosts.set(hostKey, s);
    }
    return s;
  };

  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      console.warn(
        `⚠️ サーキットブレーカーの${label}に失敗（プロセス内の状態のみで続行）:`,
        error?.message ?? error,
      );
      return undefined;
    }
  };

  const refresh = async (hostKey, s) => {
    if (!store) return;
    if (now() - s.lastRead < readTtlMs) return;
    s.lastRead = now();
    const until = await safe("状態の読み取り", () => store.read(hostKey));
    if (typeof until === "number" && until > s.openUntil) s.openUntil = until;
  };

  return {
    /**
     * 取得の前に呼ぶ。開いていれば BreakerOpenError を投げる。
     * @param {string} hostKey
     */
    async check(hostKey) {
      const s = stateOf(hostKey);
      await refresh(hostKey, s);
      if (s.openUntil === 0) return;
      const t = now();
      if (t < s.openUntil) throw new BreakerOpenError(hostKey, s.openUntil);
      // 半開: 期限を過ぎた。1件だけ試行させる
      if (s.probing) throw new BreakerOpenError(hostKey, t + 5000);
      s.probing = true;
    },

    /** 429/503 を受けた */
    async recordFailure(hostKey, reason = "429/503") {
      const s = stateOf(hostKey);
      const t = now();
      s.events = s.events.filter((e) => t - e < windowMs);
      s.events.push(t);
      s.consecutive++;
      const shouldOpen =
        s.probing ||
        s.events.length >= threshold ||
        s.consecutive >= consecutiveThreshold;
      if (!shouldOpen) return;
      s.openCount++;
      const duration = Math.min(maxOpenMs, openMs * 2 ** (s.openCount - 1));
      s.openUntil = t + duration;
      s.probing = false;
      s.events = [];
      s.consecutive = 0;
      if (store) {
        await safe("開放の記録", () =>
          store.open(hostKey, s.openUntil, reason),
        );
      }
    },

    /** 正常な応答を受けた（429/503 以外） */
    async recordSuccess(hostKey) {
      const s = stateOf(hostKey);
      s.consecutive = 0;
      if (!s.probing) return;
      // 半開の試行が成功: 閉じる
      s.probing = false;
      s.openUntil = 0;
      s.openCount = 0;
      s.events = [];
      if (store) await safe("クローズの記録", () => store.close(hostKey));
    },

    /**
     * 半開の試行が、429/503 でも正常な応答でもなく終わった（ネットワークエラー・タイムアウト）。
     * 試行中の印だけを外し、次の呼び出しがもう一度試行できるようにする（外さないと、以降ずっと開いたままになる）
     */
    abortProbe(hostKey) {
      stateOf(hostKey).probing = false;
    },

    /** テスト・診断用: 状態の読み取り（プロセス内の値） */
    snapshot(hostKey) {
      const s = stateOf(hostKey);
      return {
        openUntil: s.openUntil,
        openCount: s.openCount,
        probing: s.probing,
        consecutive: s.consecutive,
        recentFailures: s.events.length,
      };
    },
  };
}
