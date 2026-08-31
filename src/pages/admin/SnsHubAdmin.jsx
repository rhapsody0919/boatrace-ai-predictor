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
  getTemplateVariants,
  archiveDraft,
  triggerGeneration,
} from "../../services/snsHubService";
import {
  canShareVideo,
  shareVideoFile,
  downloadVideoBlob,
} from "../../utils/webShare";
import Toast, { useToast } from "../../components/Toast";
import {
  FORMAT_LIBRARY,
  PERSONA_NOTES,
  DESIGN_GUIDELINE_NOTES,
  buildDocUrl,
} from "../../data/snsFormatCatalogContent";
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
  { id: "catalog", label: "フォーマットカタログ" },
];

function SnsHubAdmin() {
  const [activeTab, setActiveTab] = useState("review");
  const [drafts, setDrafts] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [insights, setInsights] = useState([]);
  const [templateVariants, setTemplateVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(null); // null | 'daily' | 'evergreen'
  // 生成リクエスト成功後、手動更新ボタンを押すまで両ボタンを無効化し続ける
  // （連打による多重起動を防ぐため）
  const [generationLocked, setGenerationLocked] = useState(false);
  // fireRoutineは起動を指示するだけで完了を待たないため、Routine自体の詳細な
  // 進捗（今何をしているか）はアプリ側から取得できない。代わりに(a)実行セッション
  // へのリンク(b)新しい下書きが増えたかの自動検知、の2つで代替する（ユーザー要望、
  // 2026-08-31）
  const [generationSessionUrl, setGenerationSessionUrl] = useState(null);
  // 経過時間の表示用（クライアント時計、多少ずれても表示上の目安なので実害なし）
  const [generationFiredAt, setGenerationFiredAt] = useState(null);
  const [generationElapsedMinutes, setGenerationElapsedMinutes] = useState(0);
  // 完了検知用の基準時刻はfire時点の下書き一覧から取った「既存の最新created_at」
  // （サーバー時刻同士の比較にすることで、クライアント/サーバーの時計ずれで
  // 検知漏れが起きないようにする。コードレビューで指摘）
  const [generationBaselineCreatedAt, setGenerationBaselineCreatedAt] =
    useState(null);
  const { toast, showToast } = useToast();

  // silent=trueの場合、全画面ローディング表示を出さずに裏側でデータだけ
  // 更新する。承認等のアクション直後に画面全体がスピナーに切り替わる
  // 体験が「うざい」という指摘への対応（2026-08-31）。初回マウント時のみ
  // 全画面ローディングを見せる
  const loadDrafts = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const [draftsData, approversData, insightsData, templateVariantsData] =
          await Promise.all([
            getDrafts(),
            getApprovers(),
            getInsights(),
            getTemplateVariants(),
          ]);
        setDrafts(draftsData);
        setApprovers(approversData);
        setInsights(insightsData);
        setTemplateVariants(templateVariantsData);
      } catch (err) {
        console.error("下書き取得エラー:", err);
        // silent時は全画面エラー表示に切り替えず、アクション自体は成功して
        // いる可能性があるためトースト通知に留める（コードレビューで指摘:
        // アクション成功直後にsetErrorすると全画面エラーに切り替わり、
        // 開いていたパネル等の状態が失われる矛盾があった）
        if (silent) {
          showToast(`最新状態の取得に失敗しました: ${err.message}`, "error");
        } else {
          setError(err.message);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  async function handleAction(actionFn, ...args) {
    try {
      await actionFn(...args);
      showToast("操作を反映しました", "success");
      await loadDrafts({ silent: true });
    } catch (err) {
      console.error("アクションエラー:", err);
      showToast(err.message || "操作に失敗しました", "error");
    }
  }

  // 承認済みストックが少ない時の手動補充用。fireRoutineは起動を指示する
  // だけで完了を待たないため、生成完了までは数分〜十数分かかる（動画
  // レンダリングを含む）。完了したかどうかは手動更新ボタン、または下記の
  // 自動検知（新しい下書きの出現）で確認する
  async function handleGenerate(mode) {
    setGenerating(mode);
    try {
      const result = await triggerGeneration(mode);
      if (result?.routine?.fired === false) {
        // fireRoutineはRoutine未構築・fire失敗時も例外を投げず
        // {fired: false, reason: ...}を返す（コードレビューで指摘:
        // これを無視すると実際は何も起動していないのに成功表示になる）
        showToast(
          `生成リクエストがRoutineに届いていません（${result.routine.reason}）。設定を確認してください`,
          "error",
        );
      } else {
        showToast(
          result.routine.sessionUrl
            ? "生成をリクエストしました。実行ログのリンクは下に表示されます"
            : "生成をリクエストしました。数分後に更新ボタンで確認してください",
          "success",
        );
        // 手動更新するまで両ボタンを無効化し続ける（コードレビューで指摘:
        // fire完了後すぐ再度押せてしまうと、数分かかる生成処理が連打で
        // 何本も重複起動されるリスクがあった）
        setGenerationLocked(true);
        setGenerationSessionUrl(result.routine.sessionUrl || null);
        setGenerationFiredAt(Date.now());
        setGenerationElapsedMinutes(0);
        setGenerationBaselineCreatedAt(
          drafts.reduce((max, d) => {
            const t = new Date(d.created_at).getTime();
            return t > max ? t : max;
          }, 0),
        );
      }
    } catch (err) {
      console.error("生成リクエストエラー:", err);
      showToast(err.message || "生成リクエストに失敗しました", "error");
    } finally {
      setGenerating(null);
    }
  }

  // 生成リクエスト中、30秒おきに下書き一覧を裏側で再取得し、fire時刻より
  // 後に作成された下書きが現れたら自動的にロックを解除する（ユーザー要望、
  // 2026-08-31: 「生成されているのかわからない」への対応）
  useEffect(() => {
    if (!generationLocked || !generationFiredAt) return;
    const interval = setInterval(() => {
      setGenerationElapsedMinutes(
        Math.max(0, Math.round((Date.now() - generationFiredAt) / 60000)),
      );
      loadDrafts({ silent: true });
    }, 30000);
    return () => clearInterval(interval);
  }, [generationLocked, generationFiredAt, loadDrafts]);

  useEffect(() => {
    if (!generationLocked || generationBaselineCreatedAt === null) return;
    // revise/redoも同じSNS_HUB_ROUTINEをfireするため、ポーリング中に別の下書きへ
    // 一部修正/全部作り直しを行うとその結果が新規下書きとして現れ、今回の手動生成
    // (generate-daily/evergreen)が完了したと誤検知してしまう（コードレビューで指摘）。
    // revise/redo由来の下書きは必ずparent_draft_idを持つため、それが無い
    // （新規content_group_idで作られた）下書きだけを対象にして区別する。
    // 比較基準もクライアント時計(generationFiredAt)ではなく、fire時点の下書き
    // 一覧から取ったサーバー側の最新created_atにして時計ずれによる検知漏れを防ぐ
    const newDraftsCount = drafts.filter(
      (d) =>
        new Date(d.created_at).getTime() > generationBaselineCreatedAt &&
        !d.parent_draft_id,
    ).length;
    if (newDraftsCount > 0) {
      showToast(`✅ ${newDraftsCount}件生成完了しました`, "success");
      setGenerationLocked(false);
      setGenerationSessionUrl(null);
      setGenerationFiredAt(null);
      setGenerationBaselineCreatedAt(null);
    }
  }, [drafts, generationLocked, generationBaselineCreatedAt, showToast]);

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
  const isCatalogTab = activeTab === "catalog";
  const visibleDrafts =
    isInsightsTab || isCatalogTab
      ? []
      : drafts.filter((d) => activeTabDef.statuses.includes(d.status));

  return (
    <div className="sns-hub-admin-page">
      <Header />

      <div className="tab-navigation-row">
        <div className="tab-navigation">
          {TABS.map((tab) => {
            const count =
              tab.id === "insights"
                ? insights.filter((i) => i.status === "proposed").length
                : tab.id === "catalog"
                  ? templateVariants.length
                  : drafts.filter((d) => tab.statuses.includes(d.status))
                      .length;
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
        <button
          className="refresh-btn"
          onClick={() => {
            setGenerationLocked(false);
            setGenerationSessionUrl(null);
            setGenerationFiredAt(null);
            setGenerationBaselineCreatedAt(null);
            loadDrafts();
          }}
        >
          🔄 更新
        </button>
      </div>

      <div className="manual-generate-row">
        <span className="manual-generate-label">
          承認済みストックが少ない時の手動生成:
        </span>
        <button
          className="manual-generate-btn"
          disabled={generating !== null || generationLocked}
          onClick={() => handleGenerate("daily")}
        >
          {generating === "daily"
            ? "⏳ リクエスト中..."
            : "🎬 当日ネタを今すぐ生成"}
        </button>
        <button
          className="manual-generate-btn"
          disabled={generating !== null || generationLocked}
          onClick={() => handleGenerate("evergreen")}
        >
          {generating === "evergreen"
            ? "⏳ リクエスト中..."
            : "📦 会場攻略型などを今すぐ生成"}
        </button>
        {generationLocked && (
          <span className="manual-generate-hint">
            ⏳ 生成中...（{generationElapsedMinutes}
            分経過）30秒おきに自動で確認します
            {generationSessionUrl && (
              <>
                {" ・ "}
                <a
                  href={generationSessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  実行ログを見る
                </a>
              </>
            )}
          </span>
        )}
      </div>

      <div className="tab-content">
        {isCatalogTab ? (
          <CatalogTab templateVariants={templateVariants} />
        ) : isInsightsTab ? (
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
                onArchive={() => handleAction(archiveDraft, draft.id)}
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

// 「フォーマットカタログ」タブ: 型一覧(DB)＋ドキュメント要約(静的キュレーション)の2区画
// （2026-08-31、ユーザー要望。既存の「戦略メモ」はinsight PDCA専用のため別タブとして新設、
// docs/design/sns-hub-admin-ux-improvements/spec.md課題3参照）
function CatalogTab({ templateVariants }) {
  return (
    <div className="catalog-tab">
      <section className="catalog-section">
        <h2 className="catalog-section-title">型一覧</h2>
        <TemplateVariantList templateVariants={templateVariants} />
      </section>
      <section className="catalog-section">
        <h2 className="catalog-section-title">デザイン・ペルソナ方針</h2>
        <DocReferenceSection />
      </section>
    </div>
  );
}

function TemplateVariantList({ templateVariants }) {
  if (templateVariants.length === 0) {
    return (
      <div className="empty-state">
        <p>登録されている型はありません。</p>
      </div>
    );
  }

  const grouped = templateVariants.reduce((acc, tv) => {
    (acc[tv.format] ||= []).push(tv);
    return acc;
  }, {});

  return (
    <div className="template-variant-groups">
      {Object.entries(grouped).map(([format, variants]) => (
        <details key={format} className="template-variant-group">
          <summary className="template-variant-format">
            {format}（{variants.length}件）
          </summary>
          <table className="template-variant-table">
            <thead>
              <tr>
                <th>デザイン名</th>
                <th>コンポジション</th>
                <th>作成者</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((tv) => (
                <tr key={tv.id}>
                  <td>{tv.variant_name}</td>
                  <td>{tv.composition_name}</td>
                  <td>{tv.created_by === "routine" ? "Routine" : "人間"}</td>
                  <td>{tv.active ? "稼働中" : "停止中"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}

function DocReferenceSection() {
  return (
    <div className="doc-reference-section">
      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">フォーマットライブラリ</h3>
        {FORMAT_LIBRARY.map((f) => (
          <div key={f.name} className="doc-reference-card">
            <div className="doc-reference-card-header">
              <span className="doc-reference-name">{f.name}</span>
              <span className="doc-reference-status">{f.status}</span>
            </div>
            <p className="doc-reference-summary">{f.summary}</p>
            <a
              href={buildDocUrl(f.docPath)}
              target="_blank"
              rel="noreferrer"
              className="doc-reference-link"
            >
              {f.docLabel} を見る →
            </a>
          </div>
        ))}
      </div>

      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">ペルソナ・キャラ選定</h3>
        <div className="doc-reference-card">
          <p className="doc-reference-summary">{PERSONA_NOTES.summary}</p>
          <a
            href={buildDocUrl(PERSONA_NOTES.docPath)}
            target="_blank"
            rel="noreferrer"
            className="doc-reference-link"
          >
            {PERSONA_NOTES.docLabel} を見る →
          </a>
        </div>
      </div>

      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">
          デザイン・ブランドガイドライン
        </h3>
        <div className="doc-reference-card">
          <p className="doc-reference-summary">
            {DESIGN_GUIDELINE_NOTES.summary}
          </p>
          <a
            href={buildDocUrl(DESIGN_GUIDELINE_NOTES.docPath)}
            target="_blank"
            rel="noreferrer"
            className="doc-reference-link"
          >
            {DESIGN_GUIDELINE_NOTES.docLabel} を見る →
          </a>
        </div>
      </div>
    </div>
  );
}

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

// スマホ幅(2列グリッド)では詳細・操作ボタンを畳んだ状態で開く。デスクトップ幅では
// 従来通り常に展開（auto-fillグリッドで元々カード自体が大きく、畳む必要が無いため）。
// 判定基準はCSS側の2列グリッド切り替え（.draft-listの@media (max-width: 480px)）と
// 必ず同じ値にする（ズレるとカードが1列表示なのに折りたたまれる幅域ができてしまう）
function getDefaultDraftCardExpanded() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 481px)").matches;
}

function DraftCard({
  draft,
  approvers,
  onApprove,
  onRevise,
  onRedo,
  onMarkPosted,
  onAddMetric,
  onArchive,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const [openPanel, setOpenPanel] = useState(null); // null | 'revise' | 'redo'
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [expanded, setExpanded] = useState(getDefaultDraftCardExpanded);

  const variantLabel = draft.sns_template_variants
    ? `${draft.format} / ${draft.sns_template_variants.variant_name}`
    : draft.format;

  // 承認・修正・作り直しはpending_reviewの下書きにのみ許可される（api/admin/sns-hub側の検証と一致）
  const canAct = draft.status === "pending_review";

  // 一部修正/全部作り直しパネルを開いている間は、トグルで折りたたんでも
  // パネルをアンマウントしない（コードレビューで指摘: 折りたたむと入力中の
  // freeText等がRevisionPanelごと消え、ユーザーに無警告でデータが失われるため）
  const isOpen = expanded || openPanel !== null;

  return (
    <div className={`draft-card${isOpen ? " draft-card--expanded" : ""}`}>
      <VideoPreview
        videoUrl={draft.video_url}
        coverImageUrl={draft.cover_image_url}
      />

      <div className="draft-card-body">
        <div className="draft-card-badges">
          <span
            className={`draft-badge draft-badge-platform draft-badge-platform-${draft.platform}`}
          >
            {PLATFORM_LABELS[draft.platform] || draft.platform}
          </span>
          <span className="draft-badge draft-badge-language">
            {LANGUAGE_LABELS[draft.language] || draft.language}
          </span>
          <span className="draft-badge draft-badge-variant">
            {variantLabel}
          </span>
        </div>

        <p className="draft-meta-text">
          生成: {formatDateTime(draft.created_at)}
          {draft.parent_draft_id && "（修正版・再生成）"}
        </p>

        {draft.status === "revision_requested" && (
          <ProcessingStatusBadge updatedAt={draft.updated_at} />
        )}

        <button
          type="button"
          className="draft-card-expand-toggle"
          disabled={openPanel !== null}
          onClick={() => setExpanded((v) => !v)}
        >
          {openPanel !== null
            ? "▲ 修正内容を確定/キャンセルすると閉じられます"
            : isOpen
              ? "▲ 閉じる"
              : "▼ 詳細・操作を見る"}
        </button>

        {isOpen && (
          <>
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

            {(draft.status === "approved" ||
              draft.status === "ready_to_post") && (
              <PostingActionLinks draft={draft} onMarkPosted={onMarkPosted} />
            )}

            {draft.status === "posted" && draft.platform === "tiktok" && (
              <TikTokMetricsForm onSubmit={onAddMetric} />
            )}

            {draft.status !== "posted" &&
              (confirmingArchive ? (
                <div className="draft-hide-confirm">
                  <span>非表示にしますか？</span>
                  <button
                    className="revision-cancel"
                    onClick={() => setConfirmingArchive(false)}
                  >
                    キャンセル
                  </button>
                  <button className="draft-action-btn redo" onClick={onArchive}>
                    非表示にする
                  </button>
                </div>
              ) : (
                <button
                  className="draft-hide-btn"
                  onClick={() => setConfirmingArchive(true)}
                >
                  🗂️ 非表示にする
                </button>
              ))}
          </>
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
  const [downloadState, setDownloadState] = useState({
    downloading: false,
    error: null,
  });

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

  async function handleDownload() {
    setDownloadState({ downloading: true, error: null });
    try {
      await downloadVideoBlob(
        draft.video_url,
        `${draft.platform}-${draft.language}.mp4`,
      );
      setDownloadState({ downloading: false, error: null });
    } catch (err) {
      console.error("ダウンロードエラー:", err);
      setDownloadState({
        downloading: false,
        error: "ダウンロードに失敗しました",
      });
      setTimeout(
        () => setDownloadState({ downloading: false, error: null }),
        3000,
      );
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
          <>
            <button
              className="posting-action-btn download"
              onClick={handleDownload}
              disabled={downloadState.downloading}
            >
              {downloadState.downloading
                ? "⏳ ダウンロード準備中..."
                : "⬇️ 動画をダウンロード"}
            </button>
            {downloadState.error && (
              <span className="copy-feedback">{downloadState.error}</span>
            )}
          </>
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

  const canSubmit =
    mode === "redo" || reasonCodes.length > 0 || freeText.trim().length > 0;
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

// revision_requestedからの経過時間の目安（この時間を超えたら「時間がかかっています」表示に切り替える）
const PROCESSING_STALE_THRESHOLD_MINUTES = 30;

// revise/redo実行後、新規下書きの生成・旧下書きのarchived化は非同期Routine任せで
// 画面には完了検知の仕組みが無いため、updated_at（revision_requestedへの遷移時刻の
// 近似値）からの経過時間で「処理中」「時間がかかっています」を出し分ける（spec.md課題2）
function ProcessingStatusBadge({ updatedAt }) {
  const minutesElapsed = updatedAt
    ? (Date.now() - new Date(updatedAt).getTime()) / 60000
    : 0;
  const isStale = minutesElapsed > PROCESSING_STALE_THRESHOLD_MINUTES;
  return (
    <span className={`processing-status-badge ${isStale ? "stale" : ""}`}>
      {isStale
        ? "⏱️ 時間がかかっています（Routineの状況を確認してください）"
        : "⏳ 処理中"}
    </span>
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
