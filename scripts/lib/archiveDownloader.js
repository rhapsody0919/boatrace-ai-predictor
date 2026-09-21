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

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  inWindow,
  parseWindow,
  windowDayKey,
  classifyResponse,
  estimatePlan,
} from "../maintenance/kb-backfill.js";

export { inWindow, parseWindow, windowDayKey, classifyResponse, estimatePlan };

/** 公式サイトへの最小間隔（ADR-0067）。これ未満は指定できない */
export const HARD_MIN_INTERVAL_MS = 3000;
export const FETCH_TIMEOUT_MS = 45000;
/** 完了: ok、または404が確定（想定内の404=未公開は、次回以降も再試行する） */
export const isDone = (s) =>
  s && (s.status === "ok" || (s.status === "absent" && !s.expected));

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (buf) =>
  crypto.createHash("sha256").update(buf).digest("hex");

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${file} の${i + 1}行目が不正なJSONです: ${e.message}`);
      }
    });
}

export const appendJsonl = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
};

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
  const sleepFn = deps.sleep ?? sleepDefault;
  const fetchFn = deps.fetchOnce ?? ((url) => fetchOnce(url, userAgent));
  const nowFn = deps.now ?? (() => new Date());
  const backoffBaseMs = deps.backoffBaseMs ?? 30000;
  const log = deps.log ?? console.log;
  const win = parseWindow(opts.window);
  // マニフェスト（追記のみ）の項目ごとの最新が、状態
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
    return 0;
  }
  if (todo.length === 0) {
    log("未取得はありません（完了済み）");
    return 0;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const stats = { requests: 0, ok: 0, absent: 0, pending: 0, error: 0 };
  let consecutiveBad = 0;
  let badKind = null;
  let consecutiveInvalid = 0;
  let consecutiveAbsent = 0;
  const pace = () =>
    sleepFn(
      opts.intervalMinMs +
        Math.random() * (opts.intervalMaxMs - opts.intervalMinMs),
    );
  const nightCount = () => {
    const k = windowDayKey(win, nowFn());
    return readJsonl(manifestFile).filter(
      (e) => e.requested && windowDayKey(win, e.fetchedAt) === k,
    ).length;
  };
  let usedTonight = nightCount();

  const stop = (code, reason, resumeFrom) => {
    log(`\n停止: ${reason}`);
    if (resumeFrom)
      log(`再開: 同じコマンドを再実行（次の対象 ${resumeFrom.key}）`);
    log(`集計: ${JSON.stringify(stats)}`);
    appendJsonl(runsFile, { runId, stopped: reason, stats });
    return code;
  };

  for (let i = 0; i < todo.length; i++) {
    const item = todo[i];
    if (!inWindow(win, nowFn()))
      return stop(2, `実行窓（JST ${opts.window}）の外です`, item);
    if (usedTonight >= opts.dailyLimit)
      return stop(
        2,
        `日次上限 ${opts.dailyLimit} リクエストに到達しました`,
        item,
      );
    if (stats.requests >= opts.maxRequests)
      return stop(2, `--max-requests=${opts.maxRequests} に到達しました`, item);

    let res;
    let netError = null;
    try {
      res = await fetchFn(item.url);
    } catch (e) {
      netError = e;
    }
    stats.requests++;
    usedTonight++;
    const fetchedAt = nowFn().toISOString();
    const cls = netError
      ? { kind: "network", bad: true, threshold: 3, backoff: true }
      : classifyResponse(res.status);
    let entry = {
      key: item.key,
      url: item.url,
      requested: true,
      fetchedAt,
      http: res?.status ?? null,
      ms: res?.ms ?? null,
      lastModified: res?.lastModified ?? null,
    };

    if (cls.bad) {
      consecutiveBad = badKind === cls.kind ? consecutiveBad + 1 : 1;
      badKind = cls.kind;
      entry = {
        ...entry,
        status: "error",
        reason: netError
          ? String(netError.message ?? netError)
          : `HTTP ${res.status}`,
      };
      appendJsonl(manifestFile, entry);
      stats.error++;
      log(
        `[${i + 1}/${todo.length}] ${item.key} ${entry.reason}（連続 ${consecutiveBad}/${cls.threshold}）`,
      );
      if (consecutiveBad >= cls.threshold)
        return stop(
          4,
          `サーキットブレーカー: ${cls.kind} が ${consecutiveBad} 回連続しました。時間を置き、間隔を広げてから再開してください`,
          item,
        );
      if (cls.backoff) {
        const wait = Math.min(
          300000,
          backoffBaseMs * 2 ** (consecutiveBad - 1),
        );
        log(`  バックオフ ${Math.round(wait / 1000)} 秒`);
        await sleepFn(wait);
      } else await pace();
      i--; // 同じ対象をやり直す（連続失敗の上限で必ず止まる）
      continue;
    }
    consecutiveBad = 0;
    badKind = null;

    if (cls.kind === "absent") {
      appendJsonl(manifestFile, {
        ...entry,
        status: "absent",
        expected: isAbsentExpected(item),
      });
      stats.absent++;
      if (isAbsentExpected(item)) {
        log(`[${i + 1}/${todo.length}] ${item.key} 404（未公開。想定内）`);
      } else {
        consecutiveAbsent++;
        log(`[${i + 1}/${todo.length}] ${item.key} 404`);
        if (consecutiveAbsent >= 3)
          return stop(
            4,
            `404が${consecutiveAbsent}回連続しました（URL構造の変更またはアクセス制限の疑い）`,
            todo[i + 1] ?? null,
          );
      }
    } else {
      consecutiveAbsent = 0;
      let verdict = null;
      try {
        verdict = await validate(res.bytes, item);
      } catch (e) {
        appendJsonl(manifestFile, {
          ...entry,
          status: "error",
          reason: `内容が想定外: ${e.message}`,
          bytes: res.bytes.length,
        });
        stats.error++;
        log(`[${i + 1}/${todo.length}] ${item.key} 内容が想定外: ${e.message}`);
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
      if (verdict.status === "pending") {
        appendJsonl(manifestFile, {
          ...entry,
          status: "pending",
          bytes: res.bytes.length,
          reason: verdict.note ?? null,
        });
        stats.pending++;
        log(
          `[${i + 1}/${todo.length}] ${item.key} 未確定（${verdict.note ?? "pending"}）。保存しません`,
        );
      } else {
        const file = save(item, res.bytes);
        appendJsonl(manifestFile, {
          ...entry,
          status: "ok",
          bytes: res.bytes.length,
          sha256: sha256(res.bytes),
          file,
        });
        stats.ok++;
        log(
          `[${i + 1}/${todo.length}] ${item.key} ok ${res.bytes.length}B ${res.ms}ms lm=${res.lastModified ?? "-"}（今夜 ${usedTonight}/${opts.dailyLimit}）`,
        );
      }
    }
    await pace();
  }
  log(`\n完了: ${JSON.stringify(stats)}`);
  appendJsonl(runsFile, { runId, completed: true, stats });
  // 0件取得のまま「成功」にしない（想定内の404だけの実行は成功）
  if (stats.requests > 0 && stats.ok + stats.absent === 0) return 1;
  return 0;
}
