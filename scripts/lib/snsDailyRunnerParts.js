/**
 * SNS の暦日の取り込みの共通の部品。snsDailyRunner.js から、定数・指標の定義の文（def）・日付の関数を移した（振る舞いは同じ）。
 */
import { SITE_HOST } from "./snsGa4.js";

export const SNS_DAILY_LOOKBACK_DAYS = 3;
export const UTM_CAMPAIGNS = ["race-full", "today_digest"];
/** YouTube Shorts「節の機力」の下書きの format（scripts/sns/push-setsu-kiryoku-short.js、#2112。そちらを import しない） */
export const SETSU_SHORT_FORMAT = "setsu_kiryoku_short";
export const CHANNEL_METRICS = ["views", "engagedViews", "subscribersGained"];
// averageViewDuration（秒）は 2026-10-24 に追加（BOA-1006 (b)、hq の Shorts の改善の周の主な指標）。
// Shorts の「スワイプされた割合」は公開の API の指標に無い（YouTube Analytics の metrics の一覧、2026-10-24 確認）。
// 近いものは engagedViews / views で、今の行から計算できる
export const VIDEO_METRICS = [
  "views",
  "engagedViews",
  "averageViewPercentage",
  "averageViewDuration",
  "subscribersGained",
];
/**
 * 動画ごとの engagedViews・views（と平均の視聴の割合・時間）を sns_metric_observations にも入れる（PD02、hq の毎日の PDCA の流れ shorts_engaged）。
 * 窓は pt3d（マイグレーション 175）: 太平洋時間の投稿日から3日（投稿日＋2日）の暦日の和。終わりは PT の3日目の翌日 0:00。
 * Analytics は暦日の粒度なので、「投稿から72時間」のような時間の窓へ変換しない（docs/design/sns-hub-metrics/contract.md「日次Analyticsを
 * 時間窓へ推測変換しない」。day_end と同じく投稿ごとに長さが違う窓）。投稿前の views は0なので、和は [posted_at, period_end) と同じ。
 * 反映の遅れ（2〜3日、BOA-1006 (b)）のため、3日目が取り直しの最も古い日（D−3）より前になってから1回入れる。
 * 値（engagedViews と分母の views）が無ければ、値が出るまで ENGAGED_LOOKBACK_DAYS の間は毎日やり直す
 */
export const ENGAGED_WINDOW = "pt3d";
export const ENGAGED_PT_DAYS = 3;
// 3日目が D−3 より前になるのは投稿の約6日後。14日まで見ると、欠測のときに約8回やり直せる
export const ENGAGED_LOOKBACK_DAYS = 14;
/** 同じ日の2回目の起動（補足の起動・重複配信）で欠測の revision を重ねない間隔 */
export const ENGAGED_RETRY_HOURS = 20;
/** Analytics を読む時間の上限（関数の時間 300 秒の中で、残りは次の起動に回す） */
export const ENGAGED_BUDGET_MS = 90000;
export const ENGAGED_METRICS = [
  "engagedViews",
  "views",
  "averageViewPercentage",
  "averageViewDuration",
];
/** PT の暦日 day の 0:00 の UTC の時刻（夏時間は UTC 07:00、冬時間は 08:00） */
export function ptMidnightUtc(day) {
  const hit = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "")
    ? ["07", "08"]
        .map((h) => new Date(`${day}T${h}:00:00Z`))
        .find(
          (t) => ptDate(t) === day && ptDate(new Date(t.getTime() - 1)) !== day,
        )
    : null;
  if (!hit) throw new Error(`PT の 0:00 を出せない日付: ${day}`);
  return hit.toISOString();
}
export const RACE_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;
/** 時刻を JST の YYYY-MM-DD にする */
export const toJstDay = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UPSERT_CHUNK = 500;
export const YT_MISSING = "Analytics が行を返さない（未確定の可能性）";

export const def = {
  ytChannel: (m) =>
    `YouTube Analytics reports dimensions=day・チャネル全体・${m}・太平洋時間の暦日・v1`,
  ytVideo: (m) =>
    `YouTube Analytics reports dimensions=day filters=video・${m}・太平洋時間の暦日・v1`,
  ytEngaged: (m) =>
    `YouTube Analytics reports filters=video・${m}・太平洋時間の暦日で投稿日から${ENGAGED_PT_DAYS}日の和（窓 pt3d、終わりは PT の${ENGAGED_PT_DAYS}日目の翌日 0:00）・D−3 より前になってから・v1`,
  ga4Channel: (m) =>
    `GA4 ${m}・hostName=${SITE_HOST}・sessionSource は X・YouTube の完全一致のリスト・流入元ごとの和・JST の暦日・Cookie 同意者のみ・v1`,
  // 全貌（utm_content=race_id）は X・YouTube と utm_term（full・shorts）で分ける
  ga4FullPicture: (m, source, term) =>
    `GA4 ${m}・utm_source=${source}・utm_medium=social・utm_campaign=race-full・utm_content=race_id・utm_term=${term || "(なし)"}・JST の暦日・投稿日と翌日だけ・Cookie 同意者のみ・v1`,
  ga4SetsuShort: (m) =>
    `GA4 ${m}・節の機力の Shorts（format=${SETSU_SHORT_FORMAT}）・説明欄のリンクの utm_source・utm_medium・utm_content（と、あれば utm_campaign）と landingPage の会場が一致・JST の暦日・投稿日と翌日だけ・Cookie 同意者のみ・v1`,
  ga4Utm: (m, campaign) =>
    `GA4 ${m}・utm_source=x・utm_medium=social・utm_campaign=${campaign}・JST の暦日・Cookie 同意者のみ・v1`,
};

/** YYYY-MM-DD に日数を足す */
export const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const ptDate = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    date,
  );
export const range = (endExclusive) =>
  Array.from({ length: SNS_DAILY_LOOKBACK_DAYS }, (_, i) =>
    addDays(endExclusive, i - SNS_DAILY_LOOKBACK_DAYS),
  );
