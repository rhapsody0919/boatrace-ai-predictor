/**
 * 取得先への取得の数を数え、fetch_counts（マイグレーション185）へ足す（BOA-1145 P3 = spec §7.1 の M2、ADR-0101 決定2・7）。
 *
 * politeFetch が1回の fetch（再試行・カナリアも1件）ごとに add({url, status, error}) を呼ぶ。キーは JST の日・時・ホスト・パス・
 * 応答の種類・経路。flush() で、溜まった分を1回の RPC（add_fetch_counts）で足す。何も数えていなければ書かない（取得0の起動は書かない）。
 *
 * 数えるのは監視のためで、取得の可否には使わない。そのため、どの失敗でも例外を投げない（警告だけ）:
 *   - RPC が無い（185 の前。PGRST202・42883、関数名つき）: そのプロセスでは数えるのをやめる（溜まった分も捨てる）
 *   - その他の失敗: 溜まった分を戻して次の flush でもう一度足す（上限 maxPending 行。超えたら古い分を捨てて警告）
 */
import { toJstDateString } from "./time.js";
import { isScrapeSchemaMissingError } from "./schemaErrors.js";

export const FETCH_COUNT_RPC = "add_fetch_counts";

/** 応答の種類（fetch_counts.kind の CHECK と同じ） */
export function fetchKindOf({ status, error } = {}) {
  if (error || typeof status !== "number") return "network";
  if (status >= 200 && status < 400) return "ok";
  if (status === 404) return "not_found";
  if (status === 403) return "blocked";
  if (status === 429 || status === 503) return "overload";
  if (status >= 500) return "server_error";
  return "client_error";
}

/** ホスト（www・www1 を外す）とパス（2桁以上の数字の並びを {n} にまとめる。odds3t の 3 は残す。BOATCAST のファイル名の日付・会場で行が増え続けないように） */
export function fetchTargetOf(url) {
  const u = new URL(url);
  return {
    host: u.hostname.replace(/^www\d*\./, ""),
    path: u.pathname.replace(/\d{2,}/g, "{n}"),
  };
}

/** JST の日（YYYY-MM-DD）と時（0〜23） */
export function jstDayHour(date) {
  const day = toJstDateString(date);
  const hour = new Date(date.getTime() + 9 * 3600 * 1000).getUTCHours();
  return { day, hour };
}

/**
 * @param {Object} params
 * @param {{rpc: Function} | null} params.client Supabase（無ければ数えるだけで書かない）
 * @param {"vercel"|"live"|"gha"} params.source
 * @param {() => Date} [params.now]
 * @param {number} [params.flushEvery] maybeFlush が書く件数（溜まった取得の数）
 * @param {number} [params.flushAfterMs] maybeFlush が書く経過時間（最初に溜まってから）
 * @param {number} [params.maxPending] 書けないときに持ち越す行の上限
 */
export function createFetchCounter({
  client,
  source,
  now = () => new Date(),
  flushEvery = 20,
  flushAfterMs = 60 * 1000,
  maxPending = 2000,
  logger = console,
} = {}) {
  /** @type {Map<string, {day: string, hour: number, host: string, path: string, kind: string, source: string, count: number}>} */
  let pending = new Map();
  let pendingFetches = 0;
  let firstPendingAt = null;
  let disabled = false;
  let flushing = null;

  const add = ({ url, status, error } = {}) => {
    if (disabled) return;
    let target;
    try {
      target = fetchTargetOf(url);
    } catch {
      return;
    }
    const t = now();
    const { day, hour } = jstDayHour(t);
    const kind = fetchKindOf({ status, error });
    const key = [day, hour, target.host, target.path, kind, source].join(
      "\u0000",
    );
    const row = pending.get(key);
    if (row) row.count++;
    else {
      if (pending.size >= maxPending) {
        logger?.warn?.(
          `⚠️ fetch_counts: 持ち越しが上限（${maxPending}行）に達したので、新しいキーを数えない`,
        );
        return;
      }
      pending.set(key, { day, hour, ...target, kind, source, count: 1 });
    }
    pendingFetches++;
    if (firstPendingAt === null) firstPendingAt = t.getTime();
  };

  const flush = async () => {
    if (flushing) return flushing;
    if (disabled || pending.size === 0 || !client) return 0;
    const rows = [...pending.values()];
    pending = new Map();
    pendingFetches = 0;
    firstPendingAt = null;
    flushing = (async () => {
      try {
        const { error } = await client.rpc(FETCH_COUNT_RPC, { p_rows: rows });
        if (!error) return rows.length;
        if (isScrapeSchemaMissingError(error, [FETCH_COUNT_RPC])) {
          disabled = true;
          logger?.warn?.(
            "⚠️ fetch_counts: add_fetch_counts が無い（マイグレーション185の前）。このプロセスでは数えない",
          );
          return 0;
        }
        throw new Error(error.message ?? String(error));
      } catch (e) {
        // 戻して次に足す（取得は止めない）
        for (const r of rows) {
          const key = [r.day, r.hour, r.host, r.path, r.kind, r.source].join(
            "\u0000",
          );
          const cur = pending.get(key);
          if (cur) cur.count += r.count;
          else if (pending.size < maxPending) pending.set(key, r);
          pendingFetches += r.count;
        }
        if (firstPendingAt === null) firstPendingAt = now().getTime();
        logger?.warn?.(
          `⚠️ fetch_counts の書き込みに失敗（次に持ち越す）: ${e?.message ?? e}`,
        );
        return 0;
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  };

  /** 溜まった取得が flushEvery 件以上、または最初に溜まってから flushAfterMs 以上なら書く（/api/odds/live 用） */
  const maybeFlush = async () => {
    if (pendingFetches === 0) return 0;
    if (
      pendingFetches >= flushEvery ||
      (firstPendingAt !== null &&
        now().getTime() - firstPendingAt >= flushAfterMs)
    ) {
      return flush();
    }
    return 0;
  };

  return {
    add,
    flush,
    maybeFlush,
    /** テスト・診断用 */
    snapshot: () => ({ rows: [...pending.values()], pendingFetches, disabled }),
  };
}
