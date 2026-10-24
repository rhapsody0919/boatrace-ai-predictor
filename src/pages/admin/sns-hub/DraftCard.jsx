// 下書きカード（手動承認のページ）。SnsHubAdmin.jsx から切り出し
import { useState, useEffect } from "react";
import XSendPanel from "./XSendPanel.jsx";
import DraftDiffPanel from "./DraftDiffPanel.jsx";
import {
  canShareVideo,
  shareVideoFile,
  downloadFileBlob,
} from "../../../utils/webShare";
import {
  PLATFORM_UPLOAD_URLS,
  REVISION_REASONS,
  CONTENT_REVISION_REASONS,
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
  contentType,
  youtubeUrl,
  approvers,
  onApprove,
  onPublishYoutube,
  onXChanged,
  onRevise,
  onRequestSpecChange,
  onMarkPosted,
  onArchive,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const [openPanel, setOpenPanel] = useState(null); // null | 'feedback'
  // X送信パネルが確かめた送信の状態。確かめるまでは unknown（投稿導線を出さない）
  const [xSendState, setXSendState] = useState("unknown");
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [expanded, setExpanded] = useState(getDefaultDraftCardExpanded);

  const variantLabel = draft.sns_template_variants
    ? `${draft.format} / ${draft.sns_template_variants.variant_name}`
    : draft.format;

  // 承認・修正はpending_reviewの下書きにのみ許可される（api/admin/sns-hub側の検証と一致）
  const canAct = draft.status === "pending_review" && !draft.external_operation_state;
  // api/_lib/snsBundleValidation.jsのisBundlePublicationBlocked()と同じ判定式。
  // フロントはapi/_libを直接importしないため手書きで複製している。あちらを変えたらここも直すこと
  const publicationBlocked = Boolean(
    draft.publish_blocked ||
    draft.bundle_import_id ||
    draft.bundle_version_hash,
  );

  // 修正指摘パネルを開いている間は、トグルで折りたたんでも
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
      {draft.external_operation_state === "reconcile" && <p role="alert">送信中または要照合です。外部結果の確認が終わるまで再送・修正できません。</p>}
      {draft.platform === "youtube" && draft.external_operation_state === "external_done" && <div>
        <p>外部操作は完了済みです。DBへの反映だけを再試行できます。</p>
        <button className="draft-action-btn" onClick={() => onPublishYoutube(draft.approver_id || selectedApproverId)}>
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

                <div className="draft-actions">
                  {draft.platform === "youtube" ? (
                    <YouTubeApproveAction
                      disabled={!selectedApproverId || publicationBlocked}
                      onApprove={() => onPublishYoutube(selectedApproverId)}
                    />
                  ) : draft.platform !== "blog" && (
                    <button
                      className="draft-action-btn approve"
                      disabled={!selectedApproverId || publicationBlocked}
                      onClick={() => onApprove(selectedApproverId)}
                    >
                      ✅ 承認
                    </button>
                  )}
                  <button
                    className="draft-action-btn revise"
                    disabled={publicationBlocked}
                    onClick={() =>
                      setOpenPanel(openPanel === "feedback" ? null : "feedback")
                    }
                  >
                    📝 修正を依頼
                  </button>
                </div>

                {openPanel === "feedback" && (
                  <RevisionPanel
                    mode="draft-feedback"
                    reasons={
                      TEXT_DRAFT_PLATFORMS.has(draft.platform)
                        ? CONTENT_REVISION_REASONS
                        : REVISION_REASONS
                    }
                    onCancel={() => setOpenPanel(null)}
                    onSubmit={async (payload) => {
                      if (payload.category === "spec") {
                        // 起票できなかったときは閉じない（入力した本文を欄に残す）
                        const closePanel = await onRequestSpecChange({
                          approverId: selectedApproverId,
                          platform: draft.platform,
                          message: payload.freeText,
                        });
                        if (closePanel) setOpenPanel(null);
                      } else {
                        onRevise({
                          approverId: selectedApproverId,
                          reasonCodes: payload.reasonCodes,
                          freeText: payload.freeText,
                          saveAsInsight: payload.permanent,
                          scope: payload.scope,
                        });
                        setOpenPanel(null);
                      }
                    }}
                  />
                )}
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

// mode:
//  - "topic-reject": ネタ却下用（TopicCard）。理由チップ+自由記述+「今後に反映」
//    チェックボックスのみのシンプルな形（2026-09-04以前と同じ挙動を維持）
//  - "draft-feedback": 下書きへの修正指摘用（DraftCard、2026-09-04再設計）。
//    「一部修正」「全部作り直し」は実務上ほぼ全部作り直しになっていたため
//    1つのフローに統合した上で、指摘の性質を明示的に2分岐させる:
//    - コンテンツ品質の指摘: 理由チップ+自由記述。反映期間（今回限り/恒久）と
//      適用範囲（このチャネルのみ/全チャネル共通）を明示的に選ばせる
//      （旧「この指摘を今後の生成方針に反映する」チェックボックス1個だと、
//      恒久化した際の適用範囲が下書きから自動推定される曖昧な挙動だった）
//    - 制作仕様の変更要望: 尺・BGM等、個別の下書き修正では解決しない要望。
//      Linear起票のみ行い、下書き自体のステータスは変更しない
export function RevisionPanel({
  mode,
  reasons = REVISION_REASONS,
  onSubmit,
  onCancel,
}) {
  const isDraftFeedback = mode === "draft-feedback";
  const [category, setCategory] = useState("quality"); // "quality" | "spec"
  const [reasonCodes, setReasonCodes] = useState([]);
  const [freeText, setFreeText] = useState("");
  const [saveAsInsight, setSaveAsInsight] = useState(false); // topic-reject用
  const [permanent, setPermanent] = useState(false); // draft-feedback用（旧saveAsInsight相当）
  const [scope, setScope] = useState("channel"); // "channel" | "all"
  // 送信の応答を待つ間の二重送信を防ぐ（制作仕様の変更要望は応答を待ってから閉じるため）
  const [submitting, setSubmitting] = useState(false);

  function toggleReason(code) {
    setReasonCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  const isSpecCategory = isDraftFeedback && category === "spec";
  const hasFreeText = freeText.trim().length > 0;
  const canSubmit = isSpecCategory
    ? hasFreeText
    : reasonCodes.length > 0 || hasFreeText;

  return (
    <div className="revision-panel">
      {isDraftFeedback && (
        <div className="revision-category-toggle">
          <button
            type="button"
            className={`revision-category-btn ${category === "quality" ? "selected" : ""}`}
            onClick={() => setCategory("quality")}
          >
            📋 コンテンツ品質の指摘
          </button>
          <button
            type="button"
            className={`revision-category-btn ${category === "spec" ? "selected" : ""}`}
            onClick={() => setCategory("spec")}
          >
            🔧 制作仕様の変更要望
          </button>
        </div>
      )}

      {!isSpecCategory && (
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
          isSpecCategory
            ? "例: BGMをもっと軽快な曲にしてほしい、尺を20秒に伸ばしてほしい"
            : "自由記述（任意）"
        }
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
      />

      {isSpecCategory ? (
        <p className="revision-spec-hint">
          この内容でLinearにチケットを起票します。この下書き自体は変更されません（承認/修正指摘は別途行ってください）。
          今すぐ複数案を比較しながら作り込みたい場合は、Claude Codeで
          <code>/refine-creative</code>を使う方が早い場合があります。
        </p>
      ) : (
        <>
          {/* BGM・デザイン等の抜本的な作り込みはこのUIでは行わない設計
              （.claude/CLAUDE.mdフローB参照）。ここで気づいてもらうための
              軽いヒントのみ表示する */}
          {isDraftFeedback && (
            <p className="revision-refine-hint">
              💡 尺・BGM等の制作仕様そのものを変えたい場合は、上の「🔧
              制作仕様の変更要望」を選んでください
            </p>
          )}

          {isDraftFeedback ? (
            <div className="revision-permanence-group">
              <span className="revision-permanence-label">反映期間:</span>
              <label className="revision-radio">
                <input
                  type="radio"
                  name="revision-permanent"
                  checked={!permanent}
                  disabled={!hasFreeText}
                  onChange={() => setPermanent(false)}
                />
                今回限り
              </label>
              <label className="revision-radio">
                <input
                  type="radio"
                  name="revision-permanent"
                  checked={permanent}
                  disabled={!hasFreeText}
                  onChange={() => setPermanent(true)}
                />
                恒久ルール化
              </label>
              {permanent && (
                <>
                  <span className="revision-permanence-label">適用範囲:</span>
                  <label className="revision-radio">
                    <input
                      type="radio"
                      name="revision-scope"
                      checked={scope === "channel"}
                      onChange={() => setScope("channel")}
                    />
                    このチャネルのみ
                  </label>
                  <label className="revision-radio">
                    <input
                      type="radio"
                      name="revision-scope"
                      checked={scope === "all"}
                      onChange={() => setScope("all")}
                    />
                    全チャネル共通
                  </label>
                </>
              )}
            </div>
          ) : (
            <label className="revision-save-insight">
              <input
                type="checkbox"
                checked={saveAsInsight}
                disabled={!hasFreeText}
                onChange={(e) => setSaveAsInsight(e.target.checked)}
              />
              この指摘を今後の生成方針に反映する
            </label>
          )}
        </>
      )}

      <div className="revision-panel-actions">
        <button className="revision-cancel" onClick={onCancel}>
          キャンセル
        </button>
        <button
          className="revision-submit"
          disabled={!canSubmit || submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await onSubmit({
              category: isDraftFeedback ? category : undefined,
              reasonCodes,
              freeText,
              // ラジオ/チェックボックスはdisabledでもstate自体はリセットされない
              // ため、自由記述を消してから送信した場合に備え送信時点で再検証する
              // （コードレビューで指摘: 空のfreeTextとsaveAsInsight:trueが
              // 同時に送信されうる不整合があった）
              saveAsInsight: saveAsInsight && hasFreeText,
              permanent: permanent && hasFreeText,
              scope,
              });
            } finally {
              setSubmitting(false);
            }
          }}
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
export function ContentTypeBadge({ contentType }) {
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
export function ChannelTargetToggle({ targets, onToggle }) {
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
