// 選手ニュース自動収集の冪等性チェック
// docs/adr/0025-racer-news-dedup-without-new-table.md 参照
//
// 処理済み判定は新規テーブルを作らず、既存の racer_news.source_url の一意性と
// 要確認リスト（従来は pending.json。Vercel では DB の表 racer_news_pending）の記録内容だけで行う。

import { supabase } from "../supabaseClient.js";
import { createFilePendingStore } from "./pendingReview.js";

/**
 * 指定したsource_urlが「公開済み」または「保留中として記録済み」かどうかを判定する
 * @param {string} sourceUrl
 * @param {Object} [options] 省略時は従来どおり（pending.json・モジュールの supabase）
 * @param {import("@supabase/supabase-js").SupabaseClient|null} [options.client]
 * @param {ReturnType<typeof createFilePendingStore>} [options.pendingStore]
 * @returns {Promise<boolean>} 既に処理済みならtrue（再処理不要）
 */
export async function isAlreadyProcessed(
  sourceUrl,
  { client = supabase, pendingStore = createFilePendingStore() } = {},
) {
  if (await pendingStore.hasItemForSourceUrl(sourceUrl)) {
    return true;
  }

  if (!client) {
    console.warn(
      "⚠️ Supabase未設定のため重複チェックをスキップし、未処理として扱いません（安全側に倒して処理済み扱い）",
    );
    return true;
  }

  const { data, error } = await client
    .from("racer_news")
    .select("id")
    .eq("source_url", sourceUrl)
    .limit(1);

  if (error) {
    throw new Error(`racer_newsの重複チェックに失敗しました: ${error.message}`);
  }

  return data.length > 0;
}
