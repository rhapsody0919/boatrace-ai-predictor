/**
 * SNS の流入の GA4 の共通部分（sns-pdca-loop plan §5）。分析スクリプト（scripts/analysis/sns-pdca-baseline/ga4-sns-inflow.js）と
 * cron `sns_daily`（scripts/lib/snsDailyRunner.js）が同じ流入元のリスト・フィルタを使う。
 *
 * 流入元は完全一致のリストで絞る（正規表現 `t\.co` は "chatgpt.com" にも当たるため）。
 * 数は Cookie に同意した人だけ（src/utils/analytics.js）なので下限として扱う。
 */
import { createSign } from "node:crypto";

export const X_SOURCES = ["t.co", "x.com", "twitter.com", "x"];
export const YOUTUBE_SOURCES = [
  "youtube.com",
  "m.youtube.com",
  "youtube",
  "youtu.be",
  "com.google.android.youtube",
];
export const SITE_HOST = "www.boat-ai.jp";

export const exact = (fieldName, value) => ({
  filter: { fieldName, stringFilter: { matchType: "EXACT", value } },
});
export const inList = (fieldName, values) => ({
  filter: { fieldName, inListFilter: { values } },
});
export const and = (...expressions) => ({ andGroup: { expressions } });
export const hostFilter = exact("hostName", SITE_HOST);
/** 龍神ソナーのタブを開いた（race_tab_select・race_tab_initial の tab_id=sonar） */
export const sonarTabFilter = and(
  inList("eventName", ["race_tab_select", "race_tab_initial"]),
  exact("customEvent:tab_id", "sonar"),
);

const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 30000;
const b64url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** サービスアカウント（JSON の文字列）で GA4 の読み取りの access token を取る */
export async function getServiceAccountToken(
  keyJson,
  { fetchImpl = fetch, now = () => Date.now() } = {},
) {
  let key;
  try {
    key = JSON.parse(keyJson);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が JSON ではありません");
  }
  if (!key?.client_email || !key?.private_key)
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY に client_email・private_key がありません",
    );
  const iat = Math.floor(now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: GA4_SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    }),
  )}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(key.private_key, "base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token)
    throw new Error(`GA4 のトークンを取れません: HTTP ${response.status}`);
  return body.access_token;
}

/** GA4 Data API の runReport。行は [ディメンション..., 指標(数)...] の配列 */
export function createGa4Client({
  propertyId,
  accessToken,
  fetchImpl = fetch,
}) {
  return async function runReport(body) {
    const response = await fetchImpl(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 10000, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !data)
      throw new Error(`GA4 runReport が失敗: HTTP ${response.status}`);
    return (data.rows ?? []).map((r) => [
      ...r.dimensionValues.map((v) => v.value),
      ...r.metricValues.map((v) => Number(v.value)),
    ]);
  };
}
