/**
 * SNSハブ管理画面「フォーマットカタログ」タブ用の静的キュレーションデータ。
 *
 * .claude/rules/sns-content-generation.md・docs/reference/brand-kit.md
 * （全体ルール、Tier1）、docs/operation/sns-pipeline-{platform}.md
 * （チャネル別ルール、Tier2）、docs/operation/sns-video-producer-prompt.md・
 * x-operations-playbook.md・docs/reference/sns-brand-guideline.md
 * （X/TikTok動画制作の実装詳細）の内容を要約し、元ドキュメントへの
 * GitHubリンクを添えたもの（ADR 0031参照）。
 *
 * 元ドキュメントが更新されても自動追従しない。ドキュメント更新時は
 * このファイルも手動で同期する（自動同期の仕組みは意図的に作っていない、
 * ADR 0031参照）。
 *
 * 2026-09-04、BOA-240対応: sns-topic-gate移行後にTier1/Tier2ドキュメントへの
 * 参照が一切無く、実際に何のルールで生成されているか確認できないという
 * ギャップが判明したため、GLOBAL_RULES/CHANNEL_RULESを新設した
 *
 * 2026-09-05追加: ルール文書（brand-kit.md等）へのリンクだけでは、その中で
 * 参照されている再利用可能なコード（Remotionの共有Sceneコンポーネント・
 * 関数）が実際にどれだけあるか分からないというユーザー指摘を受け、
 * SHARED_COMPONENTSを新設した。venue-featureパイプライン等はmasterへコードを
 * コミットしないため、既存の共有コンポーネントを知らずに書き捨てコードを
 * 書いてしまう（左偏りバグの再発等）ことを防ぐ狙い
 */

const REPO_BASE_URL =
  "https://github.com/rhapsody0919/boatrace-ai-predictor/blob/master";

// 全体ルール（Tier1、全チャネル共通）。2026-09-04追加（BOA-240、sns-topic-gate
// 移行後にこのカタログがチャネル別パイプライン体系を全く参照していなかった
// ことが判明したため、Tier1/Tier2の参照を新設して補う）
export const GLOBAL_RULES = [
  {
    name: "生成前の必須確認事項（getRecentRevisions/getActiveInsights）",
    summary:
      "全Routineが生成前に必ず確認する共通ルール。過去の修正・却下理由（getRecentRevisions）と蓄積された戦略insight（getActiveInsights）の参照方法、テキストのフィット処理（fitHeadline）、Supabase Storageのパス規約、リスクチェックの手順を定義する。フロントマターを持たないため全Routineセッションに自動的に読み込まれる。",
    docPath: ".claude/rules/sns-content-generation.md",
    docLabel: "sns-content-generation.md",
  },
  {
    name: "ブランドキット（色・フォント・承認済み実例ギャラリー）",
    summary:
      "ロゴ・カラー・フォント使用ルールと、チャネル別の承認済み実例ギャラリーをまとめた資料。新しいチャネル向け画像・動画を作る前に必ず確認する。承認された実例はその場でここに追記される運用（後日まとめての更新にしない）。",
    docPath: "docs/reference/brand-kit.md",
    docLabel: "brand-kit.md",
  },
];

// チャネル別ルール（Tier2）。sns-topic-gate体系（ADR 0036〜0038）以降、
// ネタ承認済み下書き生成はこの5ドキュメントが担う（2026-09-04追加）
export const CHANNEL_RULES = [
  {
    platform: "blog",
    label: "Blog",
    docPath: "docs/operation/sns-pipeline-blog.md",
    docLabel: "sns-pipeline-blog.md",
  },
  {
    platform: "note",
    label: "Note",
    docPath: "docs/operation/sns-pipeline-note.md",
    docLabel: "sns-pipeline-note.md",
  },
  {
    platform: "x",
    label: "X",
    docPath: "docs/operation/sns-pipeline-x.md",
    docLabel: "sns-pipeline-x.md",
  },
  {
    platform: "tiktok",
    label: "TikTok",
    docPath: "docs/operation/sns-pipeline-tiktok.md",
    docLabel: "sns-pipeline-tiktok.md",
  },
  {
    platform: "youtube",
    label: "YouTube",
    docPath: "docs/operation/sns-pipeline-youtube.md",
    docLabel: "sns-pipeline-youtube.md",
  },
];

export const FORMAT_LIBRARY = [
  {
    name: "予想数値フック型",
    status: "実装済み",
    summary:
      "AIの逃げ確率等をフックにする型。本日開催中・結果未確定のレースが前提。TikTok向けは実画面スクショ不要版（LivePredictionHookCM.jsx）があり、展開予測TOP3・イン崩れ注意度カードをRemotionで再現している。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
  {
    name: "答え合わせ型",
    status: "実装済み",
    summary:
      "「AIが○○と予想してたレース」→結果→CTAの構成。結果確定済みのレースを扱う。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
  {
    name: "一覧アピール型",
    status: "実装済み",
    summary:
      "分析ツールの物量・網羅性を訴求する型。ツール一覧タブの実画面→個別ツールのモンタージュ→CTA。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
  {
    name: "本日のデータ一覧型",
    status: "実装済み",
    summary:
      "一覧アピール型と同じ実データを「本日の注目◯◯」という日替わりダイジェストとして見せる型。習慣形成・毎日チェックしたくなる訴求が狙い。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
  {
    name: "会場攻略・データ一覧型",
    status: "実装済み",
    summary:
      "24会場横断の全期間データ集計をランキング形式で見せる型。日付に依存しない恒久的な会場特性を扱うストック型コンテンツとして主力に位置づけている（隣接ジャンルの先行事例で保存率の高さが実証された型）。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
  {
    name: "マスコット案内型",
    status: "実装済み",
    summary:
      "龍神レーダーのマスコットキャラ（候補A'/B'/C'）が実画面を案内する型。既存フォーマットにマスコットを重ねる形で組み込む。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
  {
    name: "対決煽り型・豆知識型・観光ブレンド型",
    status: "未実装/保留中",
    summary:
      "出走表データでの2艇対決、意外なデータ傾向紹介、会場観光情報とのブレンド版。今後の拡張候補。",
    docPath: "docs/operation/sns-video-producer-prompt.md",
    docLabel: "sns-video-producer-prompt.md",
  },
];

export const PERSONA_NOTES = {
  summary:
    "マスコットキャラ3体（A'=元気系リュウくん、B'=冷静系レーダー、C'=気品系龍神さま）を3日間・1日3本ローテーションでテスト中。型は直近3投稿と同じ型を連続させないルールで選定する。予想数値フック型を選ぶ場合は締切60分以上余裕のあるレースが前提。",
  docPath: "docs/operation/x-operations-playbook.md",
  docLabel: "x-operations-playbook.md",
};

export const DESIGN_GUIDELINE_NOTES = {
  summary:
    "艇番カラーは公式配色（src/utils/colors.jsのBOAT_COLORS）を必ず使う。ロゴは金の龍（public/logo.png）で統一。動画カバー画像（frame=0）はサムネイルとしてそのまま使われるため、frame=0で主要情報が視認できる状態にする（GOLD統一・非対称配置・実データ背景・ベタ塗り帯の思想を基調とする）。「競艇」表記禁止・廃止済みモデル名の不使用・射幸心を煽る表現の禁止はrisk-rules.jsonと連動。",
  docPath: "docs/reference/sns-brand-guideline.md",
  docLabel: "sns-brand-guideline.md",
};

// 再利用可能なRemotionの共有Sceneコンポーネント・関数。venue-feature等の
// パイプラインはmasterへコードをコミットしないため、この一覧を見ずに
// 新しい形状が必要になるたびゼロから書いてしまう（2026-09-05に発生した
// 棒グラフ左偏りバグの根本原因）ことを防ぐのが目的。新しい共有コンポーネント
// を追加した際は、このファイルへの追記を忘れないこと（ADR 0031と同じ手動
// 同期の運用）
export const SHARED_COMPONENTS = [
  {
    name: "SceneHook（会場攻略・データ一覧型、案Aデザイン）",
    summary:
      "巨大な順位数字を画面左端からはみ出させる、意図的な非対称配置。TikTokプロフィールグリッドの縮小表示（横幅120px程度）でも視認できるよう、2026-08-24に複数回のレビューを経て採用した設計。新しい非対称配置を検討する際はこの前例を踏襲する",
    docPath: "sns-video-studio/remotion/src/VenueRankingCM.jsx",
    docLabel: "VenueRankingCM.jsx",
    imagePath: "/sns-hub-catalog/scene-hook.png",
  },
  {
    name: "SceneHookCompareTwo（2値比較、中央寄せ固定）",
    summary:
      "最高値vs最低値のような2値だけを比較する構成。書き捨てコードのたびに中央寄せが再現されず棒グラフが左に偏る事故が発生したため、2026-09-05に新設。2値比較の可視化が必要な場合は必ずこれを再利用する",
    docPath: "sns-video-studio/remotion/src/VenueRankingCM.jsx",
    docLabel: "VenueRankingCM.jsx",
    imagePath: "/sns-hub-catalog/scene-hook-compare-two.png",
  },
  {
    name: "SceneHookDiagonal（対角分割Before/After型）",
    summary:
      "TOP1位とWORST1位を斜め境界線で対比させる型。現在の会場攻略・データ一覧型では案Aを採用したため未使用だが、的中検証型等でBefore/After訴求が必要になった際の再利用候補としてコードを残置している",
    docPath: "sns-video-studio/remotion/src/VenueRankingCM.jsx",
    docLabel: "VenueRankingCM.jsx",
    imagePath: "/sns-hub-catalog/scene-hook-diagonal.png",
  },
  {
    name: "noteVideoShared.jsx（Fade/Pop/Logo/SceneHook/SceneFeatures/SceneCTA等）",
    summary:
      "note埋め込み解説動画・YouTube系（決まり手データCM、言語切替CM等）で共通利用する基礎コンポーネント群。8ファイル以上から再利用されている、最も広く共有されているモジュール",
    docPath: "sns-video-studio/remotion/src/noteVideoShared.jsx",
    docLabel: "noteVideoShared.jsx",
  },
  {
    name: "fitHeadline()（可変長見出しの自動折り返し・縮小）",
    summary:
      "熟語・単語の途中で改行崩れを起こさず、指定行数に収まる最大フォントサイズを自動選択する。新しいテキストブロックを追加する際は、生の<div>で複数行になりうる可変長テキストを描画せず必ずこれを使う",
    docPath: "sns-video-studio/remotion/src/textFit.js",
    docLabel: "textFit.js",
  },
  {
    name: "snsVideoShared.jsx: SceneCTA",
    summary: "X/TikTok向け動画の共通CTAシーン",
    docPath: "sns-video-studio/remotion/src/snsVideoShared.jsx",
    docLabel: "snsVideoShared.jsx",
  },
];

export function buildDocUrl(docPath) {
  return `${REPO_BASE_URL}/${docPath}`;
}
