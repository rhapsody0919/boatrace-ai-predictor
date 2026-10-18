/**
 * 送信の試験（投稿しない）。オーナーが1回開くだけで、本番の関数の中で次を試す（2026-10-18）:
 *   1. X の媒体のアップロード（initialize → append → finalize → status）。画像1枚（今日の /today の図）と動画1本（最新の YouTube の下書きの動画）
 *   2. 送る前の表示の確認（未ログインの Chromium）: /today と、今日の優勝戦の龍神ソナーのタブ
 * 投稿（createPost）は呼ばない。結果は段階ごとの ok と「段階_種類」（#1620 と同じ）。API の本文・鍵は返さない。
 * ?media=a.png,b.mp4 で媒体の path（sns-hub-media の中）を、?race=2026-10-18-20-12 で表示を見るレースを選べる
 */
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import {
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  isConfigured,
  jsonResponse,
} from "../../_lib/snsHubHelpers.js";
import { loadXMedia } from "../../_lib/snsXSendStore.js";
import {
  createPostgrestTokenDb,
  getXAccessToken,
} from "../../_lib/snsTokenStore.js";
import { createXApiAdapter } from "../../_lib/xApiAdapter.js";
import { createChromiumHeadless } from "../../_lib/snsHeadless.js";
import { SCREEN_MARKERS } from "../../../scripts/lib/snsScreenMarkers.js";
import { probeDisplay, probeMedia } from "../../_lib/snsSendProbe.js";

// Chromium を使うので nodejs（GET・POST の名前で書き出す。既定の書き出しは Node の (req, res) で呼ばれる、#1614）
export const config = { runtime: "nodejs", maxDuration: 300 };

const SITE = "https://www.boat-ai.jp";

async function rest(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} ${path.split("?")[0]}`);
  return response.json();
}

/** 既定の媒体: 最新の /today の図1枚と、最新の YouTube の下書きの動画1本 */
async function defaultMedia() {
  const [today] = await rest(
    "sns_drafts?format=eq.today_digest&cover_image_path=not.is.null&select=cover_image_path&order=created_at.desc&limit=1",
  );
  const [video] = await rest(
    "sns_drafts?platform=eq.youtube&video_storage_path=not.is.null&select=video_storage_path&order=created_at.desc&limit=1",
  );
  return [today?.cover_image_path, video?.video_storage_path].filter(Boolean);
}

/** 既定の表示: /today と、今日（JST）の優勝戦のうち締切の遅いレースの龍神ソナー */
async function defaultRace() {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  const stages = await rest(
    `race_conditions?race_id=like.${date}-*&race_stage=eq.${encodeURIComponent("優勝戦")}&select=race_id`,
  );
  return (
    stages
      .map((s) => s.race_id)
      .sort()
      .at(-1) ?? null
  );
}

async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (!["GET", "POST"].includes(req.method))
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return jsonResponse({ error: "DB未設定です" }, 503);
  const params = new URL(req.url).searchParams;
  const media = params.get("media")
    ? params.get("media").split(",").filter(Boolean).slice(0, 2)
    : await defaultMedia();
  const race = params.get("race") || (await defaultRace());
  const displays = [
    { url: `${SITE}/today`, screen_key: "today" },
    ...(race
      ? [{ url: `${SITE}/race/${race}?tab=sonar`, screen_key: "race-sonar" }]
      : []),
  ];

  const result = { media: [], displays: [] };
  // 1. X の媒体のアップロード（投稿しない）
  let x = null;
  try {
    const { accessToken } = await getXAccessToken({
      db: createPostgrestTokenDb(),
      keyBase64: process.env.SNS_TOKEN_ENC_KEY,
      clientId: process.env.X_OAUTH_CLIENT_ID,
      clientSecret: process.env.X_OAUTH_CLIENT_SECRET,
    });
    x = createXApiAdapter({ accessToken });
  } catch (error) {
    console.error(`送信の試験: X の鍵: ${error.message}`);
    result.token = { ok: false, reason: "x_token_error" };
  }
  if (x) {
    result.token = { ok: true };
    for (const path of media)
      result.media.push(
        await probeMedia(path, {
          x,
          loadMedia: (p) => loadXMedia(p),
          wait: (secs) => new Promise((r) => setTimeout(r, secs * 1000)),
        }),
      );
  }
  // 2. 送る前の表示の確認（Chromium）
  const headless = createChromiumHeadless({ maxInspections: 4 });
  for (const display of displays)
    result.displays.push(
      await probeDisplay(display, { headless, markers: SCREEN_MARKERS }),
    );
  await headless.close().catch(() => {});
  const response = jsonResponse({ data: result });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export { handler as GET, handler as POST };
