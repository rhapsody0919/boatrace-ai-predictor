// DraftCard.jsx から移した小さな部品（投稿導線・プレビュー・承認者のチップ等。字は元のまま）。
// ApproverChips・TextDraftPreview・VideoPreview は DraftCard.jsx が同じ名で再 export する
import { useState, useEffect } from "react";
import {
  canShareVideo,
  shareVideoFile,
  downloadFileBlob,
} from "../../../utils/webShare";
import { PLATFORM_UPLOAD_URLS, PLATFORM_LABELS } from "./constants.js";
import { buildXIntentUrl, buildPostText, isIOSSafari } from "./utils";

// 共有できるか（iOS Safari の動画共有）の判定。対象外なら共有不可の固定値を返す
function usePostingShareState(draft) {
  const [videoShareState, setShareState] = useState({
    checked: false,
    canShare: false,
    file: null,
  });

  const shouldCheckShare = Boolean(isIOSSafari() && draft.video_url);
  // 対象外になったら、再び動画が渡されたときに以前のファイルを使わない。
  if (
    !shouldCheckShare &&
    (!videoShareState.checked || videoShareState.canShare || videoShareState.file)
  ) {
    setShareState({ checked: true, canShare: false, file: null });
  }
  const shareState = shouldCheckShare
    ? videoShareState
    : { checked: true, canShare: false, file: null };

  useEffect(() => {
    let cancelled = false;
    if (shouldCheckShare) {
      canShareVideo(draft.video_url).then((result) => {
        if (!cancelled) setShareState({ checked: true, ...result });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [draft.video_url, shouldCheckShare]);

  return shareState;
}

function PostingShareOrDownload({
  draft,
  shareState,
  downloadState,
  onShare,
  onDownload,
}) {
  if (shareState.checked && shareState.canShare) {
    return (
      <button className="posting-action-btn share" onClick={onShare}>
        📤 共有して投稿
      </button>
    );
  }
  return (
    draft.video_url && (
      <>
        <button
          className="posting-action-btn download"
          onClick={onDownload}
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
  );
}

function PostingImageDownloads({ draft }) {
  return (
    <>
      {/* 企画型パイプライン等、動画ではなく静止画像2枚（cover_image_url +
          source_data.dataCardUrl）で構成される投稿には、動画用の
          handleDownloadでは対応できないため画像専用のダウンロードボタンを
          出す（2026-09-09、画像がダウンロードできない不具合の修正） */}
      {!draft.video_url && draft.cover_image_url && (
        <DownloadImageButton
          imageUrl={draft.cover_image_url}
          fileName={`${draft.platform}-${draft.language}-1.png`}
          label="画像①をダウンロード"
        />
      )}
      {!draft.video_url && draft.source_data?.dataCardUrl && (
        <DownloadImageButton
          imageUrl={draft.source_data.dataCardUrl}
          fileName={`${draft.platform}-${draft.language}-2.png`}
          label="画像②をダウンロード"
        />
      )}
    </>
  );
}

export function PostingActionLinks({ draft, onMarkPosted }) {
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [downloadState, setDownloadState] = useState({
    downloading: false,
    error: null,
  });
  const shareState = usePostingShareState(draft);

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
      <PostingShareOrDownload
        draft={draft}
        shareState={shareState}
        downloadState={downloadState}
        onShare={handleShare}
        onDownload={handleDownload}
      />

      <PostingImageDownloads draft={draft} />

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

export function ApproverChips({ approvers, selectedId, onSelect }) {
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

// ブログ/note下書きのプレビュー（2026-09-01追加、screens.md参照）。
// VideoPreviewの文章版。タイトル・本文（折りたたみ可）・タグ・画像or
// YouTube動画リンクを表示する
export function TextDraftPreview({ draft }) {
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

// カバー画像のダウンロードボタン（2026-09-04追加）。downloadFileBlob（クロス
// オリジンURLのdownload属性無視問題を回避するfetch→Blob方式）を画像URLにも使う
export function DownloadImageButton({ imageUrl, fileName, label }) {
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

// active=falseの間（モバイルでカードが折りたたまれている等）は<video>をマウント
// せずカバー画像のみ表示する（2026-09-01対応）。一覧に多数のカードが並ぶと
// <video preload="metadata">が同時に何本もロードされ、体感速度に影響していた
// （ユーザー指摘）ため、実際に見る操作（カードを展開する）をした時だけ動画を
// 読み込むようにした
export function VideoPreview({ videoUrl, coverImageUrl, active = true }) {
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
