/**
 * SNSマーケティングハブ Phase 2用 sns_strategy_insights 共通操作関数
 *
 * scripts/lib/supabaseClient.jsの既存パターンに従う（Node.jsバッチ処理・Routine用、
 * api/_lib/snsHubHelpers.jsとは別系統。Edge Function側は生fetch経由でREST APIを叩く
 * 既存方針のため、こちらはNode.js実行環境専用）。
 */

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

const TABLE = "sns_strategy_insights";

function assertSupabaseEnabled() {
  if (!isSupabaseEnabled()) {
    throw new Error(
      "Supabase環境変数（SUPABASE_URL/SUPABASE_SERVICE_KEY）が未設定です。sns_strategy_insightsを操作できません。",
    );
  }
}

/**
 * scopeが一致する（またはnullで全体適用の）activeなinsightを取得する。
 * insight数は週次で数件〜数十件程度の想定のため、絞り込みはJS側で行う
 * （platform/format/languageそれぞれ独立にnull=全体適用というOR条件をSQL側で
 * 組むより単純で読みやすいため）。
 * @param {{platform?: string, format?: string, language?: string}} scope
 * @returns {Promise<Array>}
 */
export async function getActiveInsights({ platform, format, language } = {}) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("status", "active");
  if (error) {
    throw new Error(`${TABLE}取得エラー（active）: ${error.message}`);
  }
  return (data || []).filter(
    (insight) =>
      (insight.platform === null || insight.platform === platform) &&
      (insight.format === null || insight.format === format) &&
      (insight.language === null || insight.language === language),
  );
}

/**
 * status='proposed'（要判断、承認待ち）のinsight件数と一覧を取得する。
 * セッション開始時チェック（session-start-check.js）が、承認待ちinsightを
 * 見落とさず提示するために使う（2026-09-05追加、tweet-drafts.md等と同じ
 * 「セッション開始時チェックが無いと滞留する」パターンの再発防止）。
 * @returns {Promise<Array<{id: string, platform: string|null, insight_text: string, created_at: string}>>}
 */
export async function getProposedInsights() {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, platform, format, language, insight_text, created_at")
    .eq("status", "proposed")
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`${TABLE}取得エラー（proposed）: ${error.message}`);
  }
  return data || [];
}

/**
 * 新規insightを提案する（/x-growth-report・/tiktok-growth-reportからの登録用）
 * @param {{platform?: string, language?: string, format?: string, insightText: string, evidence?: string, source: string, researchMethod?: string}} payload
 */
export async function createInsight({
  platform = null,
  language = null,
  format = null,
  insightText,
  evidence = null,
  source,
  researchMethod = null,
}) {
  assertSupabaseEnabled();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      platform,
      language,
      format,
      insight_text: insightText,
      evidence,
      source,
      research_method: researchMethod,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`insight登録エラー: ${error.message}`);
  }
  return data;
}
