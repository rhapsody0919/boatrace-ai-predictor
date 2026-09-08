/**
 * Vercel Edge Function: sns_drafts.titleとYouTube上の実際の動画タイトルを同期する。
 * POST /api/admin/sns-hub/maintenance/sync-youtube-titles
 *
 * 2026-09-08、`docs/operation/sns-pipeline-youtube.md`のINSERT対象列リストに
 * `title`が含まれていなかったため、titleがNULLのままYouTubeへ自動投稿され
 * YouTube上でタイトルが表示されない不具合（表示上「unknown」）が発生した。
 * 生成Routine側の修正（title必須化）・DB側のtitleバックフィルとは別に、
 * 既にYouTubeへ公開済みの動画本体のタイトルを実際に修正するための一時的な
 * 運用ツール。sns_drafts.titleが正しい値に更新された後、本番環境から1回
 * 実行する想定（`/admin/sns-hub`と同じBasic認証で保護される、middleware.js参照）。
 */

import {
  jsonResponse,
  isConfigured,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
} from "../../../_lib/snsHubHelpers.js";
import {
  getYoutubeAccessToken,
  getYoutubeVideoSnippet,
  updateYoutubeVideoTitle,
} from "../../../_lib/youtubeUpload.js";

export const config = {
  runtime: "edge",
};

function extractVideoId(youtubeUrl) {
  if (!youtubeUrl) return null;
  const match = youtubeUrl.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
  return match?.[1] || null;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (!isConfigured()) {
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  }

  const accessToken = await getYoutubeAccessToken({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
  });
  if (!accessToken) {
    return jsonResponse(
      {
        error:
          "YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET/YOUTUBE_REFRESH_TOKENが未設定です",
      },
      500,
    );
  }

  const listResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?platform=eq.youtube&status=eq.posted&title=not.is.null&select=id,title,source_data`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!listResponse.ok) {
    return jsonResponse(
      { error: `sns_drafts取得エラー: ${listResponse.status}` },
      502,
    );
  }
  const drafts = await listResponse.json();

  const results = [];
  for (const draft of drafts) {
    const videoId = extractVideoId(draft.source_data?.youtube_url);
    if (!videoId) {
      results.push({
        draftId: draft.id,
        skipped: "youtube_urlが見つかりません",
      });
      continue;
    }
    try {
      const snippet = await getYoutubeVideoSnippet(accessToken, videoId);
      if (!snippet) {
        results.push({
          draftId: draft.id,
          videoId,
          skipped: "動画が見つかりません",
        });
        continue;
      }
      if (snippet.title === draft.title) {
        results.push({ draftId: draft.id, videoId, skipped: "既に一致" });
        continue;
      }
      const before = snippet.title;
      await updateYoutubeVideoTitle(accessToken, videoId, snippet, draft.title);
      results.push({ draftId: draft.id, videoId, before, after: draft.title });
    } catch (error) {
      results.push({ draftId: draft.id, videoId, error: error.message });
    }
  }

  return jsonResponse({ count: results.length, results });
}
