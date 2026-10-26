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
 *
 * 拒否（403）の扱い（BOA-1145）: 取得先が特定のページだけを 403 で拒んだ（2026-10-26 の beforeinfo）。過負荷の 429/503 と
 * 違い、待っても数分では戻らない見込みが高く、叩き続けるほど拒否が長引く恐れがある。recordBlocked は1回で開き、
 * 開く期間を blockOpenMs（30分）から開くたびに2倍（上限 blockMaxOpenMs＝120分）にする。倍にするのは同じプロセスの
 * 中だけ（DB には期限しか残さない）で、起動ごとに別のプロセスなら、30分ごとに1件の試行になる（1日最大48件）。
 * 期限後は同じ半開（1件だけ試行）。キーは呼び出し側が決める（politeFetch はページのパス単位にし、同じホストの他のページを巻き込まない）。
 *
 * 非常停止（fetch_stop。マイグレーション178、ADR-0101 決定6）: store.read が {untilMs, fetchStop} を返し、fetchStop が true の
 * キー（人が `host:<ホスト>` の行で立てる）は、check が FetchStoppedError を投げる（BreakerOpenError の一種なので、呼び出し側は
 * 既存の breaker_open と同じ扱い＝取らない・ジョブの連続失敗に数えない）。下ろすのも人で、ブレーカーは書かない。
 * 読み取りの TTL（readTtlMs）の間はプロセス内の値で判定するので、立ててから効くまで最大 readTtlMs。
 * 読み取りに失敗したときは直前の値のまま（他の読み取りの失敗と同じく、取得は止めない側。DB が読めないときは
 * スロットの claim も失敗する）。
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
 * store.read の戻り値を {untilMs, fetchStop} にそろえる（数だけを返す旧い形・テストのストアも受ける）
 * @param {unknown} value
 * @returns {{untilMs: number, fetchStop: boolean} | null} 解釈できなければ null（直前の値のまま）
 */
export function normalizeBreakerRead(value) {
  if (typeof value === "number") return { untilMs: value, fetchStop: false };
  if (value && typeof value === "object" && typeof value.untilMs === "number") {
    return { untilMs: value.untilMs, fetchStop: value.fetchStop === true };
  }
  return null;
}

/**
 * @typedef {Object} BreakerStore
 * @property {(hostKey: string) => Promise<number | {untilMs: number, fetchStop: boolean}>} read
 *   breaker_open_until（epoch ms。開いていなければ0）と fetch_stop。数だけを返すと fetchStop=false として扱う
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
  blockOpenMs = 30 * 60 * 1000,
  blockMaxOpenMs = 120 * 60 * 1000,
  readTtlMs = 10 * 1000,
} = {}) {
  /** @type {Map<string, {events: number[], consecutive: number, openUntil: number, openCount: number, probing: boolean, fetchStop: boolean, lastRead: number}>} */
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
        fetchStop: false,
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
    const read = normalizeBreakerRead(
      await safe("状態の読み取り", () => store.read(hostKey)),
    );
    if (!read) return;
    if (read.untilMs > s.openUntil) s.openUntil = read.untilMs;
    s.fetchStop = read.fetchStop;
  };

  return {
    /**
     * 取得の前に呼ぶ。開いていれば BreakerOpenError を投げる。
     * @param {string} hostKey
     */
    async check(hostKey) {
      const s = stateOf(hostKey);
      await refresh(hostKey, s);
      // 非常停止は期限・半開より先に見る（半開の試行も取らない）
      if (s.fetchStop) throw new FetchStoppedError(hostKey, now() + readTtlMs);
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

    /**
     * 拒否（403）を受けた。1回で開く（開く期間は blockOpenMs から開くたびに2倍、上限 blockMaxOpenMs）。
     * 開いた期限は store に書き、他のジョブ・他の起動と共有する（半開の試行が 403 でも、ここで開き直す）
     */
    async recordBlocked(hostKey, reason = "HTTP 403") {
      const s = stateOf(hostKey);
      const t = now();
      s.openCount++;
      const duration = Math.min(
        blockMaxOpenMs,
        blockOpenMs * 2 ** (s.openCount - 1),
      );
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
        fetchStop: s.fetchStop,
        consecutive: s.consecutive,
        recentFailures: s.events.length,
      };
    },
  };
}
