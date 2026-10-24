// SNS ハブ管理画面の各ページ・部品で共有する定数（SnsHubAdmin.jsx から切り出し）

export const PLATFORM_UPLOAD_URLS = {
  youtube: "https://studio.youtube.com",
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

// 戦略メモの履歴で過去の修正理由（sns_content_revisions）を表示するための表。修正の依頼の口（redo）は
// SH01 R2 で消したが、過去の行の表示に使う
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

// REVISION_REASONS（動画向け）・CONTENT_REVISION_REASONS（ブログ/note向け）を
// 統合したcode→labelの逆引き表。共通するcode（typo-or-data-error等）は
// 両リストで同じlabelのため単純mergeで問題ない（2026-09-04、過去のFB表示用）
export const REVISION_REASON_LABELS = Object.fromEntries(
  [...REVISION_REASONS, ...CONTENT_REVISION_REASONS].map((r) => [
    r.code,
    r.label,
  ]),
);
