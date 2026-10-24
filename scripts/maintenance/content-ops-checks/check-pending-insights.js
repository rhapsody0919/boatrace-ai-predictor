/**
 * sns_strategy_insights の status='proposed'（要判断、承認待ち）件数を取得する。
 *
 * 背景: PR #514で「戦略メモ」タブに手動採用ボタンを追加したが、tweet-drafts.md
 * （最大38件滞留の実績）・X動画投稿・TikTok投稿と同じ「セッション開始時チェックが
 * 無いと人間が承認を忘れて滞留する」パターンがそのまま再発するリスクがあった
 * （2026-09-05、実際にtiktok分2件が発見のまま滞留していた実績で発覚）。
 */

import { getProposedInsights } from "../../lib/snsStrategyInsights.js";

export async function checkPendingInsights() {
  try {
    const proposed = await getProposedInsights();
    return {
      pendingCount: proposed.length,
      oldest: proposed[0]
        ? {
            id: proposed[0].id,
            platform: proposed[0].platform,
            insightText: proposed[0].insight_text,
            createdAt: proposed[0].created_at,
          }
        : null,
    };
  } catch (error) {
    return { pendingCount: 0, oldest: null, error: error.message };
  }
}
