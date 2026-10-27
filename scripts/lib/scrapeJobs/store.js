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
import { SCRAPE_JOBS, graceOverridesOf, slotDefsFor } from "./registry.js";
import {
  isClaimByOffsetMissingError,
  isScrapeSchemaMissingError,
} from "./schemaErrors.js";
import { addSeconds } from "./time.js";
import { truncateError } from "./outcomes.js";
import { isColumnMissingError } from "../optionalColumns.js";

/** scrape_breaker_open（マイグレーション184）が無いと分かった後、もう一度 RPC を試すまでの間隔 */
export const BREAKER_RPC_RECHECK_MS = 10 * 60 * 1000;

/** fetch_stop の列が無い（マイグレーション178 の前）と分かった後、もう一度列を入れて読み直すまでの間隔 */
export const FETCH_STOP_RECHECK_MS = 10 * 60 * 1000;

/** マイグレーション178 で足した host:… の行の列（非常停止・段階）。どれかが無いエラーなら、178 の前として読み直す */
const BREAKER_178_COLUMNS = [
  "fetch_stop",
  "breaker_level",
  "breaker_opened_at",
  "breaker_closed_at",
];

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

  /** scrape_breaker_open（184）が無いと分かった後、upsert で書く期限（epoch ms） */
  let breakerRpcMissingUntil = 0;

  /** fetch_stop の列が無い（178 の前）と分かった後、列を入れずに読む期限（epoch ms） */
  let fetchStopMissingUntil = 0;

  /** 直前の claimSlots が、上書きなしの既存の関数で取った（フォールバックした）理由。takeClaimFallback で読むと消える */
  let claimFallback = null;

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

    async recordSuccess(job, { now, rowsWritten, targetDate, report, cursor }) {
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
      if (cursor !== undefined) patch.cursor = cursor;
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

    async claimSlots({ job, worker, mode, now, limit }) {
      const def = SCRAPE_JOBS[job];
      const args = {
        p_job: job,
        // limit: 1起動の上限の上書き（閉じた後24時間の絞りで半分にする。cronWrapper.js）
        p_limit: limit ?? def.claimLimit,
        p_lease_sec: def.leaseSec,
        p_worker: worker,
        p_grace_min: def.graceMin,
        p_run_mode: mode,
      };
      if (now) args.p_now = now.toISOString();
      claimFallback = null;
      const overrides = graceOverridesOf(def);
      if (overrides) {
        // offset ごとの許容幅の上書きがあるジョブ: 新関数で取る。関数が無い（092が未適用）ときだけ、既存の関数へ
        // フォールバックする（オッズの取得を止めない。延長は効かない）。それ以外のエラーはフォールバックしない
        const { data, error } = await client.rpc(
          "claim_scrape_slots_by_offset",
          {
            ...args,
            p_grace_by_offset: overrides,
          },
        );
        if (!error) return data ?? [];
        if (!isClaimByOffsetMissingError(error)) {
          throw wrap(
            `スロットの取得(claim_scrape_slots_by_offset, ${job})`,
            error,
          );
        }
        claimFallback = {
          reason: `claim_scrape_slots_by_offset が無いため（マイグレーション092が未適用）、既存の claim_scrape_slots で取りました。許容幅の延長（${JSON.stringify(overrides)}）は効いていません`,
        };
        console.warn(`⚠️ ${job}: ${claimFallback.reason}`);
      }
      const { data, error } = await client.rpc("claim_scrape_slots", args);
      if (error)
        throw wrap(`スロットの取得(claim_scrape_slots, ${job})`, error);
      return data ?? [];
    },

    takeClaimFallback() {
      const taken = claimFallback;
      claimFallback = null;
      return taken;
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
      // breaker_open_until と、非常停止（fetch_stop）・段階（breaker_level・breaker_opened_at）（どちらもマイグレーション178）を
      // 同じ SELECT で読む。178 の前（列が無い）は breaker_open_until だけを読み直し、非常停止なし・段階0とする
      // （列の不在は 42703 かつ列名つきのときだけ。他のエラーは投げる）
      async read(hostKey) {
        const select = (columns) =>
          client.from(STATE).select(columns).eq("job", hostKey).maybeSingle();
        let data;
        let error;
        if (Date.now() >= fetchStopMissingUntil) {
          ({ data, error } = await select(
            "breaker_open_until, fetch_stop, breaker_level, breaker_opened_at, breaker_closed_at",
          ));
          if (error && isColumnMissingError(error, BREAKER_178_COLUMNS)) {
            // 178 の前: しばらく（FETCH_STOP_RECHECK_MS）は列を入れずに読む（キーごと・10秒ごとの2往復を避ける）
            fetchStopMissingUntil = Date.now() + FETCH_STOP_RECHECK_MS;
            ({ data, error } = await select("breaker_open_until"));
          }
        } else {
          ({ data, error } = await select("breaker_open_until"));
        }
        if (error) throw wrap(`ブレーカーの読み取り(${hostKey})`, error);
        const until = data?.breaker_open_until;
        const openedAt = data?.breaker_opened_at;
        const closedAt = data?.breaker_closed_at;
        return {
          untilMs: until ? new Date(until).getTime() : 0,
          fetchStop: data?.fetch_stop === true,
          level: typeof data?.breaker_level === "number" ? data.breaker_level : 0,
          openedAtMs: openedAt ? new Date(openedAt).getTime() : 0,
          closedAtMs: closedAt ? new Date(closedAt).getTime() : 0,
          untilRaw: typeof until === "string" ? until : null,
        };
      },
      // 半開の試行の予約（BOA-1145 P4a ④c）: breaker_open_until が読んだ値（expectedRaw。DB が返した文字列のまま）の行だけを
      // newUntilMs に進める。1行変わったら予約できた（このプロセスだけが試す）。0行なら別の起動が先に予約・開き直した
      async reserveProbe(hostKey, expectedRaw, newUntilMs) {
        const { data, error } = await client
          .from(STATE)
          .update({
            breaker_open_until: new Date(newUntilMs).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("job", hostKey)
          .eq("breaker_open_until", expectedRaw)
          .select("job");
        if (error) throw wrap(`半開の試行の予約(${hostKey})`, error);
        return (data?.length ?? 0) === 1;
      },
      // level（403 のとき）を渡すと段階と開いた時刻も書く。fetch_stop・mode は書かない（人が立てた値・既定の off に触れない）。
      // 178 の前（段階の列が無い: PGRST204、列名つき）は段階を外して書き直す
      async open(hostKey, untilMs, reason, level) {
        // 長い方を DB の中で取る RPC（184、BOA-1159）。無い（184 の前）ときだけ下の upsert に戻る（しばらく RPC を試さない）。
        // 戻り値 {untilMs}: 書いた後の DB の期限（RPC のとき。別の起動の長い期限が勝ったら、その値）
        if (Date.now() >= breakerRpcMissingUntil) {
          const { data, error } = await client.rpc("scrape_breaker_open", {
            p_job: hostKey,
            p_until: new Date(untilMs).toISOString(),
            p_reason: truncateError(reason),
            p_level: level ? level.level : null,
            p_opened_at: level ? new Date(level.openedAtMs).toISOString() : null,
          });
          if (!error) {
            return { untilMs: data ? new Date(data).getTime() : untilMs };
          }
          if (!isScrapeSchemaMissingError(error, ["scrape_breaker_open"])) {
            throw wrap(`ブレーカーの開放(${hostKey})`, error);
          }
          breakerRpcMissingUntil = Date.now() + BREAKER_RPC_RECHECK_MS;
        }
        const row = {
          job: hostKey,
          breaker_open_until: new Date(untilMs).toISOString(),
          last_error: truncateError(reason),
          updated_at: new Date().toISOString(),
        };
        const upsert = (payload) =>
          client.from(STATE).upsert(payload, { onConflict: "job" });
        let { error } = await upsert(
          level
            ? {
                ...row,
                breaker_level: level.level,
                breaker_opened_at: new Date(level.openedAtMs).toISOString(),
              }
            : row,
        );
        if (
          error &&
          level &&
          isColumnMissingError(error, ["breaker_level", "breaker_opened_at"])
        ) {
          ({ error } = await upsert(row));
        }
        if (error) throw wrap(`ブレーカーの開放(${hostKey})`, error);
        return { untilMs };
      },
      // closed を渡すと閉じた時刻（breaker_closed_at、178）も書く。178 の前（PGRST204、列名つき）は外して書き直す。
      // closed.expectedRaw を渡すと、breaker_open_until がその値のままの行だけを閉じる（別の起動の開き直しを消さない。④c）。
      // 戻り値: 閉じたら true、条件に合わず閉じなかったら false（expectedRaw が無いときは常に true）
      async close(hostKey, closed) {
        const patch = {
          breaker_open_until: null,
          updated_at: new Date().toISOString(),
        };
        const expectedRaw = closed?.expectedRaw ?? null;
        const update = async (p) => {
          let q = client.from(STATE).update(p).eq("job", hostKey);
          if (expectedRaw) q = q.eq("breaker_open_until", expectedRaw);
          return expectedRaw ? q.select("job") : q;
        };
        let { data, error } = await update(
          closed
            ? {
                ...patch,
                breaker_closed_at: new Date(closed.closedAtMs).toISOString(),
              }
            : patch,
        );
        if (
          error &&
          closed &&
          isColumnMissingError(error, ["breaker_closed_at"])
        ) {
          ({ data, error } = await update(patch));
        }
        if (error) throw wrap(`ブレーカーの解除(${hostKey})`, error);
        return expectedRaw ? (data?.length ?? 0) === 1 : true;
      },
    },
  };
}
