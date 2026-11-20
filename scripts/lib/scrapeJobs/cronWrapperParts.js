// cronWrapper.js から移した部品: 応答の組み立て・ブレーカーの確認・フォールバックの記録・オプションの既定値・
// 窓型のスロット処理（settle・スロットごとの worker）・集計・日次/連続のジョブの記録の中身。
// 同期の部品と、元の async の関数（isBreakerOpen・recordClaimFallback）・元の入れ子の async のクロージャの工場（createSettle・
// createSlotWorker・createRecordFailure）だけで、await の段は増やさない（書き込みの順は cronWrapper.js の本体に残る）。
import { randomUUID } from "node:crypto";
import { SCRAPE_JOBS } from "./registry.js";
import {
  BreakerOpenError,
  FetchStoppedError,
  createCircuitBreaker,
} from "./circuitBreaker.js";
import { hostKeyOf, pathKeyOf } from "./politeFetch.js";
import {
  applyZeroRowGuard,
  computeRetryAt,
  isFinalOutcome,
  truncateError,
} from "./outcomes.js";

export function defaultWorker(job) {
  return `${process.env.VERCEL_REGION ?? "local"}:${job}:${randomUUID()}`;
}

export const ok = (body) => ({ status: 200, body: { success: true, ...body } });
export const failed = (body) => ({
  status: 500,
  body: { success: false, ...body },
});

/** フォールバックのアラートの key（scrape_job_state.last_report.alerts。監視が report:{job}:{key} として通知する） */
export const CLAIM_FALLBACK_ALERT_KEY = "claim_fallback";

/** runScrapeJobWith の引数の既定値（依存の順に評価する: definition → now → worker → breaker） */
export const scrapeJobOptions = ({
  job,
  definition = SCRAPE_JOBS[job],
  store,
  handleSlot,
  run,
  onTick,
  now = () => new Date(),
  worker = defaultWorker(job),
  modeGated = true,
  client = null,
  query = {},
  breaker = createCircuitBreaker({
    store: store.breakerStore,
    now: () => now().getTime(),
  }),
  politeFetch,
}) => ({
  job,
  definition,
  store,
  handleSlot,
  run,
  onTick,
  now,
  worker,
  modeGated,
  client,
  query,
  breaker,
  politeFetch,
});

/** ソフトデッドライン（maxDuration−30秒）を超えたか、を返す関数 */
export function createShouldStop(now, definition, marginSec) {
  const startedMs = now().getTime();
  const softDeadlineMs =
    startedMs + (definition.maxDurationSec - marginSec) * 1000;
  return () => now().getTime() >= softDeadlineMs;
}

/** 失敗の記録（記録の失敗は、本処理を止めない）。起動時点の連続失敗数を覚えておく */
export function createRecordFailure({ store, job, now, state }) {
  const previousFailures = state.row?.consecutive_failures ?? 0;
  return async (error) => {
    try {
      await store.recordFailure(job, {
        now: now(),
        error,
        previousFailures,
      });
    } catch (e) {
      console.error(`❌ ${job}: 失敗の記録に失敗: ${e.message}`);
    }
  };
}

/** tick のフックを呼ぶか（live のときだけ） */
export const shouldRunTick = (onTick, mode) => Boolean(onTick && mode === "live");

/** onTick が投げたときの、ログと応答の tickError */
export function tickFailureInfo(job, error) {
  console.error(`❌ ${job}: onTick のエラー:`, error);
  return { tickError: truncateError(error) };
}

/**
 * 窓型・連続の処理結果から、応答と、失敗の記録（record: true なら error を記録する）を決める。
 * summary.failed: 窓型だけ firstError を記録する。tickError があれば（summary が成功でも）それを記録する
 */
export function summaryVerdict({ job, mode, definition, summary, tickInfo, tickError }) {
  const body = { job, mode, ...summary.body, ...tickInfo };
  if (summary.failed) {
    return {
      record: definition.kind === "window",
      error: summary.firstError,
      result: failed(body),
    };
  }
  if (tickError) return { record: true, error: tickError, result: failed(body) };
  return { record: false, error: undefined, result: ok(body) };
}

/** ブレーカーが開いていて取らずに終えるときの結果 */
export const breakerSkipResult = (brk) => ({
  failed: false,
  body: {
    skipped: brk.skipped,
    host: brk.host,
    until: new Date(brk.until).toISOString(),
  },
});

/**
 * ジョブのブレーカーが開いているか。ホスト（definition.hosts）と、ページのパス（definition.breakerUrls。403 の拒否で
 * 開くパス単位のブレーカー。BOA-1145）の両方を見る。開いていれば、claim せずにこの起動を終える
 */
export async function isBreakerOpen(breaker, definition, nowMs) {
  const keys = [
    ...(definition.hosts ?? []).map((host) => ({
      key: hostKeyOf(`https://${host}/`),
      host,
    })),
    ...(definition.breakerUrls ?? []).map((url) => ({
      key: pathKeyOf(url),
      host: pathKeyOf(url),
    })),
  ];
  for (const { key, host } of keys) {
    try {
      // 開いているかだけを見る（半開の試行を DB で予約しない。予約すると、この起動で取らないのに全体の試行を2分止める）
      await breaker.check(key, { reserve: false });
    } catch (error) {
      if (error instanceof BreakerOpenError) {
        return {
          open: true,
          until: error.until,
          host,
          // 非常停止（fetch_stop、178）は応答で breaker_open と分ける（人が立てたものか、ブレーカーが開いたものか）
          skipped:
            error instanceof FetchStoppedError ? "fetch_stop" : "breaker_open",
        };
      }
      throw error;
    }
  }
  return { open: false, until: nowMs };
}

/**
 * 閉じた後24時間の絞り（spec §5.2）にあるブレーカーのキー（ホスト・ページのパス）。isBreakerOpen の後に呼ぶ
 * （check の読み取りで DB の段階を同期済み）。1つでもあれば、その起動の1起動の上限（claimLimit）を半分にする
 */
export function throttledKeys(breaker, definition) {
  if (typeof breaker.isThrottled !== "function") return [];
  const keys = [
    ...(definition.hosts ?? []).map((host) => hostKeyOf(`https://${host}/`)),
    ...(definition.breakerUrls ?? []).map(pathKeyOf),
  ];
  return keys.filter((key) => breaker.isThrottled(key));
}

/**
 * claim が上書きなしの既存の関数へフォールバックしたかを、ジョブ状態（last_report）に反映する。
 *   フォールバックした: last_report.alerts にアラートを入れる（成功の記録を伴う。既にあれば、書き直さない）
 *   正常に取れた・前回のアラートが残っている: アラートを消す
 * 記録の失敗は、本処理を止めない（ログのみ）。応答の body に足す値を返す
 */
export async function recordClaimFallback({ job, definition, store, state, now }) {
  const fallback = store.takeClaimFallback?.() ?? null;
  const previousAlerts = state.row?.last_report?.alerts;
  const hadAlert =
    Array.isArray(previousAlerts) &&
    previousAlerts.some((a) => a?.key === CLAIM_FALLBACK_ALERT_KEY);
  try {
    if (fallback && !hadAlert) {
      await store.recordSuccess(job, {
        now: now(),
        report: {
          alerts: [{ key: CLAIM_FALLBACK_ALERT_KEY, text: fallback.reason }],
        },
      });
    } else if (!fallback && hadAlert && definition.graceMinByOffset) {
      await store.recordSuccess(job, { now: now(), report: { alerts: [] } });
    }
  } catch (error) {
    console.error(`❌ ${job}: フォールバックの記録に失敗: ${error.message}`);
  }
  return fallback ? { claimFallback: fallback.reason } : {};
}

/** スロットの完了・再試行を記録する関数（リースを奪われていたら警告して false を返す） */
export function createSettle({ store, worker, now, job, definition }) {
  return async (slot, result) => {
    const at = now();
    let applied;
    if (isFinalOutcome(result.outcome)) {
      applied = await store.completeSlot(slot, {
        worker,
        now: at,
        outcome: result.outcome,
        rowsWritten: result.rowsWritten,
        resultDigest: result.resultDigest,
      });
    } else {
      applied = await store.retrySlot(slot, {
        worker,
        now: at,
        outcome: result.outcome,
        error: result.error,
        // 取得せずに戻した（展示の not_due。BOA-1145）: 試行回数を戻す
        releaseAttempt: result.releaseAttempt === true,
        retryAt:
          result.retryAt ??
          computeRetryAt({
            now: at,
            claimedAt: slot.last_attempt_at,
            retrySec: definition.retrySec,
          }),
      });
    }
    if (!applied) {
      // リースを奪われていた（処理が遅くリースが切れ、別の実行が引き継いだ）。データ側は冪等な書き込み済みで無害
      console.warn(
        `⚠️ ${job}: リースを失っていたため記録しませんでした（${slot.race_id} ${slot.offset_min}）`,
      );
    }
    return applied;
  };
}

/**
 * 着手しない場合: ソフトデッドライン（maxDuration−30秒）を超えた、または、リースが処理の完了前に
 * 切れる見込み（別の実行が同じスロットを取って二重に取得するのを避ける）。shouldStop が true なら now() は呼ばない
 */
export function shouldDeferSlot(slot, definition, now, shouldStop) {
  const leaseEndMs = slot.lease_until
    ? new Date(slot.lease_until).getTime()
    : Infinity;
  return (
    shouldStop() ||
    now().getTime() + (definition.slotSecEstimate ?? 0) * 1000 > leaseEndMs
  );
}

/** ハンドラーが投げたときの結果（ブレーカーが開いたなら breaker_open、それ以外はログして error） */
export function slotErrorResult(job, slot, error) {
  if (error instanceof BreakerOpenError) {
    return {
      outcome: "breaker_open",
      retryAt: new Date(error.until),
      error: error.message,
    };
  }
  console.error(`❌ ${job}: スロットの処理エラー（${slot.race_id}）:`, error);
  return { outcome: "error", error: truncateError(error) };
}

/** ハンドラーの結果の形を検査し（不正なら error）、0件エラーの判定を通す */
export function finalizeSlotResult(result) {
  const valid =
    result === null ||
    typeof result !== "object" ||
    typeof result.outcome !== "string"
      ? {
          outcome: "error",
          error: `ハンドラーが不正な結果を返しました: ${String(result)}`,
        }
      : result;
  return applyZeroRowGuard(valid);
}

/**
 * スロット1件の処理（mapWithConcurrency の worker）を作る。このスロットの処理・記録の失敗は、他のスロットを止めない
 * （1つの例外で、claim済みの全スロットがリース失効まで running のまま残るのを避ける）。
 * 着手しない場合は、すぐ次の起動が取れるよう pending に戻す（試行回数は戻す）
 */
export function createSlotWorker({ job, definition, store, worker, now, shouldStop, handleSlot, ctx, settle }) {
  return async (slot) => {
    if (shouldDeferSlot(slot, definition, now, shouldStop)) {
      try {
        await store.retrySlot(slot, {
          worker,
          now: now(),
          retryAt: now(),
          releaseAttempt: true,
        });
      } catch (error) {
        console.error(
          `❌ ${job}: スロットを戻せませんでした（${slot.race_id}）:`,
          error,
        );
      }
      return { outcome: "deferred" };
    }
    try {
      let result;
      try {
        result = await handleSlot(slot, ctx);
      } catch (error) {
        result = slotErrorResult(job, slot, error);
      }
      result = finalizeSlotResult(result);
      await settle(slot, result);
      return result;
    } catch (error) {
      console.error(
        `❌ ${job}: スロットの記録エラー（${slot.race_id}）:`,
        error,
      );
      return { outcome: "error", error: truncateError(error) };
    }
  };
}

/**
 * スロットの結果の集計。着手しなかった（deferred）・予定の時刻より前で取得しなかった（not_due）スロットは、処理に数えない。
 * 処理したスロットが全て error なら、この実行は失敗（HTTP 500・連続失敗数を増やす）
 */
export function tallySlotResults(results) {
  const tally = {};
  let rowsWritten = 0;
  for (const r of results) {
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    rowsWritten += r.rowsWritten ?? 0;
  }
  const processed = results.filter(
    (r) => r.outcome !== "deferred" && r.outcome !== "not_due",
  );
  const allFailed =
    processed.length > 0 && processed.every((r) => r.outcome === "error");
  return { tally, rowsWritten, processed, allFailed };
}

/** 対象日が処理済みの応答（補足の起動が、既に成功した対象日を再処理しない＝冪等） */
export const alreadyDoneResult = (targetDate) => ({
  failed: false,
  body: { skipped: "already_done", targetDate },
});

/** リースを取った後の再確認: 読んだ状態が使えて、対象日が処理済みか */
export const isDoneForTarget = (fresh, targetDate) =>
  Boolean(fresh.available && fresh.row?.last_target_date === targetDate);

/**
 * 成功の記録の引数。shadow は書き込まないため、対象日を済みにしない（live に切り替えたとき、その日の分を処理できるように）。
 * incomplete（未公開のデータを待っている等）も、対象日を済みにしない（補足の起動がもう一度処理する）。
 * cursor はチャンク処理の進捗（racer_profiles 等）。undefined なら cursor は変更しない
 */
export const leasedSuccessRecord = (at, mode, targetDate, result) => ({
  now: at,
  rowsWritten: result.rowsWritten,
  targetDate: mode === "live" && !result.incomplete ? targetDate : undefined,
  report: result.report,
  cursor: result.cursor,
});

/** 日次・連続の成功の応答の本文 */
export const leasedSuccessBody = (targetDate, result) => ({
  targetDate,
  rowsWritten: result.rowsWritten ?? 0,
  ...(result.incomplete ? { incomplete: true } : {}),
  ...(result.body ?? {}),
});
