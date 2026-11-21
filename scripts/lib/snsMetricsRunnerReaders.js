/**
 * SNS の 48h・7d の取り込みの読み取り（YouTube・X）。snsMetricsRunner.js から、getJson・各 reader・dailySendMicrousd を移した（振る舞いは同じ）。
 */
import {
  X_METRICS,
  YOUTUBE_BATCH,
  YOUTUBE_METRICS,
} from "./snsMetricsRunnerParts.js";

const TIMEOUT_MS = 30000;

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

async function getJson(fetchImpl, url, headers, label) {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} の応答を解釈できません: HTTP ${response.status}`);
  }
  if (!response.ok) {
    // 応答の本文（API の詳細）は DB に残さない。状態コードとエラーの種類だけ
    const kind = body?.title || body?.error?.errors?.[0]?.reason || "";
    throw new Error(
      `${label} が失敗: HTTP ${response.status}${kind ? ` ${kind}` : ""}`,
    );
  }
  return body;
}

const toNumber = (value) =>
  value === undefined || value === null || value === "" ? null : Number(value);

/** YouTube の読み取り。ids は50件まで */
export function createYoutubeMetricsReader({
  accessToken,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  if (!accessToken) throw new Error("YouTube の access token がありません");
  return {
    async read(ids) {
      const url = `${YOUTUBE_API_BASE}/videos?part=statistics&id=${ids.map(encodeURIComponent).join(",")}&maxResults=${YOUTUBE_BATCH}`;
      const body = await getJson(
        fetchImpl,
        url,
        { Authorization: `Bearer ${accessToken}` },
        "YouTube videos.list",
      );
      const observedAt = now().toISOString();
      if (!Array.isArray(body.items))
        throw new Error("YouTube videos.list の応答に items が無い");
      return new Map(
        body.items.map((item) => [
          item.id,
          {
            observedAt,
            values: Object.fromEntries(
              YOUTUBE_METRICS.map(([name, field]) => [
                name,
                toNumber(item.statistics?.[field]),
              ]),
            ),
          },
        ]),
      );
    },
  };
}

/** X の読み取り。ids は1件（since_id=ID−1・until_id=ID+1 で、その投稿だけを返させる） */
export function createXMetricsReader({
  xApiBase,
  accessToken,
  accountId,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  if (!accessToken) throw new Error("X の access token がありません");
  if (!/^[0-9]{1,19}$/.test(accountId ?? ""))
    throw new Error("X のアカウント ID がありません");
  return {
    async read([id]) {
      if (!/^[0-9]{1,19}$/.test(id ?? ""))
        throw new Error("X の投稿 ID が不正です");
      const params = new URLSearchParams({
        since_id: String(BigInt(id) - 1n),
        until_id: String(BigInt(id) + 1n),
        max_results: "5",
        "tweet.fields": "public_metrics,non_public_metrics",
      });
      const body = await getJson(
        fetchImpl,
        `${xApiBase}/2/users/${accountId}/tweets?${params}`,
        { Authorization: `Bearer ${accessToken}` },
        "X GET /2/users/{id}/tweets",
      );
      const observedAt = now().toISOString();
      const tweet = (body.data ?? []).find((t) => t.id === id);
      if (!tweet) return new Map();
      return new Map([
        [
          id,
          {
            observedAt,
            values: Object.fromEntries(
              X_METRICS.map(([name, group, field]) => [
                name,
                toNumber(tweet[group]?.[field]),
              ]),
            ),
          },
        ],
      ]);
    },
  };
}

/** 1日の送信の予約額の見込み（reserve_sns_x_read に渡す。スレッドの親1件＋子）。上限額が未設定なら0 */
export function dailySendMicrousd(control) {
  const limit = control.daily_limit_x ?? control.daily_limit ?? 1;
  const url =
    control.ceiling_x_url_microusd ?? control.attempt_ceiling_microusd ?? 0;
  const plain =
    control.ceiling_x_plain_microusd ?? control.attempt_ceiling_microusd ?? 0;
  return Number(url) + Math.max(0, limit - 1) * Number(plain);
}
