/**
 * 「マイグレーションの列・テーブルが、接続先のDBに適用済みか」の判定（共通処理）
 *
 * 目的: マイグレーションの適用前後どちらでも、取得が壊れない・意味の違う行を書かない。対象の列・テーブルを
 * 1回読んで（行は取らない）判定し、適用済みの列だけを書く。scripts/lib/optionalColumns.js の「列が無いエラーを
 * 見て除く」方式は、書き込みに失敗した後に除いて書き直すため、変更判定（scripts/lib/unchangedRows.js）が
 * 「未適用の列を含む既存行の取得」に失敗して全行を書く状態になる。先に判定すれば、未適用でも変更の無い行を書かない。
 * （結果系は scripts/lib/raceResultSchema.js が同じ方式。本ファイルはその汎用版で、直前情報・出走表系
 * scripts/lib/preRaceSchema.js が使う）
 *
 * 判定は、クライアントごとに一定時間キャッシュする（適用の反映を待つのは数分で足りる）。確認自体が失敗した
 * （通信エラー等）場合は、適用済みとは扱わず（旧形式で書く=安全側）、キャッシュもしない。
 */

import { isColumnMissingError } from "./optionalColumns.js";

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

export const DEFAULT_SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 判定の対象ごとに、判定器を作る。キャッシュは判定器ごと（=対象の集合ごと）に持つ。
 *
 * @param {Readonly<Record<string, {table: string, columns: string[], migration: string}>>} targets
 *   columns が空なら、テーブルの存在だけを見る
 * @returns {{
 *   detect: (client: import("@supabase/supabase-js").SupabaseClient, options?: {now?: () => number, ttlMs?: number, warn?: (message: string) => void}) => Promise<Record<string, boolean>>,
 *   clear: (client: object) => void,
 * }}
 */
export function createSchemaDetector(targets) {
  /** @type {WeakMap<object, {at: number, value: Record<string, boolean>}>} */
  const cache = new WeakMap();

  async function detect(
    client,
    {
      now = () => Date.now(),
      ttlMs = DEFAULT_SCHEMA_CACHE_TTL_MS,
      warn = (m) => console.warn(m),
    } = {},
  ) {
    const cached = cache.get(client);
    if (cached && now() - cached.at < ttlMs) return cached.value;

    const value = {};
    let definite = true;
    for (const [key, target] of Object.entries(targets)) {
      // limit(0): 行は取らないが、列・テーブルの有無は検査される。HEADリクエストは、エラー時に本文が空で
      // 「列が無い」エラーの内容を読めないため、GETで確認する
      let error;
      try {
        ({ error } = await client
          .from(target.table)
          .select(target.columns.length > 0 ? target.columns.join(",") : "*")
          .limit(0));
      } catch (thrown) {
        // 通信例外・クライアントの差し替え（テスト）で、確認できない。適用済みとは扱わない
        error = { message: thrown?.message ?? String(thrown) };
      }
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

  return { detect, clear: (client) => cache.delete(client) };
}
