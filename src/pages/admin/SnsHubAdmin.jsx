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
  triggerGeneration,
  triggerTopicPipelineGeneration,
  getTopics,
  approveTopic,
  rejectTopic,
  updateTopicTargetLabel,
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
// タブに生成される」という流れが、同列のタブに埋もれると分かりにくいため
const NON_PLATFORM_TABS = [
  { id: "insights", label: "戦略メモ" },
  { id: "catalog", label: "フォーマットカタログ" },
];

const TABS = [...PLATFORM_TABS, ...NON_PLATFORM_TABS];

// 手動生成の対象プラットフォーム選択肢。Routineが対応するプラットフォームが
// 増えたらここに1件足すだけでよい（api/admin/sns-hub/generate.jsの
// VALID_PLATFORMSと合わせて更新すること）。youtubeは2026-09-01追加
const GENERATE_PLATFORM_OPTIONS = [
  { value: "x", label: "X" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
];

// countMaxはapi/admin/sns-hub/generate.jsのCOUNT_MAX_BY_MODEと一致させる
const GENERATE_MODES = [
  {
    mode: "daily",
    icon: "🎬",
    label: "当日ネタ",
    countMax: 5,
    defaultCount: 2,
  },
  {
    mode: "evergreen",
    icon: "📦",
    label: "会場攻略型など",
    countMax: 10,
    defaultCount: 3,
  },
];

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(null); // null | 'daily' | 'evergreen'
  // 手動生成の対象プラットフォーム・本数（モードごとに独立、2026-09-01追加）。
  // TikTokがシャドウバン気味の時期にX限定で生成したい等の要望への対応
  const [generatePlatforms, setGeneratePlatforms] = useState(() =>
    Object.fromEntries(
      GENERATE_MODES.map((m) => [
        m.mode,
        GENERATE_PLATFORM_OPTIONS.map((p) => p.value),
      ]),
    ),
  );
  const [generateCounts, setGenerateCounts] = useState(() =>
    Object.fromEntries(GENERATE_MODES.map((m) => [m.mode, m.defaultCount])),
  );
  // 手動生成する型の指定（モードごとに独立、2026-09-02追加）。既定は""＝
  // 「おまかせ（自動選定）」で、Routine側の型選定ロジックに従う。「会場攻略型など」
  // という曖昧な指定しかできなかったのをユーザー指摘を受けて拡張した
  const [generateFormats, setGenerateFormats] = useState(() =>
    Object.fromEntries(GENERATE_MODES.map((m) => [m.mode, ""])),
  );
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
  // ネタ駆動マルチチャネルパイプライン（content-multi-channel-pipeline）用の
  // 手動実行state。daily/evergreen（Pipeline A）とは別のRoutineであり、
  // パラメータ（プラットフォーム/本数/型）を選ばせる余地が無いため単純な
  // ボタン1つで完結する。ロック・完了検知の仕組みは上記と同じパターンだが、
  // 別Routineなので独立したstateで管理する（2026-09-02追加）。
  // 2026-09-03、コードレビューで指摘: 両ロックとも同じdrafts配列・同じ
  // 「!parent_draft_idの新規行が現れたら完了」ヒューリスティックを見ているため、
  // 片方のRoutineが先に1行INSERTすると、もう片方のuseEffectもそれを「自分の
  // 生成完了」と誤検知してロック解除してしまう競合状態がある（根本解決には
  // sns_drafts.routine_run_idへの記録・参照が必要だが未実装）。当面の緩和策として
  // 両ボタンのdisabled条件に相手のLocked状態も加え、同時実行自体を防ぐ
  const [topicPipelineGenerating, setTopicPipelineGenerating] = useState(false);
  const [topicPipelineLocked, setTopicPipelineLocked] = useState(false);
  const [topicPipelineSessionUrl, setTopicPipelineSessionUrl] = useState(null);
  const [topicPipelineFiredAt, setTopicPipelineFiredAt] = useState(null);
  const [topicPipelineElapsedMinutes, setTopicPipelineElapsedMinutes] =
    useState(0);
  const [topicPipelineBaselineCreatedAt, setTopicPipelineBaselineCreatedAt] =
    useState(null);
  const { toast, showToast } = useToast();

  // 手動生成の型選択肢。フォーマットカタログ（sns_template_variants、"型一覧"タブと
  // 同じデータ源）から重複を除いた型名一覧を出す。ハードコードした一覧を別途持つと
  // カタログと食い違うため、既に画面にロード済みのtemplateVariantsをそのまま使う
  // （2026-09-02追加）
  const evergreenFormatOptions = useMemo(() => {
    const names = new Set(templateVariants.map((tv) => tv.format));
    return [...names].sort();
  }, [templateVariants]);

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

  // 承認済みストックが少ない時の手動補充用。fireRoutineは起動を指示する
  // だけで完了を待たないため、生成完了までは数分〜十数分かかる（動画
  // レンダリングを含む）。完了したかどうかは手動更新ボタン、または下記の
  // 自動検知（新しい下書きの出現）で確認する
  function toggleGeneratePlatform(mode, platform) {
    setGeneratePlatforms((prev) => {
      const current = prev[mode];
      const next = current.includes(platform)
        ? current.filter((p) => p !== platform)
        : [...current, platform];
      return { ...prev, [mode]: next };
    });
  }

  function handleGenerateCountChange(mode, rawValue, countMax) {
    const parsed = parseInt(rawValue, 10);
    // 入力欄を一時的に空にした場合(NaN)にstate更新をスキップすると、画面表示は
    // 空欄なのに実際に送信される本数は直前の値のまま、という食い違いが生まれる
    // （コードレビューで指摘）。空にした場合は最小値1にスナップし、表示とstateを
    // 常に一致させる
    const clamped = Number.isNaN(parsed)
      ? 1
      : Math.min(Math.max(parsed, 1), countMax);
    setGenerateCounts((prev) => ({ ...prev, [mode]: clamped }));
  }

  function handleGenerateFormatChange(mode, value) {
    setGenerateFormats((prev) => ({ ...prev, [mode]: value }));
  }

  async function handleGenerate(mode) {
    const platforms = generatePlatforms[mode];
    if (platforms.length === 0) {
      showToast("生成対象のプラットフォームを1つ以上選んでください", "error");
      return;
    }
    setGenerating(mode);
    try {
      const result = await triggerGeneration(mode, {
        platforms,
        count: generateCounts[mode],
        format: generateFormats[mode] || undefined,
      });
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
      loadDrafts({ silent: true, fetch: { drafts: true } });
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

  // ネタ駆動マルチチャネルパイプラインの手動実行。パラメータは無く、常に
  // 新規ネタの選定から開始する（2026-09-02追加）
  async function handleGenerateTopicPipeline() {
    setTopicPipelineGenerating(true);
    try {
      const result = await triggerTopicPipelineGeneration();
      if (result?.routine?.fired === false) {
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
        setTopicPipelineLocked(true);
        setTopicPipelineSessionUrl(result.routine.sessionUrl || null);
        setTopicPipelineFiredAt(Date.now());
        setTopicPipelineElapsedMinutes(0);
        setTopicPipelineBaselineCreatedAt(
          drafts.reduce((max, d) => {
            const t = new Date(d.created_at).getTime();
            return t > max ? t : max;
          }, 0),
        );
      }
    } catch (err) {
      console.error("ネタ駆動パイプライン生成リクエストエラー:", err);
      showToast(err.message || "生成リクエストに失敗しました", "error");
    } finally {
      setTopicPipelineGenerating(false);
    }
  }

  useEffect(() => {
    if (!topicPipelineLocked || !topicPipelineFiredAt) return;
    const interval = setInterval(() => {
      setTopicPipelineElapsedMinutes(
        Math.max(0, Math.round((Date.now() - topicPipelineFiredAt) / 60000)),
      );
      loadDrafts({ silent: true, fetch: { drafts: true } });
    }, 30000);
    return () => clearInterval(interval);
  }, [topicPipelineLocked, topicPipelineFiredAt, loadDrafts]);

  useEffect(() => {
    if (!topicPipelineLocked || topicPipelineBaselineCreatedAt === null) return;
    const newDraftsCount = drafts.filter(
      (d) =>
        new Date(d.created_at).getTime() > topicPipelineBaselineCreatedAt &&
        !d.parent_draft_id,
    ).length;
    if (newDraftsCount > 0) {
      showToast(`✅ ${newDraftsCount}件生成完了しました`, "success");
      setTopicPipelineLocked(false);
      setTopicPipelineSessionUrl(null);
      setTopicPipelineFiredAt(null);
      setTopicPipelineBaselineCreatedAt(null);
    }
  }, [drafts, topicPipelineLocked, topicPipelineBaselineCreatedAt, showToast]);

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
        onReject={(topicId, approverId) =>
          handleAction(rejectTopic, [topicId, approverId], {
            topics: true,
          })
        }
        onUpdateTargetLabel={(topicId, targetId, status) =>
          handleAction(updateTopicTargetLabel, [topicId, targetId, status], {
            topics: true,
          })
        }
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

      <div className="manual-generate-panel">
        <span className="manual-generate-label">
          承認済みストックが少ない時の手動生成:
        </span>
        {GENERATE_MODES.map((modeConfig) => (
          <div className="manual-generate-block" key={modeConfig.mode}>
            <div className="generate-platform-chips">
              {GENERATE_PLATFORM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`generate-platform-chip${
                    generatePlatforms[modeConfig.mode].includes(opt.value)
                      ? " selected"
                      : ""
                  }`}
                  disabled={
                    generating !== null ||
                    generationLocked ||
                    topicPipelineLocked
                  }
                  onClick={() =>
                    toggleGeneratePlatform(modeConfig.mode, opt.value)
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {modeConfig.mode === "evergreen" &&
              evergreenFormatOptions.length > 0 && (
                <label className="generate-format-label">
                  型
                  <select
                    className="generate-format-select"
                    value={generateFormats[modeConfig.mode]}
                    disabled={
                      generating !== null ||
                      generationLocked ||
                      topicPipelineLocked
                    }
                    onChange={(e) =>
                      handleGenerateFormatChange(
                        modeConfig.mode,
                        e.target.value,
                      )
                    }
                  >
                    <option value="">おまかせ（自動選定）</option>
                    {evergreenFormatOptions.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            <label className="generate-count-label">
              本数
              <input
                type="number"
                className="generate-count-input"
                min={1}
                max={modeConfig.countMax}
                value={generateCounts[modeConfig.mode]}
                disabled={
                  generating !== null || generationLocked || topicPipelineLocked
                }
                onChange={(e) =>
                  handleGenerateCountChange(
                    modeConfig.mode,
                    e.target.value,
                    modeConfig.countMax,
                  )
                }
              />
              <span className="generate-count-max">
                / 最大{modeConfig.countMax}
              </span>
            </label>
            <button
              className="manual-generate-btn"
              disabled={
                generating !== null ||
                generationLocked ||
                topicPipelineLocked ||
                generatePlatforms[modeConfig.mode].length === 0
              }
              onClick={() => handleGenerate(modeConfig.mode)}
            >
              {generating === modeConfig.mode
                ? "⏳ リクエスト中..."
                : `${modeConfig.icon} ${modeConfig.label}を今すぐ生成`}
            </button>
          </div>
        ))}
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

      <div className="manual-generate-panel topic-pipeline-panel">
        <span className="manual-generate-label">
          ネタ駆動マルチチャネルパイプライン（新機能/会場特性/データ知見/成績から自動選定・全チャネルへ展開）:
        </span>
        <div className="manual-generate-block">
          <button
            className="manual-generate-btn"
            disabled={
              topicPipelineGenerating || topicPipelineLocked || generationLocked
            }
            onClick={handleGenerateTopicPipeline}
          >
            {topicPipelineGenerating
              ? "⏳ リクエスト中..."
              : "🧵 ネタ駆動パイプラインを今すぐ実行"}
          </button>
        </div>
        {topicPipelineLocked && (
          <span className="manual-generate-hint">
            ⏳ 生成中...（{topicPipelineElapsedMinutes}
            分経過）30秒おきに自動で確認します
            {topicPipelineSessionUrl && (
              <>
                {" ・ "}
                <a
                  href={topicPipelineSessionUrl}
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

// blog/youtubeは承認操作自体がPRマージ/YouTube投稿まで行うため、
// 承認後は"approved"状態を経由せず直接"posted"になる（ADR 0034, 0035）
const AUTO_PUBLISH_PLATFORMS = new Set(["blog", "youtube"]);
const TEXT_DRAFT_PLATFORMS = new Set(["blog", "note"]);

function DraftCard({
  draft,
  contentType,
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
function NoteCopyActionLinks({ draft, onMarkPosted }) {
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
          onClick={() => onReject(topic.id, selectedApproverId)}
        >
          却下
        </button>
      </div>
    </div>
  );
}

// 承認済みネタ×アカウントの生成状況をテーブル形式で表示する（要件15、screens.md #6）
function TopicProgressMatrix({ topics }) {
  const approvedTopics = topics.filter((t) => t.status === "approved");
  if (approvedTopics.length === 0) {
    return null;
  }
  return (
    <div className="topic-progress-matrix-wrap">
      <h3 className="topic-progress-matrix-title">承認済みネタの進捗</h3>
      <div className="topic-progress-matrix-scroll">
        <table className="topic-progress-matrix">
          <tbody>
            {approvedTopics.map((topic) => (
              <tr key={topic.id}>
                <td className="topic-progress-matrix-topic-text">
                  {topic.topic_text}
                </td>
                {(topic.sns_topic_targets || []).map((target) => (
                  <td
                    key={target.id}
                    className={`topic-progress-matrix-cell topic-progress-matrix-cell-${target.status}`}
                  >
                    {target.sns_target_accounts?.platform || "?"}:{" "}
                    {target.status}
                    {target.status === "generated" && target.draft_id && (
                      <span className="topic-progress-matrix-generated-mark">
                        {" "}
                        ✓
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 「ネタ承認」タブ本体（screens.md #2）。status='proposed'（承認要否の型のみ）を
// 一覧表示し、承認済みネタの進捗マトリクスも合わせて表示する
// タブではなく専用セクションとして、下書き承認タブ群(TABS)の上に常時表示する
// （2026-09-03ユーザー指摘: 「承認→各プラットフォームタブに生成される」という
// 流れが、同列の1タブに埋もれると分かりにくいため）
function TopicApprovalSection({
  topics,
  approvers,
  onApprove,
  onReject,
  onUpdateTargetLabel,
}) {
  const proposedTopics = topics.filter((t) => t.status === "proposed");
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="topic-approval-section">
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
          <TopicProgressMatrix topics={topics} />
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
