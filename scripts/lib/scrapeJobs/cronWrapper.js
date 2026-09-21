/**
 * Vercel Cron 向けの共通ラッパ（plan.md §2.2）。各データセットの api/cron/*.js は、これを経由する。
 *
 * 責務:
 *   認証        Authorization: Bearer ${CRON_SECRET} を定数時間比較
 *   モード      scrape_job_state.mode（off / shadow / live）を毎回読む。off（または行なし）は何もしない。
 *               shadow は取得・解析のみで、データテーブルへは書かせない（ハンドラーに ctx.mode で伝える）
 *   排他        窓型はスロットのリース（claim_scrape_slots）、それ以外はジョブ単位のリース
 *   冪等        完了の記録は claimed_by が一致する場合のみ。日次ジョブは last_target_date で二重実行を避ける
 *   0件エラー   期待件数が0でないのに解析0件の結果は、成功にせず error にする
 *   死活        last_tick_at（5分に1回）・last_success_at・last_error・consecutive_failures
 *   ブレーカー  取得先のサーキットブレーカーが開いていれば、スロットを取らずに終える
 *   応答方式    waitUntil を使わず、処理の完了後に 200/500 を返す（失敗をHTTPステータスに残す）。
 *               ソフトデッドライン（maxDuration−30秒）を超えたら、新しいスロットに着手しない
 *
 * マイグレーション075が未適用のDBでは、何もせず 200（skipped）で終わる。
 *
 * ハンドラー（各データセットが実装する）:
 *   window型   handleSlot(slot, ctx) → {outcome, rowsWritten?, rowsParsed?, rowsExpected?, resultDigest?, error?}
 *   それ以外   run(ctx)              → {rowsWritten?, rowsParsed?, rowsExpected?, report?, cursor?, body?, incomplete?, outcome?, error?}
 *              （cursor は、チャンク処理の進捗（scrape_job_state.cursor）。成功の記録と同時に保存し、次の起動で
 *              ctx.state.cursor として読める。エラー（outcome:"error"）のときは保存しない＝同じチャンクをやり直す。
 *              body は、HTTP応答の本文に、そのまま足される。outcome:"error" は失敗として記録する。
 *              incomplete:true は「成功したが、今回の対象日の処理は完了していない」（未公開のデータを待つ等）で、
 *              対象日を処理済みにしない＝補足の起動が同じ対象日をもう一度処理する）
 *   onTick     onTick(ctx)          → 任意のオブジェクト（応答の tick に入る）。live のときだけ、毎回の起動で、
 *              スロットの取得（claim）の前に1回呼ぶ。スロットの有無に関わらず毎分やりたいDB上の作業
 *              （例: 結果のスロットが期限切れになる前の、中止・順延の確定）に使う。shadow・off では呼ばない
 *              （データテーブルへ書くため）。例外は、スロットの処理は続けた上で、この実行を失敗として記録する
 *   ctx: {job, mode, worker, now(), targetDate?, politeFetch, shouldStop(),
 *         client（Supabase）, query（リクエストのクエリ）, state（起動時のジョブ状態の行）}
 *
 * api/cron/{job}.js の書き方（窓型の例。maxDuration は、レジストリの maxDurationSec と同じ値をリテラルで書く。
 * Vercel がビルド時に静的に読むため、importした定数は使えない）:
 *
 *   import { createScrapeCronHandler } from "../../scripts/lib/scrapeJobs/cronWrapper.js";
 *   export const config = { maxDuration: 300 };
 *   export default createScrapeCronHandler({
 *     job: "result",
 *     handleSlot: async (slot, ctx) => {
 *       // ctx.mode === "shadow" のときは、取得・解析のみ行い、データテーブルへは書かない
 *       const res = await ctx.politeFetch(url);   // タイムアウト・バックオフ・ブレーカー込み
 *       return { outcome: "ok", rowsWritten, rowsParsed, rowsExpected };
 *     },
 *   });
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { SCRAPE_JOBS, SOFT_DEADLINE_MARGIN_SEC } from "./registry.js";
import { mapWithConcurrency } from "./concurrency.js";
import { resolveTargetDate } from "./dailyJob.js";
import { BreakerOpenError, createCircuitBreaker } from "./circuitBreaker.js";
import { createPoliteFetch, hostKeyOf } from "./politeFetch.js";
import {
  applyZeroRowGuard,
  computeRetryAt,
  isFinalOutcome,
  truncateError,
} from "./outcomes.js";
import { jstStartOfDay, toJstDateString } from "./time.js";
import { createSupabaseStore } from "./store.js";

/** 予定表を生成し直す間隔（分）。races が後から増えた場合の追従（plan.md §3.5） */
export const ENSURE_SLOTS_EVERY_MIN = 10;

// 単純な !== 比較はタイミングサイドチャネルになりうるため定数時間で比較する
// （api/cron/exhibition.js の isAuthorized と同一実装）
export function isAuthorized(authHeader, expected) {
  if (!expected || !authHeader) return false;
  const expectedBuf = Buffer.from(`Bearer ${expected}`);
  const actualBuf = Buffer.from(authHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function defaultWorker(job) {
  return `${process.env.VERCEL_REGION ?? "local"}:${job}:${randomUUID()}`;
}

const ok = (body) => ({ status: 200, body: { success: true, ...body } });
const failed = (body) => ({ status: 500, body: { success: false, ...body } });

/** 予定表を生成するか: 10分に1回、または、その日の最初の起動（ジョブを日中に有効化した場合を含む） */
export function shouldEnsureSlots(now, lastTickAt) {
  if (now.getUTCMinutes() % ENSURE_SLOTS_EVERY_MIN === 0) return true;
  if (!lastTickAt) return true;
  return new Date(lastTickAt) < jstStartOfDay(now);
}

async function isBreakerOpen(breaker, hosts, nowMs) {
  for (const host of hosts ?? []) {
    try {
      await breaker.check(hostKeyOf(`https://${host}/`));
      // check() が半開の試行を予約した場合は、ここでは取得しないので戻す
      breaker.abortProbe(hostKeyOf(`https://${host}/`));
    } catch (error) {
      if (error instanceof BreakerOpenError) {
        return { open: true, until: error.until, host };
      }
      throw error;
    }
  }
  return { open: false, until: nowMs };
}

/**
 * ジョブを1回実行する（HTTPに依存しない。テストではこれを直接呼ぶ）。
 *
 * @returns {Promise<{status: number, body: Record<string, unknown>}>}
 */
export async function runScrapeJob({
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
  politeFetch = createPoliteFetch({ breaker }),
}) {
  if (!definition) return failed({ job, error: `未登録のジョブです: ${job}` });
  const startedMs = now().getTime();
  const softDeadlineMs =
    startedMs + (definition.maxDurationSec - SOFT_DEADLINE_MARGIN_SEC) * 1000;
  const shouldStop = () => now().getTime() >= softDeadlineMs;

  // 1) ジョブ状態とモード
  let state;
  try {
    state = await store.readState(job);
  } catch (error) {
    return failed({ job, error: error.message });
  }
  if (!state.available) {
    return ok({ job, skipped: "scrape_schema_not_applied" });
  }
  if (!state.row) {
    // 行の無いジョブ。off として扱い（ゲートを掛けるジョブ）、以降 DB の更新のみで切り替えられるよう行を作る。
    // ゲートを掛けないジョブ（監視・保守）も、死活（last_tick_at）を記録するために行が要る
    try {
      await store.ensureRow(job);
    } catch (error) {
      return failed({ job, error: error.message });
    }
    if (modeGated) return ok({ job, skipped: "mode_off", mode: "off" });
  }
  const mode = modeGated ? state.row.mode : "live";
  if (mode === "off") return ok({ job, skipped: "mode_off", mode });

  // 2) 死活の記録（失敗しても、本処理は続ける。本処理のDBアクセスが失敗すれば、そちらで検知する）
  try {
    await store.touchTick(job, now());
  } catch (error) {
    console.warn(`⚠️ ${job}: 起動の記録に失敗: ${error.message}`);
  }

  // state: 起動時点のジョブ状態の行（前回の last_report 等を読むため）。client・query: 監視・保守のジョブが使う
  const ctx = {
    job,
    mode,
    worker,
    now,
    politeFetch,
    shouldStop,
    client,
    query,
    state: state.row,
  };
  const previousFailures = state.row?.consecutive_failures ?? 0;
  const recordFailure = async (error) => {
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

  try {
    // live のときだけ、スロットの取得の前に呼ぶ（tick のフック）。失敗しても、スロットの処理は続ける
    let tickInfo = {};
    let tickError = null;
    if (onTick && mode === "live") {
      try {
        tickInfo = { tick: await onTick(ctx) };
      } catch (error) {
        console.error(`❌ ${job}: onTick のエラー:`, error);
        tickError = error;
        tickInfo = { tickError: truncateError(error) };
      }
    }
    const summary =
      definition.kind === "window"
        ? await runWindow({
            job,
            definition,
            ctx,
            store,
            handleSlot,
            breaker,
            state,
          })
        : await runLeased({
            job,
            definition,
            ctx,
            store,
            run,
            breaker,
            state,
            recordFailure,
          });
    if (summary.failed) {
      if (definition.kind === "window") await recordFailure(summary.firstError);
      return failed({ job, mode, ...summary.body, ...tickInfo });
    }
    if (tickError) {
      await recordFailure(tickError);
      return failed({ job, mode, ...summary.body, ...tickInfo });
    }
    return ok({ job, mode, ...summary.body, ...tickInfo });
  } catch (error) {
    console.error(`❌ ${job}: 実行エラー:`, error);
    await recordFailure(error);
    return failed({ job, mode, error: truncateError(error) });
  }
}

/** 窓型: 期限が来たスロットを取り、ハンドラーで処理して、完了・再試行を記録する */
async function runWindow({
  job,
  definition,
  ctx,
  store,
  handleSlot,
  breaker,
  state,
}) {
  const { now, mode, worker, shouldStop } = ctx;
  const brk = await isBreakerOpen(breaker, definition.hosts, now().getTime());
  if (brk.open) {
    return {
      failed: false,
      body: {
        skipped: "breaker_open",
        host: brk.host,
        until: new Date(brk.until).toISOString(),
      },
    };
  }

  let ensured = 0;
  if (shouldEnsureSlots(now(), state.row?.last_tick_at)) {
    // 時刻は、DBの now() を正とする（期限・リースの比較を、DBの1つの時計で行う。Vercelの各実行の時計に依存しない）
    ensured = await store.ensureSlots({
      date: toJstDateString(now()),
      jobs: [job],
    });
  }

  const slots = await store.claimSlots({ job, worker, mode });
  if (slots.length === 0) {
    return { failed: false, body: { claimed: 0, ensured } };
  }

  const settle = async (slot, result) => {
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

  const results = await mapWithConcurrency(
    slots,
    definition.concurrency,
    async (slot) => {
      // 着手しない場合: ソフトデッドライン（maxDuration−30秒）を超えた、または、リースが処理の完了前に
      // 切れる見込み（別の実行が同じスロットを取って二重に取得するのを避ける）。すぐ次の起動が取れるよう、
      // pending に戻す（試行回数は戻す）
      const leaseEndMs = slot.lease_until
        ? new Date(slot.lease_until).getTime()
        : Infinity;
      if (
        shouldStop() ||
        now().getTime() + (definition.slotSecEstimate ?? 0) * 1000 > leaseEndMs
      ) {
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
      // このスロットの処理・記録の失敗は、他のスロットを止めない（1つの例外で、claim済みの全スロットが
      // リース失効まで running のまま残るのを避ける）
      try {
        let result;
        try {
          result = await handleSlot(slot, ctx);
        } catch (error) {
          if (error instanceof BreakerOpenError) {
            result = {
              outcome: "breaker_open",
              retryAt: new Date(error.until),
              error: error.message,
            };
          } else {
            console.error(
              `❌ ${job}: スロットの処理エラー（${slot.race_id}）:`,
              error,
            );
            result = { outcome: "error", error: truncateError(error) };
          }
        }
        if (
          result === null ||
          typeof result !== "object" ||
          typeof result.outcome !== "string"
        ) {
          result = {
            outcome: "error",
            error: `ハンドラーが不正な結果を返しました: ${String(result)}`,
          };
        }
        result = applyZeroRowGuard(result);
        await settle(slot, result);
        return result;
      } catch (error) {
        console.error(
          `❌ ${job}: スロットの記録エラー（${slot.race_id}）:`,
          error,
        );
        return { outcome: "error", error: truncateError(error) };
      }
    },
  );

  const tally = {};
  let rowsWritten = 0;
  for (const r of results) {
    tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
    rowsWritten += r.rowsWritten ?? 0;
  }
  const processed = results.filter((r) => r.outcome !== "deferred");
  // 処理したスロットが全て error なら、この実行は失敗（HTTP 500・連続失敗数を増やす）
  const allFailed =
    processed.length > 0 && processed.every((r) => r.outcome === "error");
  const body = { claimed: slots.length, ensured, outcomes: tally, rowsWritten };
  if (allFailed) {
    return { failed: true, firstError: processed[0].error, body };
  }
  if (processed.length > 0) {
    await store.recordSuccess(job, { now: now(), rowsWritten });
  }
  return { failed: false, body };
}

/** 日次・連続・監視: ジョブ単位のリースで排他し、run() を1回呼ぶ */
async function runLeased({
  job,
  definition,
  ctx,
  store,
  run,
  breaker,
  state,
  recordFailure,
}) {
  const { now, mode, worker } = ctx;

  if (definition.kind === "daily") {
    ctx.targetDate = resolveTargetDate(now(), definition.targetTimeJst);
    if (state.row?.last_target_date === ctx.targetDate) {
      // 補足の起動が、既に成功した対象日を再処理しない（冪等）
      return {
        failed: false,
        body: { skipped: "already_done", targetDate: ctx.targetDate },
      };
    }
  }

  const brk = await isBreakerOpen(breaker, definition.hosts, now().getTime());
  if (brk.open) {
    return {
      failed: false,
      body: {
        skipped: "breaker_open",
        host: brk.host,
        until: new Date(brk.until).toISOString(),
      },
    };
  }

  const acquired = await store.acquireLease(
    job,
    worker,
    definition.leaseSec,
    now(),
  );
  if (!acquired) return { failed: false, body: { skipped: "lease_held" } };

  try {
    if (definition.kind === "daily") {
      // リースを取った後に、対象日が処理済みでないかを再確認する（読み取りとリース取得の間に、
      // 別の実行が完了した場合の二重実行を避ける）
      const fresh = await store.readState(job);
      if (fresh.available && fresh.row?.last_target_date === ctx.targetDate) {
        return {
          failed: false,
          body: { skipped: "already_done", targetDate: ctx.targetDate },
        };
      }
    }
    const result = applyZeroRowGuard({ outcome: "ok", ...(await run(ctx)) });
    if (result.outcome === "error") {
      await recordFailure(result.error);
      return {
        failed: true,
        body: { error: result.error, targetDate: ctx.targetDate },
      };
    }
    await store.recordSuccess(job, {
      now: now(),
      rowsWritten: result.rowsWritten,
      // shadow は書き込まないため、対象日を済みにしない（live に切り替えたとき、その日の分を処理できるように）。
      // incomplete（未公開のデータを待っている等）も、対象日を済みにしない（補足の起動がもう一度処理する）
      targetDate:
        mode === "live" && !result.incomplete ? ctx.targetDate : undefined,
      report: result.report,
      // チャンク処理の進捗（racer_profiles 等）。undefined なら cursor は変更しない
      cursor: result.cursor,
    });
    return {
      failed: false,
      body: {
        targetDate: ctx.targetDate,
        rowsWritten: result.rowsWritten ?? 0,
        ...(result.incomplete ? { incomplete: true } : {}),
        ...(result.body ?? {}),
      },
    };
  } finally {
    try {
      await store.releaseLease(job, worker);
    } catch (error) {
      console.warn(`⚠️ ${job}: リースの解放に失敗: ${error.message}`);
    }
  }
}

/**
 * api/cron/{job}.js のエクスポート用ハンドラーを作る。
 *
 * @param {Object} options
 * @param {string} options.job レジストリのジョブ名
 * @param {Function} [options.handleSlot] 窓型のハンドラー
 * @param {Function} [options.run] 日次・連続・監視のハンドラー
 * @param {Function} [options.onTick] live のときだけ、毎回の起動で、スロットの取得の前に呼ぶ（ファイル冒頭の説明を参照）
 * @param {boolean} [options.modeGated] false ならモードのゲートを掛けない（監視・保守）
 * @param {(client: import("@supabase/supabase-js").SupabaseClient) => Object} [options.createStore] ストアの差し替え（既定は createSupabaseStore）。
 *   対象レースにだけスロットを作る等、ensureSlots をジョブ固有にしたいときに使う（例: ピットレポート scripts/lib/pitReportJob.js）
 * @param {() => Promise<import("@supabase/supabase-js").SupabaseClient|null>} [options.getClient] テスト用の差し替え。既定は scripts/lib/supabaseClient.js
 */
export function createScrapeCronHandler({
  job,
  handleSlot,
  run,
  onTick,
  modeGated,
  createStore = createSupabaseStore,
  getClient = async () => (await import("../supabaseClient.js")).supabase,
}) {
  return async function handler(req, res) {
    if (!isAuthorized(req.headers.authorization, process.env.CRON_SECRET)) {
      return res.status(401).json({ success: false, error: "unauthorized" });
    }
    const client = await getClient();
    if (!client) {
      return res
        .status(500)
        .json({ success: false, job, error: "Supabase が設定されていません" });
    }
    const definition = SCRAPE_JOBS[job];
    const { status, body } = await runScrapeJob({
      job,
      definition,
      store: createStore(client),
      handleSlot,
      run,
      onTick,
      modeGated: modeGated ?? definition?.kind !== "monitor",
      client,
      query: req.query ?? {},
    });
    return res.status(status).json(body);
  };
}
