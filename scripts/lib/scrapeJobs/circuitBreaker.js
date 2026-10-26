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

/** 段階の上限（DB の CHECK、マイグレーション178 と同じ） */
export const MAX_BREAKER_LEVEL = 10;

const finiteOr0 = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * store.read の戻り値を {untilMs, fetchStop, level, openedAtMs} にそろえる（数だけを返す旧い形・テストのストアも受ける）
 * @param {unknown} value
 * @returns {{untilMs: number, fetchStop: boolean, level: number, openedAtMs: number} | null} 解釈できなければ null（直前の値のまま）
 */
export function normalizeBreakerRead(value) {
  if (typeof value === "number")
    return {
      untilMs: value,
      fetchStop: false,
      level: 0,
      openedAtMs: 0,
      closedAtMs: 0,
    };
  if (value && typeof value === "object" && typeof value.untilMs === "number") {
    const level = finiteOr0(value.level);
    return {
      untilMs: value.untilMs,
      fetchStop: value.fetchStop === true,
      level: Math.min(MAX_BREAKER_LEVEL, Math.max(0, Math.trunc(level))),
      openedAtMs: finiteOr0(value.openedAtMs),
      closedAtMs: finiteOr0(value.closedAtMs),
    };
  }
  return null;
}

/**
 * 今の段階（純関数）。最後に開いてから stepDownMs ごとに1段下げる（24時間 403 が無ければ1段下げる。spec §5.2）。
 * 開いた時刻が無い（0）のに段階がある行は、下げる起点が分からないので段階のまま
 */
export function effectiveBlockLevel(level, openedAtMs, nowMs, stepDownMs) {
  if (!(level > 0)) return 0;
  if (!(openedAtMs > 0)) return level;
  const steps = Math.floor(Math.max(0, nowMs - openedAtMs) / stepDownMs);
  return Math.max(0, level - steps);
}

/** 段階 level（1以上）で開く期間（純関数）: openMs × 2^(level−1)、上限 maxOpenMs */
export function blockDurationMs(level, openMs, maxOpenMs) {
  return Math.min(maxOpenMs, openMs * 2 ** (Math.max(1, level) - 1));
}

/**
 * @typedef {Object} BreakerStore
 * @property {(hostKey: string) => Promise<number | {untilMs: number, fetchStop: boolean, level?: number, openedAtMs?: number}>} read
 *   breaker_open_until（epoch ms。開いていなければ0）・fetch_stop・breaker_level・breaker_opened_at（epoch ms。無ければ0）。
 *   数だけを返すと fetchStop=false・段階0として扱う
 * @property {(hostKey: string, untilMs: number, reason: string, level?: {level: number, openedAtMs: number}) => Promise<void>} open
 *   level を渡すと breaker_level・breaker_opened_at も書く（403 のとき。429/503 は渡さない）
 * @property {(hostKey: string, closed?: {closedAtMs: number}) => Promise<void>} close closed を渡すと breaker_closed_at も書く
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
  blockMaxOpenMs = 6 * 60 * 60 * 1000,
  stepDownMs = 24 * 60 * 60 * 1000,
  throttleMs = 24 * 60 * 60 * 1000,
  hostBlockOpenMs = 60 * 60 * 1000,
  readTtlMs = 10 * 1000,
} = {}) {
  // ホスト全体のキー（host:boatrace.jp）か、ページのパスのキー（host:boatrace.jp/owpc/…）かで、開く期間の基準を変える
  const blockBaseOf = (key) =>
    String(key).includes("/") ? blockOpenMs : hostBlockOpenMs;
  const blockDurationOf = (key, level) =>
    blockDurationMs(level, blockBaseOf(key), blockMaxOpenMs);
  // 期間が上限に届く段階より上へは上げない（上げても期間は同じで、下げに余計な日数がかかるだけ。審査 P3）
  const levelCapOf = (key) =>
    Math.min(
      MAX_BREAKER_LEVEL,
      Math.max(1, Math.ceil(Math.log2(blockMaxOpenMs / blockBaseOf(key))) + 1),
    );
  /** @type {Map<string, {events: number[], consecutive: number, openUntil: number, openCount: number, probing: boolean, fetchStop: boolean, level: number, openedAt: number, lastRead: number}>} */
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
        // 403 で開いた段階と、最後に開いた時刻（DB の breaker_level・breaker_opened_at と同期する）
        level: 0,
        openedAt: 0,
        closedAt: 0,
        lastRead: -Infinity,
        inflight: null,
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

  // 読み取り中の並行の呼び出しは、同じ読み取り（s.inflight）を待つ。lastRead は読み終わってから更新する
  // （先に更新すると、読み取りの完了前に来た並行の check が TTL 内として読みを省き、初期値の fetchStop=false で
  // 取りに行く。Codex の審査 P1、/api/odds/live の同時の要求）。
  // force: TTL を無視して読む（書く前に、別の起動が書いた長い期限を短く上書きしないため）。読み取り中なら、それを待ってから読み直す
  const refresh = async (hostKey, s, { force = false } = {}) => {
    if (!store) return;
    if (s.inflight) {
      await s.inflight;
      if (!force) return;
    }
    if (!force && now() - s.lastRead < readTtlMs) return;
    s.inflight = (async () => {
      try {
        const read = normalizeBreakerRead(
          await safe("状態の読み取り", () => store.read(hostKey)),
        );
        if (!read) return;
        if (read.untilMs > s.openUntil) s.openUntil = read.untilMs;
        s.fetchStop = read.fetchStop;
        // 段階は、より新しく開いた側を採る（別の起動が開き直していれば、その段階から上げる）
        if (read.openedAtMs > s.openedAt) {
          s.level = read.level;
          s.openedAt = read.openedAtMs;
        } else if (read.openedAtMs === s.openedAt && read.level > s.level) {
          s.level = read.level;
        }
        if (read.closedAtMs > s.closedAt) s.closedAt = read.closedAtMs;
      } finally {
        s.lastRead = now();
        s.inflight = null;
      }
    })();
    return s.inflight;
  };

  return {
    /**
     * 取得の前に呼ぶ。開いていれば BreakerOpenError を投げる。半開の試行を予約したら {probe: true} を返す
     * @param {string} hostKey
     * @returns {Promise<{probe: true} | undefined>}
     */
    async check(hostKey) {
      const s = stateOf(hostKey);
      await refresh(hostKey, s);
      // 非常停止は期限・半開より先に見る（半開の試行も取らない）
      if (s.fetchStop) throw new FetchStoppedError(hostKey, now() + readTtlMs);
      if (s.openUntil === 0) return;
      const t = now();
      if (t < s.openUntil) throw new BreakerOpenError(hostKey, s.openUntil);
      // 半開: 期限を過ぎた。1件だけ試行させる（呼び出し側が試行のページを選べるよう、予約したことを返す）
      if (s.probing) throw new BreakerOpenError(hostKey, t + 5000);
      s.probing = true;
      return { probe: true };
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
      // 別の起動が開いた長い期限（403 のホストの60分等）を短く上書きしない（書く前に DB を読み、長い方を書く）
      await refresh(hostKey, s, { force: true });
      s.openUntil = Math.max(s.openUntil, t + duration);
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
     * 拒否（403）を受けた。1回で開く。段階を今の段階（24時間ごとに1段下げた値）＋1にし、開く期間は
     * 基準 × 2^(段階−1)、上限 blockMaxOpenMs。基準は、ページのパスのキー（host:…/パス）が blockOpenMs（30分）、
     * ホスト全体のキー（host:…）が hostBlockOpenMs（60分。カナリアの 403 でホストを開くとき。spec §5.1）。
     * 書く前に DB を読み直し（TTL を無視）、別の起動が上げた段階・長い期限を採る。
     * 期限・段階・開いた時刻は store に書き、他のジョブ・他の起動と共有する（半開の試行が 403 でも、ここで段階を上げて開き直す）
     * @param {string} hostKey
     * @param {string} [reason]
     */
    async recordBlocked(hostKey, reason = "HTTP 403") {
      const s = stateOf(hostKey);
      await refresh(hostKey, s, { force: true });
      const t = now();
      const level = Math.min(
        levelCapOf(hostKey),
        effectiveBlockLevel(s.level, s.openedAt, t, stepDownMs) + 1,
      );
      s.level = level;
      s.openedAt = t;
      s.openUntil = Math.max(s.openUntil, t + blockDurationOf(hostKey, level));
      s.probing = false;
      s.events = [];
      s.consecutive = 0;
      if (store) {
        await safe("開放の記録", () =>
          store.open(hostKey, s.openUntil, reason, {
            level,
            openedAtMs: t,
          }),
        );
      }
    },

    /**
     * 自動で閉じた後の絞りの期間か（spec §5.2「閉じた後24時間は1起動の上限を半分」）。check の後に呼ぶ（DB の段階・
     * 閉じた時刻は check の読み取りで同期済み）。開いている間（期限の前）は false（そもそも取らない）。
     * 起点は、最後に開いた後で半開の試行が成功して閉じた時刻（breaker_closed_at）。そこから throttleMs の間 true。
     * （段階の下げとは別に数える。段階1で30分開いて閉じても、閉じてから24時間は絞る）
     */
    isThrottled(hostKey) {
      const s = stateOf(hostKey);
      if (!(s.level > 0) || !(s.closedAt > 0) || s.closedAt < s.openedAt)
        return false;
      const t = now();
      if (s.openUntil > t) return false;
      return t - s.closedAt < throttleMs;
    },

    /** 正常な応答を受けた（429/503 以外） */
    async recordSuccess(hostKey) {
      const s = stateOf(hostKey);
      s.consecutive = 0;
      if (!s.probing) return;
      // 半開の試行が成功: 閉じる（閉じた時刻は、閉じた後24時間の絞りの起点。DB の breaker_closed_at、178）
      s.probing = false;
      s.openUntil = 0;
      s.openCount = 0;
      s.events = [];
      s.closedAt = now();
      if (store)
        await safe("クローズの記録", () =>
          store.close(hostKey, { closedAtMs: s.closedAt }),
        );
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
        level: s.level,
        effectiveLevel: effectiveBlockLevel(s.level, s.openedAt, now(), stepDownMs),
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        consecutive: s.consecutive,
        recentFailures: s.events.length,
      };
    },
  };
}
