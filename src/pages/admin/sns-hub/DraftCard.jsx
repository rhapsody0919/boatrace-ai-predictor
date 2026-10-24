// 下書きカード（手動承認のページ）。SnsHubAdmin.jsx から切り出し
import { useState, useEffect } from "react";
import XSendPanel from "./XSendPanel.jsx";
import DraftDiffPanel from "./DraftDiffPanel.jsx";
import BlogPrReview from "./BlogPrReview";
import {
  canShareVideo,
  shareVideoFile,
  downloadFileBlob,
} from "../../../utils/webShare";
import {
  PLATFORM_UPLOAD_URLS,
  PLATFORM_LABELS,
  LANGUAGE_LABELS,
} from "./constants.js";
import {
  buildXIntentUrl,
  buildPostText,
  isIOSSafari,
  formatDateTime,
  getDefaultDraftCardExpanded,
} from "./utils";

// blog/youtubeは承認操作自体がPRマージ/YouTube投稿まで行うため、
// 承認後は"approved"状態を経由せず直接"posted"になる（ADR 0034, 0035）
const AUTO_PUBLISH_PLATFORMS = new Set(["blog", "youtube"]);
const TEXT_DRAFT_PLATFORMS = new Set(["blog", "note"]);

export default function DraftCard({
  draft,
  youtubeUrl,
  approvers,
  onApprove,
  onMergeBlogPr,
  onPublishYoutube,
  onXChanged,
  onMarkPosted,
  onArchive,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const [blogReview, setBlogReview] = useState(null);
  // X送信パネルが確かめた送信の状態。確かめるまでは unknown（投稿導線を出さない）
  const [xSendState, setXSendState] = useState("unknown");
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [expanded, setExpanded] = useState(getDefaultDraftCardExpanded);

  const variantLabel = draft.sns_template_variants
    ? `${draft.format} / ${draft.sns_template_variants.variant_name}`
    : draft.format;

  // 承認はpending_reviewの下書きにのみ許可される（api/admin/sns-hub側の検証と一致）
  const canAct = draft.status === "pending_review" && !draft.external_operation_state;
  // api/_lib/snsBundleValidation.jsのisBundlePublicationBlocked()と同じ判定式。
  // フロントはapi/_libを直接importしないため手書きで複製している。あちらを変えたらここも直すこと
  const publicationBlocked = Boolean(
    draft.publish_blocked ||
    draft.bundle_import_id ||
    draft.bundle_version_hash,
  );

  const isOpen = expanded;

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
      {draft.external_operation_state === "reconcile" && <p role="alert">送信中または要照合です。外部結果の確認が終わるまで再送・修正できません。</p>}
      {draft.external_operation_state === "external_done" && <div>
        <p>外部操作は完了済みです。DBへの反映だけを再試行できます。</p>
        <button className="draft-action-btn" onClick={() => draft.platform === "youtube"
          ? onPublishYoutube(draft.approver_id || selectedApproverId)
          : onMergeBlogPr(draft.approver_id || selectedApproverId, draft.external_operation_result?.source_data?.blog_reviewed_head_sha)}>
          DB反映を再試行
        </button>
      </div>}
      {draft.platform === "youtube" && (
        <ThumbnailPreview thumbnailUrl={draft.cover_image_url} />
      )}
      {/* 企画型パイプラインは1投稿に画像2枚（cover_image_url + 2枚目の
          source_data.dataCardUrl）を添付する。2枚目はこれまでプレビュー自体が
          出ておらずダウンロードもできなかったため、1枚目と同じ見た目で追加する
          （2026-09-09） */}
      {!draft.video_url && draft.source_data?.dataCardUrl && (
        <div className="video-preview video-preview-empty">
          <img
            src={draft.source_data.dataCardUrl}
            alt=""
            className="video-preview-cover"
          />
        </div>
      )}

      <div className="draft-card-body">
        {publicationBlocked && (
          <div className="sns-bundle-publication-hold">
            <strong>公開不可</strong>
            <p>
              v0素材の修正はローカルで再生成し、新しい版を取り込んでください。
            </p>
            <ul>
              {(draft.publication_hold_reasons || []).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
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
          onClick={() => setExpanded((v) => !v)}
        >
          {isOpen ? "▲ 閉じる" : "▼ 詳細・操作を見る"}
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

            <DraftDiffPanel draft={draft} />

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

                {draft.platform === "blog" && <BlogPrReview draft={draft} review={blogReview} onReview={setBlogReview} />}
                <div className="draft-actions">
                  {draft.platform === "blog" ? (
                    <BlogApproveAction
                      disabled={publicationBlocked || !selectedApproverId || !blogReview?.confirmed || blogReview.prUrl !== draft.pr_url}
                      onApprove={() => onMergeBlogPr(selectedApproverId, blogReview.headSha)}
                    />
                  ) : draft.platform === "youtube" ? (
                    <YouTubeApproveAction
                      disabled={!selectedApproverId || publicationBlocked}
                      onApprove={() => onPublishYoutube(selectedApproverId)}
                    />
                  ) : (
                    <button
                      className="draft-action-btn approve"
                      disabled={!selectedApproverId || publicationBlocked}
                      onClick={() => onApprove(selectedApproverId)}
                    >
                      ✅ 承認
                    </button>
                  )}
                </div>
              </>
            )}

            {draft.platform === "x" && (
              <XSendPanel draft={draft} approverId={selectedApproverId} blocked={publicationBlocked}
                onChanged={onXChanged} onStateChange={setXSendState} />
            )}

            {(draft.platform !== "x" ||
              !["unknown", "queued", "sending", "reconcile", "posted"].includes(
                xSendState,
              )) &&
              (draft.status === "approved" ||
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

            {draft.status !== "posted" && !draft.external_operation_state &&
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

// カバー画像のダウンロードボタン（2026-09-04追加）。downloadFileBlob（クロス
// オリジンURLのdownload属性無視問題を回避するfetch→Blob方式）を画像URLにも使う
function DownloadImageButton({ imageUrl, fileName, label }) {
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

// revision_requestedからの経過時間の目安（この時間を超えたら「時間がかかっています」表示に切り替える）
const PROCESSING_STALE_THRESHOLD_MINUTES = 30;

// 修正の依頼（redo、2026-10-24 撤去）の後、新規下書きの生成・旧下書きのarchived化は非同期Routine任せで
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
