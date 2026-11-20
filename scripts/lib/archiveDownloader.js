/**
 * 公式サイトの静的ファイル・ページを、生のまま保管する取得ループ（fan・月間スケジュールのCLI共通）
 *
 * kb-backfill.js の download と同じ安全策を、対象（項目）の種類に依存しない形にしたもの:
 *   逐次（同時接続1）・3秒以上のジッター付き間隔・夜間窓・日次上限・サーキットブレーカー・
 *   マニフェスト（JSONL、追記のみ）による中断・再開。
 *   403は2回連続、429・503・5xx・接続失敗は3回連続で即停止（終了コード4）。429・503・接続失敗は
 *   指数バックオフ（30秒→60秒→…上限5分）で同じ対象を再試行する。
 *   404が3回連続、内容が想定外の200応答が3回連続でも停止（URL構造の変更・ブロックの疑い）。
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止（窓外・日次上限・最大件数。再実行で続きから） /
 *             4=サーキットブレーカー
 *
 * kb-backfill.js の純粋関数（窓・分類・見積り）を再利用し、取得ループだけをここに持つ
 * （kb-backfill.js 自体は変更しない）。
 */

import {
  inWindow,
  parseWindow,
  windowDayKey,
  classifyResponse,
  estimatePlan,
} from "../maintenance/kb-backfill.js";
import { appendJsonl } from "./archiveFiles.js";
import {
  baseEntry,
  classifyFetched,
  createRunContext,
  fetchItem,
  handleAbsentResponse,
  planRun,
  recordInvalidContent,
  recordVerdict,
  resolveRunDeps,
} from "./archiveDownloadSteps.js";

export { inWindow, parseWindow, windowDayKey, classifyResponse, estimatePlan };

/** 公式サイトへの最小間隔（ADR-0067）。これ未満は指定できない */
export const HARD_MIN_INTERVAL_MS = 3000;
export const FETCH_TIMEOUT_MS = 45000;
/** 完了: ok、または404が確定（想定内の404=未公開は、次回以降も再試行する） */
export const isDone = (s) =>
  s && (s.status === "ok" || (s.status === "absent" && !s.expected));

export { appendJsonl, readJsonl, sha256 } from "./archiveFiles.js";

/** 1回のHTTP取得（リダイレクトは追わない）。Last-Modified を返す（公開時期の実測用） */
export async function fetchOnce(url, userAgent) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent },
      signal: ac.signal,
      redirect: "manual",
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      status: res.status,
      bytes,
      ms: Date.now() - t0,
      lastModified: res.headers.get("last-modified"),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 未取得の項目（完了 = ok または absent）。items は {key, url} の配列 */
export function planItems(items, manifest) {
  return items.filter((it) => {
    return !isDone(manifest.get(it.key));
  });
}

/** 取得前の停止の理由（窓の外・日次上限・最大件数）。無ければ null（純関数） */
function preFetchStopReason({ win, now, opts, usedTonight, requests }) {
  if (!inWindow(win, now)) return `実行窓（JST ${opts.window}）の外です`;
  if (usedTonight >= opts.dailyLimit)
    return `日次上限 ${opts.dailyLimit} リクエストに到達しました`;
  if (requests >= opts.maxRequests)
    return `--max-requests=${opts.maxRequests} に到達しました`;
  return null;
}

/**
 * 失敗（403・429・503・5xx・接続失敗）の扱い。サーキットブレーカーで止めるなら終了コード、
 * 同じ対象をやり直すなら null。
 */
async function handleBadResponse(r, { i, item, cls, res, netError, entry }) {
  const c = r.counters;
  c.consecutiveBad = c.badKind === cls.kind ? c.consecutiveBad + 1 : 1;
  c.badKind = cls.kind;
  const failed = {
    ...entry,
    status: "error",
    reason: netError
      ? String(netError.message ?? netError)
      : `HTTP ${res.status}`,
  };
  appendJsonl(r.manifestFile, failed);
  r.stats.error++;
  r.log(
    `[${i + 1}/${r.items.length}] ${item.key} ${failed.reason}（連続 ${c.consecutiveBad}/${cls.threshold}）`,
  );
  if (c.consecutiveBad >= cls.threshold)
    return r.stop(
      4,
      `サーキットブレーカー: ${cls.kind} が ${c.consecutiveBad} 回連続しました。時間を置き、間隔を広げてから再開してください`,
      item,
    );
  if (cls.backoff) {
    const wait = Math.min(
      300000,
      r.backoffBaseMs * 2 ** (c.consecutiveBad - 1),
    );
    r.log(`  バックオフ ${Math.round(wait / 1000)} 秒`);
    await r.sleepFn(wait);
  } else await r.pace();
  return null;
}

/**
 * @param {object} p
 * @param {Array<{key: string, url: string}>} p.items 取得する項目（この順に取得）
 * @param {string} p.manifestFile マニフェスト（JSONL。key ごとの最新が状態）
 * @param {string} p.runsFile 実行の記録（JSONL）
 * @param {string} p.userAgent
 * @param {{intervalMinMs: number, intervalMaxMs: number, dailyLimit: number, window: string, maxRequests: number, latencyMs: number}} p.opts
 * @param {(bytes: Uint8Array, item: object) => Promise<{status: "ok"|"pending", note?: string}>} p.validate 内容の検査。想定外なら例外
 * @param {(item: object, bytes: Uint8Array) => string} p.save 生ファイルを保存し、アーカイブ内の相対パスを返す
 * @param {(item: object) => boolean} [p.isAbsentExpected] 404が想定内の項目（未公開の最新ファイル等）。404連続の停止に数えない
 * @param {{sleep?: Function, fetchOnce?: Function, now?: () => Date, backoffBaseMs?: number, log?: Function}} [p.deps]
 * @returns {Promise<number>} 終了コード
 */
export async function runArchiveDownload({
  items,
  manifestFile,
  runsFile,
  userAgent,
  opts,
  validate,
  save,
  isAbsentExpected = () => false,
  deps = {},
}) {
  const d = resolveRunDeps(deps, userAgent, fetchOnce);
  const win = parseWindow(opts.window);
  const plan = planRun({
    items,
    manifestFile,
    opts,
    log: d.log,
    planItems,
    estimatePlan,
  });
  if (plan.done) return 0;
  const r = createRunContext({
    todo: plan.todo,
    manifestFile,
    runsFile,
    opts,
    dayKeyOf: (at) => windowDayKey(win, at),
    d,
    isAbsentExpected,
  });
  const { stats, pace, stop, runId } = r;
  let consecutiveInvalid = 0;
  const c = r.counters;
  for (let i = 0; i < r.items.length; i++) {
    const item = r.items[i];
    const reason = preFetchStopReason({
      win,
      now: d.nowFn(),
      opts,
      usedTonight: c.usedTonight,
      requests: stats.requests,
    });
    if (reason) return stop(2, reason, item);

    const { res, netError } = await fetchItem(d.fetchFn, item.url);
    stats.requests++;
    c.usedTonight++;
    const entry = baseEntry(item, d.nowFn().toISOString(), res);
    const cls = classifyFetched(netError, res, classifyResponse);

    if (cls.bad) {
      const code = await handleBadResponse(r, {
        i,
        item,
        cls,
        res,
        netError,
        entry,
      });
      if (code !== null) return code;
      i--; // 同じ対象をやり直す（連続失敗の上限で必ず止まる）
      continue;
    }
    c.consecutiveBad = 0;
    c.badKind = null;

    if (cls.kind === "absent") {
      const code = handleAbsentResponse(r, { i, item, entry });
      if (code !== null) return code;
    } else {
      c.consecutiveAbsent = 0;
      let verdict = null;
      try {
        verdict = await validate(res.bytes, item);
      } catch (e) {
        recordInvalidContent(r, { i, item, res, entry, error: e });
        consecutiveInvalid++;
        if (consecutiveInvalid >= 3)
          return stop(
            4,
            "内容が想定外の応答が3回連続しました（応答の形式変更またはブロックの疑い）",
            item,
          );
        await pace();
        continue;
      }
      consecutiveInvalid = 0;
      recordVerdict(r, { i, item, res, entry, verdict, save });
    }
    await pace();
  }
  d.log(`\n完了: ${JSON.stringify(stats)}`);
  appendJsonl(runsFile, { runId, completed: true, stats });
  // 0件取得のまま「成功」にしない（想定内の404だけの実行は成功）
  if (stats.requests > 0 && stats.ok + stats.absent === 0) return 1;
  return 0;
}
