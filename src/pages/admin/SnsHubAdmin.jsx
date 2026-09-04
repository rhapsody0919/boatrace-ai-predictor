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
  reviseDraft,
  redoDraft,
  markDraftPosted,
  addDraftMetric,
  getInsights,
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
  // デザイン系の理由（2026-09-03追加、ユーザー要望: 「無駄なスペース、色使い、
  // フォントサイズ、画像など」を選択式で指摘できるようにしてほしい）。既存の
  // RevisionPanel（チップ選択+自由記述）をそのまま流用し、新規UIは作らない
  { code: "design-spacing", label: "余白・スペースが無駄" },
  { code: "design-color", label: "配色が合わない" },
  { code: "design-font-size", label: "フォントサイズが不適切" },
  { code: "design-visual-material", label: "画像・素材の質が低い" },
];

// ブログ/note下書き向けの却下理由（spec.md FR5、2026-09-01追加）。
// 動画下書きとは性質が異なる却下理由（検索意図・数値正確性等）を別リストにする
const CONTENT_REVISION_REASONS = [
  { code: "search-intent-mismatch", label: "検索意図とズレている" },
  { code: "data-accuracy-error", label: "数値・データの誤り" },
  { code: "too-similar-to-existing", label: "既存記事と似すぎている" },
  { code: "typo-or-data-error", label: "誤字・データの誤り" },
  { code: "tone-adjustment", label: "トーン調整" },
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
  // 操作のたびに遅い」と指摘）。ただし「一部修正」「全部作り直し」の指摘を戦略メモに
  // 保存するチェック（saveAsInsight）や、戦略メモの却下操作はinsightsも変化させるため、
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
  // （却下、saveAsInsight付きの一部修正/全部作り直し）を呼ぶ箇所はinsights: true
  // も指定すること
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
                  handleAction(mergeBlogPr, [draft.id, approverId])
                }
                onPublishYoutube={(approverId) =>
                  handleAction(publishYoutube, [draft.id, approverId])
                }
                onRevise={(payload) =>
                  handleAction(reviseDraft, [draft.id, payload], {
                    drafts: true,
                    insights: true,
                  })
                }
                onRedo={(payload) =>
                  handleAction(redoDraft, [draft.id, payload], {
                    drafts: true,
                    insights: true,
                  })
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
                    reasons={
                      TEXT_DRAFT_PLATFORMS.has(draft.platform)
                        ? CONTENT_REVISION_REASONS
                        : REVISION_REASONS
                    }
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

function RevisionPanel({
  mode,
  reasons = REVISION_REASONS,
  onSubmit,
  onCancel,
}) {
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
          mode="revise"
          reasons={TOPIC_REJECTION_REASONS}
          onCancel={() => setShowRejectPanel(false)}
          onSubmit={({ reasonCodes, freeText, saveAsInsight }) => {
            const reasonLabels = reasonCodes
              .map(
                (code) =>
                  TOPIC_REJECTION_REASONS.find((r) => r.code === code)?.label,
              )
              .filter(Boolean);
            const reason = [reasonLabels.join("、"), freeText.trim()]
              .filter(Boolean)
              .join(" / ");
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
function TopicProgressMatrix({ topics, onFireTarget }) {
  // 「⚡今すぐ生成」の発火中状態。target.id単位で管理し、他のターゲットの
  // ボタン操作をブロックしないようにする
  const [firingTargetId, setFiringTargetId] = useState(null);
  const approvedTopics = topics.filter((t) => t.status === "approved");
  if (approvedTopics.length === 0) {
    return null;
  }

  async function handleFire(topicId, targetId) {
    setFiringTargetId(targetId);
    try {
      await onFireTarget(topicId, targetId);
    } finally {
      setFiringTargetId(null);
    }
  }

  return (
    <div className="topic-progress-matrix-wrap">
      <h3 className="topic-progress-matrix-title">承認済みネタの進捗</h3>
      <div className="topic-progress-matrix-list">
        {approvedTopics.map((topic) => (
          <div key={topic.id} className="topic-progress-matrix-card">
            <p className="topic-progress-matrix-topic-text">
              {topic.topic_text}
            </p>
            <div className="topic-progress-matrix-chips">
              {(topic.sns_topic_targets || []).map((target) => (
                <span
                  key={target.id}
                  className={`topic-progress-matrix-chip topic-progress-matrix-chip-${target.status}`}
                >
                  {target.sns_target_accounts?.platform || "?"}: {target.status}
                  {target.status === "generated" && target.draft_id && (
                    <span className="topic-progress-matrix-generated-mark">
                      {" "}
                      ✓
                    </span>
                  )}
                  {target.status === "pending" && (
                    <button
                      type="button"
                      className="topic-progress-matrix-fire-btn"
                      disabled={firingTargetId === target.id}
                      title="対象チャネルのパイプラインを今すぐ起動します（放っておいても通常のポーリングでいずれ生成されます）"
                      onClick={() => handleFire(topic.id, target.id)}
                    >
                      {firingTargetId === target.id ? "⏳" : "⚡今すぐ生成"}
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
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
function useTopicProposerTrigger({ triggerFn, topics, showToast, label }) {
  const [triggering, setTriggering] = useState(false);
  const [locked, setLocked] = useState(false);
  const [sessionUrl, setSessionUrl] = useState(null);
  const [firedAt, setFiredAt] = useState(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [idsAtFire, setIdsAtFire] = useState(null);

  async function trigger() {
    setTriggering(true);
    try {
      const result = await triggerFn();
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
        setLocked(true);
        setSessionUrl(result.routine.sessionUrl || null);
        setFiredAt(Date.now());
        setElapsedMinutes(0);
        setIdsAtFire(new Set(topics.map((t) => t.id)));
      }
    } catch (err) {
      console.error(`${label}起動リクエストエラー:`, err);
      showToast(err.message || "起動リクエストに失敗しました", "error");
    } finally {
      setTriggering(false);
    }
  }

  useEffect(() => {
    if (!locked || !firedAt) return;
    const interval = setInterval(() => {
      setElapsedMinutes(
        Math.max(0, Math.round((Date.now() - firedAt) / 60000)),
      );
    }, 30000);
    return () => clearInterval(interval);
  }, [locked, firedAt]);

  useEffect(() => {
    if (!locked || !idsAtFire) return;
    const hasNewTopic = topics.some((t) => !idsAtFire.has(t.id));
    if (hasNewTopic) {
      showToast("✅ 新しいネタが登録されました", "success");
      setLocked(false);
      setSessionUrl(null);
      setFiredAt(null);
      setIdsAtFire(null);
    }
  }, [topics, locked, idsAtFire, showToast]);

  return { triggering, locked, sessionUrl, elapsedMinutes, trigger };
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
  const proposedTopics = topics.filter((t) => t.status === "proposed");
  const [expanded, setExpanded] = useState(true);
  // 「ネタ型設定」は元は他のプラットフォームタブ（TikTok/X/YouTube等）と同列の
  // タブだったが、コンテンツレビュー用タブに紛れて発見しづらいと指摘された。
  // 型ごとのチャネルON/OFFはネタ承認の前提となる設定であり、ネタ承認と同じ
  // セクション内から開閉するパネルに変更した（2026-09-04）
  const [showCategorySettings, setShowCategorySettings] = useState(false);

  const weeklyProposer = useTopicProposerTrigger({
    triggerFn: triggerWeeklyProposer,
    topics,
    showToast,
    label: "週次ネタ提案",
  });
  const dailyAutoProposer = useTopicProposerTrigger({
    triggerFn: triggerDailyAutoProposer,
    topics,
    showToast,
    label: "日次ネタ自動提案",
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

  return (
    <div className="topic-approval-section">
      <div className="topic-approval-section-header-row">
        <button
          type="button"
          className="topic-approval-section-header"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="topic-approval-section-title">
            📋 ネタ承認{" "}
            {proposedTopics.length > 0 && (
              <span className="topic-approval-section-count">
                {proposedTopics.length}
              </span>
            )}
          </span>
          <span className="topic-approval-section-hint">
            ここで承認すると、対応するチャネルタブ（下）に下書きが生成されます
          </span>
          <span className="topic-approval-section-toggle">
            {expanded ? "▲" : "▼"}
          </span>
        </button>
        <button
          type="button"
          className="topic-approval-section-settings-btn"
          disabled={weeklyProposer.triggering || weeklyProposer.locked}
          onClick={weeklyProposer.trigger}
        >
          {weeklyProposer.triggering
            ? "⏳ リクエスト中..."
            : "📅 週次ネタ提案を今すぐ実行"}
        </button>
        <button
          type="button"
          className="topic-approval-section-settings-btn"
          disabled={dailyAutoProposer.triggering || dailyAutoProposer.locked}
          onClick={dailyAutoProposer.trigger}
        >
          {dailyAutoProposer.triggering
            ? "⏳ リクエスト中..."
            : "🌅 日次ネタ自動提案を今すぐ実行"}
        </button>
        <button
          type="button"
          className="topic-approval-section-settings-btn"
          onClick={() => setShowCategorySettings((v) => !v)}
        >
          ⚙️ ネタ型設定
        </button>
      </div>

      {(weeklyProposer.locked || dailyAutoProposer.locked) && (
        <div className="topic-approval-section-weekly-proposer-hint">
          {weeklyProposer.locked && (
            <div>
              ⏳ 週次ネタ提案を実行中...（{weeklyProposer.elapsedMinutes}
              分経過）30秒おきに自動で確認します
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
          {dailyAutoProposer.locked && (
            <div>
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
      )}

      {showCategorySettings && (
        <div className="topic-category-settings-panel">
          <TopicCategorySettingsTab
            categories={topicCategories}
            onToggleChannel={onToggleCategoryChannel}
          />
        </div>
      )}

      {expanded && (
        <div className="topic-approval-section-body">
          {proposedTopics.length === 0 ? (
            <div className="empty-state">
              <p>
                承認待ちのネタはありません（日次・一般/日次・時間制約型はネタ
                承認を経ずに生成されるため、ここには表示されません）。
              </p>
            </div>
          ) : (
            <div className="topic-list">
              {proposedTopics.map((topic) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  approvers={approvers}
                  onApprove={onApprove}
                  onReject={onReject}
                  onUpdateTargetLabel={onUpdateTargetLabel}
                />
              ))}
            </div>
          )}
          <TopicProgressMatrix topics={topics} onFireTarget={onFireTarget} />
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
