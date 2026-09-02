/**
 * sns_draftsの却下・修正依頼履歴（revision_reason_codes/revision_reason_freetext）を
 * 読み出す共通関数。「却下フィードバックの恒久反映」の入口部分（毎回参照）を担う
 * （content-multi-channel-pipeline-prompt.md、既存のX/TikTok側運用プロンプトにも
 * 同じ穴があったため2026-09-02に新設）。
 *
 * revision_reason_codesが埋まった行は、修正依頼時点のstatus
 * （revision_requested、その後Routineが修正版を作る際に旧行はarchivedになる想定、
 * ADR 0020）を問わず「過去に指摘された内容」の記録として残るため、statusでは
 * 絞り込まずrevision_reason_codesの有無だけで判定する。
 */

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";

const TABLE = "sns_drafts";
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 20;

/**
 * @param {{platform?: string, windowDays?: number, limit?: number}} opts
 * @returns {Promise<Array<{id: string, platform: string, format: string|null, title: string|null, revisionReasonCodes: string[], revisionReasonFreetext: string|null, updatedAt: string}>>}
 */
export async function getRecentRevisions({
  platform,
  windowDays = DEFAULT_WINDOW_DAYS,
  limit = DEFAULT_LIMIT,
} = {}) {
  if (!isSupabaseEnabled()) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  let query = supabase
    .from(TABLE)
    .select(
      "id, platform, format, title, revision_reason_codes, revision_reason_freetext, updated_at",
    )
    .not("revision_reason_codes", "is", null)
    .gte("updated_at", cutoff.toISOString())
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (platform) {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`sns_drafts revision履歴取得エラー: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id,
    platform: row.platform,
    format: row.format,
    title: row.title,
    revisionReasonCodes: row.revision_reason_codes || [],
    revisionReasonFreetext: row.revision_reason_freetext,
    updatedAt: row.updated_at,
  }));
}

/**
 * platform:reason_code の組み合わせごとに出現回数を集計する。
 * 閾値エスカレーション判定（check-revision-escalation.js）で使う。
 */
export function countReasonCodes(revisions) {
  const counts = {};
  for (const rev of revisions) {
    for (const code of rev.revisionReasonCodes) {
      const key = `${rev.platform}:${code}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}
