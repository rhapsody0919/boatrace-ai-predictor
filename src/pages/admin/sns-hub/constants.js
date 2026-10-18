// SNS ハブ管理画面の各ページ・部品で共有する定数（SnsHubAdmin.jsx から切り出し）

export const PLATFORM_UPLOAD_URLS = {
  youtube: "https://studio.youtube.com",
};

export const REVISION_REASONS = [
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
export const CONTENT_REVISION_REASONS = [
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
export const TOPIC_REJECTION_REASONS = [
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
export const TIKTOK_PERMANENTLY_EXCLUDED_CATEGORY_KEYS = [
  "payout-rate",
  "outcome-distribution",
];

// sns_template_variants.formatの日本語ラベル。DB側にlabel列が無く英語の
// kebab-case識別子のみのため、docs/operation/sns-video-producer-prompt.md
// のフォーマットライブラリの呼称に合わせてここで翻訳する（2026-09-04追加）。
// race-insightは同ドキュメントに記載が無く由来不明のため、キー名からの
// 推測ラベル。未知の型（今後Routineが新規登録した場合）は生の英語キーの
// ままフォールバック表示する
export const FORMAT_LABELS = {
  "answer-check": "答え合わせ型",
  "daily-data-list": "本日のデータ一覧型",
  "live-prediction-hook": "予想数値フック型",
  "new-feature": "新機能紹介型",
  "race-insight": "レース考察型",
  "tool-showcase": "一覧アピール型",
  trivia: "豆知識型",
  "venue-ranking": "会場攻略・データ一覧型",
};

export const PLATFORM_LABELS = {
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  blog: "ブログ",
  note: "note",
};
export const LANGUAGE_LABELS = { ja: "日本語", en: "English" };
export const SOURCE_LABELS = {
  "own-metrics": "自社実績",
  "external-research": "外部調査",
};

// 「フォーマットカタログ」タブ: 型一覧(DB)＋ドキュメント要約(静的キュレーション)の2区画
// （2026-08-31、ユーザー要望。既存の「戦略メモ」はinsight PDCA専用のため別タブとして新設、
// docs/design/sns-hub-admin-ux-improvements/spec.md課題3参照）
// REVISION_REASONS（動画向け）・CONTENT_REVISION_REASONS（ブログ/note向け）を
// 統合したcode→labelの逆引き表。共通するcode（typo-or-data-error等）は
// 両リストで同じlabelのため単純mergeで問題ない（2026-09-04、過去のFB表示用）
export const REVISION_REASON_LABELS = Object.fromEntries(
  [...REVISION_REASONS, ...CONTENT_REVISION_REASONS].map((r) => [
    r.code,
    r.label,
  ]),
);
