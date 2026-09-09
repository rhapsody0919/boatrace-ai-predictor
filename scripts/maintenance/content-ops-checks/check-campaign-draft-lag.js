/**
 * 稼働中の企画（sns_campaigns）のネタのうち、承認済み（ネタ承認済み）なのに
 * チャネル別生成Routineが下書きをまだ作っていないもの（sns_topic_targets.status
 * が'pending'のまま一定時間経過）を検知する。
 *
 * 背景（2026-09-09、天才エンジニアレビューで指摘）: 企画のネタ生成は、この
 * リポジトリのGitHub Actionsではなく、外部の生成Routine（claude.aiの
 * スケジュール実行機能、sns-topic-gate基盤）が自律的にポーリングして担う設計。
 * そのRoutine自体の稼働状況を監視する仕組みがこれまで無く、もし停止しても
 * 「ネタは自動で作られるが下書きが永遠に生成されない」まま誰にも気づかれない
 * リスクがあった。Routineを直接監視する手段はこちらには無いため、症状
 * （承認済みなのに下書きが作られていない）で間接的に検知する。
 */

import { supabase } from "../../lib/supabaseClient.js";
import { getActiveCampaigns } from "../../lib/snsCampaigns.js";

const STALE_HOURS = 3;

export async function checkCampaignDraftLag() {
  try {
    const campaigns = await getActiveCampaigns();
    if (campaigns.length === 0) {
      return { staleCount: 0, staleThresholdHours: STALE_HOURS, items: [] };
    }

    const { data: topics, error } = await supabase
      .from("sns_topics")
      .select(
        "id, topic_text, approved_at, campaign_id, sns_topic_targets(id, status, created_at)",
      )
      .in(
        "campaign_id",
        campaigns.map((c) => c.id),
      )
      .eq("status", "approved");
    if (error) throw error;

    const staleThresholdMs = Date.now() - STALE_HOURS * 60 * 60 * 1000;
    const items = [];
    for (const topic of topics || []) {
      const stalePendingTargets = (topic.sns_topic_targets || []).filter(
        (t) =>
          t.status === "pending" &&
          new Date(t.created_at).getTime() < staleThresholdMs,
      );
      if (stalePendingTargets.length > 0) {
        items.push({
          topicId: topic.id,
          topicText: topic.topic_text,
          approvedAt: topic.approved_at,
          stalePendingTargetCount: stalePendingTargets.length,
        });
      }
    }

    return {
      staleCount: items.length,
      staleThresholdHours: STALE_HOURS,
      items,
    };
  } catch (error) {
    return {
      staleCount: 0,
      staleThresholdHours: STALE_HOURS,
      items: [],
      error: error.message,
    };
  }
}
