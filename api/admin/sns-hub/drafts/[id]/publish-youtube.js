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
  updateDraft,
} from "../../../../_lib/snsHubHelpers.js";

export const config = {
  runtime: "edge",
};

const YOUTUBE_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status";
const YOUTUBE_THUMBNAIL_URL_BASE =
  "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

async function getAccessToken() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `YouTube OAuthトークン取得に失敗しました (${response.status})`,
    );
  }
  const { access_token } = await response.json();
  return access_token;
}

async function uploadVideo(accessToken, draft, videoBlob) {
  const metadata = {
    snippet: {
      title: draft.title,
      description: draft.caption_text || "",
      tags: draft.hashtags || [],
    },
    status: { privacyStatus: "public" },
  };

  const boundary = "boatai-youtube-upload-boundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: video/mp4\r\n\r\n`;
  const bodyBytes = new Blob([body, videoBlob, `\r\n--${boundary}--`]);

  const response = await fetch(YOUTUBE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: bodyBytes,
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `YouTube動画アップロードに失敗しました (${response.status}): ${errorBody}`,
    );
  }
  return response.json();
}

async function uploadThumbnail(accessToken, videoId, thumbnailBlob) {
  const response = await fetch(
    `${YOUTUBE_THUMBNAIL_URL_BASE}?videoId=${videoId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/jpeg",
      },
      body: thumbnailBlob,
    },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `YouTubeサムネイル設定に失敗しました (${response.status}): ${errorBody}`,
    );
  }
  return response.json();
}

export default async function handler(req) {
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

    const videoResponse = await fetch(draft.video_storage_path);
    if (!videoResponse.ok) {
      return jsonResponse(
        { error: `動画取得に失敗しました (${videoResponse.status})` },
        502,
      );
    }
    const videoBlob = await videoResponse.blob();

    const uploaded = await uploadVideo(accessToken, draft, videoBlob);
    const youtubeVideoId = uploaded.id;

    if (draft.cover_image_path) {
      const thumbResponse = await fetch(draft.cover_image_path);
      if (thumbResponse.ok) {
        const thumbBlob = await thumbResponse.blob();
        await uploadThumbnail(accessToken, youtubeVideoId, thumbBlob);
      }
    }

    const youtubeUrl = `https://youtu.be/${youtubeVideoId}`;
    const updated = await updateDraft(id, {
      status: "posted",
      approver_id: approverId,
      approved_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
      source_data: { ...(draft.source_data || {}), youtube_url: youtubeUrl },
    });

    return jsonResponse({ data: updated, youtubeUrl });
  } catch (error) {
    console.error("SNS Hub publish-youtube Edge function error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
}
