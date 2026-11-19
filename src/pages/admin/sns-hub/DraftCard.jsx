// 下書きカード（手動承認のページ）。SnsHubAdmin.jsx から切り出し
// 小さな部品（投稿導線・プレビュー等）は DraftCardParts.jsx へ移した。ここの子（Draft...）は props だけ受ける。
// hooks（useState 4つ）は DraftCard が持つ（数と順は元のまま）
import { useState } from "react";
import XSendPanel from "./XSendPanel.jsx";
import DraftDiffPanel from "./DraftDiffPanel.jsx";
import {
  ApproverChips,
  PostingActionLinks,
  TextDraftPreview,
  VideoPreview,
} from "./DraftCardParts.jsx";
import { NoteCopyActionLinks } from "./DraftCardNote.jsx";
import { PLATFORM_LABELS, LANGUAGE_LABELS } from "./constants.js";
import { formatDateTime, getDefaultDraftCardExpanded } from "./utils";

export { ApproverChips, TextDraftPreview, VideoPreview };

const TEXT_DRAFT_PLATFORMS = new Set(["blog", "note"]);

// DraftCard.jsx に残した小さな部品（元の字のまま）
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

function RiskWarningBadge({ flag }) {
  const label =
    typeof flag === "string"
      ? flag
      : flag.description || flag.ruleId || "リスク検出";
  return <span className="risk-warning-badge">⚠️ {label}</span>;
}

// カードの上のプレビューと、外部操作の注意（元の DraftCard の最初の塊）
function DraftCardMedia({ draft, isOpen, selectedApproverId, onPublishYoutube }) {
  return (
    <>
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
    </>
  );
}

// 公開不可の表示（元の DraftCard の draft-card-body の先頭）
function PublicationHold({ draft }) {
  return (
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
  );
}

// チャネル・言語・型のバッジ
function DraftBadges({ draft, variantLabel }) {
  return (
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
  );
}

// 承認者の選択と承認ボタン（canAct のときだけ呼ばれる）
function DraftApproveActions({
  draft,
  approvers,
  selectedApproverId,
  onSelectApprover,
  publicationBlocked,
  onApprove,
  onPublishYoutube,
}) {
  return (
    <>
      <ApproverChips
        approvers={approvers}
        selectedId={selectedApproverId}
        onSelect={onSelectApprover}
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
      </div>
    </>
  );
}

// 手動の投稿導線（承認済みで、X は送信の状態が確かめられて送信中でないとき）
function DraftPostingLinks({ draft, youtubeUrl, xSendState, onMarkPosted }) {
  const show =
    (draft.platform !== "x" ||
      !["unknown", "queued", "sending", "reconcile", "posted"].includes(
        xSendState,
      )) &&
    (draft.status === "approved" || draft.status === "ready_to_post");
  if (!show) return null;
  return draft.platform === "note" ? (
    <NoteCopyActionLinks
      draft={draft}
      youtubeUrl={youtubeUrl}
      onMarkPosted={onMarkPosted}
    />
  ) : (
    <PostingActionLinks draft={draft} onMarkPosted={onMarkPosted} />
  );
}

// 非表示にする操作（確認の状態は DraftCard が持ち、setter を渡される）
function DraftArchiveControl({ confirming, onConfirmingChange, onArchive }) {
  return confirming ? (
    <div className="draft-hide-confirm">
      <span>非表示にしますか？</span>
      <button
        className="revision-cancel"
        onClick={() => onConfirmingChange(false)}
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
      onClick={() => onConfirmingChange(true)}
    >
      🗂️ 非表示にする
    </button>
  );
}

// 展開したときの中身（元の DraftCard の isOpen && の中）。state は持たず props だけ受ける
function DraftCardDetails({
  draft,
  youtubeUrl,
  approvers,
  selectedApproverId,
  onSelectApprover,
  canAct,
  publicationBlocked,
  xSendState,
  onXSendStateChange,
  confirmingArchive,
  onConfirmingArchiveChange,
  onApprove,
  onPublishYoutube,
  onXChanged,
  onMarkPosted,
  onArchive,
}) {
  return (
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
        <DraftApproveActions
          draft={draft}
          approvers={approvers}
          selectedApproverId={selectedApproverId}
          onSelectApprover={onSelectApprover}
          publicationBlocked={publicationBlocked}
          onApprove={onApprove}
          onPublishYoutube={onPublishYoutube}
        />
      )}

      {draft.platform === "x" && (
        <XSendPanel draft={draft} approverId={selectedApproverId} blocked={publicationBlocked}
          onChanged={onXChanged} onStateChange={onXSendStateChange} />
      )}

      <DraftPostingLinks
        draft={draft}
        youtubeUrl={youtubeUrl}
        xSendState={xSendState}
        onMarkPosted={onMarkPosted}
      />

      {draft.status !== "posted" && !draft.external_operation_state && (
        <DraftArchiveControl
          confirming={confirmingArchive}
          onConfirmingChange={onConfirmingArchiveChange}
          onArchive={onArchive}
        />
      )}
    </>
  );
}

export default function DraftCard({
  draft,
  youtubeUrl,
  approvers,
  onApprove,
  onPublishYoutube,
  onXChanged,
  onMarkPosted,
  onArchive,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
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
      <DraftCardMedia
        draft={draft}
        isOpen={isOpen}
        selectedApproverId={selectedApproverId}
        onPublishYoutube={onPublishYoutube}
      />

      <div className="draft-card-body">
        {publicationBlocked && <PublicationHold draft={draft} />}
        <DraftBadges draft={draft} variantLabel={variantLabel} />

        <p className="draft-meta-text">
          生成: {formatDateTime(draft.created_at)}
          {draft.parent_draft_id && "（修正版・再生成）"}
        </p>

        <button
          type="button"
          className="draft-card-expand-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {isOpen ? "▲ 閉じる" : "▼ 詳細・操作を見る"}
        </button>

        {isOpen && (
          <DraftCardDetails
            draft={draft}
            youtubeUrl={youtubeUrl}
            approvers={approvers}
            selectedApproverId={selectedApproverId}
            onSelectApprover={setSelectedApproverId}
            canAct={canAct}
            publicationBlocked={publicationBlocked}
            xSendState={xSendState}
            onXSendStateChange={setXSendState}
            confirmingArchive={confirmingArchive}
            onConfirmingArchiveChange={setConfirmingArchive}
            onApprove={onApprove}
            onPublishYoutube={onPublishYoutube}
            onXChanged={onXChanged}
            onMarkPosted={onMarkPosted}
            onArchive={onArchive}
          />
        )}
      </div>
    </div>
  );
}
