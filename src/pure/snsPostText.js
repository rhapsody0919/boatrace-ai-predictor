// キャプション本文＋ハッシュタグを投稿用の完成形テキストに組み立てる。
// コピー・X Intent・共有の3経路で同じテキストになるよう必ずこれを使う
// （X Intentだけcaption_text単体を渡していてハッシュタグが欠落する不具合が
// 2026-08-29の初回実投稿で発覚したため共通化）
export function buildPostText(draft) {
  const hashtagLine = (draft.hashtags || []).filter(Boolean).join(" ");
  return [draft.caption_text, hashtagLine].filter(Boolean).join("\n\n");
}
