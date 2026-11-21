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
import { timingSafeEqual } from "node:crypto";
import { SCRAPE_JOBS, SOFT_DEADLINE_MARGIN_SEC } from "./registry.js";
import { mapWithConcurrency } from "./concurrency.js";
import { resolveTargetDate } from "./dailyJob.js";
import { createCircuitBreaker } from "./circuitBreaker.js";
import { createPoliteFetch } from "./politeFetch.js";
import { applyZeroRowGuard, truncateError } from "./outcomes.js";
import { jstStartOfDay, toJstDateString } from "./time.js";
import { createSupabaseStore } from "./store.js";
import { createFetchCounter } from "./fetchCounter.js";
import {
  CLAIM_FALLBACK_ALERT_KEY,
  alreadyDoneResult,
  breakerSkipResult,
  createRecordFailure,
  createSettle,
  createShouldStop,
  createSlotWorker,
  defaultWorker,
  failed,
  isBreakerOpen,
  isDoneForTarget,
  leasedSuccessBody,
  leasedSuccessRecord,
  ok,
  recordClaimFallback,
  scrapeJobOptions,
  shouldRunTick,
  summaryVerdict,
  tallySlotResults,
  throttledKeys,
  tickFailureInfo,
} from "./cronWrapperParts.js";

// フォールバックのアラートの key・既定のワーカー名は cronWrapperParts.js へ移した（ここから従来どおり import できる）
export { CLAIM_FALLBACK_ALERT_KEY, defaultWorker };

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

/** 予定表を生成するか: 10分に1回、または、その日の最初の起動（ジョブを日中に有効化した場合を含む） */
export function shouldEnsureSlots(now, lastTickAt) {
  if (now.getUTCMinutes() % ENSURE_SLOTS_EVERY_MIN === 0) return true;
  if (!lastTickAt) return true;
  return new Date(lastTickAt) < jstStartOfDay(now);
}

/** 絞りのときの1起動の上限（半分、切り上げ。1未満にしない） */
export const throttledClaimLimit = (claimLimit) =>
  Math.max(1, Math.ceil(claimLimit / 2));

/** 絞りのブレーカーがあるときの応答の足し（throttled と、半分にした claimLimit）。無ければ空 */
function throttleInfoOf(breaker, definition) {
  const throttled = throttledKeys(breaker, definition);
  return throttled.length > 0
    ? {
        throttled,
        claimLimit: throttledClaimLimit(definition.claimLimit),
      }
    : {};
}

/**
 * Cron の1回の起動の取得の道具（ブレーカー・politeFetch・取得の数え。BOA-1145 P3）。Cron の口（createScrapeCronHandler と、
 * オッズの口 createOddsCronHandlerWithPredictionOdds）が使う。数えは20件か60秒で裏で書き、finish() で残りを書く（取得0なら書かない）。
 * finish は投げない（数える側の失敗は取得・応答に響かせない）。呼ぶ側は try/finally で必ず呼ぶ
 */
export function createCronFetchContext({ client, store, now }) {
  const counter = createFetchCounter({
    client,
    source: "vercel",
    ...(now ? { now } : {}),
  });
  const breaker = createCircuitBreaker({
    store: store.breakerStore,
    ...(now ? { now: () => now().getTime() } : {}),
  });
  return {
    counter,
    breaker,
    politeFetch: createPoliteFetch({ breaker, counter }),
    finish: () => counter.flush(),
  };
}

/**
 * ジョブを1回実行する（HTTPに依存しない。テストではこれを直接呼ぶ）。
 *
 * politeFetch を渡さないときは、取得の数え（fetch_counts。BOA-1145 P3）つきの politeFetch を作り、終わりに足す（取得0なら書かない。
 * 投げない）。口ごとに数えを渡す作りだと、渡し忘れた口が数えから黙って抜ける（展示 beforeinfo・レース情報 racelist の
 * runSlotsWithRefresh が 10/27〜11/2 に抜けていた）。politeFetch を渡す呼び出し側（Cron の共通の口・オッズの口・テスト）は、
 * 数えも自分で持つ。
 *
 * @returns {Promise<{status: number, body: Record<string, unknown>}>}
 */
export async function runScrapeJob(options) {
  if (options.politeFetch) return runScrapeJobWith(options);
  const now = options.now ?? (() => new Date());
  const counter = createFetchCounter({
    client: options.client ?? null,
    source: "vercel",
    now,
  });
  const breaker =
    options.breaker ??
    createCircuitBreaker({
      store: options.store.breakerStore,
      now: () => now().getTime(),
    });
  try {
    return await runScrapeJobWith({
      ...options,
      now,
      breaker,
      politeFetch: createPoliteFetch({ breaker, counter }),
    });
  } finally {
    await counter.flush();
  }
}

async function runScrapeJobWith(options) {
  const {
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
  } = scrapeJobOptions(options);
  if (!definition) return failed({ job, error: `未登録のジョブです: ${job}` });
  const shouldStop = createShouldStop(now, definition, SOFT_DEADLINE_MARGIN_SEC);

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
  const recordFailure = createRecordFailure({ store, job, now, state });

  try {
    // live のときだけ、スロットの取得の前に呼ぶ（tick のフック）。失敗しても、スロットの処理は続ける
    let tickInfo = {};
    let tickError = null;
    if (shouldRunTick(onTick, mode)) {
      try {
        tickInfo = { tick: await onTick(ctx) };
      } catch (error) {
        tickError = error;
        tickInfo = tickFailureInfo(job, error);
      }
    }
    const runKind = definition.kind === "window" ? runWindow : runLeased;
    const summary = await runKind({
      job,
      definition,
      ctx,
      store,
      handleSlot,
      run,
      breaker,
      state,
      recordFailure,
    });
    const verdict = summaryVerdict({ job, mode, definition, summary, tickInfo, tickError });
    if (verdict.record) await recordFailure(verdict.error);
    return verdict.result;
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
  const brk = await isBreakerOpen(breaker, definition, now().getTime());
  if (brk.open) return breakerSkipResult(brk);

  let ensured = 0;
  if (shouldEnsureSlots(now(), state.row?.last_tick_at)) {
    // 時刻は、DBの now() を正とする（期限・リースの比較を、DBの1つの時計で行う。Vercelの各実行の時計に依存しない）
    ensured = await store.ensureSlots({
      date: toJstDateString(now()),
      jobs: [job],
    });
  }

  const throttleInfo = throttleInfoOf(breaker, definition);
  const slots = await store.claimSlots({
    job,
    worker,
    mode,
    ...(throttleInfo.claimLimit ? { limit: throttleInfo.claimLimit } : {}),
  });
  // offset ごとの許容幅の上書きが効かなかった（マイグレーション092が未適用で、既存の関数へフォールバックした）場合は、
  // 黙って延長が効かない状態を放置しないよう、応答・ジョブ状態の last_report（監視が通知する）に残す。
  // 上書きのあるジョブが、正常に取れた実行では、前回のフォールバックのアラートを消す
  const fallbackInfo = await recordClaimFallback({
    job,
    definition,
    store,
    state,
    now,
  });
  if (slots.length === 0) {
    return {
      failed: false,
      body: { claimed: 0, ensured, ...fallbackInfo, ...throttleInfo },
    };
  }

  const settle = createSettle({ store, worker, now, job, definition });
  const results = await mapWithConcurrency(
    slots,
    definition.concurrency,
    createSlotWorker({ job, definition, store, worker, now, shouldStop, handleSlot, ctx, settle }),
  );

  const { tally, rowsWritten, processed, allFailed } = tallySlotResults(results);
  const body = {
    claimed: slots.length,
    ensured,
    outcomes: tally,
    rowsWritten,
    ...fallbackInfo,
    ...throttleInfo,
  };
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
      return alreadyDoneResult(ctx.targetDate);
    }
  }

  const brk = await isBreakerOpen(breaker, definition, now().getTime());
  if (brk.open) return breakerSkipResult(brk);

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
      if (isDoneForTarget(fresh, ctx.targetDate)) {
        return alreadyDoneResult(ctx.targetDate);
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
    await store.recordSuccess(
      job,
      leasedSuccessRecord(now(), mode, ctx.targetDate, result),
    );
    return { failed: false, body: leasedSuccessBody(ctx.targetDate, result) };
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
    const store = createStore(client);
    const fetching = createCronFetchContext({ client, store });
    let result;
    try {
      result = await runScrapeJob({
        job,
        definition,
        store,
        handleSlot,
        run,
        onTick,
        modeGated: modeGated ?? definition?.kind !== "monitor",
        client,
        query: req.query ?? {},
        breaker: fetching.breaker,
        politeFetch: fetching.politeFetch,
      });
    } finally {
      await fetching.finish();
    }
    return res.status(result.status).json(result.body);
  };
}
