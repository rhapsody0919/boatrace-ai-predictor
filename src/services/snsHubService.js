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
 * @param {string} [status] - 'pending_review' | 'revision_requested' | 'approved' | 'ready_to_post' | 'posted' | 'archived' | undefined(全件)
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
  { approverId, reasonCodes, freeText },
) {
  return request(`/drafts/${draftId}/revise`, {
    method: "POST",
    body: JSON.stringify({ approverId, reasonCodes, freeText }),
  });
}

/** 下書きを全部作り直す */
export async function redoDraft(draftId, { approverId, freeText }) {
  return request(`/drafts/${draftId}/redo`, {
    method: "POST",
    body: JSON.stringify({ approverId, freeText }),
  });
}

/** 下書きを投稿済みにする */
export async function markDraftPosted(draftId, postedAt) {
  return request(`/drafts/${draftId}/mark-posted`, {
    method: "POST",
    body: JSON.stringify(postedAt ? { postedAt } : {}),
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
