/**
 * SNSマーケティングハブ Phase 2用 sns_strategy_insights 共通操作関数
 *
 * scripts/lib/supabaseClient.jsの既存パターンに従う（Node.jsバッチ処理・Routine用、
 * api/_lib/snsHubHelpers.jsとは別系統。Edge Function側は生fetch経由でREST APIを叩く
 * 既存方針のため、こちらはNode.js実行環境専用）。
 */

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

const TABLE = "sns_strategy_insights";
const PROMOTION_WINDOW_DAYS = 7;

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
 * 週次昇格判定の対象（status=proposedかつ提案から一定期間経過）を取得する。
 * @returns {Promise<Array>}
 */
export async function getProposedInsightsForPromotion() {
  assertSupabaseEnabled();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PROMOTION_WINDOW_DAYS);
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("status", "proposed")
    .lte("created_at", cutoff.toISOString());
  if (error) {
    throw new Error(`${TABLE}取得エラー（proposed）: ${error.message}`);
  }
  return data || [];
}

/** insightをactiveへ昇格する */
export async function activateInsight(id) {
  assertSupabaseEnabled();
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    throw new Error(`insight昇格エラー(${id}): ${error.message}`);
  }
}

/**
 * insightをretiredにする（risk-rules抵触時の自動却下、または人間による却下操作の両方で使う）
 * @param {string} id
 * @param {string} [decisionNote] - 却下理由（任意）
 */
export async function retireInsight(id, decisionNote) {
  assertSupabaseEnabled();
  const { error } = await supabase
    .from(TABLE)
    .update({
      status: "retired",
      retired_at: new Date().toISOString(),
      ...(decisionNote ? { decision_note: decisionNote } : {}),
    })
    .eq("id", id);
  if (error) {
    throw new Error(`insight却下エラー(${id}): ${error.message}`);
  }
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
