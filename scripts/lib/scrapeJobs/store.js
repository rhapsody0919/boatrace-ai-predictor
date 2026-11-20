/**
 * 予定表（scrape_slots）・ジョブ状態（scrape_job_state）へのアクセス（Supabase実装）。
 *
 * 共通ラッパ（cronWrapper.js）は、この「ストア」のインターフェースにだけ依存する（テストでは
 * testing/memoryStore.js に差し替える）。ストアのインターフェース:
 *   readState(job)                       → {available, row}  ※available=false: テーブルが未適用
 *   ensureRow(job)                       → void              ※行が無いジョブを mode='off' で作る
 *   touchTick(job, now)                  → void              ※5分に1回だけ last_tick_at を更新する
 *   recordSuccess(job, {now, rowsWritten, targetDate, report, cursor})
 *   recordFailure(job, {now, error, previousFailures})
 *   acquireLease(job, worker, leaseSec, now) → boolean
 *   releaseLease(job, worker)
 *   ensureSlots({date, jobs, now})       → 新規に作ったスロット数
 *   claimSlots({job, worker, mode, now, limit}) → スロットの配列（limit は claimLimit の上書き。閉じた後の絞り）
 *                                       ※offset ごとの許容幅の上書き（レジストリの graceMinByOffset）があるジョブは、
 *                                         claim_scrape_slots_by_offset（マイグレーション092）で取る。その関数が無い
 *                                         （092が未適用）ときだけ、既存の claim_scrape_slots へフォールバックする
 *   takeClaimFallback()                  → {reason}|null     ※直前の claimSlots が上書きなしで取ったとき（フォールバック）の理由。
 *                                                              読むと消える。共通ラッパが、ログと last_report に残す
 *   completeSlot(slot, {worker, now, outcome, rowsWritten, resultDigest}) → boolean（リースを持っていたか）
 *   retrySlot(slot, {worker, now, outcome, error, retryAt}) → boolean
 *   breakerStore                         → {read, open, close}（circuitBreaker.js の BreakerStore。read は
 *                                          {untilMs, fetchStop}。fetch_stop は人が立てる非常停止、マイグレーション178）
 *
 * 「テーブル・関数が無い」（マイグレーション075が未適用）エラーは、readState だけが available=false として
 * 返す。それ以外のDBエラーは、意味のあるメッセージを付けて投げる（「対象なし」に化けさせない）。
 */
import { createBreakerMethods } from "./storeBreaker.js";
import { createSlotMethods, createStateMethods } from "./storeParts.js";

export {
  BREAKER_RPC_RECHECK_MS,
  FETCH_STOP_RECHECK_MS,
} from "./storeBreaker.js";
export { TICK_WRITE_INTERVAL_MS } from "./storeParts.js";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export function createSupabaseStore(client) {
  return {
    ...createStateMethods(client),
    ...createSlotMethods(client),
    ...createBreakerMethods(client),
  };
}
