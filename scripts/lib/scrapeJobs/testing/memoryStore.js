/**
 * テスト用のインメモリのストア（store.js と同じインターフェース）。共通ラッパの検証（verify-scrape-jobs.js）専用。
 *
 * claim の意味論（期限・許容幅・リース・奪取）は、DBの関数の責務であり、PGlite で検証している
 * （scripts/maintenance/verify-scrape-slots-sql.js）。ここでは再実装せず、テストが用意したスロットを
 * そのまま返し、完了・再試行の記録の呼び出しを保持する。
 */
// claim のフォールバックとスロットの差し替え・記録（pendingSlots・claimFallback を持つ）。getStore は今の store
function slotMethods(slots, record, getStore) {
  let pendingSlots = [...slots];
  let claimFallback = null;
  return {
    control: {
      /** takeClaimFallback が次に返す値（{reason}|null）を差し替える（claim が既存の関数へフォールバックした場合のテスト） */
      setClaimFallback(next) {
        claimFallback = next;
      },
      takeClaimFallback() {
        const taken = claimFallback;
        claimFallback = null;
        return taken;
      },
      /** claimSlots が返すスロットを差し替える */
      setSlots(next) {
        pendingSlots = [...next];
      },
    },
    calls: {
      async ensureSlots(args) {
        record("ensureSlots", args);
        return 0;
      },
      async claimSlots(args) {
        record("claimSlots", args);
        const out = pendingSlots;
        pendingSlots = [];
        return out;
      },
      async completeSlot(slot, args) {
        record("completeSlot", { slot, ...args });
        getStore().completed.push({ slot, ...args });
        return true;
      },
      async retrySlot(slot, args) {
        record("retrySlot", { slot, ...args });
        getStore().retried.push({ slot, ...args });
        return true;
      },
    },
  };
}

// ジョブの行（state）の読み書きとリース
function stateMethods(state, record, { available, leaseHeld }) {
  return {
    async readState(job) {
      record("readState", { job });
      if (!available) return { available: false, row: null };
      return { available: true, row: state.get(job) ?? null };
    },
    async ensureRow(job) {
      record("ensureRow", { job });
      if (!state.has(job))
        state.set(job, { job, mode: "off", consecutive_failures: 0 });
    },
    async touchTick(job, now) {
      record("touchTick", { job });
      const row = state.get(job);
      if (row) row.last_tick_at = now.toISOString();
    },
    async recordSuccess(job, args) {
      record("recordSuccess", { job, ...args });
      const row = state.get(job);
      Object.assign(row, {
        last_success_at: args.now.toISOString(),
        last_error: null,
        consecutive_failures: 0,
      });
      if (args.targetDate) row.last_target_date = args.targetDate;
      if (typeof args.rowsWritten === "number")
        row.last_rows_written = args.rowsWritten;
      if (args.report !== undefined) row.last_report = args.report;
      if (args.cursor !== undefined) row.cursor = args.cursor;
    },
    async recordFailure(job, args) {
      record("recordFailure", { job, ...args });
      const row = state.get(job);
      row.last_error = String(args.error?.message ?? args.error);
      row.consecutive_failures = (args.previousFailures ?? 0) + 1;
    },
    async acquireLease(job, worker) {
      record("acquireLease", { job, worker });
      if (leaseHeld) return false;
      state.get(job).claimed_by = worker;
      return true;
    },
    async releaseLease(job, worker) {
      record("releaseLease", { job, worker });
      state.get(job).claimed_by = null;
    },
  };
}

// until: 全てのキーに効く期限（テストが直接入れる）。byKey: キーごとの期限（ブレーカーが open で書く。
// ホストのキーとパスのキー（BOA-1145）を分けて確かめるため）。fetchStop: キーごとの非常停止（テストが直接入れる。178）。
// 読み書きは呼んだ時の store.breakerStore（getStore）に当てる
function memoryBreakerStore(getStore) {
  return {
    until: 0,
    byKey: {},
    fetchStop: {},
    // levels: キーごとの段階と開いた時刻（{level, openedAtMs}。ブレーカーが 403 の open で書く。テストが直接入れてもよい）
    levels: {},
    // closedAt: キーごとの閉じた時刻（ブレーカーが close で書く）
    closedAt: {},
    async read(hostKey) {
      const b = getStore().breakerStore;
      return {
        untilMs: Math.max(b.until, b.byKey[hostKey] ?? 0),
        fetchStop: b.fetchStop[hostKey] === true,
        level: b.levels[hostKey]?.level ?? 0,
        openedAtMs: b.levels[hostKey]?.openedAtMs ?? 0,
        closedAtMs: b.closedAt[hostKey] ?? 0,
      };
    },
    async open(hostKey, untilMs, _reason, level) {
      const b = getStore().breakerStore;
      b.byKey[hostKey] = untilMs;
      if (level) b.levels[hostKey] = { ...level };
    },
    async close(hostKey, closed) {
      if (closed) getStore().breakerStore.closedAt[hostKey] = closed.closedAtMs;
      // until はホストのキーの閉鎖でだけ消す（パスのキーの閉鎖で、テストが入れたホストの開放を消さない）
      if (!String(hostKey).includes("/")) getStore().breakerStore.until = 0;
      delete getStore().breakerStore.byKey[hostKey];
    },
  };
}

export function createMemoryStore({
  available = true,
  rows = {},
  slots = [],
  leaseHeld = false,
} = {}) {
  const state = new Map(Object.entries(rows));
  const calls = [];
  const record = (name, args) => calls.push({ name, ...args });
  const getStore = () => store;
  const slot = slotMethods(slots, record, getStore);
  const store = {
    calls,
    state,
    completed: [],
    retried: [],
    ...slot.control,
    ...stateMethods(state, record, { available, leaseHeld }),
    ...slot.calls,
    breakerStore: memoryBreakerStore(getStore),
  };
  return store;
}
