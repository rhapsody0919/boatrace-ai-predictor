/**
 * Supabase クライアント（フロントエンド用）
 *
 * 環境変数:
 *   VITE_SUPABASE_URL - Supabase プロジェクトURL
 *   VITE_SUPABASE_ANON_KEY - Supabase anon key（公開キー）
 *
 * ## 取得エラーは必ず例外になる（BOA-359、2026-09-23）
 *
 * このモジュールが返すクライアントは、`.from()` / `.rpc()` の結果に
 * supabase-js 標準の `.throwOnError()` を**既定で**適用する。
 * クエリが失敗したら戻り値ではなく例外（PostgrestError）になる。
 *
 * なぜ既定にするか:
 *   supabase-js は失敗を例外ではなく `{ data, error }` で返すため、
 *   「error を無視する」が最も短く書ける既定の書き方になっていた。その結果、
 *   取得失敗が `[]` / `null` という「データなし」に化け、しかも withCache が
 *   それを 30分〜7日 保存するため、リロードしても直らない誤表示として固着した。
 *   2026-09-23の実測では、supabaseDataService.js の91クエリのうち
 *   70件が握りつぶし・6件がerrorを参照すらしておらず、失敗の表現が11方言に
 *   分裂していた（77件中73件は呼び出し側から失敗を検知できない状態）。
 *   同型の障害は BOA-291 / 301 / 352 / 356 / 359 / 369 / 372 と、
 *   フロント・バッチ・監視・CIの4層で再発している。
 *
 * 呼び出し側への影響:
 *   **成功時の戻り値の形は変わらない。** `const { data, error } = await supabase
 *   .from(...)` はそのまま動き、`error` が非nullになる前に例外が出るだけになる。
 *   そのため既存の呼び出し側は書き換え不要（`if (error)` の分岐は到達しなくなる）。
 *
 * エラーの内容で分岐したい場合:
 *   try/catch で捕まえて `err.code`（例: 権限エラーは "42501"）を見る。
 *   実例は supabaseDataService.js の getRacePitReport（権限エラーだけ
 *   「セクションを出さない」に倒す）。
 *
 * 新しいクエリを書くときの決まり:
 *   `createClient()` を src/ 配下で直接呼ばない。必ずこのモジュールの
 *   `supabase` を import する。`npm run verify:query-errors` が機械検査する。
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase環境変数が設定されていません。JSON モードで動作します。",
  );
}

// `.from(table)` が返す QueryBuilder は `.throwOnError()` を持たない
// （PostgrestBuilder を継承していないため）。select/insert/update/upsert/delete が
// 返す FilterBuilder 以降が持つので、そこに付ける。
const BUILDER_ENTRY_METHODS = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
];

function applyThrowOnError(queryBuilder) {
  for (const method of BUILDER_ENTRY_METHODS) {
    if (typeof queryBuilder[method] !== "function") continue;
    const original = queryBuilder[method].bind(queryBuilder);
    queryBuilder[method] = (...args) => original(...args).throwOnError();
  }
  return queryBuilder;
}

function createThrowingClient(url, key) {
  const client = createClient(url, key);

  const rawFrom = client.from.bind(client);
  client.from = (table) => applyThrowOnError(rawFrom(table));

  const rawRpc = client.rpc.bind(client);
  client.rpc = (...args) => rawRpc(...args).throwOnError();

  return client;
}

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createThrowingClient(supabaseUrl, supabaseAnonKey)
    : null;
