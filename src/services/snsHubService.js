import { downloadFileBlob } from "../utils/webShare.js";
import { csvPublicationRange } from "../utils/snsObservationCsv.js";
/**
 * SNSマーケティングハブ 管理画面用サービス層
 *
 * 既存のruleMatchService.js等と異なり、Supabaseを直接呼ばず /api/admin/sns-hub/* を
 * 経由する薄いラッパー（ADR 0021: フロントエンドにService Role Keyを露出させないため）。
 */

const BASE_URL = "/api/admin/sns-hub";

/** JSON・media・出典を同じmultipartで渡す。Content-Typeはブラウザに任せる。 */
export async function importPreviewBundle(files) {
  const body = new FormData();
  for (const file of files) body.append("files", file, file.name);
  return request("/import-bundle", { method: "POST", headers: {}, body });
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error(
      "通信結果を確認できませんでした。再実行する前に最新の状態を確認してください。",
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    // Vite開発サーバー等、Vercel Edge Functionsが実行されない環境ではSPA
    // フォールバック(HTML)が返り、JSONとして解釈できない。無効な応答として扱う
    throw new Error(`APIから予期しない応答がありました (${response.status})`);
  }

  if (!response.ok) {
    const error = new Error(
      "処理を完了できませんでした。最新の状態を再読み込みして確認してください。",
    );
    error.code = body.code;
    throw error;
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
export async function getBlogPrPreview(draftId) {
  return request(`/drafts/${draftId}/blog-pr-preview`);
}

export async function mergeBlogPr(draftId, approverId, headSha) {
  return request(`/drafts/${draftId}/merge-blog-pr`, {
    method: "POST",
    body: JSON.stringify({ approverId, headSha }),
  });
}

/** YouTube下書きを承認し、YouTube Data API v3で自動投稿する（platform='youtube'専用） */
export async function publishYoutube(draftId, approverId) {
  return request(`/drafts/${draftId}/publish-youtube`, {
    method: "POST",
    body: JSON.stringify({ approverId }),
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
 * 「戦略メモ」insight一覧を取得する
 * @param {string} [status] - 'proposed' | 'active' | 'retired' | undefined(全件)
 */
export async function getInsights(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const { data } = await request(`/insights${query}`);
  return data || [];
}

export async function getRecentRevisions() {
  const { data } = await request("/revisions");
  return data || [];
}

/** insightを却下する（理由は任意） */
export async function rejectInsight(insightId, reason) {
  return request(`/insights/${insightId}/reject`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/** insightを採用する（active化、次回生成から参照される） */
export async function approveInsight(insightId) {
  return request(`/insights/${insightId}/approve`, { method: "POST" });
}

/** 観測窓つき指標。旧手動指標から期間を推測しない。 */
export async function getMetricObservations(window, metric) {
  const { data } = await request(
    `/observations?window=${encodeURIComponent(window)}&metric=${encodeURIComponent(metric)}`,
  );
  return data;
}

/** X送信は接続承認までconnected=false。鍵をブラウザへ渡さない。 */
export async function getXSendStatus(draftId) {
  const { data } = await request(`/drafts/${draftId}/x-send`);
  return data;
}
export async function approveXSend(draftId, approverId, scheduledAt) {
  return request(`/drafts/${draftId}/x-send`, {
    method: "POST",
    body: JSON.stringify({ approverId, scheduledAt }),
  });
}
export async function stopXSend() {
  return request("/x-send-stop", { method: "POST", body: "{}" });
}

export async function cancelXSend(draftId) {
  return request(`/drafts/${draftId}/x-send`, {
    method: "POST",
    body: JSON.stringify({ action: "cancel" }),
  });
}

/** 待ち行列の行と、送信の状態（モード・試運転・停止。取得できなければ null） */
export async function getDeadlineQueue() {
  const { data, control } = await request("/deadline-queue");
  return { rows: data || [], control: control ?? null };
}

/** SPAフォールバックのHTMLをCSVとして保存しない。 */
export async function downloadObservationCsv({ start, end, platform }) {
  csvPublicationRange(start, end, platform);
  const query = new URLSearchParams({ export: "csv", start, end, platform });
  return downloadFileBlob(
    `${BASE_URL}/observations?${query}`,
    `posts-${start}-${end}-${platform}.csv`,
    "text/csv",
  );
}

// 一画面で複数の下書きが開いても、媒体hash用の要求を同時に積まない。
let draftDiffQueue = Promise.resolve();
export function getDraftDiff(id, versionHash) {
  const query = new URLSearchParams({ id });
  if (versionHash !== undefined) query.set("versionHash", versionHash || "");
  const result = draftDiffQueue.then(() => request(`/draft-diff?${query}`));
  draftDiffQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
