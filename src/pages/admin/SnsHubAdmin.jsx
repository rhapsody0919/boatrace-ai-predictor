/**
 * SnsHubAdmin - SNSマーケティングハブ管理画面
 * URL: /admin/sns-hub （middleware.jsでBasic認証保護）
 *
 * ヘッダー・タブナビゲーション・タブコンテンツというAdminRules.jsxの構成パターンを踏襲する
 * （docs/design/sns-marketing-hub/screens.md参照）。
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getDrafts,
  getApprovers,
  approveDraft,
  reviseDraft,
  redoDraft,
  markDraftPosted,
  addDraftMetric,
  getInsights,
  rejectInsight,
} from "../../services/snsHubService";
import { canShareVideo, shareVideoFile } from "../../utils/webShare";
import Toast, { useToast } from "../../components/Toast";
import "./SnsHubAdmin.css";

const PLATFORM_UPLOAD_URLS = {
  tiktok: "https://www.tiktok.com/tiktokstudio/upload",
  youtube: "https://studio.youtube.com",
};

function buildXIntentUrl(postText) {
  return `https://x.com/intent/post?text=${encodeURIComponent(postText || "")}`;
}

// キャプション本文＋ハッシュタグを投稿用の完成形テキストに組み立てる。
// コピー・X Intent・共有の3経路で同じテキストになるよう必ずこれを使う
// （X Intentだけcaption_text単体を渡していてハッシュタグが欠落する不具合が
// 2026-08-29の初回実投稿で発覚したため共通化）
function buildPostText(draft) {
  const hashtagLine = (draft.hashtags || []).filter(Boolean).join(" ");
  return [draft.caption_text, hashtagLine].filter(Boolean).join("\n\n");
}

function isIOSSafari() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function formatDateTime(isoString) {
  if (!isoString) return "-";
  return new Date(isoString).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const REVISION_REASONS = [
  { code: "time-expression-error", label: "時制表現の誤り" },
  { code: "gambling-connotation", label: "ギャンブル連想表現" },
  { code: "typo-or-data-error", label: "誤字・データの誤り" },
  { code: "tone-adjustment", label: "トーン調整" },
  { code: "format-or-topic-change", label: "型・題材の変更" },
];

const TABS = [
  {
    id: "review",
    label: "承認待ち",
    statuses: ["pending_review", "revision_requested"],
  },
  {
    id: "readyToPost",
    label: "投稿準備完了",
    statuses: ["approved", "ready_to_post"],
  },
  { id: "posted", label: "投稿済み", statuses: ["posted"] },
  { id: "insights", label: "戦略メモ" },
];

function SnsHubAdmin() {
  const [activeTab, setActiveTab] = useState("review");
  const [drafts, setDrafts] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast, showToast } = useToast();

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [draftsData, approversData, insightsData] = await Promise.all([
        getDrafts(),
        getApprovers(),
        getInsights(),
      ]);
      setDrafts(draftsData);
      setApprovers(approversData);
      setInsights(insightsData);
    } catch (err) {
      console.error("下書き取得エラー:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  async function handleAction(actionFn, ...args) {
    try {
      await actionFn(...args);
      showToast("操作を反映しました", "success");
      await loadDrafts();
    } catch (err) {
      console.error("アクションエラー:", err);
      showToast(err.message || "操作に失敗しました", "error");
    }
  }

  if (loading) {
    return (
      <div className="sns-hub-admin-page">
        <Header />
        <div className="loading-state">
          <div className="spinner" />
          <p>データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sns-hub-admin-page">
        <Header />
        <div className="error-state">
          <p>エラーが発生しました: {error}</p>
          <button onClick={loadDrafts}>再読み込み</button>
        </div>
      </div>
    );
  }

  const activeTabDef = TABS.find((t) => t.id === activeTab);
  const isInsightsTab = activeTab === "insights";
  const visibleDrafts = isInsightsTab
    ? []
    : drafts.filter((d) => activeTabDef.statuses.includes(d.status));

  return (
    <div className="sns-hub-admin-page">
      <Header />

      <div className="tab-navigation">
        {TABS.map((tab) => {
          const count =
            tab.id === "insights"
              ? insights.filter((i) => i.status === "proposed").length
              : drafts.filter((d) => tab.statuses.includes(d.status)).length;
          return (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="tab-content">
        {isInsightsTab ? (
          <InsightTab
            insights={insights}
            onReject={(insightId, reason) =>
              handleAction(rejectInsight, insightId, reason)
            }
          />
        ) : visibleDrafts.length === 0 ? (
          <div className="empty-state">
            <p>該当する下書きはありません。</p>
          </div>
        ) : (
          <div className="draft-list">
            {visibleDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                approvers={approvers}
                onApprove={(approverId) =>
                  handleAction(approveDraft, draft.id, approverId)
                }
                onRevise={(payload) =>
                  handleAction(reviseDraft, draft.id, payload)
                }
                onRedo={(payload) => handleAction(redoDraft, draft.id, payload)}
                onMarkPosted={() => handleAction(markDraftPosted, draft.id)}
                onAddMetric={(payload) =>
                  handleAction(addDraftMetric, draft.id, payload)
                }
              />
            ))}
          </div>
        )}
      </div>

      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </div>
  );
}

const PLATFORM_LABELS = { x: "X", tiktok: "TikTok", youtube: "YouTube" };
const LANGUAGE_LABELS = { ja: "日本語", en: "English" };
const SOURCE_LABELS = {
  "own-metrics": "自社実績",
  "external-research": "外部調査",
};

// 「戦略メモ」タブ: 要判断(proposed)ビューと履歴(active/retired)ビューの2区分
// （2026-08-29、ユーザー指摘によりPDCAの経緯を追える設計に追加）
function InsightTab({ insights, onReject }) {
  const proposed = insights.filter((i) => i.status === "proposed");
  const history = insights
    .filter((i) => i.status === "active" || i.status === "retired")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div className="insight-tab">
      <section className="insight-section">
        <h2 className="insight-section-title">要判断</h2>
        {proposed.length === 0 ? (
          <div className="empty-state">
            <p>反映待ちの戦略メモはありません。</p>
          </div>
        ) : (
          <div className="insight-list">
            {proposed.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onReject={(reason) => onReject(insight.id, reason)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="insight-section">
        <h2 className="insight-section-title">履歴</h2>
        {history.length === 0 ? (
          <div className="empty-state">
            <p>履歴はまだありません。</p>
          </div>
        ) : (
          <div className="insight-list">
            {history.map((insight) => (
              <InsightHistoryEntry
                key={insight.id}
                insight={insight}
                allInsights={insights}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InsightScopeBadges({ insight }) {
  return (
    <div className="draft-card-badges">
      <span className="draft-badge draft-badge-platform">
        {insight.platform
          ? PLATFORM_LABELS[insight.platform] || insight.platform
          : "全プラットフォーム"}
      </span>
      <span className="draft-badge draft-badge-language">
        {insight.language
          ? LANGUAGE_LABELS[insight.language] || insight.language
          : "全言語"}
      </span>
      {insight.format && (
        <span className="draft-badge draft-badge-variant">
          {insight.format}
        </span>
      )}
    </div>
  );
}

function InsightCard({ insight, onReject }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function handleReject() {
    onReject(reason.trim() || undefined);
    setRejecting(false);
    setReason("");
  }

  return (
    <div className="insight-card">
      <InsightScopeBadges insight={insight} />
      <p className="insight-text">{insight.insight_text}</p>
      {insight.evidence && (
        <p className="insight-evidence">根拠: {insight.evidence}</p>
      )}
      <p className="insight-meta">
        提案日時: {formatDateTime(insight.created_at)}
        {" ・ "}
        {SOURCE_LABELS[insight.source] || insight.source}
        {insight.research_method && ` (${insight.research_method})`}
      </p>

      {rejecting ? (
        <div className="insight-reject-form">
          <input
            type="text"
            className="insight-reject-reason"
            placeholder="却下理由（任意）"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="insight-reject-actions">
            <button
              className="revision-cancel"
              onClick={() => setRejecting(false)}
            >
              キャンセル
            </button>
            <button className="draft-action-btn redo" onClick={handleReject}>
              却下する
            </button>
          </div>
        </div>
      ) : (
        <button
          className="draft-action-btn revise"
          onClick={() => setRejecting(true)}
        >
          却下
        </button>
      )}
    </div>
  );
}

function InsightHistoryEntry({ insight, allInsights }) {
  const supersededByInsight = insight.superseded_by
    ? allInsights.find((i) => i.id === insight.superseded_by)
    : null;

  const isActive = insight.status === "active";

  return (
    <div className="insight-card insight-history-entry">
      <div className="draft-card-badges">
        <span
          className={`insight-status-badge ${
            isActive ? "insight-status-active" : "insight-status-retired"
          }`}
        >
          {isActive ? "採用中" : "却下/失効"}
        </span>
      </div>
      <InsightScopeBadges insight={insight} />
      <p className="insight-text">{insight.insight_text}</p>
      <p className="insight-meta">
        提案: {formatDateTime(insight.created_at)}
        {insight.activated_at &&
          ` ・ 採用: ${formatDateTime(insight.activated_at)}`}
        {insight.retired_at &&
          ` ・ 却下/失効: ${formatDateTime(insight.retired_at)}`}
      </p>
      {insight.decision_note && (
        <p className="insight-decision-note">理由: {insight.decision_note}</p>
      )}
      <p className="insight-usage-count">
        反映本数:{" "}
        {insight.referenced_draft_count === null
          ? "取得できませんでした"
          : `${insight.referenced_draft_count}件`}
      </p>
      {supersededByInsight && (
        <p className="insight-superseded-link">
          → 後継: {supersededByInsight.insight_text.slice(0, 30)}...
        </p>
      )}
    </div>
  );
}

function DraftCard({
  draft,
  approvers,
  onApprove,
  onRevise,
  onRedo,
  onMarkPosted,
  onAddMetric,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const [openPanel, setOpenPanel] = useState(null); // null | 'revise' | 'redo'

  const variantLabel = draft.sns_template_variants
    ? `${draft.format} / ${draft.sns_template_variants.variant_name}`
    : draft.format;

  // 承認・修正・作り直しはpending_reviewの下書きにのみ許可される（api/admin/sns-hub側の検証と一致）
  const canAct = draft.status === "pending_review";

  return (
    <div className="draft-card">
      <VideoPreview
        videoUrl={draft.video_url}
        coverImageUrl={draft.cover_image_url}
      />

      <div className="draft-card-body">
        <div className="draft-card-badges">
          <span className="draft-badge draft-badge-platform">
            {PLATFORM_LABELS[draft.platform] || draft.platform}
          </span>
          <span className="draft-badge draft-badge-language">
            {LANGUAGE_LABELS[draft.language] || draft.language}
          </span>
          <span className="draft-badge draft-badge-variant">
            {variantLabel}
          </span>
        </div>

        {draft.risk_flags?.length > 0 && (
          <div className="draft-risk-flags">
            {draft.risk_flags.map((flag, idx) => (
              <RiskWarningBadge key={idx} flag={flag} />
            ))}
          </div>
        )}

        {draft.background_text && (
          <details className="draft-background-details">
            <summary>生成メモ</summary>
            <p className="draft-background-text">{draft.background_text}</p>
          </details>
        )}

        {draft.caption_text && (
          <p className="draft-caption-text">{draft.caption_text}</p>
        )}

        {canAct && (
          <>
            <ApproverChips
              approvers={approvers}
              selectedId={selectedApproverId}
              onSelect={setSelectedApproverId}
            />

            <div className="draft-actions">
              <button
                className="draft-action-btn approve"
                disabled={!selectedApproverId}
                onClick={() => onApprove(selectedApproverId)}
              >
                ✅ 承認
              </button>
              <button
                className="draft-action-btn revise"
                onClick={() =>
                  setOpenPanel(openPanel === "revise" ? null : "revise")
                }
              >
                📝 一部修正
              </button>
              <button
                className="draft-action-btn redo"
                onClick={() =>
                  setOpenPanel(openPanel === "redo" ? null : "redo")
                }
              >
                ❌ 全部作り直し
              </button>
            </div>

            {openPanel === "revise" && (
              <RevisionPanel
                mode="revise"
                onCancel={() => setOpenPanel(null)}
                onSubmit={({ reasonCodes, freeText, saveAsInsight }) => {
                  onRevise({
                    approverId: selectedApproverId,
                    reasonCodes,
                    freeText,
                    saveAsInsight,
                  });
                  setOpenPanel(null);
                }}
              />
            )}
            {openPanel === "redo" && (
              <RevisionPanel
                mode="redo"
                onCancel={() => setOpenPanel(null)}
                onSubmit={({ freeText, saveAsInsight }) => {
                  onRedo({
                    approverId: selectedApproverId,
                    freeText,
                    saveAsInsight,
                  });
                  setOpenPanel(null);
                }}
              />
            )}
          </>
        )}

        {(draft.status === "approved" || draft.status === "ready_to_post") && (
          <PostingActionLinks draft={draft} onMarkPosted={onMarkPosted} />
        )}

        {draft.status === "posted" && draft.platform === "tiktok" && (
          <TikTokMetricsForm onSubmit={onAddMetric} />
        )}
      </div>
    </div>
  );
}

function PostingActionLinks({ draft, onMarkPosted }) {
  const [shareState, setShareState] = useState({
    checked: false,
    canShare: false,
    file: null,
  });
  const [copyFeedback, setCopyFeedback] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (isIOSSafari() && draft.video_url) {
      canShareVideo(draft.video_url).then((result) => {
        if (!cancelled) setShareState({ checked: true, ...result });
      });
    } else {
      setShareState({ checked: true, canShare: false, file: null });
    }
    return () => {
      cancelled = true;
    };
  }, [draft.video_url]);

  async function handleCopyCaption() {
    const text = buildPostText(draft);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("コピーしました");
    } catch (err) {
      console.error("キャプションコピーエラー:", err);
      setCopyFeedback("コピーに失敗しました");
    }
    setTimeout(() => setCopyFeedback(null), 2000);
  }

  async function handleShare() {
    if (shareState.file) {
      try {
        await shareVideoFile(shareState.file, buildPostText(draft));
      } catch (err) {
        console.error("共有エラー:", err);
      }
    }
  }

  const platformUrl =
    draft.platform === "x"
      ? buildXIntentUrl(buildPostText(draft))
      : PLATFORM_UPLOAD_URLS[draft.platform];

  return (
    <div className="posting-action-links">
      {shareState.checked && shareState.canShare ? (
        <button className="posting-action-btn share" onClick={handleShare}>
          📤 共有して投稿
        </button>
      ) : (
        draft.video_url && (
          <a
            className="posting-action-btn download"
            href={draft.video_url}
            download
          >
            ⬇️ 動画をダウンロード
          </a>
        )
      )}

      {draft.caption_text && (
        <>
          <button
            className="posting-action-btn copy"
            onClick={handleCopyCaption}
          >
            📋 キャプションをコピー
          </button>
          {copyFeedback && (
            <span className="copy-feedback">{copyFeedback}</span>
          )}
        </>
      )}

      {platformUrl && (
        <a
          className="posting-action-btn platform-link"
          href={platformUrl}
          target="_blank"
          rel="noreferrer"
        >
          {PLATFORM_LABELS[draft.platform] || draft.platform}を開く
        </a>
      )}

      <button className="posting-action-btn mark-posted" onClick={onMarkPosted}>
        投稿済みにする
      </button>
    </div>
  );
}

const METRIC_LABELS = {
  views: "再生数",
  likes: "いいね数",
  saves: "保存数",
  shares: "シェア数",
};

function TikTokMetricsForm({ onSubmit }) {
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);

  function handleChange(metricName, rawValue) {
    setValues((prev) => ({ ...prev, [metricName]: rawValue }));
  }

  function handleSubmit() {
    Object.entries(values).forEach(([metricName, rawValue]) => {
      if (rawValue === "" || rawValue === undefined) return;
      const metricValue = Number(rawValue);
      if (Number.isNaN(metricValue)) return;
      onSubmit({ metricName, metricValue, source: "manual" });
    });
    setSubmitted(true);
  }

  return (
    <div className="tiktok-metrics-form">
      <p className="tiktok-metrics-title">TikTok指標を入力</p>
      <div className="tiktok-metrics-fields">
        {Object.entries(METRIC_LABELS).map(([name, label]) => (
          <label key={name} className="tiktok-metrics-field">
            <span>{label}</span>
            <input
              type="number"
              min="0"
              value={values[name] ?? ""}
              onChange={(e) => handleChange(name, e.target.value)}
            />
          </label>
        ))}
      </div>
      <button className="tiktok-metrics-submit" onClick={handleSubmit}>
        記録する
      </button>
      {submitted && <span className="copy-feedback">送信しました</span>}
    </div>
  );
}

function ApproverChips({ approvers, selectedId, onSelect }) {
  if (approvers.length === 0) return null;
  return (
    <div className="approver-chips">
      {approvers.map((a) => (
        <button
          key={a.id}
          className={`approver-chip ${selectedId === a.id ? "selected" : ""}`}
          onClick={() => onSelect(a.id)}
        >
          {a.display_name}
        </button>
      ))}
    </div>
  );
}

function RevisionPanel({ mode, onSubmit, onCancel }) {
  const [reasonCodes, setReasonCodes] = useState([]);
  const [freeText, setFreeText] = useState("");
  const [saveAsInsight, setSaveAsInsight] = useState(false);

  function toggleReason(code) {
    setReasonCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  const canSubmit = mode === "redo" || reasonCodes.length > 0;
  const hasFreeText = freeText.trim().length > 0;

  return (
    <div className="revision-panel">
      {mode === "revise" && (
        <div className="revision-reason-chips">
          {REVISION_REASONS.map((r) => (
            <button
              key={r.code}
              className={`revision-reason-chip ${
                reasonCodes.includes(r.code) ? "selected" : ""
              }`}
              onClick={() => toggleReason(r.code)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <textarea
        className="revision-freetext"
        placeholder={
          mode === "revise" ? "自由記述（任意）" : "作り直しの意図（任意）"
        }
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
      />

      <label className="revision-save-insight">
        <input
          type="checkbox"
          checked={saveAsInsight}
          disabled={!hasFreeText}
          onChange={(e) => setSaveAsInsight(e.target.checked)}
        />
        この指摘を今後の生成方針に反映する
      </label>

      <div className="revision-panel-actions">
        <button className="revision-cancel" onClick={onCancel}>
          キャンセル
        </button>
        <button
          className="revision-submit"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              reasonCodes,
              freeText,
              // チェックボックスはdisabledでもcheckedのstate自体はリセットされない
              // ため、自由記述を消してから送信した場合に備え送信時点で再検証する
              // （コードレビューで指摘: 空のfreeTextとsaveAsInsight:trueが
              // 同時に送信されうる不整合があった）
              saveAsInsight: saveAsInsight && hasFreeText,
            })
          }
        >
          送信
        </button>
      </div>
    </div>
  );
}

function VideoPreview({ videoUrl, coverImageUrl }) {
  if (!videoUrl) {
    return (
      <div className="video-preview video-preview-empty">
        {coverImageUrl ? (
          <img src={coverImageUrl} alt="" className="video-preview-cover" />
        ) : (
          <p>動画準備中</p>
        )}
      </div>
    );
  }

  return (
    <div className="video-preview">
      <video
        src={videoUrl}
        poster={coverImageUrl || undefined}
        controls
        playsInline
        preload="metadata"
      />
    </div>
  );
}

function RiskWarningBadge({ flag }) {
  const label =
    typeof flag === "string"
      ? flag
      : flag.description || flag.ruleId || "リスク検出";
  return <span className="risk-warning-badge">⚠️ {label}</span>;
}

function Header() {
  return (
    <div className="sns-hub-header">
      <Link to="/" className="back-link">
        ← トップへ戻る
      </Link>
      <h1>SNSマーケティングハブ</h1>
      <p className="admin-badge">管理者用</p>
    </div>
  );
}

export default SnsHubAdmin;
