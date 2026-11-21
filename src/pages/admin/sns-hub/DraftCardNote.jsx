// DraftCardParts.jsx から移した note 下書きの投稿導線（クリップボードへのコピーのボタンと NoteCopyActionLinks。字は元のまま）
import { useState } from "react";
import { DownloadImageButton } from "./DraftCardParts.jsx";

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
export function NoteCopyActionLinks({ draft, youtubeUrl, onMarkPosted }) {
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
