/**
 * kb-backfill.js の download（公式サイトから生のLZHをアーカイブへ保存する。ネットワークのみ。DBは触らない）。
 * CLI と使い方は kb-backfill.js の冒頭のコメント。大きさの線（400行）のため分けた（中身は変えない）
 */

import fs from "node:fs";
import path from "node:path";
import {
  KB_USER_AGENT,
  PENDING_MARKER,
  classifyKFileVenues,
  buildKbUrl,
  kbArchiveRelPath,
  decodeLzhText,
} from "../lib/kbFileParser.js";
import {
  parseWindow,
  inWindow,
  windowDayKey,
  classifyResponse,
  latestManifest,
  planDownload,
  estimatePlan,
  manifestPath,
  rawPath,
  readJsonl,
} from "./kb-backfill-parts.js";
import {
  appendJsonl,
  sleep,
  sha256,
  finishDownload,
} from "./kb-backfill-load.js";

const FETCH_TIMEOUT_MS = 45000;

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

async function fetchOnce(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": KB_USER_AGENT },
      signal: ac.signal,
      redirect: "manual",
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, bytes, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/** 取得の見積りを表示する（実行前の1行） */
function logDownloadPlan(opts, todo) {
  const meanInterval = (opts.intervalMinMs + opts.intervalMaxMs) / 2;
  const est = estimatePlan({
    requests: todo.length,
    dailyLimit: opts.dailyLimit,
    meanIntervalMs: meanInterval,
    latencyMs: opts.latencyMs,
  });
  const days = new Set(todo.map((t) => t.date)).size;
  console.log(
    `対象 ${opts.from}〜${opts.to} / 種別 ${opts.kinds.join(",")}: 未取得 ${todo.length} リクエスト（${days}日分）` +
      ` / 日次上限 ${opts.dailyLimit} → 最短 ${est.nights} 夜、合計約 ${est.totalHours} 時間` +
      `（間隔 ${opts.intervalMinMs}〜${opts.intervalMaxMs}ms + 応答 ${opts.latencyMs}ms を仮定）`,
  );
}

/** リクエスト間の最小間隔（ジッター付き）。全ての経路（成功・失敗・再試行）で必ず空ける */
const pace = (c) =>
  c.sleepFn(
    c.opts.intervalMinMs +
      Math.random() * (c.opts.intervalMaxMs - c.opts.intervalMinMs),
  );

/** 今夜（実行窓の日付）に出したリクエスト数 */
const nightCount = (c) => {
  const key = windowDayKey(c.win, c.nowFn());
  return [...readJsonl(c.manifestFile)].filter(
    (e) => e.requested && windowDayKey(c.win, e.fetchedAt) === key,
  ).length;
};

/** 実行を止めて記録する。終了コードを返す */
const stopRun = (c, code, reason, resumeFrom) => {
  console.log(`\n停止: ${reason}`);
  if (resumeFrom)
    console.log(
      `再開: 同じコマンドを再実行（次の対象 ${resumeFrom.date} ${resumeFrom.kind}）`,
    );
  console.log(`集計: ${JSON.stringify(c.stats)}`);
  appendJsonl(path.join(c.opts.archiveDir, "runs.jsonl"), {
    runId: c.runId,
    stopped: reason,
    stats: c.stats,
  });
  return code;
};

/** Kが404の日（開催なし）のBは取得しない。飛ばしたら true */
function skipAbsentKDay(c, date, kind) {
  if (!(
    kind === "B" &&
    (c.skipB.has(date) || c.manifest.get(`${date}|K`)?.status === "absent")
  ))
    return false;
  appendJsonl(c.manifestFile, {
    date,
    kind,
    status: "skipped",
    reason: "K-absent",
    fetchedAt: new Date().toISOString(),
  });
  c.stats.skipped++;
  return true;
}

/** 実行窓・日次上限・最大件数の確認。止めるなら終了コード、続けるなら null */
function limitStop(c, target) {
  const { opts } = c;
  if (!inWindow(c.win, c.nowFn()))
    return stopRun(c, 2, `実行窓（JST ${opts.window}）の外です`, target);
  if (c.usedTonight >= opts.dailyLimit)
    return stopRun(
      c,
      2,
      `日次上限 ${opts.dailyLimit} リクエストに到達しました`,
      target,
    );
  if (c.stats.requests >= opts.maxRequests)
    return stopRun(
      c,
      2,
      `--max-requests=${opts.maxRequests} に到達しました`,
      target,
    );
  return null;
}

/** 失敗応答（ネットワーク・403等）の記録・サーキットブレーカー・待ち。止めるなら終了コード、やり直すなら null */
async function handleBadResponse(c, i, entry, cls, res, netError) {
  const { stats, todo } = c;
  const { date, kind } = todo[i];
  c.consecutiveBad = c.badKind === cls.kind ? c.consecutiveBad + 1 : 1;
  c.badKind = cls.kind;
  const failed = {
    ...entry,
    status: "error",
    reason: netError
      ? String(netError.message ?? netError)
      : `HTTP ${res.status}`,
  };
  appendJsonl(c.manifestFile, failed);
  stats.error++;
  console.log(
    `[${i + 1}/${todo.length}] ${date} ${kind} ${failed.reason}（連続 ${c.consecutiveBad}/${cls.threshold}）`,
  );
  if (c.consecutiveBad >= cls.threshold)
    return stopRun(
      c,
      4,
      `サーキットブレーカー: ${cls.kind} が ${c.consecutiveBad} 回連続しました。時間を置き、間隔を広げてから再開してください`,
      todo[i],
    );
  if (cls.backoff) {
    const wait = Math.min(
      300000,
      c.backoffBaseMs * 2 ** (c.consecutiveBad - 1),
    );
    console.log(`  バックオフ ${Math.round(wait / 1000)} 秒`);
    await c.sleepFn(wait);
  } else {
    await pace(c); // バックオフ無しの失敗（403等）でも、最小間隔を空けて再試行する
  }
  return null;
}

/** 404（開催なし）の記録。404が続けば止める。止めるなら終了コード、続けるなら null */
function handleAbsent(c, i, entry) {
  const { stats, todo } = c;
  const { date, kind } = todo[i];
  appendJsonl(c.manifestFile, { ...entry, status: "absent" });
  stats.absent++;
  c.consecutiveAbsent++;
  if (kind === "K") c.skipB.add(date);
  console.log(`[${i + 1}/${todo.length}] ${date} ${kind} 404（開催なし）`);
  if (c.consecutiveAbsent >= 3)
    return stopRun(
      c,
      4,
      `404が${c.consecutiveAbsent}回連続しました（URL構造の変更またはアクセス制限の疑い。開催のない日が3日続くことは通常ありません）`,
      todo[i + 1] ?? null,
    );
  return null;
}

/** LZHとして展開できない応答の記録。3回続けば止める。止めるなら終了コード、続けるなら null */
function handleNotLzh(c, i, entry, res, e) {
  const { stats, todo } = c;
  const { date, kind } = todo[i];
  const failed = {
    ...entry,
    status: "error",
    reason: `LZH展開失敗: ${e.message}`,
    bytes: res.bytes.length,
  };
  appendJsonl(c.manifestFile, failed);
  stats.error++;
  console.log(`[${i + 1}/${todo.length}] ${date} ${kind} ${failed.reason}`);
  c.consecutiveNotLzh++;
  if (c.consecutiveNotLzh >= 3)
    return stopRun(
      c,
      4,
      "LZHとして展開できない応答が3回連続しました（応答の形式変更またはブロックの疑い）",
      todo[i],
    );
  return null;
}

/** 確定済みの応答を生ファイルとして保存し、マニフェストへ記録する */
function saveFetched(c, i, entry, res, kVenues) {
  const { opts, stats, todo } = c;
  const { date, kind } = todo[i];
  const file = rawPath(opts.archiveDir, kind, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, res.bytes);
  appendJsonl(c.manifestFile, {
    ...entry,
    status: "ok",
    ...(kVenues && kVenues.pendingVenues.length > 0
      ? { pendingVenues: kVenues.pendingVenues }
      : {}),
    bytes: res.bytes.length,
    sha256: sha256(res.bytes),
    file: kbArchiveRelPath(kind, date),
  });
  stats.ok++;
  console.log(
    `[${i + 1}/${todo.length}] ${date} ${kind} ok ${res.bytes.length}B ${res.ms}ms（今夜 ${c.usedTonight}/${opts.dailyLimit}）`,
  );
}

/** 200応答: LZHとして展開できること、Kは確定済み（プレースホルダでない）ことを確認して保存する。止めるなら終了コード、続けるなら null */
async function handleFetched(c, i, entry, res) {
  const { date, kind } = c.todo[i];
  c.consecutiveAbsent = 0;
  let text = null;
  try {
    text = await decodeLzhText(res.bytes);
  } catch (e) {
    return handleNotLzh(c, i, entry, res, e);
  }
  c.consecutiveNotLzh = 0;
  // 日全体が未確定なのは、確定した会場が1つも無い場合だけ（会場ごとに判定。中止・順延の会場があるだけの日を、
  // 捨てない。ブロックが読み取れない想定外の形式は、従来どおり、ファイル全体のマーカーで判定する）
  const kVenues = kind === "K" ? classifyKFileVenues(text) : null;
  if (
    kind === "K" &&
    (kVenues.allPending ||
      (kVenues.total === 0 && text.includes(PENDING_MARKER)))
  ) {
    appendJsonl(c.manifestFile, {
      ...entry,
      status: "pending",
      bytes: res.bytes.length,
    });
    c.stats.pending++;
    console.log(
      `[${i + 1}/${c.todo.length}] ${date} ${kind} 未確定（プレースホルダ）。保存しません`,
    );
  } else {
    saveFetched(c, i, entry, res, kVenues);
  }
  return null;
}

/** 1件を取りに行く。失敗は netError に入れて返す */
async function fetchTarget(c, url) {
  try {
    return { res: await c.fetchFn(url), netError: null };
  } catch (e) {
    return { res: undefined, netError: e };
  }
}

/** 1件ぶんの処理。止めるなら終了コード、次へ進むなら null、同じ対象をやり直すなら "retry" */
async function downloadOne(c, i) {
  const { date, kind } = c.todo[i];
  if (skipAbsentKDay(c, date, kind)) return null;
  const limited = limitStop(c, c.todo[i]);
  if (limited !== null) return limited;

  const url = buildKbUrl(kind, date);
  const { res, netError } = await fetchTarget(c, url);
  c.stats.requests++;
  c.usedTonight++;
  const fetchedAt = c.nowFn().toISOString();

  const cls = netError
    ? { kind: "network", bad: true, threshold: 3, backoff: true }
    : classifyResponse(res.status);
  const entry = {
    date,
    kind,
    url,
    requested: true,
    fetchedAt,
    http: res?.status ?? null,
    ms: res?.ms ?? null,
  };

  if (cls.bad) {
    const code = await handleBadResponse(c, i, entry, cls, res, netError);
    return code ?? "retry"; // 同じ対象をやり直す（連続失敗の上限で必ず止まる）
  }
  c.consecutiveBad = 0;
  c.badKind = null;

  const code =
    cls.kind === "absent"
      ? handleAbsent(c, i, entry)
      : await handleFetched(c, i, entry, res);
  if (code !== null) return code;
  await pace(c);
  return null;
}

/**
 * @param {object} opts
 * @param {{sleep?: Function, fetchOnce?: Function, now?: () => Date, backoffBaseMs?: number}} [deps] テスト用の差し替え
 */
export async function cmdDownload(opts, deps = {}) {
  const sleepFn = deps.sleep ?? sleep;
  const fetchFn = deps.fetchOnce ?? fetchOnce;
  const nowFn = deps.now ?? (() => new Date());
  const backoffBaseMs = deps.backoffBaseMs ?? 30000;
  const manifestFile = manifestPath(opts.archiveDir);
  const manifest = latestManifest(readJsonl(manifestFile));
  const todo = planDownload({
    from: opts.from,
    to: opts.to,
    kinds: opts.kinds,
    manifest,
  });
  const win = parseWindow(opts.window);
  logDownloadPlan(opts, todo);
  if (opts.dryRun) {
    console.log(
      "[DRY-RUN] ネットワーク・書き込みなし。先頭5件:",
      JSON.stringify(todo.slice(0, 5)),
    );
    return 0;
  }
  if (todo.length === 0) {
    console.log("未取得はありません（完了済み）");
    return 0;
  }

  // 実行中の状態（取得ループの各段が読み書きする）
  const c = {
    opts,
    sleepFn,
    fetchFn,
    nowFn,
    backoffBaseMs,
    manifestFile,
    manifest,
    todo,
    win,
    runId: new Date().toISOString().replace(/[:.]/g, "-"),
    stats: { requests: 0, ok: 0, absent: 0, pending: 0, error: 0, skipped: 0 },
    consecutiveBad: 0,
    badKind: null,
    consecutiveNotLzh: 0,
    consecutiveAbsent: 0, // 404が続くのは、URL構造の変更やアクセス制限の疑い（ボートレースは毎日どこかで開催）
    skipB: new Set(), // Kが404の日（開催なし）はBを取得しない
    usedTonight: 0,
  };
  c.usedTonight = nightCount(c);

  for (let i = 0; i < todo.length; i++) {
    const code = await downloadOne(c, i);
    if (code === "retry") i--;
    else if (code !== null) return code;
  }
  return finishDownload(c);
}
