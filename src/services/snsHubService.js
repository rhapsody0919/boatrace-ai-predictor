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

/** ブログ下書きを承認し、対応するDraft PRを自動マージする（platform='blog'専用） */
export async function mergeBlogPr(draftId, approverId) {
  return request(`/drafts/${draftId}/merge-blog-pr`, {
    method: "POST",
    body: JSON.stringify({ approverId }),
  });
}

/** YouTube下書きを承認し、YouTube Data API v3で自動投稿する（platform='youtube'専用） */
export async function publishYoutube(draftId, approverId) {
  return request(`/drafts/${draftId}/publish-youtube`, {
    method: "POST",
    body: JSON.stringify({ approverId }),
  });
}

/**
 * 下書きに修正を指摘する（2026-09-04、旧「一部修正」「全部作り直し」を統合）。
 * saveAsInsight=trueの場合、scopeで反映範囲を選ぶ:
 * 'channel'（既定、この下書きのチャネルのみ）| 'all'（全チャネル共通）
 */
export async function redoDraft(
  draftId,
  { approverId, reasonCodes, freeText, saveAsInsight, scope },
) {
  return request(`/drafts/${draftId}/redo`, {
    method: "POST",
    body: JSON.stringify({
      approverId,
      reasonCodes,
      freeText,
      saveAsInsight,
      scope,
    }),
  });
}

/**
 * 制作仕様の変更要望をLinearに起票する（要件85、2026-09-04新設）。
 * この下書き自体のstatusは変更しない
 */
export async function requestSpecChange(draftId, { approverId, message }) {
  return request(`/drafts/${draftId}/request-spec-change`, {
    method: "POST",
    body: JSON.stringify({ approverId, message }),
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

/**
 * 週次ネタ提案Routine（sns-topic-proposer-weekly）を手動起動する。通常は
 * 週次cronのみで起動するため、承認済みストックが少ない・動作確認したい
 * 場面向け（2026-09-04追加）。ネタ登録のみでdraft生成は行わない
 */
export async function triggerWeeklyProposer() {
  return request("/trigger-weekly-proposer", { method: "POST" });
}

/**
 * 日次・一般ネタ自動提案Routine（sns-topic-proposer-daily-auto）を手動起動する。
 * 通常は深夜〜早朝のcronのみで起動するため、承認済みストックが少ない・動作確認
 * したい場面向け（2026-09-04追加）。autoApprove固定のためネタは即座に
 * status='approved'で登録される（ネタ承認は経由しない）
 */
export async function triggerDailyAutoProposer() {
  return request("/trigger-daily-auto-proposer", { method: "POST" });
}

/**
 * 「ネタ承認」タブ用、ネタ一覧を取得する（型情報・進捗マトリクス用のターゲット一覧を含む）
 * @param {string} [status] - 'proposed' | 'approved' | 'rejected' | 'all' | undefined(全件)
 */
export async function getTopics(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data } = await request(`/topics${query}`);
  return data || [];
}

/** ネタを承認する */
export async function approveTopic(topicId, approverId) {
  return request(`/topics/${topicId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approverId }),
  });
}

/** ネタを却下する */
export async function rejectTopic(topicId, approverId, reason, saveAsInsight) {
  return request(`/topics/${topicId}/reject`, {
    method: "POST",
    body: JSON.stringify({ approverId, reason, saveAsInsight }),
  });
}

/** チャネルラベル（sns_topic_targets）をpending⇔skippedで切り替える */
export async function updateTopicTargetLabel(
  topicId,
  targetId,
  status,
  reason,
) {
  return request(`/topics/${topicId}/targets/${targetId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason }),
  });
}

/**
 * 「⚡今すぐ生成」ボタン。status='pending'のターゲットに対し、対象チャネルの
 * パイプラインRoutineを即時発火する。ポーリングでもいずれ拾われるが、
 * 起動タイミングを早めるショートカット（生成結果自体は変わらない）
 */
export async function fireTopicTargetNow(topicId, targetId) {
  return request(`/topics/${topicId}/targets/${targetId}/fire`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** 「ネタ型設定」画面用、ネタの型（カテゴリ）一覧をチャネル設定つきで取得する */
export async function getTopicCategories() {
  const { data } = await request("/topic-categories");
  return data || [];
}

/** 型×チャネルのON/OFFを切り替える */
export async function updateTopicCategoryChannel(
  categoryId,
  platform,
  enabled,
) {
  return request(`/topic-categories/${categoryId}/channels/${platform}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}
