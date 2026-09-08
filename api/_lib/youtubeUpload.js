/**
 * YouTube Data API v3への動画・サムネイルアップロードの純粋ロジック。
 * `api/admin/sns-hub/drafts/[id]/publish-youtube.js`（本番の下書き承認フロー）と
 * `scripts/maintenance/test-youtube-upload.js`（standaloneの動作確認スクリプト）の
 * 両方から同じ実装を使うために切り出した。Supabase・下書きレコードには依存しない。
 */

const YOUTUBE_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status";
const YOUTUBE_THUMBNAIL_URL_BASE =
  "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

export async function getYoutubeAccessToken({
  clientId,
  clientSecret,
  refreshToken,
}) {
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

/**
 * @param {string} accessToken
 * @param {{title: string, description?: string, tags?: string[], privacyStatus?: "public"|"unlisted"|"private"}} meta
 * @param {Blob} videoBlob
 */
export async function uploadYoutubeVideo(accessToken, meta, videoBlob) {
  if (!meta.title || !meta.title.trim()) {
    throw new Error("動画タイトル（title）が未設定です");
  }

  const metadata = {
    snippet: {
      title: meta.title,
      description: meta.description || "",
      tags: meta.tags || [],
    },
    // 未指定時は"unlisted"（限定公開）を既定にする。本番の公開下書きフローは
    // 明示的に"public"を渡すことでこれまで通りの挙動を維持する
    status: { privacyStatus: meta.privacyStatus || "unlisted" },
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

export async function getYoutubeVideoSnippet(accessToken, videoId) {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `YouTube動画情報の取得に失敗しました (${response.status}): ${errorBody}`,
    );
  }
  const { items } = await response.json();
  return items?.[0]?.snippet || null;
}

export async function updateYoutubeVideoTitle(
  accessToken,
  videoId,
  snippet,
  newTitle,
) {
  const response = await fetch(
    "https://www.googleapis.com/youtube/v3/videos?part=snippet",
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: videoId,
        snippet: { ...snippet, title: newTitle },
      }),
    },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `YouTube動画タイトルの更新に失敗しました (${response.status}): ${errorBody}`,
    );
  }
  return response.json();
}

export async function uploadYoutubeThumbnail(
  accessToken,
  videoId,
  thumbnailBlob,
) {
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
