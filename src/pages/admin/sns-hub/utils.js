// SnsHubAdmin.jsx共通ユーティリティ（BOA-242、docs/design/sns-hub-admin-refactoring/plan.md参照）
// 依存の無い純粋関数のみを対象に、リファクタリングの第一歩として切り出した。

export function buildXIntentUrl(postText) {
  return `https://x.com/intent/post?text=${encodeURIComponent(postText || "")}`;
}

// キャプション本文＋ハッシュタグを投稿用の完成形テキストに組み立てる。
// コピー・X Intent・共有の3経路で同じテキストになるよう必ずこれを使う
// （X Intentだけcaption_text単体を渡していてハッシュタグが欠落する不具合が
// 2026-08-29の初回実投稿で発覚したため共通化）
export function buildPostText(draft) {
  const hashtagLine = (draft.hashtags || []).filter(Boolean).join(" ");
  return [draft.caption_text, hashtagLine].filter(Boolean).join("\n\n");
}

export function isIOSSafari() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function formatDateTime(isoString) {
  if (!isoString) return "-";
  return new Date(isoString).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST基準で「今日」の日付（YYYY-MM-DD）かどうかを判定する */
export function isTodayJST(isoString) {
  if (!isoString) return false;
  const toJstDateKey = (date) =>
    new Date(date.getTime() + JST_OFFSET_MS).toISOString().split("T")[0];
  return toJstDateKey(new Date(isoString)) === toJstDateKey(new Date());
}

// スマホ幅(2列グリッド)では詳細・操作ボタンを畳んだ状態で開く。デスクトップ幅では
// 従来通り常に展開（auto-fillグリッドで元々カード自体が大きく、畳む必要が無いため）。
// 判定基準はCSS側の2列グリッド切り替え（.draft-listの@media (max-width: 480px)）と
// 必ず同じ値にする（ズレるとカードが1列表示なのに折りたたまれる幅域ができてしまう）
export function getDefaultDraftCardExpanded() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(min-width: 481px)").matches;
}
