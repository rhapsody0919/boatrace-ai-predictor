/**
 * 送信・取り込みの鍵の健全性（sns-pdca-loop tasks 19）。Vercel の Sensitive の値は手元で読めないので、
 * 本番の関数の中で「refresh できるか」「scope が足りるか」だけを確かめ、値は返さない。
 * X のトークンは期限が近ければ実際に refresh して保存する（getXAccessToken の通常の動き）。
 */
import { getXAccessToken } from "./snsTokenStore.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const SCOPE = "https://www.googleapis.com/auth/";

async function googleCheck(
  { clientId, clientSecret, refreshToken },
  fetchImpl,
) {
  if (!clientId || !clientSecret || !refreshToken) return { configured: false };
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token)
    return {
      configured: true,
      refresh: false,
      error: `HTTP ${response.status}${body.error ? ` ${body.error}` : ""}`,
    };
  const info = await fetchImpl(
    `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(body.access_token)}`,
    {
      signal: AbortSignal.timeout(30000),
    },
  );
  const infoBody = await info.json().catch(() => ({}));
  const scopes = String(infoBody.scope ?? "")
    .split(" ")
    .filter(Boolean)
    .map((s) => s.replace(SCOPE, ""));
  return {
    configured: true,
    refresh: true,
    scopes,
    accessToken: body.access_token,
  };
}

export async function checkTokenHealth({
  env = process.env,
  fetchImpl = fetch,
  xDb,
  now = () => new Date(),
} = {}) {
  const result = {};

  if (
    !env.X_OAUTH_CLIENT_ID ||
    !env.X_OAUTH_CLIENT_SECRET ||
    !env.SNS_TOKEN_ENC_KEY
  ) {
    result.x = { configured: false };
  } else {
    try {
      const { accountId } = await getXAccessToken({
        db: xDb,
        keyBase64: env.SNS_TOKEN_ENC_KEY,
        clientId: env.X_OAUTH_CLIENT_ID,
        clientSecret: env.X_OAUTH_CLIENT_SECRET,
        fetchImpl,
        maxWaits: 3,
      });
      result.x = {
        configured: true,
        connected: true,
        accountId: Boolean(accountId),
      };
    } catch (error) {
      result.x = { configured: true, connected: false, error: error.message };
    }
  }

  const youtube = await googleCheck(
    {
      clientId: env.YOUTUBE_CLIENT_ID,
      clientSecret: env.YOUTUBE_CLIENT_SECRET,
      refreshToken: env.YOUTUBE_REFRESH_TOKEN,
    },
    fetchImpl,
  );
  delete youtube.accessToken;
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
  result.youtube = youtube;

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
  result.analytics = analytics;
  return result;
}
