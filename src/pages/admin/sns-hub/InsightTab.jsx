// 「戦略メモ」タブ（数字と戦略メモのページ）。SnsHubAdmin.jsx から切り出し
import { useState } from "react";
import {
  PLATFORM_LABELS,
  LANGUAGE_LABELS,
  SOURCE_LABELS,
  REVISION_REASON_LABELS,
} from "./constants.js";
import { formatDateTime } from "./utils";

// 「過去のFB」表示（2026-09-04追加）。sns_draftsのrevision_reason_codes/
// revision_reason_freetextは、生成Routine側は毎回getRecentRevisions()で
// 参照しているが（.claude/rules/sns-content-generation.md）、人間側がUI上で
// 直近の指摘傾向を確認する手段がこれまで無かった
function RecentRevisionsSection({ revisions }) {
  if (revisions.length === 0) {
    return (
      <div className="empty-state">
        <p>直近30日間の修正フィードバックはありません。</p>
      </div>
    );
  }

  const grouped = revisions.reduce((acc, rev) => {
    (acc[rev.platform] ||= []).push(rev);
    return acc;
  }, {});

  return (
    <div className="revision-feed">
      {Object.entries(grouped).map(([platform, items]) => (
        <div key={platform} className="revision-feed-group">
          <h3 className="doc-reference-group-title">
            {PLATFORM_LABELS[platform] || platform}（{items.length}件）
          </h3>
          <ul className="revision-feed-list">
            {items.map((rev) => (
              <li key={rev.id} className="revision-feed-item">
                <div className="revision-feed-item-header">
                  <span className="revision-feed-title">
                    {rev.title || "（無題）"}
                  </span>
                  <span className="revision-feed-date">
                    {formatDateTime(rev.updatedAt)}
                  </span>
                </div>
                {rev.revisionReasonCodes.length > 0 && (
                  <p className="revision-feed-reasons">
                    {rev.revisionReasonCodes
                      .map((code) => REVISION_REASON_LABELS[code] || code)
                      .join("、")}
                  </p>
                )}
                {rev.revisionReasonFreetext && (
                  <p className="revision-feed-freetext">
                    {rev.revisionReasonFreetext}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// 「戦略メモ」タブ: 要判断(proposed)ビューと履歴(active/retired)ビューの2区分
// （2026-08-29、ユーザー指摘によりPDCAの経緯を追える設計に追加）
// 全体戦略（platform=null）とチャネル別戦略を分けて表示する（2026-09-04追加、
// ユーザー指摘: 各チャネルのアルゴリズムは違うため戦略メモも区別すべき。
// DBスキーマ・API変更はせず、既存のplatformカラム（nullが全体を表す既存規約、
// getActiveInsightsのwildcard判定と同じ）でUI表示だけをグルーピングする
// 軽量案を採用した）
// items.length===0の場合はグループごと非表示にする（2026-09-04、UI/UX
// レビュー指摘: 全体戦略insightが実データ上0件のため、常時「〜はありません」
// という空状態文だけが表示され続けノイズになっていた。0件でも枠組み自体は
// 残したいという意図は「反映待ちの戦略メモはありません」等の上位の空状態
// （InsightTab側、proposed/history全体が0件の場合）で既にカバーされている）
function InsightScopeGroup({ title, items, renderItem }) {
  if (items.length === 0) return null;
  return (
    <div className="insight-scope-group">
      <h3 className="insight-scope-title">{title}</h3>
      <div className="insight-list">{items.map(renderItem)}</div>
    </div>
  );
}

export default function InsightTab({ insights, onApprove, onReject, revisions }) {
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
          <>
            <InsightScopeGroup
              title="🌐 全体戦略"
              items={proposed.filter((i) => !i.platform)}
              renderItem={(insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onApprove={() => onApprove(insight.id)}
                  onReject={(reason) => onReject(insight.id, reason)}
                />
              )}
            />
            <InsightScopeGroup
              title="📡 チャネル別戦略"
              items={proposed.filter((i) => i.platform)}
              renderItem={(insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onApprove={() => onApprove(insight.id)}
                  onReject={(reason) => onReject(insight.id, reason)}
                />
              )}
            />
          </>
        )}
      </section>

      <section className="insight-section">
        <h2 className="insight-section-title">履歴</h2>
        {history.length === 0 ? (
          <div className="empty-state">
            <p>履歴はまだありません。</p>
          </div>
        ) : (
          <>
            <InsightScopeGroup
              title="🌐 全体戦略"
              items={history.filter((i) => !i.platform)}
              renderItem={(insight) => (
                <InsightHistoryEntry
                  key={insight.id}
                  insight={insight}
                  allInsights={insights}
                />
              )}
            />
            <InsightScopeGroup
              title="📡 チャネル別戦略"
              items={history.filter((i) => i.platform)}
              renderItem={(insight) => (
                <InsightHistoryEntry
                  key={insight.id}
                  insight={insight}
                  allInsights={insights}
                />
              )}
            />
          </>
        )}
      </section>

      <section className="insight-section">
        <h2 className="insight-section-title">
          📝 過去の修正フィードバック（直近30日）
        </h2>
        <RecentRevisionsSection revisions={revisions} />
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

function InsightCard({ insight, onApprove, onReject }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [approving, setApproving] = useState(false);

  function handleReject() {
    onReject(reason.trim() || undefined);
    setRejecting(false);
    setReason("");
  }

  async function handleApprove() {
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
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
        <div className="draft-actions">
          <button
            className="draft-action-btn approve"
            onClick={handleApprove}
            disabled={approving}
          >
            {approving ? "採用中…" : "採用"}
          </button>
          <button
            className="draft-action-btn revise"
            onClick={() => setRejecting(true)}
          >
            却下
          </button>
        </div>
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
