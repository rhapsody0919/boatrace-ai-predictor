import { VENUE_NAMES } from "./venueNames.js";
/**
 * バッチ処理用 Supabaseクライアント
 *
 * 環境変数:
 *   SUPABASE_URL - Supabase URL
 *   SUPABASE_SERVICE_KEY - Service Role Key (書き込み権限あり)
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local を読み込み
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    "⚠️ Supabase環境変数が未設定です。Supabaseへの書き込みはスキップされます。",
  );
}

// ⚠️ 2026-08-13判明: デフォルトのfetch（Node.js標準/undici）だと、多数のレースを
// 連続処理するバッチ（generate-unified-trifecta-reference.js等）で、ランダムなタイミングで
// リクエストが無期限にハングする不具合が発生した（9レース目、5レース目等、再現性のない箇所で発生）。
// タイムアウト付きfetchを注入し、一定時間内にレスポンスが無ければAbortErrorとして処理を継続できるようにする
const FETCH_TIMEOUT_MS = 15000;
function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId),
  );
}

export const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        global: { fetch: fetchWithTimeout },
      })
    : null;

export const isSupabaseEnabled = () => !!supabase;

/**
 * fetchAll のクエリに並び順があるかを確かめる（BOA-753）。無ければ、呼び出し元と直し方を書いて例外を投げる。
 * URL を持たないクエリ（テストの偽のクライアント）は判定しない
 */
function assertOrdered(table, query) {
  const url = query?.url;
  if (!(url instanceof URL)) return;
  if (url.searchParams.get("order")) return;
  const caller =
    new Error().stack
      ?.split("\n")
      .slice(1)
      .map((l) => l.trim())
      .find((l) => !l.includes("supabaseClient.js")) ?? "(不明)";
  throw new Error(
    `${table}: fetchAll に並び順（.order()）がありません。1000行を超えるとページの間で行が重複・欠落します（BOA-753）。` +
      `buildQuery で主キーの .order() を付けてください（例: (q) => q.order("race_id")）。呼び出し元: ${caller}`,
  );
}

/**
 * ページネーション付きデータ一括取得
 *
 * @param {string} table - テーブル名
 * @param {string} select - selectカラム
 * @param {Function} [buildQuery] - クエリビルダー関数
 * @param {{ throwOnError?: boolean, client?: import("@supabase/supabase-js").SupabaseClient, unordered?: string }} [options] - throwOnError: 取得エラー時に部分結果を
 *   返さず例外を投げる（既定 true。BOA-391）。false は、取得の失敗を「途中までの結果」として扱ってよいことを
 *   呼び出し側が理由付きで示すときだけ指定する（部分結果が「全件」に化けるため、既定にしない）。client: テスト・共通ラッパ用のクライアントの差し替え（既定は本ファイルの supabase）。
 *   unordered: 並び順なしを許す理由（空でない文字列）。並び順の要らない読み取りだけで使う（下の「並び順」）
 * @returns {Promise<Array>}
 *
 * 並び順（BOA-753）: buildQuery で必ず .order() を付ける（主キーが確実）。並び順が無いと、PostgREST は行の順を決めないので、
 * 1000行を超える読み取りでページの間に行の重複・欠落が起きうる（BOA-595・BOA-745 で同じ型を個別に直した）。
 * 付いていなければ、最初のリクエストの前に例外を投げる（fail fast）。テストの偽のクライアント（URL を持たない）は判定しない。
 * 呼び出しの書き方は verify-fetchall-order.js が静的にも検査する
 */
export async function fetchAll(
  table,
  select,
  buildQuery,
  { throwOnError = true, client = supabase, unordered } = {},
) {
  if (
    unordered !== undefined &&
    !(typeof unordered === "string" && unordered.trim())
  ) {
    throw new Error(
      `${table}: fetchAll の unordered には、並び順なしを許す理由を書いてください（BOA-753）`,
    );
  }
  const allData = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = client
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (buildQuery) q = buildQuery(q);
    if (from === 0 && !unordered) assertOrdered(table, q);
    const { data, error } = await q;
    if (error) {
      if (throwOnError) throw new Error(`${table}取得エラー: ${error.message}`);
      console.error(`${table} 取得エラー:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

/**
 * 会場コード→会場名のマッピング
 */
export { VENUE_NAMES } from "./venueNames.js";

/**
 * 会場名→会場コードの逆引き
 */
export const VENUE_CODES = Object.fromEntries(
  Object.entries(VENUE_NAMES).map(([code, name]) => [name, parseInt(code)]),
);
