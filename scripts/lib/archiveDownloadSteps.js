/**
 * 取得ループ（archiveDownloader.js の runArchiveDownload）から分けた部品（リファクタ。振る舞いは変えない）。
 * 既定の解決・計画・取得・分類・記録。archiveDownloader.js を import しない（循環させない）。
 * kb-backfill.js の関数は lib から maintenance への新しい依存の辺を作らないよう、呼び出し側から受け取る。
 */
import { appendJsonl, readJsonl, sha256 } from "./archiveFiles.js";

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/** 差し替え（deps）の既定値を解決する */
export function resolveRunDeps(deps, userAgent, fetchOnce) {
  return {
    sleepFn: deps.sleep ?? sleepDefault,
    fetchFn: deps.fetchOnce ?? ((url) => fetchOnce(url, userAgent)),
    nowFn: deps.now ?? (() => new Date()),
    backoffBaseMs: deps.backoffBaseMs ?? 30000,
    log: deps.log ?? console.log,
  };
}

/**
 * 取得する項目を決め、計画を出す。dry-run・未取得なしなら { done: true }、取得するなら { todo }。
 * マニフェスト（追記のみ）の項目ごとの最新が、状態
 */
export function planRun({
  items,
  manifestFile,
  opts,
  log,
  planItems,
  estimatePlan,
}) {
  const byKey = new Map();
  for (const e of readJsonl(manifestFile)) byKey.set(e.key, e);
  // refresh: 完了済みも取り直す（更新される項目。例: 当月・翌月の月間スケジュール）
  const todo = opts.refresh ? items : planItems(items, byKey);
  const meanInterval = (opts.intervalMinMs + opts.intervalMaxMs) / 2;
  const est = estimatePlan({
    requests: todo.length,
    dailyLimit: opts.dailyLimit,
    meanIntervalMs: meanInterval,
    latencyMs: opts.latencyMs,
  });
  log(
    `未取得 ${todo.length} リクエスト（全 ${items.length}）/ 日次上限 ${opts.dailyLimit} → 最短 ${est.nights} 夜、合計約 ${est.totalHours} 時間` +
      `（間隔 ${opts.intervalMinMs}〜${opts.intervalMaxMs}ms + 応答 ${opts.latencyMs}ms を仮定）`,
  );
  if (opts.dryRun) {
    log(
      "[DRY-RUN] ネットワーク・書き込みなし。先頭5件:",
      JSON.stringify(todo.slice(0, 5).map((t) => t.key)),
    );
    return { done: true };
  }
  if (todo.length === 0) {
    log("未取得はありません（完了済み）");
    return { done: true };
  }
  return { todo };
}

/**
 * 取得ループの文脈（集計・間隔・停止・状態）を作る。counters（連続した失敗・404の数と、今夜の使用数）は
 * ハンドラーと共有する。
 */
export function createRunContext({
  todo,
  manifestFile,
  runsFile,
  opts,
  dayKeyOf,
  d: { log, sleepFn, nowFn, backoffBaseMs },
  isAbsentExpected,
}) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const stats = { requests: 0, ok: 0, absent: 0, pending: 0, error: 0 };
  const pace = () =>
    sleepFn(
      opts.intervalMinMs +
        Math.random() * (opts.intervalMaxMs - opts.intervalMinMs),
    );
  const nightCount = () => {
    const k = dayKeyOf(nowFn());
    return readJsonl(manifestFile).filter(
      (e) => e.requested && dayKeyOf(e.fetchedAt) === k,
    ).length;
  };
  const stop = (code, reason, resumeFrom) => {
    log(`\n停止: ${reason}`);
    if (resumeFrom)
      log(`再開: 同じコマンドを再実行（次の対象 ${resumeFrom.key}）`);
    log(`集計: ${JSON.stringify(stats)}`);
    appendJsonl(runsFile, { runId, stopped: reason, stats });
    return code;
  };
  return {
    runId,
    items: todo,
    manifestFile,
    opts,
    stats,
    log,
    stop,
    sleepFn,
    backoffBaseMs,
    isAbsentExpected,
    pace,
    counters: {
      consecutiveBad: 0,
      badKind: null,
      consecutiveAbsent: 0,
      usedTonight: nightCount(),
    },
  };
}

/** 1回の取得。接続の失敗は例外にせず netError で返す */
export async function fetchItem(fetchFn, url) {
  let res;
  let netError = null;
  try {
    res = await fetchFn(url);
  } catch (e) {
    netError = e;
  }
  return { res, netError };
}

/** 応答（または接続の失敗）の分類（純関数） */
export function classifyFetched(netError, res, classifyResponse) {
  return netError
    ? { kind: "network", bad: true, threshold: 3, backoff: true }
    : classifyResponse(res.status);
}

/** マニフェストに書く、取得の共通の項目（純関数） */
export function baseEntry(item, fetchedAt, res) {
  return {
    key: item.key,
    url: item.url,
    requested: true,
    fetchedAt,
    http: res?.status ?? null,
    ms: res?.ms ?? null,
    lastModified: res?.lastModified ?? null,
  };
}

/** 404 の扱い。404が3回連続したら終了コード、続けるなら null */
export function handleAbsentResponse(r, { i, item, entry }) {
  const c = r.counters;
  appendJsonl(r.manifestFile, {
    ...entry,
    status: "absent",
    expected: r.isAbsentExpected(item),
  });
  r.stats.absent++;
  if (r.isAbsentExpected(item)) {
    r.log(`[${i + 1}/${r.items.length}] ${item.key} 404（未公開。想定内）`);
    return null;
  }
  c.consecutiveAbsent++;
  r.log(`[${i + 1}/${r.items.length}] ${item.key} 404`);
  if (c.consecutiveAbsent >= 3)
    return r.stop(
      4,
      `404が${c.consecutiveAbsent}回連続しました（URL構造の変更またはアクセス制限の疑い）`,
      r.items[i + 1] ?? null,
    );
  return null;
}

/** 内容が想定外（検査が例外）の記録 */
export function recordInvalidContent(r, { i, item, res, entry, error }) {
  appendJsonl(r.manifestFile, {
    ...entry,
    status: "error",
    reason: `内容が想定外: ${error.message}`,
    bytes: res.bytes.length,
  });
  r.stats.error++;
  r.log(
    `[${i + 1}/${r.items.length}] ${item.key} 内容が想定外: ${error.message}`,
  );
}

/** 内容の検査の結果（未確定なら記録のみ、確定なら保存して記録）を記録する */
export function recordVerdict(r, { i, item, res, entry, verdict, save }) {
  if (verdict.status === "pending") {
    appendJsonl(r.manifestFile, {
      ...entry,
      status: "pending",
      bytes: res.bytes.length,
      reason: verdict.note ?? null,
    });
    r.stats.pending++;
    r.log(
      `[${i + 1}/${r.items.length}] ${item.key} 未確定（${verdict.note ?? "pending"}）。保存しません`,
    );
    return;
  }
  const file = save(item, res.bytes);
  appendJsonl(r.manifestFile, {
    ...entry,
    status: "ok",
    bytes: res.bytes.length,
    sha256: sha256(res.bytes),
    file,
  });
  r.stats.ok++;
  r.log(
    `[${i + 1}/${r.items.length}] ${item.key} ok ${res.bytes.length}B ${res.ms}ms lm=${res.lastModified ?? "-"}（今夜 ${r.counters.usedTonight}/${r.opts.dailyLimit}）`,
  );
}
