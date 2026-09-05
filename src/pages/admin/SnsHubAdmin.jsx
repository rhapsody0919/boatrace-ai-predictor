/**
 * SnsHubAdmin - SNSマーケティングハブ管理画面
 * URL: /admin/sns-hub （middleware.jsでBasic認証保護）
 *
 * ヘッダー・タブナビゲーション・タブコンテンツというAdminRules.jsxの構成パターンを踏襲する
 * （docs/design/sns-marketing-hub/screens.md参照）。
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  getDrafts,
  getApprovers,
  approveDraft,
  mergeBlogPr,
  publishYoutube,
  redoDraft,
  requestSpecChange,
  markDraftPosted,
  addDraftMetric,
  getInsights,
  getRecentRevisions,
  approveInsight,
  rejectInsight,
  getTemplateVariants,
  archiveDraft,
  getTopics,
  approveTopic,
  rejectTopic,
  updateTopicTargetLabel,
  fireTopicTargetNow,
  getTopicCategories,
  updateTopicCategoryChannel,
  triggerWeeklyProposer,
  triggerDailyAutoProposer,
} from "../../services/snsHubService";
import {
  canShareVideo,
  shareVideoFile,
  downloadFileBlob,
} from "../../utils/webShare";
import Toast, { useToast } from "../../components/Toast";
import {
  GLOBAL_RULES,
  CHANNEL_RULES,
  FORMAT_LIBRARY,
  PERSONA_NOTES,
  DESIGN_GUIDELINE_NOTES,
  buildDocUrl,
} from "../../data/snsFormatCatalogContent";
import {
  buildXIntentUrl,
  buildPostText,
  isIOSSafari,
  formatDateTime,
  isTodayJST,
  getDefaultDraftCardExpanded,
} from "./sns-hub/utils";
import "./SnsHubAdmin.css";

const PLATFORM_UPLOAD_URLS = {
  tiktok: "https://www.tiktok.com/tiktokstudio/upload",
  youtube: "https://studio.youtube.com",
};

const REVISION_REASONS = [
  { code: "time-expression-error", label: "時制表現の誤り" },
  { code: "gambling-connotation", label: "ギャンブル連想表現" },
  { code: "typo-or-data-error", label: "誤字・データの誤り" },
  { code: "tone-adjustment", label: "トーン調整" },
  { code: "format-or-topic-change", label: "型・題材の変更" },
  // デザイン系の理由（2026-09-03追加、ユーザー要望: 「無駄なスペース、色使い、
  // フォントサイズ、画像など」を選択式で指摘できるようにしてほしい）。既存の
  // RevisionPanel（チップ選択+自由記述）をそのまま流用し、新規UIは作らない
  { code: "design-spacing", label: "余白・スペースが無駄" },
  { code: "design-color", label: "配色が合わない" },
  { code: "design-font-size", label: "フォントサイズが不適切" },
  { code: "design-visual-material", label: "画像・素材の質が低い" },
  // 2026-09-04追加、ユーザー指摘: 生成テキストが不自然な日本語（中国語的な
  // 言い回し）になるケースが多いため専用チップを新設
  { code: "unnatural-japanese", label: "不自然な日本語（中国語的な言い回し）" },
];

// ブログ/note下書き向けの却下理由（spec.md FR5、2026-09-01追加）。
// 動画下書きとは性質が異なる却下理由（検索意図・数値正確性等）を別リストにする
const CONTENT_REVISION_REASONS = [
  { code: "search-intent-mismatch", label: "検索意図とズレている" },
  { code: "data-accuracy-error", label: "数値・データの誤り" },
  { code: "too-similar-to-existing", label: "既存記事と似すぎている" },
  { code: "typo-or-data-error", label: "誤字・データの誤り" },
  { code: "tone-adjustment", label: "トーン調整" },
  { code: "unnatural-japanese", label: "不自然な日本語（中国語的な言い回し）" },
];

// ネタ承認の却下理由（2026-09-04追加、ユーザー要望: 自由記述だけだと面倒なので
// 選択式でタップできるようにしてほしい）。下書きの却下理由（表現・デザイン等）
// とは性質が異なり、ネタ選定自体の問題を扱うため専用リストにする
const TOPIC_REJECTION_REASONS = [
  { code: "outdated-or-inaccurate", label: "内容が古い・不正確" },
  { code: "duplicate-topic", label: "既出のネタと重複" },
  { code: "weak-appeal", label: "訴求が弱い" },
  { code: "overhyped-wording", label: "表現が誇大・煽り気味" },
  { code: "policy-risk", label: "TikTok等ガイドライン抵触の懸念" },
  { code: "wrong-data-selection", label: "会場・データの選定ミス" },
  { code: "unnatural-japanese", label: "不自然な日本語（中国語的な言い回し）" },
];

// payout-rate（選手×艇番回収率型）・outcome-distribution（出目分布型）は
// TikTokガイドライン上新規制作を全面停止中で、DB上はactive=trueのまま
// daily-auto Routineの候補選定から恒久的に除外されている
// （docs/db-migration/046_sns_topic_categories_exclusion_notes.sql、
// sns-topic-proposer-daily-auto.md参照）。日次ネタ型選択ドロップダウンでも
// 同じ理由で選択肢から外す（2026-09-04、レビューで指摘: active判定だけの
// フィルタだとこの2型が選択可能になってしまっていた）
const TIKTOK_PERMANENTLY_EXCLUDED_CATEGORY_KEYS = [
  "payout-rate",
  "outcome-distribution",
];

// 2026-09-01、content-multi-channel-pipeline（spec.md FR6・screens.md）で
// ステータス軸タブからプラットフォーム軸タブへ再構成した。以前は「承認待ち/
// 投稿準備完了/投稿済み」が主タブだったが、note/blog/youtubeが増えチャネルを
// 横断して見づらくなったため、プラットフォームを主タブ・ステータスを
// 副フィルタにした。
const PLATFORM_TABS = [
  { id: "tiktok", label: "TikTok", platform: "tiktok" },
  { id: "x", label: "X", platform: "x" },
  { id: "youtube", label: "YouTube", platform: "youtube" },
  { id: "note", label: "Note", platform: "note" },
  { id: "blog", label: "Blog", platform: "blog" },
];

const STATUS_FILTERS = [
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
];

// 「ネタ承認」は2026-09-03のユーザー指摘によりタブではなく専用セクション
// （tab-navigation-rowの上、常時表示）に変更した。「承認→各プラットフォーム
// タブに生成される」という流れが、同列のタブに埋もれると分かりにくいため。
// 「ネタ型設定」も同じ理由で2026-09-04にタブ列から外し、ネタ承認セクションの
// ヘッダーから開く設定パネルに変更した（型ごとのチャネルON/OFFは「ネタ承認」の
// 前提となる設定であり、コンテンツレビュー用のプラットフォームタブとは
// 性質が異なるため、5プラットフォームタブと並べると発見しづらいという指摘）
const NON_PLATFORM_TABS = [
  { id: "insights", label: "戦略メモ" },
  { id: "catalog", label: "フォーマットカタログ" },
];

const TABS = [...PLATFORM_TABS, ...NON_PLATFORM_TABS];

// sns_template_variants.formatの日本語ラベル。DB側にlabel列が無く英語の
// kebab-case識別子のみのため、docs/operation/sns-video-producer-prompt.md
// のフォーマットライブラリの呼称に合わせてここで翻訳する（2026-09-04追加）。
// race-insightは同ドキュメントに記載が無く由来不明のため、キー名からの
// 推測ラベル。未知の型（今後Routineが新規登録した場合）は生の英語キーの
// ままフォールバック表示する
const FORMAT_LABELS = {
  "answer-check": "答え合わせ型",
  "daily-data-list": "本日のデータ一覧型",
  "live-prediction-hook": "予想数値フック型",
  "new-feature": "新機能紹介型",
  "race-insight": "レース考察型",
  "tool-showcase": "一覧アピール型",
  trivia: "豆知識型",
  "venue-ranking": "会場攻略・データ一覧型",
};

function SnsHubAdmin() {
  // activeTab: プラットフォーム軸の主タブ（tiktok/x/youtube/note/blog/insights/catalog）
  // activeStatusFilter: プラットフォームタブ内のステータス副フィルタ
  const [activeTab, setActiveTab] = useState("tiktok");
  const [activeStatusFilter, setActiveStatusFilter] = useState("review");
  const [drafts, setDrafts] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [insights, setInsights] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [templateVariants, setTemplateVariants] = useState([]);
  const [topics, setTopics] = useState([]);
  const [topicCategories, setTopicCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast, showToast } = useToast();

  // 下書きのcontent_group_id → ネタの型、の逆引き。ネタ駆動で生成された下書きに
  // ContentTypeBadgeを表示するために使う（要件15由来、単発投稿にはネタが無いため
  // 何も表示しない）
  const contentTypeByGroupId = useMemo(() => {
    const map = {};
    for (const topic of topics) {
      if (topic.sns_content_types) {
        map[topic.id] = topic.sns_content_types;
      }
    }
    return map;
  }, [topics]);

  // 同じネタ（content_group_id）から派生したYouTube下書きの公開URLの逆引き。
  // note下書きの投稿導線で「YouTube動画URLをコピー」ボタンを出すために使う
  // （2026-09-03、ユーザー要望: noteは文章だけだと読みにくく、YouTubeリンクを
  // 貼ると自動展開されるため。noteは元々手動コピペ運用のため、生成時に
  // YouTube公開を待つブロッキング依存にはせず、投稿時にリンクを取得できれば
  // 十分という判断）。YouTubeは承認と同時に公開されるためsource_data.youtube_url
  // が入っていれば常に実際に有効なURL
  const youtubeUrlByGroupId = useMemo(() => {
    const map = {};
    for (const d of drafts) {
      if (
        d.platform === "youtube" &&
        d.content_group_id &&
        d.source_data?.youtube_url
      ) {
        map[d.content_group_id] = d.source_data.youtube_url;
      }
    }
    return map;
  }, [drafts]);

  // silent=trueの場合、全画面ローディング表示を出さずに裏側でデータだけ
  // 更新する。承認等のアクション直後に画面全体がスピナーに切り替わる
  // 体験が「うざい」という指摘への対応（2026-08-31）。初回マウント時のみ
  // 全画面ローディングを見せる
  // fetchで指定した種類だけを再取得する。承認者・戦略メモ・フォーマットカタログは
  // 下書きへの操作(承認・非表示等)の大半では変化しないため、アクションのたびに
  // 4種類全部を再取得していたのを見直した（2026-09-01対応、ユーザーから「ボタン
  // 操作のたびに遅い」と指摘）。ただし修正指摘（恒久ルール化を選んだ場合）や
  // 戦略メモの却下操作はinsightsも変化させるため、
  // その呼び出し元だけはinsightsもtrueにする（コードレビューで指摘: draftsだけ再取得
  // すると戦略メモタブが古いまま表示され続け、二重に却下しようとして409エラーになる
  // 不具合があった）。すべて省略した場合は従来通りフル再取得（初回マウント・手動更新
  // ボタン用）
  const loadDrafts = useCallback(
    async ({
      silent = false,
      fetch: fetchScope = {
        drafts: true,
        approvers: true,
        insights: true,
        revisions: true,
        templateVariants: true,
        topics: true,
        topicCategories: true,
      },
    } = {}) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        await Promise.all([
          fetchScope.drafts ? getDrafts().then(setDrafts) : null,
          fetchScope.approvers ? getApprovers().then(setApprovers) : null,
          fetchScope.insights ? getInsights().then(setInsights) : null,
          fetchScope.revisions ? getRecentRevisions().then(setRevisions) : null,
          fetchScope.templateVariants
            ? getTemplateVariants().then(setTemplateVariants)
            : null,
          fetchScope.topics ? getTopics().then(setTopics) : null,
          fetchScope.topicCategories
            ? getTopicCategories().then(setTopicCategories)
            : null,
        ]);
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

  // reloadScope: このアクション後にloadDraftsへ渡すfetch指定。省略時はdraftsのみ
  // （大半のアクションはdraftsだけ変化するため）。戦略メモに影響するアクション
  // （却下、恒久ルール化を選んだ修正指摘）を呼ぶ箇所はinsights: trueも指定すること
  async function handleAction(actionFn, args, reloadScope = { drafts: true }) {
    try {
      await actionFn(...args);
      showToast("操作を反映しました", "success");
      await loadDrafts({ silent: true, fetch: reloadScope });
    } catch (err) {
      console.error("アクションエラー:", err);
      showToast(err.message || "操作に失敗しました", "error");
    }
  }

  // 「⚡今すぐ生成」。fireRoutineはRoutine未構築・fire失敗時も例外を投げず
  // {fired: false, reason: ...}を返すため、handleActionの汎用成功トーストでは
  // 実際には起動していない場合に誤って成功表示になる（useTopicProposerTriggerの
  // 既存パターンを踏襲）
  async function handleFireTarget(topicId, targetId) {
    try {
      const result = await fireTopicTargetNow(topicId, targetId);
      if (result?.routine?.fired === false) {
        showToast(
          `起動リクエストがRoutineに届いていません（${result.routine.reason}）。Vercel環境変数の設定を確認してください`,
          "error",
        );
      } else {
        showToast("生成をリクエストしました", "success");
      }
      await loadDrafts({ silent: true, fetch: { topics: true } });
    } catch (err) {
      console.error("今すぐ生成エラー:", err);
      showToast(err.message || "起動リクエストに失敗しました", "error");
    }
  }

  // 「制作仕様の変更要望」。handleActionの汎用成功トーストだと、
  // LINEAR_API_KEY未設定でissueResult.created===falseの場合も「操作を
  // 反映しました」と表示されてしまい、要望が実際には記録されていないのに
  // 成功したと誤解される（コードレビューで指摘、handleFireTargetと同じ
  // 理由でfireRoutineのnot_configuredチェックを個別に行う）
  async function handleRequestSpecChange(draftId, payload) {
    try {
      const result = await requestSpecChange(draftId, payload);
      if (result?.issue?.created === false) {
        showToast(
          `Linear起票がスキップされました（${result.issue.reason}）。要望内容は記録されていません`,
          "error",
        );
      } else {
        showToast("Linearに起票しました", "success");
      }
    } catch (err) {
      console.error("制作仕様変更要望エラー:", err);
      showToast(err.message || "起票に失敗しました", "error");
    }
  }

  // ブログ「承認してPR」後の反映確認（要件82）。handleActionの汎用トースト
  // 「操作を反映しました」だけでは実際にマージされたか判断できないという
  // 指摘を受け、GitHubのマージレスポンス（merge.merged/merge.sha）を見て
  // 個別にメッセージを出し分ける。マージ自体はエンドポイント側で同期的に
  // 完結する設計のため（api/admin/sns-hub/drafts/[id]/merge-blog-pr.js）、
  // ここでの確認はポーリングではなく単発のレスポンス確認で足りる。
  // Toastは2秒で自動消滅・white-space: nowrap・max-width指定無しで画面中央
  // 固定表示する設計（Toast.jsx）のため、既存メッセージ（15文字前後）より
  // 大幅に長い文言はモバイル幅で画面外にはみ出すリスクがある（コードレビュー
  // で指摘）。PR URL等の詳細は埋め込まず短い確認メッセージのみ表示する
  // （URL自体は下書きプレビューに別途表示済み）
  async function handleMergeBlogPr(draftId, approverId) {
    try {
      const result = await mergeBlogPr(draftId, approverId);
      if (result?.merge?.merged) {
        const shaLabel = result.merge.sha
          ? `(${result.merge.sha.slice(0, 7)})`
          : "";
        showToast(`マージしました${shaLabel}`, "success");
      } else {
        showToast("マージ結果を確認できません", "error");
      }
      await loadDrafts({ silent: true, fetch: { drafts: true } });
    } catch (err) {
      console.error("ブログPRマージエラー:", err);
      showToast(err.message || "マージに失敗しました", "error");
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

  const isInsightsTab = activeTab === "insights";
  const isCatalogTab = activeTab === "catalog";
  const isPlatformTab = !isInsightsTab && !isCatalogTab;
  const activeStatusDef = STATUS_FILTERS.find(
    (f) => f.id === activeStatusFilter,
  );
  const visibleDrafts = isPlatformTab
    ? drafts.filter(
        (d) =>
          d.platform === activeTab &&
          activeStatusDef.statuses.includes(d.status),
      )
    : [];

  return (
    <div className="sns-hub-admin-page">
      <Header />

      <TopicApprovalSection
        topics={topics}
        approvers={approvers}
        onApprove={(topicId, approverId) =>
          handleAction(approveTopic, [topicId, approverId], {
            topics: true,
          })
        }
        onReject={(topicId, approverId, reason, saveAsInsight) =>
          handleAction(
            rejectTopic,
            [topicId, approverId, reason, saveAsInsight],
            { topics: true },
          )
        }
        onUpdateTargetLabel={(topicId, targetId, status) =>
          handleAction(updateTopicTargetLabel, [topicId, targetId, status], {
            topics: true,
          })
        }
        onFireTarget={handleFireTarget}
        topicCategories={topicCategories}
        onToggleCategoryChannel={(categoryId, platform, enabled) =>
          handleAction(
            updateTopicCategoryChannel,
            [categoryId, platform, enabled],
            { topicCategories: true },
          )
        }
        onReloadTopics={() =>
          loadDrafts({ silent: true, fetch: { topics: true } })
        }
        showToast={showToast}
      />

      <div className="tab-navigation-row">
        <div className="tab-navigation">
          {TABS.map((tab) => {
            const count =
              tab.id === "insights"
                ? insights.filter((i) => i.status === "proposed").length
                : tab.id === "catalog"
                  ? templateVariants.length
                  : // プラットフォームタブの件数バッジは「承認待ち」件数のみを表示する
                    // （投稿準備完了・投稿済みまで含めると常に大きい数字になり、
                    // 対応が必要な件数という意味が薄れるため）
                    drafts.filter(
                      (d) =>
                        d.platform === tab.id &&
                        STATUS_FILTERS[0].statuses.includes(d.status),
                    ).length;
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
        <button className="refresh-btn" onClick={() => loadDrafts()}>
          🔄 更新
        </button>
      </div>

      {isPlatformTab && (
        <div className="status-filter-row">
          {STATUS_FILTERS.map((filter) => {
            const count = drafts.filter(
              (d) =>
                d.platform === activeTab && filter.statuses.includes(d.status),
            ).length;
            return (
              <button
                key={filter.id}
                className={`status-filter-btn ${activeStatusFilter === filter.id ? "active" : ""}`}
                onClick={() => setActiveStatusFilter(filter.id)}
              >
                {filter.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      <div className="tab-content">
        {isCatalogTab ? (
          <CatalogTab templateVariants={templateVariants} />
        ) : isInsightsTab ? (
          <InsightTab
            insights={insights}
            revisions={revisions}
            onApprove={(insightId) =>
              handleAction(approveInsight, [insightId], {
                drafts: true,
                insights: true,
              })
            }
            onReject={(insightId, reason) =>
              handleAction(rejectInsight, [insightId, reason], {
                drafts: true,
                insights: true,
              })
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
                contentType={contentTypeByGroupId[draft.content_group_id]}
                youtubeUrl={youtubeUrlByGroupId[draft.content_group_id]}
                approvers={approvers}
                onApprove={(approverId) =>
                  handleAction(approveDraft, [draft.id, approverId])
                }
                onMergeBlogPr={(approverId) =>
                  handleMergeBlogPr(draft.id, approverId)
                }
                onPublishYoutube={(approverId) =>
                  handleAction(publishYoutube, [draft.id, approverId])
                }
                onRevise={(payload) =>
                  handleAction(redoDraft, [draft.id, payload], {
                    drafts: true,
                    insights: true,
                  })
                }
                onRequestSpecChange={(payload) =>
                  handleRequestSpecChange(draft.id, payload)
                }
                onMarkPosted={() => handleAction(markDraftPosted, [draft.id])}
                onAddMetric={(payload) =>
                  handleAction(addDraftMetric, [draft.id, payload])
                }
                onArchive={() => handleAction(archiveDraft, [draft.id])}
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

const PLATFORM_LABELS = {
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  blog: "ブログ",
  note: "note",
};
const LANGUAGE_LABELS = { ja: "日本語", en: "English" };
const SOURCE_LABELS = {
  "own-metrics": "自社実績",
  "external-research": "外部調査",
};

// 「フォーマットカタログ」タブ: 型一覧(DB)＋ドキュメント要約(静的キュレーション)の2区画
// （2026-08-31、ユーザー要望。既存の「戦略メモ」はinsight PDCA専用のため別タブとして新設、
// docs/design/sns-hub-admin-ux-improvements/spec.md課題3参照）
// REVISION_REASONS（動画向け）・CONTENT_REVISION_REASONS（ブログ/note向け）を
// 統合したcode→labelの逆引き表。共通するcode（typo-or-data-error等）は
// 両リストで同じlabelのため単純mergeで問題ない（2026-09-04、過去のFB表示用）
const REVISION_REASON_LABELS = Object.fromEntries(
  [...REVISION_REASONS, ...CONTENT_REVISION_REASONS].map((r) => [
    r.code,
    r.label,
  ]),
);

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

function CatalogTab({ templateVariants }) {
  return (
    <div className="catalog-tab">
      <section className="catalog-section">
        <h2 className="catalog-section-title">型一覧</h2>
        <TemplateVariantList templateVariants={templateVariants} />
      </section>
      <section className="catalog-section">
        <h2 className="catalog-section-title">生成ルール</h2>
        <RulesReferenceSection />
      </section>
      <section className="catalog-section">
        <h2 className="catalog-section-title">デザイン・ペルソナ方針</h2>
        <DocReferenceSection />
      </section>
    </div>
  );
}

// PLATFORM_TABSと同じ表示順・ラベルを使う（sns_target_accounts.platformの語彙と一致）
const CATEGORY_CHANNEL_PLATFORMS = ["blog", "note", "x", "tiktok", "youtube"];
const CATEGORY_CHANNEL_LABELS = {
  blog: "Blog",
  note: "Note",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
};

// ネタの型（会場特性・選手調子・イン崩れ注意度等）×チャネルのON/OFF設定画面
// （2026-09-03新設）。TikTokはガイドライン上センシティブなため、型ごとに
// チャネル可否を人間が直接編集できるようにする（channelMatrix.js・各Routineの
// プロンプト文言に散在していた判断をデータに寄せる）
function TopicCategorySettingsTab({ categories, onToggleChannel }) {
  if (categories.length === 0) {
    return (
      <div className="empty-state">
        <p>登録されているネタの型はありません。</p>
      </div>
    );
  }

  return (
    <div className="topic-category-settings">
      <p className="topic-category-settings-hint">
        ネタの型ごとに、各チャネルへの生成対象可否を設定できます。特にTikTokはガイドライン上センシティブなため、実績を見ながら個別に調整してください。廃止済みの型は行がグレーアウトします。
      </p>
      <p className="topic-category-settings-hint">
        例1: 「イン崩れ注意度」でTikTokの投稿が制限を受けた
        →「イン崩れ注意度」行のTikTok列をOFFにする（他チャネルはそのまま）。
        例2: 「豆知識型」は成績・確率と無関係
        →全チャネルONのままでよい。ℹ️アイコンがある行は除外理由をホバーで確認できる。
      </p>
      <div className="topic-category-settings-scroll">
        <table className="topic-category-settings-table">
          <thead>
            <tr>
              <th>型</th>
              <th>頻度区分</th>
              {CATEGORY_CHANNEL_PLATFORMS.map((platform) => (
                <th key={platform}>{CATEGORY_CHANNEL_LABELS[platform]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr
                key={category.id}
                className={
                  category.active
                    ? "topic-category-row"
                    : "topic-category-row topic-category-row-inactive"
                }
              >
                <td className="topic-category-label-cell">
                  <span className="topic-category-label">{category.label}</span>
                  {!category.active && (
                    <span className="topic-category-inactive-badge">
                      廃止済み
                    </span>
                  )}
                  {category.notes && (
                    <span
                      className="topic-category-notes"
                      title={category.notes}
                    >
                      ℹ️
                    </span>
                  )}
                </td>
                <td className="topic-category-cadence-cell">
                  {category.sns_content_types?.label || "未接続"}
                </td>
                {CATEGORY_CHANNEL_PLATFORMS.map((platform) => {
                  const channel = (
                    category.sns_topic_category_channels || []
                  ).find((c) => c.platform === platform);
                  const enabled = channel?.enabled ?? false;
                  return (
                    <td key={platform} className="topic-category-channel-cell">
                      <button
                        type="button"
                        className={`topic-category-channel-toggle${
                          enabled ? " on" : " off"
                        }`}
                        disabled={!category.active || !channel}
                        onClick={() =>
                          onToggleChannel(category.id, platform, !enabled)
                        }
                      >
                        {enabled ? "ON" : "OFF"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            {FORMAT_LABELS[format] || format}（{variants.length}件）
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

// 全体ルール（Tier1）・チャネル別ルール（Tier2）へのリンク集。デザイン・
// ペルソナ方針（DocReferenceSection）とは意味が異なる（技術ルール vs
// 制作方針）ため別コンポーネントに分離した（2026-09-04、UI/UXレビュー指摘:
// 「デザイン・ペルソナ方針」の見出し下に技術ルールを入れると見出しと
// 中身が一致しない）
function RulesReferenceSection() {
  return (
    <div className="doc-reference-section">
      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">
          🌐 全体ルール（全チャネル共通）
        </h3>
        {GLOBAL_RULES.map((r) => (
          <div key={r.name} className="doc-reference-card">
            <div className="doc-reference-card-header">
              <span className="doc-reference-name">{r.name}</span>
            </div>
            <p className="doc-reference-summary">{r.summary}</p>
            <a
              href={buildDocUrl(r.docPath)}
              target="_blank"
              rel="noreferrer"
              className="doc-reference-link"
            >
              {r.docLabel} を見る →
            </a>
          </div>
        ))}
      </div>

      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">📡 チャネル別ルール</h3>
        <div className="doc-reference-channel-grid">
          {CHANNEL_RULES.map((r) => (
            <a
              key={r.platform}
              href={buildDocUrl(r.docPath)}
              target="_blank"
              rel="noreferrer"
              className="doc-reference-channel-link"
            >
              <span className="doc-reference-channel-label">{r.label}</span>
              <span className="doc-reference-channel-doc">{r.docLabel}</span>
            </a>
          ))}
        </div>
      </div>
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

function InsightTab({ insights, onApprove, onReject, revisions }) {
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

// blog/youtubeは承認操作自体がPRマージ/YouTube投稿まで行うため、
// 承認後は"approved"状態を経由せず直接"posted"になる（ADR 0034, 0035）
const AUTO_PUBLISH_PLATFORMS = new Set(["blog", "youtube"]);
const TEXT_DRAFT_PLATFORMS = new Set(["blog", "note"]);

function DraftCard({
  draft,
  contentType,
  youtubeUrl,
  approvers,
  onApprove,
  onMergeBlogPr,
  onPublishYoutube,
  onRevise,
  onRequestSpecChange,
  onMarkPosted,
  onAddMetric,
  onArchive,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const [openPanel, setOpenPanel] = useState(null); // null | 'feedback'
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [expanded, setExpanded] = useState(getDefaultDraftCardExpanded);

  const variantLabel = draft.sns_template_variants
    ? `${draft.format} / ${draft.sns_template_variants.variant_name}`
    : draft.format;

  // 承認・修正はpending_reviewの下書きにのみ許可される（api/admin/sns-hub側の検証と一致）
  const canAct = draft.status === "pending_review";

  // 修正指摘パネルを開いている間は、トグルで折りたたんでも
  // パネルをアンマウントしない（コードレビューで指摘: 折りたたむと入力中の
  // freeText等がRevisionPanelごと消え、ユーザーに無警告でデータが失われるため）
  const isOpen = expanded || openPanel !== null;

  return (
    <div className={`draft-card${isOpen ? " draft-card--expanded" : ""}`}>
      {TEXT_DRAFT_PLATFORMS.has(draft.platform) ? (
        <TextDraftPreview draft={draft} />
      ) : (
        <VideoPreview
          videoUrl={draft.video_url}
          coverImageUrl={draft.cover_image_url}
          active={isOpen}
        />
      )}
      {draft.platform === "youtube" && (
        <ThumbnailPreview thumbnailUrl={draft.cover_image_url} />
      )}

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
          {contentType && <ContentTypeBadge contentType={contentType} />}
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
                  {draft.platform === "blog" ? (
                    <BlogApproveAction
                      disabled={!selectedApproverId}
                      onApprove={() => onMergeBlogPr(selectedApproverId)}
                    />
                  ) : draft.platform === "youtube" ? (
                    <YouTubeApproveAction
                      disabled={!selectedApproverId}
                      onApprove={() => onPublishYoutube(selectedApproverId)}
                    />
                  ) : (
                    <button
                      className="draft-action-btn approve"
                      disabled={!selectedApproverId}
                      onClick={() => onApprove(selectedApproverId)}
                    >
                      ✅ 承認
                    </button>
                  )}
                  <button
                    className="draft-action-btn revise"
                    onClick={() =>
                      setOpenPanel(openPanel === "feedback" ? null : "feedback")
                    }
                  >
                    📝 修正を依頼
                  </button>
                </div>

                {openPanel === "feedback" && (
                  <RevisionPanel
                    mode="draft-feedback"
                    reasons={
                      TEXT_DRAFT_PLATFORMS.has(draft.platform)
                        ? CONTENT_REVISION_REASONS
                        : REVISION_REASONS
                    }
                    onCancel={() => setOpenPanel(null)}
                    onSubmit={(payload) => {
                      if (payload.category === "spec") {
                        onRequestSpecChange({
                          approverId: selectedApproverId,
                          platform: draft.platform,
                          message: payload.freeText,
                        });
                      } else {
                        onRevise({
                          approverId: selectedApproverId,
                          reasonCodes: payload.reasonCodes,
                          freeText: payload.freeText,
                          saveAsInsight: payload.permanent,
                          scope: payload.scope,
                        });
                      }
                      setOpenPanel(null);
                    }}
                  />
                )}
              </>
            )}

            {(draft.status === "approved" ||
              draft.status === "ready_to_post") &&
              (draft.platform === "note" ? (
                <NoteCopyActionLinks
                  draft={draft}
                  youtubeUrl={youtubeUrl}
                  onMarkPosted={onMarkPosted}
                />
              ) : (
                <PostingActionLinks draft={draft} onMarkPosted={onMarkPosted} />
              ))}

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
      await downloadFileBlob(
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

// mode:
//  - "topic-reject": ネタ却下用（TopicCard）。理由チップ+自由記述+「今後に反映」
//    チェックボックスのみのシンプルな形（2026-09-04以前と同じ挙動を維持）
//  - "draft-feedback": 下書きへの修正指摘用（DraftCard、2026-09-04再設計）。
//    「一部修正」「全部作り直し」は実務上ほぼ全部作り直しになっていたため
//    1つのフローに統合した上で、指摘の性質を明示的に2分岐させる:
//    - コンテンツ品質の指摘: 理由チップ+自由記述。反映期間（今回限り/恒久）と
//      適用範囲（このチャネルのみ/全チャネル共通）を明示的に選ばせる
//      （旧「この指摘を今後の生成方針に反映する」チェックボックス1個だと、
//      恒久化した際の適用範囲が下書きから自動推定される曖昧な挙動だった）
//    - 制作仕様の変更要望: 尺・BGM等、個別の下書き修正では解決しない要望。
//      Linear起票のみ行い、下書き自体のステータスは変更しない
function RevisionPanel({
  mode,
  reasons = REVISION_REASONS,
  onSubmit,
  onCancel,
}) {
  const isDraftFeedback = mode === "draft-feedback";
  const [category, setCategory] = useState("quality"); // "quality" | "spec"
  const [reasonCodes, setReasonCodes] = useState([]);
  const [freeText, setFreeText] = useState("");
  const [saveAsInsight, setSaveAsInsight] = useState(false); // topic-reject用
  const [permanent, setPermanent] = useState(false); // draft-feedback用（旧saveAsInsight相当）
  const [scope, setScope] = useState("channel"); // "channel" | "all"

  function toggleReason(code) {
    setReasonCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  const isSpecCategory = isDraftFeedback && category === "spec";
  const hasFreeText = freeText.trim().length > 0;
  const canSubmit = isSpecCategory
    ? hasFreeText
    : reasonCodes.length > 0 || hasFreeText;

  return (
    <div className="revision-panel">
      {isDraftFeedback && (
        <div className="revision-category-toggle">
          <button
            type="button"
            className={`revision-category-btn ${category === "quality" ? "selected" : ""}`}
            onClick={() => setCategory("quality")}
          >
            📋 コンテンツ品質の指摘
          </button>
          <button
            type="button"
            className={`revision-category-btn ${category === "spec" ? "selected" : ""}`}
            onClick={() => setCategory("spec")}
          >
            🔧 制作仕様の変更要望
          </button>
        </div>
      )}

      {!isSpecCategory && (
        <div className="revision-reason-chips">
          {reasons.map((r) => (
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
          isSpecCategory
            ? "例: BGMをもっと軽快な曲にしてほしい、尺を20秒に伸ばしてほしい"
            : "自由記述（任意）"
        }
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
      />

      {isSpecCategory ? (
        <p className="revision-spec-hint">
          この内容でLinearにチケットを起票します。この下書き自体は変更されません（承認/修正指摘は別途行ってください）。
          今すぐ複数案を比較しながら作り込みたい場合は、Claude Codeで
          <code>/refine-creative</code>を使う方が早い場合があります。
        </p>
      ) : (
        <>
          {/* BGM・デザイン等の抜本的な作り込みはこのUIでは行わない設計
              （.claude/CLAUDE.mdフローB参照）。ここで気づいてもらうための
              軽いヒントのみ表示する */}
          {isDraftFeedback && (
            <p className="revision-refine-hint">
              💡 尺・BGM等の制作仕様そのものを変えたい場合は、上の「🔧
              制作仕様の変更要望」を選んでください
            </p>
          )}

          {isDraftFeedback ? (
            <div className="revision-permanence-group">
              <span className="revision-permanence-label">反映期間:</span>
              <label className="revision-radio">
                <input
                  type="radio"
                  name="revision-permanent"
                  checked={!permanent}
                  disabled={!hasFreeText}
                  onChange={() => setPermanent(false)}
                />
                今回限り
              </label>
              <label className="revision-radio">
                <input
                  type="radio"
                  name="revision-permanent"
                  checked={permanent}
                  disabled={!hasFreeText}
                  onChange={() => setPermanent(true)}
                />
                恒久ルール化
              </label>
              {permanent && (
                <>
                  <span className="revision-permanence-label">適用範囲:</span>
                  <label className="revision-radio">
                    <input
                      type="radio"
                      name="revision-scope"
                      checked={scope === "channel"}
                      onChange={() => setScope("channel")}
                    />
                    このチャネルのみ
                  </label>
                  <label className="revision-radio">
                    <input
                      type="radio"
                      name="revision-scope"
                      checked={scope === "all"}
                      onChange={() => setScope("all")}
                    />
                    全チャネル共通
                  </label>
                </>
              )}
            </div>
          ) : (
            <label className="revision-save-insight">
              <input
                type="checkbox"
                checked={saveAsInsight}
                disabled={!hasFreeText}
                onChange={(e) => setSaveAsInsight(e.target.checked)}
              />
              この指摘を今後の生成方針に反映する
            </label>
          )}
        </>
      )}

      <div className="revision-panel-actions">
        <button className="revision-cancel" onClick={onCancel}>
          キャンセル
        </button>
        <button
          className="revision-submit"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              category: isDraftFeedback ? category : undefined,
              reasonCodes,
              freeText,
              // ラジオ/チェックボックスはdisabledでもstate自体はリセットされない
              // ため、自由記述を消してから送信した場合に備え送信時点で再検証する
              // （コードレビューで指摘: 空のfreeTextとsaveAsInsight:trueが
              // 同時に送信されうる不整合があった）
              saveAsInsight: saveAsInsight && hasFreeText,
              permanent: permanent && hasFreeText,
              scope,
            })
          }
        >
          送信
        </button>
      </div>
    </div>
  );
}

// ブログ/note下書きのプレビュー（2026-09-01追加、screens.md参照）。
// VideoPreviewの文章版。タイトル・本文（折りたたみ可）・タグ・画像or
// YouTube動画リンクを表示する
function TextDraftPreview({ draft }) {
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const bodyText = draft.caption_text || "";
  const isLong = bodyText.length > 200;
  const displayText =
    isLong && !bodyExpanded ? `${bodyText.slice(0, 200)}…` : bodyText;

  return (
    <div className="text-draft-preview">
      {draft.title && <h3 className="text-draft-title">{draft.title}</h3>}

      {draft.platform === "blog" && draft.pr_url && (
        <a
          className="text-draft-pr-link"
          href={draft.pr_url}
          target="_blank"
          rel="noreferrer"
        >
          🔗 Draft PRでレンダリング結果を確認（承認前に必ず見る）
        </a>
      )}

      {draft.cover_image_url ? (
        <img
          src={draft.cover_image_url}
          alt=""
          className="text-draft-cover-image"
        />
      ) : (
        draft.embed_video_url && (
          <a
            className="text-draft-embed-video-link"
            href={draft.embed_video_url}
            target="_blank"
            rel="noreferrer"
          >
            🎬 埋め込み動画を見る
          </a>
        )
      )}

      {bodyText && (
        <>
          <p className="text-draft-body">{displayText}</p>
          {isLong && (
            <button
              type="button"
              className="text-draft-expand-toggle"
              onClick={() => setBodyExpanded((v) => !v)}
            >
              {bodyExpanded ? "▲ 折りたたむ" : "▼ 全文を見る"}
            </button>
          )}
        </>
      )}

      {draft.hashtags?.length > 0 && (
        <div className="text-draft-tags">
          {draft.hashtags.map((tag) => (
            <span key={tag} className="text-draft-tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// クリップボードへのコピー汎用ボタン（2026-09-01追加）。note下書きの
// 本文・タグをワンタップでコピーする用途で新設したが、他画面でも再利用できる
// 汎用コンポーネントとして実装している
function CopyToClipboardButton({ text, label }) {
  const [feedback, setFeedback] = useState(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("コピーしました");
    } catch (err) {
      console.error("コピーエラー:", err);
      setFeedback("コピーに失敗しました");
    }
    setTimeout(() => setFeedback(null), 2000);
  }

  return (
    <span className="copy-to-clipboard">
      <button
        type="button"
        className="posting-action-btn copy"
        onClick={handleCopy}
      >
        📋 {label}
      </button>
      {feedback && <span className="copy-feedback">{feedback}</span>}
    </span>
  );
}

// カバー画像のダウンロードボタン（2026-09-04追加）。downloadFileBlob（クロス
// オリジンURLのdownload属性無視問題を回避するfetch→Blob方式）を画像URLにも使う
function DownloadImageButton({ imageUrl, fileName, label }) {
  const [state, setState] = useState({ downloading: false, error: null });

  async function handleDownload() {
    setState({ downloading: true, error: null });
    try {
      await downloadFileBlob(imageUrl, fileName);
      setState({ downloading: false, error: null });
    } catch (err) {
      console.error("カバー画像ダウンロードエラー:", err);
      setState({ downloading: false, error: "ダウンロードに失敗しました" });
      setTimeout(() => setState({ downloading: false, error: null }), 3000);
    }
  }

  return (
    <span className="copy-to-clipboard">
      <button
        type="button"
        className="posting-action-btn download"
        onClick={handleDownload}
        disabled={state.downloading}
      >
        {state.downloading ? "⏳ ダウンロード準備中..." : `⬇️ ${label}`}
      </button>
      {state.error && <span className="copy-feedback">{state.error}</span>}
    </span>
  );
}

// note下書きの投稿導線（2026-09-01追加）。PostingActionLinks（動画向け）の
// note版。noteは公開APIが無いため自動投稿はできず、本文・タグをコピーして
// 手動でnoteエディタに貼り付けてもらう運用（.claude/CLAUDE.mdフローC-1と同じ
// 「コピペ＋人間が最終操作」パターン）
function NoteCopyActionLinks({ draft, youtubeUrl, onMarkPosted }) {
  const tagsText = (draft.hashtags || []).join(" ");
  return (
    <div className="posting-action-links">
      <CopyToClipboardButton
        text={draft.title || ""}
        label="タイトルをコピー"
      />
      <CopyToClipboardButton
        text={draft.caption_text || ""}
        label="本文をコピー"
      />
      {tagsText && (
        <CopyToClipboardButton text={tagsText} label="タグをコピー" />
      )}
      {draft.cover_image_url && (
        <DownloadImageButton
          imageUrl={draft.cover_image_url}
          fileName={`${draft.platform}-${draft.language}-cover.jpg`}
          label="カバー画像をダウンロード"
        />
      )}
      {youtubeUrl && (
        // noteはURLをそのまま貼ると自動でプレイヤーが展開されるため、
        // 文章だけの下書きより視覚的に分かりやすくなる（2026-09-03、
        // ユーザー要望）。生成時にYouTube公開を待つ強い依存にはせず、
        // 承認済みYouTube下書きが既にあれば投稿時にコピーできるようにする
        <CopyToClipboardButton
          text={youtubeUrl}
          label="YouTube動画URLをコピー"
        />
      )}
      <a
        className="posting-action-btn platform-link"
        href="https://note.com/notes/new"
        target="_blank"
        rel="noreferrer"
      >
        noteエディタを開く
      </a>
      <button className="posting-action-btn mark-posted" onClick={onMarkPosted}>
        投稿済みにする
      </button>
    </div>
  );
}

// YouTube下書きのサムネイルプレビュー（2026-09-01追加）。VideoPreviewの
// 画像版だが、YouTube固有（1280x720固定）のため独立コンポーネントにしている
function ThumbnailPreview({ thumbnailUrl }) {
  if (!thumbnailUrl) {
    return (
      <div className="thumbnail-preview thumbnail-preview-empty">
        サムネイル未生成
      </div>
    );
  }
  return (
    <div className="thumbnail-preview">
      <img src={thumbnailUrl} alt="" className="thumbnail-preview-image" />
    </div>
  );
}

// blogの「承認」は同時にDraft PRをマージする不可逆操作のため、確認ダイアログを
// 挟む（ADR 0034）。ボタン文言も「承認」ではなく明示的にする
function BlogApproveAction({ disabled, onApprove }) {
  function handleClick() {
    if (
      window.confirm(
        "承認すると、対応するDraft PRが即座にマージされます。よろしいですか？",
      )
    ) {
      onApprove();
    }
  }
  return (
    <button
      className="draft-action-btn approve"
      disabled={disabled}
      onClick={handleClick}
    >
      ✅ 承認してPRをマージ
    </button>
  );
}

// YouTubeの「承認」も同時に実投稿する不可逆操作のため、確認ダイアログを挟む
// （ADR 0035）
function YouTubeApproveAction({ disabled, onApprove }) {
  function handleClick() {
    if (
      window.confirm(
        "承認すると、YouTubeへ即座に動画が公開されます。よろしいですか？",
      )
    ) {
      onApprove();
    }
  }
  return (
    <button
      className="draft-action-btn approve"
      disabled={disabled}
      onClick={handleClick}
    >
      ✅ 承認してYouTubeに公開
    </button>
  );
}

// active=falseの間（モバイルでカードが折りたたまれている等）は<video>をマウント
// せずカバー画像のみ表示する（2026-09-01対応）。一覧に多数のカードが並ぶと
// <video preload="metadata">が同時に何本もロードされ、体感速度に影響していた
// （ユーザー指摘）ため、実際に見る操作（カードを展開する）をした時だけ動画を
// 読み込むようにした
function VideoPreview({ videoUrl, coverImageUrl, active = true }) {
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

  if (!active) {
    return (
      <div className="video-preview video-preview-inactive">
        {coverImageUrl ? (
          <img src={coverImageUrl} alt="" className="video-preview-cover" />
        ) : (
          <p>動画準備中</p>
        )}
        <span className="video-preview-play-badge">▶</span>
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

// 型（週次/日次・一般/日次・時間制約）を表す小バッジ。TopicCardとDraftCardの
// 両方で使う共通部品（screens.md #4）
function ContentTypeBadge({ contentType }) {
  return (
    <span
      className={`content-type-badge content-type-badge-${contentType.type_key}`}
    >
      {contentType.label}
    </span>
  );
}

// sns_topic_targetsの各アカウントをpending⇔skippedで切り替えるチップ群
// （spec.md要件14、screens.md #5）。claim済み・生成済みのターゲットは
// クリック不可（既にパイプラインが着手しているため）
function ChannelTargetToggle({ targets, onToggle }) {
  return (
    <div className="channel-target-toggle">
      {targets.map((target) => {
        const account = target.sns_target_accounts;
        const label = account
          ? `${PLATFORM_LABELS[account.platform] || account.platform}`
          : "unknown";
        const isLocked =
          target.status === "claimed" || target.status === "generated";
        return (
          <button
            key={target.id}
            type="button"
            className={`channel-target-chip channel-target-chip-${target.status}`}
            disabled={isLocked}
            title={
              target.status === "skipped" && target.skip_reason
                ? target.skip_reason
                : undefined
            }
            onClick={() =>
              onToggle(
                target.id,
                target.status === "skipped" ? "pending" : "skipped",
              )
            }
          >
            {label}
            {target.status === "skipped" && " (除外)"}
            {isLocked &&
              ` (${target.status === "claimed" ? "生成中" : "生成済み"})`}
          </button>
        );
      })}
    </div>
  );
}

// RevisionPanel（mode="topic-reject"）のreasonCodes/freeTextを、却下理由の
// 表示文字列に変換する共通関数（2026-09-04、コードレビューで指摘: TopicCard/
// TopicFanoutCardで一字一句同じロジックが重複しており、片方だけ修正されて
// もう一方に伝播しない不具合の温床になっていた。sns-content-generation.mdの
// 「片方のパイプラインだけ実装され他方に伝播しない」既知パターンと同種）
function buildTopicRejectionReason(reasonCodes, freeText) {
  const reasonLabels = reasonCodes
    .map((code) => TOPIC_REJECTION_REASONS.find((r) => r.code === code)?.label)
    .filter(Boolean);
  return [reasonLabels.join("、"), freeText.trim()].filter(Boolean).join(" / ");
}

// 「ネタ承認」タブの個別ネタカード（screens.md #3）。TextDraftPreview/VideoPreview
// とは別役割（動画・本文のプレビューでなく、ネタ本文＋メタ情報の確認）のため
// 軽量な新規実装とする
function TopicCard({
  topic,
  approvers,
  onApprove,
  onReject,
  onUpdateTargetLabel,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const targets = topic.sns_topic_targets || [];
  // 却下理由の入力パネル。即時却下ではなく、簡単な理由フィードバックを
  // 挟めるようにする（2026-09-04ユーザー要望）。draft revise/redoと同じ
  // RevisionPanel（チップ選択+自由記述）をTOPIC_REJECTION_REASONSで流用し、
  // タップだけで理由を選べるようにする（自由記述だけだと面倒との指摘）
  const [showRejectPanel, setShowRejectPanel] = useState(false);

  return (
    <div className="topic-card">
      <div className="topic-card-badges">
        {topic.sns_content_types && (
          <ContentTypeBadge contentType={topic.sns_content_types} />
        )}
      </div>
      <p className="topic-card-text">{topic.topic_text}</p>
      <p className="topic-card-meta">
        提案: {formatDateTime(topic.proposed_at)}
        {topic.source_insight_ids?.length > 0 &&
          ` ・根拠insight ${topic.source_insight_ids.length}件`}
      </p>
      <ChannelTargetToggle
        targets={targets}
        onToggle={(targetId, status) =>
          onUpdateTargetLabel(topic.id, targetId, status)
        }
      />
      <ApproverChips
        approvers={approvers}
        selectedId={selectedApproverId}
        onSelect={setSelectedApproverId}
      />
      {showRejectPanel ? (
        <RevisionPanel
          mode="topic-reject"
          reasons={TOPIC_REJECTION_REASONS}
          onCancel={() => setShowRejectPanel(false)}
          onSubmit={({ reasonCodes, freeText, saveAsInsight }) => {
            const reason = buildTopicRejectionReason(reasonCodes, freeText);
            onReject(topic.id, selectedApproverId, reason, saveAsInsight);
            setShowRejectPanel(false);
          }}
        />
      ) : (
        <div className="topic-card-actions">
          <button
            type="button"
            className="topic-approve-btn"
            onClick={() => onApprove(topic.id, selectedApproverId)}
          >
            ✅ 承認
          </button>
          <button
            type="button"
            className="topic-reject-btn"
            onClick={() => setShowRejectPanel(true)}
          >
            却下
          </button>
        </div>
      )}
    </div>
  );
}

// 承認済みネタ×アカウントの生成状況をカード形式で表示する（要件15、screens.md #6）
// 元はtable実装だったが、実データの長文topic_text（80〜100字の完全な文）で
// セルがoverflowし隣接セルと視覚的に重なる不具合が発生したため、
// カード（topic_textは通常のブロック要素として自然に折り返す）+
// チャネルステータスをchip群で並べる形に再設計した（2026-09-04）
// 承認済みネタ1件×アカウントのチャネル別生成状況チップ。sns-hub UI再設計
// （2026-09-04、要件26/27）で🌅当日の運用・📦ネタのストック管理どちらの
// ブロックでも同じカード構造を使う共通部品にした
function TargetChip({ target, topicId, onFireTarget, firingTargetId }) {
  const label = PLATFORM_LABELS[target.sns_target_accounts?.platform] || "?";
  if (target.status === "generated") {
    return <span className="ch-chip ch-chip-ready">✓ {label} 生成済み</span>;
  }
  if (target.status === "claimed") {
    return <span className="ch-chip ch-chip-wait">{label} 生成中</span>;
  }
  if (target.status === "skipped") {
    return (
      <span
        className="ch-chip ch-chip-dim"
        title={target.skip_reason || undefined}
      >
        {label} 対象外
      </span>
    );
  }
  // pending
  return (
    <span className="ch-chip ch-chip-wait">
      {label} 待機中
      <button
        type="button"
        className="ch-chip-fire"
        disabled={firingTargetId === target.id}
        title="対象チャネルのパイプラインを今すぐ起動します（放っておいても通常のポーリングでいずれ生成されます）"
        onClick={() => onFireTarget(topicId, target.id)}
      >
        {firingTargetId === target.id ? "⏳" : "⚡今すぐ"}
      </button>
    </span>
  );
}

// onReject/approversは「📦ネタのストック管理」（承認済みネタ）でのみ渡す。
// 「🌅当日の運用」（自動承認・即日消化）は却下UIを出さない（2026-09-04、
// 要件: 承認済みネタを却下できるようにする。生成済みターゲットに紐づく
// 下書きは連動して非表示にせず、運用者が下書きタブで個別にarchiveする
// 最小実装とする方針）
function TopicFanoutCard({
  topic,
  onFireTarget,
  firingTargetId,
  onReject,
  approvers,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers?.[0]?.id || null,
  );
  const [showRejectPanel, setShowRejectPanel] = useState(false);
  // claimed（生成中）・generated（生成済み）のターゲットが既にある場合、
  // reject.jsのコメント通り却下してもバックグラウンドの生成は止まらない。
  // この既知の制約をUIで初めて明示する（2026-09-04、UI/UXレビュー指摘:
  // 後戻りしにくい操作なのに副作用が画面のどこにも表示されていなかった）
  const targets = topic.sns_topic_targets || [];
  const hasInFlightTarget = targets.some(
    (t) => t.status === "claimed" || t.status === "generated",
  );

  return (
    <div className="mini-card">
      <p className="mini-card-topic">{topic.topic_text}</p>
      <div className="chip-row">
        {targets.map((target) => (
          <TargetChip
            key={target.id}
            target={target}
            topicId={topic.id}
            onFireTarget={onFireTarget}
            firingTargetId={firingTargetId}
          />
        ))}
      </div>
      {onReject &&
        (showRejectPanel ? (
          <>
            <p className="topic-reject-warning">
              {hasInFlightTarget
                ? "⚠️ 生成中/生成済みのチャネルがあります。却下してもその生成は止まりません。生成済みの下書きは各プラットフォームタブで個別にarchiveしてください。"
                : "却下すると承認状態が取り消されます。まだ生成されていないチャネルは以後生成されなくなります。"}
            </p>
            <RevisionPanel
              mode="topic-reject"
              reasons={TOPIC_REJECTION_REASONS}
              onCancel={() => setShowRejectPanel(false)}
              onSubmit={({ reasonCodes, freeText, saveAsInsight }) => {
                const reason = buildTopicRejectionReason(reasonCodes, freeText);
                onReject(topic.id, selectedApproverId, reason, saveAsInsight);
                setShowRejectPanel(false);
              }}
            />
          </>
        ) : (
          <div className="mini-card-actions">
            <ApproverChips
              approvers={approvers}
              selectedId={selectedApproverId}
              onSelect={setSelectedApproverId}
            />
            <button
              type="button"
              className="topic-withdraw-btn"
              onClick={() => setShowRejectPanel(true)}
            >
              却下（承認取り消し）
            </button>
          </div>
        ))}
    </div>
  );
}

// 「ネタ承認」タブ本体（screens.md #2）。status='proposed'（承認要否の型のみ）を
// 一覧表示し、承認済みネタの進捗マトリクスも合わせて表示する
// タブではなく専用セクションとして、下書き承認タブ群(TABS)の上に常時表示する
// （2026-09-03ユーザー指摘: 「承認→各プラットフォームタブに生成される」という
// 流れが、同列の1タブに埋もれると分かりにくいため）
// ネタ提案Routine（週次・日次いずれも）の手動起動状態を管理する共通フック。
// 通常cronのみで動くRoutineを、承認済みストックが少ない・動作確認したい場面で
// 即時起動できるようにする（2026-09-04追加、週次で先に実装し日次追加時に
// フック化した）。この状態はTopicApprovalSection自身に閉じているため、他の
// 生成系ボタン（親コンポーネント側）と違い親のstateには持ち上げない
// expectedCount: このトリガーで何件の新規ネタ登録を待つか。週次(最大10件)は
// 「新規1件検知で即完了扱い」にすると9件を確認しないまま自動更新が止まって
// しまうため、日次自動提案(常に1件)と挙動を分けている（2026-09-05）。
// matchesTopic: topics配列は週次・日次両プロポーザーで共有しているため、
// 他方が同時に作成したネタを誤ってカウントしないよう、自分のcontent_type
// 由来のネタだけに絞り込むための述語（コードレビューで指摘、2026-09-05）。
// maxWaitMinutesは、想定件数に届かないまま（候補切れ・エラー等で）ポーリング
// し続けることを避けるための上限。quietMinutesは、複数件(expectedCount>1)を
// 待つ場合に、1件以上登録できた後にしばらく新規登録が無ければ「候補切れ等で
// 正常終了した」とみなして想定件数未達のままmaxWaitMinutesを待たずに確認を
// 打ち切るための閾値（週次ドキュメント上、候補切れで10件未満のまま終わるのが
// 正常挙動のため。コードレビューで指摘、2026-09-05）
function useTopicProposerTrigger({
  triggerFn,
  topics,
  showToast,
  label,
  expectedCount = 1,
  matchesTopic = () => true,
  quietMinutes = 4,
  maxWaitMinutes = 20,
}) {
  const [triggering, setTriggering] = useState(false);
  const [locked, setLocked] = useState(false);
  const [sessionUrl, setSessionUrl] = useState(null);
  const [firedAt, setFiredAt] = useState(null);
  const [lastActivityAt, setLastActivityAt] = useState(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [idsAtFire, setIdsAtFire] = useState(null);
  const [registeredCount, setRegisteredCount] = useState(0);

  function reset() {
    setLocked(false);
    setSessionUrl(null);
    setFiredAt(null);
    setLastActivityAt(null);
    setIdsAtFire(null);
    setRegisteredCount(0);
  }

  async function trigger(arg) {
    setTriggering(true);
    try {
      const result = await triggerFn(arg);
      if (result?.routine?.fired === false) {
        showToast(
          `起動リクエストがRoutineに届いていません（${result.routine.reason}）。Vercel環境変数の設定を確認してください`,
          "error",
        );
      } else {
        showToast(
          result.routine.sessionUrl
            ? `${label}を起動しました。実行ログのリンクは下に表示されます`
            : `${label}を起動しました。数分後に更新ボタンで確認してください`,
          "success",
        );
        const now = Date.now();
        setLocked(true);
        setSessionUrl(result.routine.sessionUrl || null);
        setFiredAt(now);
        setLastActivityAt(now);
        setElapsedMinutes(0);
        setIdsAtFire(new Set(topics.filter(matchesTopic).map((t) => t.id)));
        setRegisteredCount(0);
      }
    } catch (err) {
      console.error(`${label}起動リクエストエラー:`, err);
      showToast(err.message || "起動リクエストに失敗しました", "error");
    } finally {
      setTriggering(false);
    }
  }

  // 経過時間の更新と、長時間・無音状態が続いた場合の打ち切り判定を30秒おきに行う
  useEffect(() => {
    if (!locked || !firedAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setElapsedMinutes(Math.max(0, Math.round((now - firedAt) / 60000)));

      if (
        expectedCount > 1 &&
        registeredCount > 0 &&
        lastActivityAt &&
        (now - lastActivityAt) / 60000 >= quietMinutes
      ) {
        showToast(
          `✅ ${registeredCount}件のネタ登録を確認し、その後新規登録が無いため確認を終了しました`,
          "success",
        );
        reset();
        return;
      }

      if ((now - firedAt) / 60000 >= maxWaitMinutes) {
        showToast(
          registeredCount > 0
            ? `⏱ ${maxWaitMinutes}分経過したため自動確認を終了します（${registeredCount}件確認済み）。続きは更新ボタンで確認してください`
            : `⏱ ${maxWaitMinutes}分経過しても新しいネタを確認できませんでした。実行ログを確認してください`,
          registeredCount > 0 ? "success" : "error",
        );
        reset();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [
    locked,
    firedAt,
    lastActivityAt,
    registeredCount,
    expectedCount,
    quietMinutes,
    maxWaitMinutes,
    showToast,
  ]);

  // 新規ネタ検知（matchesTopicで自分のcontent_type由来のものだけに絞り込む）。
  // 目標件数に届くまでは「n/m件確認済み」を都度通知しつつポーリングを継続し、
  // 届いた時点で完了扱いにしてポーリングを止める
  useEffect(() => {
    if (!locked || !idsAtFire) return;
    const newTopics = topics.filter(
      (t) => matchesTopic(t) && !idsAtFire.has(t.id),
    );
    if (newTopics.length === 0) return;

    const nextIds = new Set(idsAtFire);
    newTopics.forEach((t) => nextIds.add(t.id));
    const nextCount = registeredCount + newTopics.length;
    setIdsAtFire(nextIds);
    setRegisteredCount(nextCount);
    setLastActivityAt(Date.now());

    if (nextCount >= expectedCount) {
      showToast(
        expectedCount > 1
          ? `✅ ${nextCount}件のネタが登録されました`
          : "✅ 新しいネタが登録されました",
        "success",
      );
      reset();
    } else {
      showToast(
        `✅ ${nextCount}/${expectedCount}件のネタが登録されました（続けて確認します）`,
        "success",
      );
    }
  }, [
    topics,
    locked,
    idsAtFire,
    registeredCount,
    expectedCount,
    matchesTopic,
    showToast,
  ]);

  return {
    triggering,
    locked,
    sessionUrl,
    elapsedMinutes,
    registeredCount,
    expectedCount,
    trigger,
  };
}

function TopicApprovalSection({
  topics,
  approvers,
  onApprove,
  onReject,
  onUpdateTargetLabel,
  onFireTarget,
  topicCategories,
  onToggleCategoryChannel,
  onReloadTopics,
  showToast,
}) {
  // 承認要否（sns_content_types.requires_topic_approval）で🌅当日の運用／
  // 📦ネタのストック管理の2ブロックに分ける（要件27、2026-09-04再設計）。
  // 裏側のデータはどちらも同じsns_topics/sns_topic_targetsで、分岐点は
  // この1フラグだけ。トピックはgetTopics()で全期間分取得されるため、期間・
  // 完了状態で絞らないと「本日」ラベルが嘘になり、両ブロックとも過去の
  // 完了済みネタが無期限に積み上がる（2026-09-04、コードレビューで発覚）
  const directTopics = topics.filter(
    (t) =>
      t.status === "approved" &&
      t.sns_content_types?.requires_topic_approval === false &&
      isTodayJST(t.approved_at || t.proposed_at),
  );
  const gateProposedTopics = topics.filter((t) => t.status === "proposed");
  // 「承認済み・生成中」を名乗る以上、全ターゲットがgenerated/skippedで
  // 完結したネタは表示対象から外す（下書き自体は各プラットフォームタブに
  // 残るため情報は失われない）
  const gateApprovedTopics = topics.filter(
    (t) =>
      t.status === "approved" &&
      t.sns_content_types?.requires_topic_approval === true &&
      (t.sns_topic_targets || []).some(
        (target) => target.status === "pending" || target.status === "claimed",
      ),
  );
  const directTargets = directTopics.flatMap((t) => t.sns_topic_targets || []);
  const directGeneratedCount = directTargets.filter(
    (t) => t.status === "generated",
  ).length;

  // 「ネタ型設定」は🌅/📦どちらのブロックからも開閉できるが、実体は
  // sns_topic_categories全体を扱う単一パネル（要件27の設計判断）
  const [showCategorySettings, setShowCategorySettings] = useState(false);
  // 「⚡今すぐ生成」の発火中状態。target.id単位で管理し、他のターゲットの
  // ボタン操作をブロックしないようにする。🌅/📦両ブロックのカードで共有する
  const [firingTargetId, setFiringTargetId] = useState(null);
  // 日次ネタ自動提案の型（カテゴリ）を人間が優先指定できるようにする
  // （2026-09-04、2026-09-02に一度実装された機能がsns-topic-gate移行時に
  // UIごと削除されていたため再接続。空文字はRoutine側の自動選定に委ねる
  // 「おまかせ」を意味する）。対象は🌅当日の運用（daily-auto/
  // race-time-critical型）のうちactiveなもののみ
  const [selectedDailyCategoryKey, setSelectedDailyCategoryKey] = useState("");
  const dailyAutoCategoryOptions = topicCategories.filter(
    (c) =>
      c.active &&
      ["daily-auto", "race-time-critical"].includes(
        c.sns_content_types?.type_key,
      ) &&
      !TIKTOK_PERMANENTLY_EXCLUDED_CATEGORY_KEYS.includes(c.category_key),
  );

  const weeklyProposer = useTopicProposerTrigger({
    triggerFn: triggerWeeklyProposer,
    topics,
    showToast,
    label: "週次ネタ提案",
    expectedCount: 10,
    // このRoutineは常にvenue-feature型のみを登録する（手順書参照）
    matchesTopic: (t) => t.sns_content_types?.type_key === "venue-feature",
  });
  const dailyAutoProposer = useTopicProposerTrigger({
    triggerFn: triggerDailyAutoProposer,
    topics,
    showToast,
    label: "日次ネタ自動提案",
    // trigger_mode='auto'のカテゴリ（racer-condition等）のみを登録する。
    // race-time-critical型（🌅ボタンとは別の手動発火、trigger_mode='manual'）
    // と区別するため type_key ではなく trigger_mode で絞り込む
    matchesTopic: (t) => t.sns_content_types?.trigger_mode === "auto",
  });

  // ロック中（Routine実行中）は30秒おきにネタ一覧をポーリングする。
  // triggerFn自体は完了検知しないため、新規ネタの出現有無で判定する
  // （useTopicProposerTrigger側の完了検知useEffectとセット）
  useEffect(() => {
    if (!weeklyProposer.locked && !dailyAutoProposer.locked) return;
    const interval = setInterval(() => {
      onReloadTopics();
    }, 30000);
    return () => clearInterval(interval);
  }, [weeklyProposer.locked, dailyAutoProposer.locked, onReloadTopics]);

  async function handleFire(topicId, targetId) {
    setFiringTargetId(targetId);
    try {
      await onFireTarget(topicId, targetId);
    } finally {
      setFiringTargetId(null);
    }
  }

  return (
    <div className="topic-approval-section">
      <div className="topic-section-card topic-section-direct">
        <div className="topic-section-title">🌅 当日の運用</div>
        <p className="topic-section-desc">
          選手調子・モーター調子・イン崩れ・予想数値フック・的中 —
          自動承認、朝すぐ投稿できる状態を目指す
        </p>
        <div className="topic-stat-row">
          <span className="topic-stat-chip">
            <b>{directTopics.length}件</b>本日ネタ登録済み（自動承認）
          </span>
          {directTargets.length > 0 && (
            <span className="topic-stat-chip">
              <b>
                {directGeneratedCount}/{directTargets.length}
              </b>
              チャネル生成完了
            </span>
          )}
        </div>
        {directTopics.length === 0 ? (
          <p className="topic-section-empty">
            本日はまだネタが登録されていません
          </p>
        ) : (
          <div className="mini-card-list">
            {directTopics.map((topic) => (
              <TopicFanoutCard
                key={topic.id}
                topic={topic}
                onFireTarget={handleFire}
                firingTargetId={firingTargetId}
              />
            ))}
          </div>
        )}
        <div className="topic-section-btn-row">
          {dailyAutoCategoryOptions.length > 0 && (
            <select
              className="topic-section-category-select"
              value={selectedDailyCategoryKey}
              onChange={(e) => setSelectedDailyCategoryKey(e.target.value)}
              disabled={
                dailyAutoProposer.triggering || dailyAutoProposer.locked
              }
              aria-label="日次ネタ自動提案の型を指定"
            >
              <option value="">おまかせ（自動選定）</option>
              {dailyAutoCategoryOptions.map((c) => (
                <option key={c.id} value={c.category_key}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="topic-section-trigger-btn topic-section-trigger-direct"
            disabled={dailyAutoProposer.triggering || dailyAutoProposer.locked}
            onClick={() =>
              dailyAutoProposer.trigger(selectedDailyCategoryKey || undefined)
            }
          >
            {dailyAutoProposer.triggering
              ? "⏳ リクエスト中..."
              : "🌅 日次ネタ自動提案を今すぐ実行"}
          </button>
          <button
            type="button"
            className="topic-section-settings-btn"
            onClick={() => setShowCategorySettings((v) => !v)}
          >
            ⚙️ ネタ型設定
          </button>
        </div>
        {dailyAutoProposer.locked && (
          <div className="topic-section-proposer-hint">
            ⏳ 日次ネタ自動提案を実行中...（{dailyAutoProposer.elapsedMinutes}
            分経過）30秒おきに自動で確認します
            {dailyAutoProposer.sessionUrl && (
              <>
                {" ・ "}
                <a
                  href={dailyAutoProposer.sessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  実行ログを見る
                </a>
              </>
            )}
          </div>
        )}
      </div>

      <div className="topic-section-card topic-section-gate">
        <div className="topic-section-title">📦 ネタのストック管理</div>
        <p className="topic-section-desc">
          会場特性・一覧アピール型など —
          承認して在庫を積む、時間制約なし。承認すると対応するチャネルタブ
          （下）に下書きが生成されます
        </p>
        <div className="topic-stat-row">
          <span className="topic-stat-chip">
            <b>{gateProposedTopics.length}件</b>承認待ち
          </span>
          <span className="topic-stat-chip">
            <b>{gateApprovedTopics.length}件</b>承認済み・生成中
          </span>
        </div>
        {gateProposedTopics.length === 0 && gateApprovedTopics.length === 0 ? (
          <p className="topic-section-empty">
            承認待ち・生成中のネタはありません
          </p>
        ) : (
          <div className="mini-card-list">
            {gateProposedTopics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                approvers={approvers}
                onApprove={onApprove}
                onReject={onReject}
                onUpdateTargetLabel={onUpdateTargetLabel}
              />
            ))}
            {gateApprovedTopics.map((topic) => (
              <TopicFanoutCard
                key={topic.id}
                topic={topic}
                onFireTarget={handleFire}
                firingTargetId={firingTargetId}
                onReject={onReject}
                approvers={approvers}
              />
            ))}
          </div>
        )}
        <div className="topic-section-btn-row">
          <button
            type="button"
            className="topic-section-trigger-btn topic-section-trigger-gate"
            disabled={weeklyProposer.triggering || weeklyProposer.locked}
            onClick={weeklyProposer.trigger}
          >
            {weeklyProposer.triggering
              ? "⏳ リクエスト中..."
              : "📅 週次ネタ提案を今すぐ実行"}
          </button>
          <button
            type="button"
            className="topic-section-settings-btn"
            onClick={() => setShowCategorySettings((v) => !v)}
          >
            ⚙️ ネタ型設定
          </button>
        </div>
        {weeklyProposer.locked && (
          <div className="topic-section-proposer-hint">
            ⏳ 週次ネタ提案を実行中...（{weeklyProposer.elapsedMinutes}
            分経過・{weeklyProposer.registeredCount}/
            {weeklyProposer.expectedCount}件確認済み）30秒おきに自動で確認します
            {weeklyProposer.sessionUrl && (
              <>
                {" ・ "}
                <a
                  href={weeklyProposer.sessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  実行ログを見る
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {showCategorySettings && (
        <div className="topic-category-settings-panel">
          <TopicCategorySettingsTab
            categories={topicCategories}
            onToggleChannel={onToggleCategoryChannel}
          />
        </div>
      )}
    </div>
  );
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
