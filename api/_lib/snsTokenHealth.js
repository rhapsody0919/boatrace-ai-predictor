/**
 * 送信・取り込みの鍵の健全性（sns-pdca-loop tasks 19）。Vercel の Sensitive の値は手元で読めないので、
 * 本番の関数の中で「refresh できるか」「scope が足りるか」だけを確かめ、値は返さない。
 * X は保存値を読んで復号できるかだけを見る（refresh token は使い切りなので、確認のためには refresh しない）。
 */
import { decryptTokens, REFRESH_MARGIN_MS } from "./snsTokenStore.js";
import { getYoutubeAccessToken } from "./youtubeUpload.js";

const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const SCOPE = "https://www.googleapis.com/auth/";

// 送信と同じ関数（getYoutubeAccessToken）で refresh し、tokeninfo で scope を読む
async function googleCheck(keys, fetchImpl) {
  if (!keys.clientId || !keys.clientSecret || !keys.refreshToken)
    return { configured: false };
  let accessToken;
  try {
    accessToken = await getYoutubeAccessToken({ ...keys, fetchImpl });
  } catch (error) {
    return { configured: true, refresh: false, error: error.message };
  }
  const info = await fetchImpl(
    `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`,
    { signal: AbortSignal.timeout(30000) },
  );
  const infoBody = await info.json().catch(() => ({}));
  const scopes = String(infoBody.scope ?? "")
    .split(" ")
    .filter(Boolean)
    .map((s) => s.replace(SCOPE, ""));
  return { configured: true, refresh: true, scopes, accessToken };
}

async function xCheck(env, xDb, now) {
  if (
    !env.X_OAUTH_CLIENT_ID ||
    !env.X_OAUTH_CLIENT_SECRET ||
    !env.SNS_TOKEN_ENC_KEY
  )
    return { configured: false };
  try {
    const row = await xDb.read();
    if (!row) return { configured: true, connected: false };
    await decryptTokens(row, env.SNS_TOKEN_ENC_KEY);
    return {
      configured: true,
      connected: true,
      decrypt: true,
      accountId: Boolean(row.account_id),
      accessExpiresAt: row.access_expires_at,
      refreshDue:
        Date.parse(row.access_expires_at) - REFRESH_MARGIN_MS <=
        now().getTime(),
      lastRefreshedAt: row.refreshed_at ?? null,
    };
  } catch (error) {
    return { configured: true, connected: false, error: error.message };
  }
}

export async function checkTokenHealth({
  env = process.env,
  fetchImpl = fetch,
  xDb,
  now = () => new Date(),
} = {}) {
  const youtube = await googleCheck(
    {
      clientId: env.YOUTUBE_CLIENT_ID,
      clientSecret: env.YOUTUBE_CLIENT_SECRET,
      refreshToken: env.YOUTUBE_REFRESH_TOKEN,
    },
    fetchImpl,
  );
  if (youtube.refresh)
    Object.assign(youtube, {
      // アップロード（videos.insert）と公開の切り替え（videos.update）に要る scope
      canUpload: youtube.scopes.some((s) =>
        ["youtube.upload", "youtube", "youtube.force-ssl"].includes(s),
      ),
      canPublish: youtube.scopes.some((s) =>
        ["youtube", "youtube.force-ssl", "youtubepartner"].includes(s),
      ),
    });
  delete youtube.accessToken;

  const analytics = await googleCheck(
    {
      clientId: env.YOUTUBE_ANALYTICS_CLIENT_ID,
      clientSecret: env.YOUTUBE_ANALYTICS_CLIENT_SECRET,
      refreshToken: env.YOUTUBE_ANALYTICS_REFRESH_TOKEN,
    },
    fetchImpl,
  );
  if (analytics.refresh) {
    const day = new Date(now().getTime() - 86400000).toISOString().slice(0, 10);
    const reports = await fetchImpl(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate=${day}&endDate=${day}&metrics=views`,
      {
        headers: { Authorization: `Bearer ${analytics.accessToken}` },
        signal: AbortSignal.timeout(30000),
      },
    );
    analytics.reportsStatus = reports.status;
  }
  delete analytics.accessToken;

  return { x: await xCheck(env, xDb, now), youtube, analytics };
}
