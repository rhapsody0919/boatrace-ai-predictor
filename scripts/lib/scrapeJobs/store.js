/**
 * 予定表（scrape_slots）・ジョブ状態（scrape_job_state）へのアクセス（Supabase実装）。
 *
 * 共通ラッパ（cronWrapper.js）は、この「ストア」のインターフェースにだけ依存する（テストでは
 * testing/memoryStore.js に差し替える）。ストアのインターフェース:
 *   readState(job)                       → {available, row}  ※available=false: テーブルが未適用
 *   ensureRow(job)                       → void              ※行が無いジョブを mode='off' で作る
 *   touchTick(job, now)                  → void              ※5分に1回だけ last_tick_at を更新する
 *   recordSuccess(job, {now, rowsWritten, targetDate, report})
 *   recordFailure(job, {now, error, previousFailures})
 *   acquireLease(job, worker, leaseSec, now) → boolean
 *   releaseLease(job, worker)
 *   ensureSlots({date, jobs, now})       → 新規に作ったスロット数
 *   claimSlots({job, worker, mode, now}) → スロットの配列
 *   completeSlot(slot, {worker, now, outcome, rowsWritten, resultDigest}) → boolean（リースを持っていたか）
 *   retrySlot(slot, {worker, now, outcome, error, retryAt}) → boolean
 *   breakerStore                         → {read, open, close}（circuitBreaker.js の BreakerStore）
 *
 * 「テーブル・関数が無い」（マイグレーション075が未適用）エラーは、readState だけが available=false として
 * 返す。それ以外のDBエラーは、意味のあるメッセージを付けて投げる（「対象なし」に化けさせない）。
 */
import { SCRAPE_JOBS, slotDefsFor } from "./registry.js";
import { isScrapeSchemaMissingError } from "./schemaErrors.js";
import { addSeconds } from "./time.js";
import { truncateError } from "./outcomes.js";

/** last_tick_at を更新する最小の間隔（毎分書くと、同じ行が1日1,000回更新され、無駄なdead tupleになる） */
export const TICK_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const wrap = (what, error) => {
  const e = new Error(`${what}に失敗しました: ${error.message}`);
  e.cause = error;
  e.code = error.code;
  return e;
};

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export function createSupabaseStore(client) {
  const STATE = "scrape_job_state";
  const SLOTS = "scrape_slots";

  const slotKey = (slot) => ({
    job: slot.job,
    race_id: slot.race_id,
    offset_min: slot.offset_min,
  });

  return {
    async readState(job) {
      const { data, error } = await client
        .from(STATE)
        .select("*")
        .eq("job", job)
        .maybeSingle();
      if (error) {
        if (isScrapeSchemaMissingError(error)) {
          return { available: false, row: null };
        }
        throw wrap(`ジョブ状態(${job})の読み取り`, error);
      }
      return { available: true, row: data ?? null };
    },

    async ensureRow(job) {
      // 行が無いときだけ作る（mode は既定の 'off'）
      const { error } = await client
        .from(STATE)
        .upsert({ job }, { onConflict: "job", ignoreDuplicates: true });
      if (error) throw wrap(`ジョブ状態(${job})の作成`, error);
    },

    async touchTick(job, now) {
      const threshold = new Date(now.getTime() - TICK_WRITE_INTERVAL_MS);
      const { error } = await client
        .from(STATE)
        .update({ last_tick_at: now.toISOString() })
        .eq("job", job)
        .or(`last_tick_at.is.null,last_tick_at.lt.${threshold.toISOString()}`);
      if (error) throw wrap(`起動の記録(${job})`, error);
    },

    async recordSuccess(job, { now, rowsWritten, targetDate, report }) {
      const patch = {
        last_success_at: now.toISOString(),
        last_error: null,
        consecutive_failures: 0,
        updated_at: now.toISOString(),
      };
      if (typeof rowsWritten === "number")
        patch.last_rows_written = rowsWritten;
      if (targetDate) patch.last_target_date = targetDate;
      if (report !== undefined) patch.last_report = report;
      const { error } = await client.from(STATE).update(patch).eq("job", job);
      if (error) throw wrap(`成功の記録(${job})`, error);
    },

    async recordFailure(job, { now, error: failure, previousFailures }) {
      const { error } = await client
        .from(STATE)
        .update({
          last_error: truncateError(failure),
          consecutive_failures: Math.min((previousFailures ?? 0) + 1, 32767),
          updated_at: now.toISOString(),
        })
        .eq("job", job);
      if (error) throw wrap(`失敗の記録(${job})`, error);
    },

    async acquireLease(job, worker, leaseSec, now) {
      const { data, error } = await client
        .from(STATE)
        .update({
          lease_until: addSeconds(now, leaseSec).toISOString(),
          claimed_by: worker,
        })
        .eq("job", job)
        .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
        .select("job");
      if (error) throw wrap(`リースの取得(${job})`, error);
      return (data?.length ?? 0) === 1;
    },

    async releaseLease(job, worker) {
      const { error } = await client
        .from(STATE)
        .update({ lease_until: null, claimed_by: null })
        .eq("job", job)
        .eq("claimed_by", worker);
      if (error) throw wrap(`リースの解放(${job})`, error);
    },

    async ensureSlots({ date, jobs, now }) {
      const args = {
        p_date: date,
        p_defs: slotDefsFor(jobs),
        p_skip_lapsed: true,
      };
      if (now) args.p_now = now.toISOString();
      const { data, error } = await client.rpc("ensure_scrape_slots", args);
      if (error) throw wrap("予定表の生成(ensure_scrape_slots)", error);
      return data ?? 0;
    },

    async claimSlots({ job, worker, mode, now }) {
      const def = SCRAPE_JOBS[job];
      const args = {
        p_job: job,
        p_limit: def.claimLimit,
        p_lease_sec: def.leaseSec,
        p_worker: worker,
        p_grace_min: def.graceMin,
        p_run_mode: mode,
      };
      if (now) args.p_now = now.toISOString();
      const { data, error } = await client.rpc("claim_scrape_slots", args);
      if (error)
        throw wrap(`スロットの取得(claim_scrape_slots, ${job})`, error);
      return data ?? [];
    },

    async completeSlot(
      slot,
      { worker, now, outcome, rowsWritten, resultDigest },
    ) {
      const { data, error } = await client
        .from(SLOTS)
        .update({
          status: "done",
          done_at: now.toISOString(),
          outcome,
          rows_written: rowsWritten ?? null,
          result_digest: resultDigest ?? null,
          last_error: null,
          lease_until: null,
        })
        .match(slotKey(slot))
        .eq("claimed_by", worker)
        .eq("status", "running")
        .select("race_id");
      if (error) throw wrap(`スロットの完了の記録(${slot.race_id})`, error);
      return (data?.length ?? 0) === 1;
    },

    async retrySlot(
      slot,
      { worker, now, outcome, error: failure, retryAt, releaseAttempt = false },
    ) {
      const patch = {
        status: "pending",
        next_attempt_at: (retryAt ?? now).toISOString(),
        lease_until: null,
      };
      if (releaseAttempt) {
        // 着手せずに返す（ソフトデッドライン・リース切れ間近）: 試行回数を戻し、直前のエラーは残す
        // （リースを持っているため、slot.attempts からの更新で競合しない）
        patch.attempts = Math.max(0, (slot.attempts ?? 1) - 1);
      } else {
        patch.last_error = truncateError(failure);
      }
      if (outcome) patch.outcome = outcome;
      const { data, error } = await client
        .from(SLOTS)
        .update(patch)
        .match(slotKey(slot))
        .eq("claimed_by", worker)
        .eq("status", "running")
        .select("race_id");
      if (error) throw wrap(`スロットの再試行の記録(${slot.race_id})`, error);
      return (data?.length ?? 0) === 1;
    },

    /** @type {import("./circuitBreaker.js").BreakerStore} */
    breakerStore: {
      async read(hostKey) {
        const { data, error } = await client
          .from(STATE)
          .select("breaker_open_until")
          .eq("job", hostKey)
          .maybeSingle();
        if (error) throw wrap(`ブレーカーの読み取り(${hostKey})`, error);
        const until = data?.breaker_open_until;
        return until ? new Date(until).getTime() : 0;
      },
      async open(hostKey, untilMs, reason) {
        const { error } = await client.from(STATE).upsert(
          {
            job: hostKey,
            breaker_open_until: new Date(untilMs).toISOString(),
            last_error: truncateError(reason),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "job" },
        );
        if (error) throw wrap(`ブレーカーの開放(${hostKey})`, error);
      },
      async close(hostKey) {
        const { error } = await client
          .from(STATE)
          .update({
            breaker_open_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("job", hostKey);
        if (error) throw wrap(`ブレーカーの解除(${hostKey})`, error);
      },
    },
  };
}
