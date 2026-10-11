import { isBundlePublicationBlocked } from "../../../../_lib/snsBundleValidation.js";
/**
 * Vercel Edge Function: YouTube下書きの承認→YouTube Data API v3への自動投稿
 * POST /api/admin/sns-hub/drafts/:id/publish-youtube
 * body: { approverId: string }
 *
 * platform='youtube'の下書き専用。承認操作自体がYouTubeへの実投稿まで行う
 * （spec.md FR7、ADR 0035）。成功時はstatusを直接'posted'にする。
 *
 * 環境変数 YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN
 * （OAuthリフレッシュトークン、ユーザー自身の一度きりの同意で取得）が必要。
 *
 * 注意: 動画本体はSupabase Storageから一度サーバー側でfetchしてYouTubeへ
 * 転送する（videos.insert、続けてthumbnails.set）。Edge Functionの実行時間・
 * メモリ制約上、動画サイズが大きい場合はタイムアウトする可能性がある
 * （このパイプラインが生成する動画は短尺想定のため通常は問題ない見込みだが、
 * 実際にYouTube認可情報を設定して動作確認するまでは未検証。詰まる場合は
 * runtime: 'nodejs'のServerless Functionへの切り替えを検討すること）。
 */

import {
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
  signStoragePath,
} from "../../../../_lib/snsHubHelpers.js";
import {
  getYoutubeAccessToken,
  uploadYoutubeVideo,
  uploadYoutubeThumbnail,
} from "../../../../_lib/youtubeUpload.js";

import { externalRpc, claimExternal, recordExternal, finishExternal, completedResponse } from "../../../../_lib/snsExternalOperations.js";

import { requireAdminAuth } from "../../../../_lib/adminAuth.js";

export const config = {
  runtime: "edge",
};

async function getAccessToken() {
  return getYoutubeAccessToken({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
  });
}

async function uploadVideo(accessToken, draft, videoBlob) {
  return uploadYoutubeVideo(
    accessToken,
    {
      title: draft.title,
      description: draft.caption_text || "",
      tags: draft.hashtags || [],
      // 下書き承認フローはこれまで通り公開投稿する（既存挙動を維持）
      privacyStatus: "public",
    },
    videoBlob,
  );
}

async function uploadThumbnail(accessToken, videoId, thumbnailBlob) {
  return uploadYoutubeThumbnail(accessToken, videoId, thumbnailBlob);
}

export default async function handler(req) {
  // middleware はエンコードしたパスで迂回できるため、関数側でも必ず認証する（api/_lib/adminAuth.js）
  const denied = await requireAdminAuth(req);
  if (denied) return denied;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const id = req.url.match(/drafts\/([^/]+)\/publish-youtube/)?.[1];
  if (!isValidDraftId(id)) {
    return jsonResponse({ error: "draft idの形式が不正です" }, 400);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }
  const { approverId } = body;
  if (!approverId) {
    return jsonResponse({ error: "approverIdは必須です" }, 400);
  }

  try {
    const draft = await getDraftById(id);
    if (!draft) {
      return jsonResponse({ error: "下書きが見つかりません" }, 404);
    }
    if (draft.platform !== "youtube") {
      return jsonResponse(
        { error: "このエンドポイントはplatform='youtube'の下書き専用です" },
        400,
      );
    }
    if (draft.source_data?.deadline_queue) {
      return jsonResponse({ error: '期限付き投稿は待ち行列で個別承認してください。接続準備中です' }, 409);
    }
    if (isBundlePublicationBlocked(draft)) {
      return jsonResponse({ error: "公開不可: v0素材の保留はこの操作で解除できません" }, 409);
    }
    if (draft.external_operation_state === "external_done") {
      return jsonResponse(completedResponse(await finishExternal(draft)));
    }
    if (draft.external_operation_state === "done") return jsonResponse(completedResponse(draft));
    if (draft.external_operation_state === "reconcile") {
      return jsonResponse({ error: "送信中または要照合です。再アップロードせず外部結果を確認してください" }, 409);
    }
    if (draft.status !== "pending_review") {
      return jsonResponse(
        {
          error: `status='${draft.status}'の下書きは承認できません（pending_reviewのみ）`,
        },
        409,
      );
    }
    if (!draft.video_storage_path) {
      return jsonResponse({ error: "video_storage_pathが未設定です" }, 409);
    }
    if (!draft.title || !draft.title.trim()) {
      return jsonResponse(
        {
          error:
            "titleが未設定です。動画タイトルを設定してから承認してください",
        },
        409,
      );
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
      return jsonResponse(
        {
          error:
            "YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET/YOUTUBE_REFRESH_TOKENが未設定です",
        },
        500,
      );
    }

    // 2026-09-03修正: video_storage_pathは生のStorageパスを保存する規約
    // （drafts/index.jsの読み取り時署名と統一）のため、fetchする前に必ず署名する
    const videoUrl = await signStoragePath(draft.video_storage_path);
    if (!videoUrl) {
      return jsonResponse(
        { error: "動画の署名付きURL発行に失敗しました" },
        502,
      );
    }
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      return jsonResponse(
        { error: `動画取得に失敗しました (${videoResponse.status})` },
        502,
      );
    }
    const videoBlob = await videoResponse.blob();

    const operationToken = await claimExternal(draft, approverId);
    const uploaded = await uploadVideo(accessToken, draft, videoBlob);
    const youtubeVideoId = uploaded.id;
    if (!youtubeVideoId) throw new Error("動画IDを確認できません。再送せず照合してください");
    const youtubeUrl = `https://youtu.be/${youtubeVideoId}`;
    // サムネ処理より先に動画IDを永続化。ここで失敗してもclaimは残る。
    const recorded = await recordExternal(id, operationToken, {
      youtubeUrl, posted_at: new Date().toISOString(),
      source_data: { youtube_video_id: youtubeVideoId, youtube_url: youtubeUrl },
      thumbnailWarning: draft.cover_image_path ? "unconfirmed" : null,
    });

    // サムネイル設定は動画本体のアップロードとは独立した成否として扱う。
    // ここで例外を投げると、動画自体はYouTube上に既に公開済み（取り消し不可）
    // にもかかわらずstatusがpending_reviewのまま残り、下書きを再承認すると
    // 動画が重複投稿される事故につながる（2026-09-02、実クレデンシャルでの
    // 検証時にサムネイル権限エラーで実際に発生した不具合）
    let thumbnailError = null;
    if (draft.cover_image_path) {
      try {
        const thumbnailUrl = await signStoragePath(draft.cover_image_path);
        if (!thumbnailUrl) {
          throw new Error("サムネイルの署名付きURL発行に失敗しました");
        }
        const thumbResponse = await fetch(thumbnailUrl);
        if (!thumbResponse.ok) {
          throw new Error(
            `サムネイル取得に失敗しました (${thumbResponse.status})`,
          );
        }
        const thumbBlob = await thumbResponse.blob();
        await uploadThumbnail(accessToken, youtubeVideoId, thumbBlob);
      } catch (error) {
        console.error("SNS Hub publish-youtube thumbnail error:", error);
        thumbnailError = "failed";
      }
    }

    // サムネ結果の保存失敗時も、先に保存した動画IDは残り再送しない。
    if (draft.cover_image_path) {
      await externalRpc("sns_update_external_warning", {
        p_id: id, p_token: operationToken, p_warning: thumbnailError,
      });
    }
    return jsonResponse(completedResponse(await finishExternal(recorded)));

  } catch (error) {
    console.error("SNS Hub publish-youtube Edge function error:", error);
    return jsonResponse({ error: "処理を完了できませんでした。最新の状態を再読み込みして確認してください。" }, error.status || 500);
  }
}
