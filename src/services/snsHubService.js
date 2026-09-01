/**
 * SNSマーケティングハブ 管理画面用サービス層
 *
 * 既存のruleMatchService.js等と異なり、Supabaseを直接呼ばず /api/admin/sns-hub/* を
 * 経由する薄いラッパー（ADR 0021: フロントエンドにService Role Keyを露出させないため）。
 */

const BASE_URL = "/api/admin/sns-hub";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  let body;
  try {
    body = await response.json();
  } catch {
    // Vite開発サーバー等、Vercel Edge Functionsが実行されない環境ではSPA
    // フォールバック(HTML)が返り、JSONとして解釈できない。無効な応答として扱う
    throw new Error(`APIから予期しない応答がありました (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      body.error || `リクエストに失敗しました (${response.status})`,
    );
  }
  return body;
}

/**
 * 下書き一覧を取得する
 * @param {string} [status] - 'pending_review' | 'revision_requested' | 'approved' | 'ready_to_post' | 'posted' | 'archived' | 'all'(文字通り全件) | undefined(archivedを除く全件、2026-09-01〜)
 */
export async function getDrafts(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data } = await request(`/drafts${query}`);
  return data || [];
}

/** 承認者マスタ一覧を取得する（タップ選択の選択肢） */
export async function getApprovers() {
  const { data } = await request("/approvers");
  return data || [];
}

/** 下書きを承認する */
export async function approveDraft(draftId, approverId) {
  return request(`/drafts/${draftId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approverId }),
  });
}

/** 下書きに一部修正を指摘する */
export async function reviseDraft(
  draftId,
  { approverId, reasonCodes, freeText, saveAsInsight },
) {
  return request(`/drafts/${draftId}/revise`, {
    method: "POST",
    body: JSON.stringify({ approverId, reasonCodes, freeText, saveAsInsight }),
  });
}

/** 下書きを全部作り直す */
export async function redoDraft(
  draftId,
  { approverId, freeText, saveAsInsight },
) {
  return request(`/drafts/${draftId}/redo`, {
    method: "POST",
    body: JSON.stringify({ approverId, freeText, saveAsInsight }),
  });
}

/** 下書きを投稿済みにする */
export async function markDraftPosted(draftId, postedAt) {
  return request(`/drafts/${draftId}/mark-posted`, {
    method: "POST",
    body: JSON.stringify(postedAt ? { postedAt } : {}),
  });
}

/** 下書きを一覧から非表示にする（アーカイブ化、実データは残る） */
export async function archiveDraft(draftId) {
  return request(`/drafts/${draftId}/archive`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * 生成Routineを手動起動する（承認済みストックが少ない時の補充用）
 * @param {'daily'|'evergreen'} mode
 */
/**
 * @param {string} mode - 'daily' | 'evergreen'
 * @param {object} [options]
 * @param {string[]} [options.platforms] - 省略時はAPI側で全プラットフォーム対象になる
 * @param {number} [options.count] - 省略時はAPI側のデフォルト範囲になる
 */
export async function triggerGeneration(mode, { platforms, count } = {}) {
  return request("/generate", {
    method: "POST",
    body: JSON.stringify({ mode, platforms, count }),
  });
}

/** TikTok等のエンゲージメント指標を手動入力する */
export async function addDraftMetric(
  draftId,
  { metricName, metricValue, source = "manual" },
) {
  return request(`/drafts/${draftId}/metrics`, {
    method: "POST",
    body: JSON.stringify({ metricName, metricValue, source }),
  });
}

/**
 * 「戦略メモ」insight一覧を取得する
 * @param {string} [status] - 'proposed' | 'active' | 'retired' | undefined(全件)
 */
export async function getInsights(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data } = await request(`/insights${query}`);
  return data || [];
}

/** insightを却下する（理由は任意） */
export async function rejectInsight(insightId, reason) {
  return request(`/insights/${insightId}/reject`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/** 「フォーマットカタログ」タブ用、型(sns_template_variants)の一覧を取得する */
export async function getTemplateVariants() {
  const { data } = await request("/template-variants");
  return data || [];
}
