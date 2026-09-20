/**
 * 結果系の新しい列・テーブル（マイグレーション077〜079）が、接続先のDBに適用済みかの判定。
 *
 * 目的: マイグレーションの適用前後どちらでも、結果取得が壊れない・意味の違う行を書かない。
 * 077の列が無いのに、STの無い艇（欠場・出遅れ）の行だけ書くと、旧形式の読み手には「ST不明の行」が
 * 混ざるため、列が適用されているときだけ、全艇の行を書く。scripts/lib/optionalColumns.js の
 * 「列が無いエラーを見て除く」方式は、書き込む行の集合そのものを切り替える今回の用途には向かないため、
 * 先に、対象の列・テーブルを1回読んで（行は取らない）判定する。
 *
 * 判定は、クライアントごとに一定時間キャッシュする（適用の反映を待つのは数分で足りる。結果取得は毎分動くため、
 * 毎回の確認は避ける）。確認自体が失敗した（通信エラー等）場合は、適用済みとは扱わず（旧形式で書く=安全側）、
 * キャッシュもしない。
 */

import { isColumnMissingError } from "./optionalColumns.js";

/** 判定の対象。columns が空なら、テーブルの存在だけを見る */
export const RESULT_SCHEMA_TARGETS = Object.freeze({
  timings: {
    table: "race_start_timings",
    columns: ["finish_mark", "finish_rank", "entry_course", "race_seconds"],
    migration: "077",
  },
  results: {
    table: "race_results",
    columns: ["race_status", "refund_boats", "remark"],
    migration: "078",
  },
  payouts: {
    table: "race_payouts",
    columns: ["race_id", "bet_type", "seq", "payout_status"],
    migration: "079",
  },
});

export const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

const TABLE_MISSING_CODES = new Set(["42P01", "PGRST205"]);

/** テーブルが無いことを示すエラーか（PostgRESTは PGRST205「Could not find the table」、直接は 42P01） */
function isTableMissingError(error, table) {
  if (!error) return false;
  const message = error.message ?? "";
  if (!new RegExp(`(?<![A-Za-z0-9_])${table}(?![A-Za-z0-9_])`).test(message)) {
    return false;
  }
  return (
    TABLE_MISSING_CODES.has(error.code) ||
    /Could not find the table|does not exist/i.test(message)
  );
}

/** @type {WeakMap<object, {at: number, value: Record<string, boolean>}>} */
const cache = new WeakMap();

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{now?: () => number, ttlMs?: number, warn?: (message: string) => void}} [options]
 * @returns {Promise<{timings: boolean, results: boolean, payouts: boolean}>}
 *   各マイグレーション（077・078・079）が適用済みか。確認に失敗したものは false
 */
export async function detectResultSchema(
  client,
  {
    now = () => Date.now(),
    ttlMs = SCHEMA_CACHE_TTL_MS,
    warn = (m) => console.warn(m),
  } = {},
) {
  const cached = cache.get(client);
  if (cached && now() - cached.at < ttlMs) return cached.value;

  const value = {};
  let definite = true;
  for (const [key, target] of Object.entries(RESULT_SCHEMA_TARGETS)) {
    // limit(0): 行は取らないが、列・テーブルの有無は検査される。HEADリクエストは、エラー時に本文が空で
    // 「列が無い」エラーの内容を読めないため、GETで確認する
    const { error } = await client
      .from(target.table)
      .select(target.columns.join(","))
      .limit(0);
    if (!error) {
      value[key] = true;
    } else if (
      isTableMissingError(error, target.table) ||
      isColumnMissingError(error, target.columns)
    ) {
      value[key] = false;
    } else {
      // 通信エラー等。適用状況が分からないため、旧形式で書く（安全側）。キャッシュしない
      value[key] = false;
      definite = false;
      warn(
        `⚠️ マイグレーション${target.migration}の適用状況を確認できません（旧形式で書きます）: ${error.message}`,
      );
    }
  }
  if (definite) cache.set(client, { at: now(), value });
  return value;
}

/** テスト用: キャッシュを捨てる（WeakMap は列挙できないため、クライアントを指定する） */
export function clearResultSchemaCache(client) {
  cache.delete(client);
}
