/**
 * テスト用のインメモリのストア（store.js と同じインターフェース）。共通ラッパの検証（verify-scrape-jobs.js）専用。
 *
 * claim の意味論（期限・許容幅・リース・奪取）は、DBの関数の責務であり、PGlite で検証している
 * （scripts/maintenance/verify-scrape-slots-sql.js）。ここでは再実装せず、テストが用意したスロットを
 * そのまま返し、完了・再試行の記録の呼び出しを保持する。
 */
export function createMemoryStore({
  available = true,
  rows = {},
  slots = [],
  leaseHeld = false,
} = {}) {
  const state = new Map(Object.entries(rows));
  const calls = [];
  const record = (name, args) => calls.push({ name, ...args });
  let pendingSlots = [...slots];
  const store = {
    calls,
    state,
    completed: [],
    retried: [],
    /** claimSlots が返すスロットを差し替える */
    setSlots(next) {
      pendingSlots = [...next];
    },
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
      store.completed.push({ slot, ...args });
      return true;
    },
    async retrySlot(slot, args) {
      record("retrySlot", { slot, ...args });
      store.retried.push({ slot, ...args });
      return true;
    },
    breakerStore: {
      until: 0,
      async read() {
        return store.breakerStore.until;
      },
      async open(hostKey, untilMs) {
        store.breakerStore.until = untilMs;
      },
      async close() {
        store.breakerStore.until = 0;
      },
    },
  };
  return store;
}
