// 選手ニュース自動収集の冪等性チェック
// docs/adr/0025-racer-news-dedup-without-new-table.md 参照
//
// 処理済み判定は新規テーブルを作らず、既存の racer_news.source_url の一意性と
// pending.json の記録内容だけで行う。

import { supabase, isSupabaseEnabled } from "../supabaseClient.js";
import { hasItemForSourceUrl } from "./pendingReview.js";

/**
 * 指定したsource_urlが「公開済み」または「保留中として記録済み」かどうかを判定する
 * @param {string} sourceUrl
 * @returns {Promise<boolean>} 既に処理済みならtrue（再処理不要）
 */
export async function isAlreadyProcessed(sourceUrl) {
  if (hasItemForSourceUrl(sourceUrl)) {
    return true;
  }

  if (!isSupabaseEnabled()) {
    console.warn(
      "⚠️ Supabase未設定のため重複チェックをスキップし、未処理として扱いません（安全側に倒して処理済み扱い）",
    );
    return true;
  }

  const { data, error } = await supabase
    .from("racer_news")
    .select("id")
    .eq("source_url", sourceUrl)
    .limit(1);

  if (error) {
    throw new Error(`racer_newsの重複チェックに失敗しました: ${error.message}`);
  }

  return data.length > 0;
}
