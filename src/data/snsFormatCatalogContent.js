/**
 * SNSハブ管理画面「フォーマットカタログ」タブ用の静的キュレーションデータ。
 *
 * docs/operation/sns-video-producer-prompt.md・x-operations-playbook.md・
 * docs/reference/sns-brand-guideline.md の内容を要約し、元ドキュメントへの
 * GitHubリンクを添えたもの（ADR 0031参照）。
 *
 * 元ドキュメントが更新されても自動追従しない。ドキュメント更新時は
 * このファイルも手動で同期する（自動同期の仕組みは意図的に作っていない、
 * ADR 0031参照）。
 */

const REPO_BASE_URL =
  "https://github.com/rhapsody0919/boatrace-ai-predictor/blob/master";

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

export function buildDocUrl(docPath) {
  return `${REPO_BASE_URL}/${docPath}`;
}
