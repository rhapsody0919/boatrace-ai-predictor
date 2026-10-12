/**
 * SNS PDCA ループの基準値: 自チャンネルの Shorts ごとに、投稿日〜翌日（2日の窓）と投稿日〜--to の
 * views・engagedViews・平均視聴率等を YouTube Analytics で取り、分布を出す。
 *
 * 2日の窓は YouTube Analytics の日単位（太平洋時間の暦日）で、厳密な48時間ではない。
 * 認証は .env.local の YOUTUBE_ANALYTICS_*（読み取り専用。docs/operation/content-pipeline-token-setup-guide.md）。
 *
 * 使い方:
 *   node scripts/analysis/sns-pdca-baseline/youtube-shorts-metrics.js --since=2026-08-01 --to=2026-10-11
 * 結果は data/analysis/sns-pdca-baseline/youtube-{since}_{to}.json。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { summarize, quantile, round } from "./stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.join(__dirname, "../../../.env.local"),
  quiet: true,
});

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const SINCE = arg("since");
const TO = arg("to");
if (!SINCE || !TO)
  throw new Error("--since と --to（YYYY-MM-DD）を指定してください");
for (const k of [
  "YOUTUBE_ANALYTICS_CLIENT_ID",
  "YOUTUBE_ANALYTICS_CLIENT_SECRET",
  "YOUTUBE_ANALYTICS_REFRESH_TOKEN",
]) {
  if (!process.env[k]) throw new Error(`.env.local に ${k} がありません`);
}

const oauth = new google.auth.OAuth2(
  process.env.YOUTUBE_ANALYTICS_CLIENT_ID,
  process.env.YOUTUBE_ANALYTICS_CLIENT_SECRET,
);
oauth.setCredentials({
  refresh_token: process.env.YOUTUBE_ANALYTICS_REFRESH_TOKEN,
});
const youtube = google.youtube({ version: "v3", auth: oauth });
const analytics = google.youtubeAnalytics({ version: "v2", auth: oauth });

const channel = (
  await youtube.channels.list({
    part: ["contentDetails", "statistics"],
    mine: true,
  })
).data.items[0];
const videos = [];
let pageToken;
do {
  const res = await youtube.playlistItems.list({
    part: ["contentDetails"],
    playlistId: channel.contentDetails.relatedPlaylists.uploads,
    maxResults: 50,
    pageToken,
  });
  videos.push(
    ...res.data.items.map((i) => ({
      id: i.contentDetails.videoId,
      publishedAt: i.contentDetails.videoPublishedAt,
    })),
  );
  pageToken = res.data.nextPageToken;
} while (pageToken);

const ptDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(iso));

const METRICS =
  "views,engagedViews,averageViewPercentage,averageViewDuration,likes,subscribersGained";
async function videoReport(id, startDate, endDate) {
  const res = await analytics.reports.query({
    ids: "channel==MINE",
    startDate,
    endDate,
    metrics: METRICS,
    dimensions: "video",
    filters: `video==${id}`,
  });
  const row = res.data.rows?.[0];
  const [
    views,
    engagedViews,
    averageViewPercentage,
    averageViewDuration,
    likes,
    subscribersGained,
  ] = row ? row.slice(1) : [0, 0, null, null, 0, 0];
  return {
    views,
    engagedViews,
    averageViewPercentage,
    averageViewDuration,
    likes,
    subscribersGained,
  };
}

const perVideo = [];
for (const v of videos
  .filter((x) => x.publishedAt >= SINCE)
  .sort((a, b) => (a.publishedAt < b.publishedAt ? -1 : 1))) {
  // YouTube Analytics の日は太平洋時間の暦日。UTC の日付を使うと半数近くで1日ずれる
  const d0 = ptDate(v.publishedAt);
  const d1 = new Date(Date.parse(`${d0}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  // 逐次に取る（同時に投げてクォータを一気に使わないため）
  perVideo.push({
    ...v,
    twoDay: await videoReport(v.id, d0, d1),
    toDate: await videoReport(v.id, d0, TO),
  });
}

const played = perVideo.filter((v) => v.toDate.views > 0);
const sorted = (k) => played.map((v) => v.toDate[k]).sort((a, b) => a - b);
const dist = (k) => {
  const s = sorted(k);
  return {
    ...summarize(s),
    median: quantile(s, 0.5),
    p25: quantile(s, 0.25),
    p75: quantile(s, 0.75),
    max: s.at(-1),
    logSd: summarize(s.map((x) => Math.log(x + 1))).sd,
  };
};
// 版の判定は投稿後2日（PT の暦日で投稿日＋翌日）の値で行う。率は2日で再生30回以上の動画だけで見る（少ない再生で率が暴れるため）。
// 30回以上かどうかは版の効果を受けるので、必要件数は「30回以上の本数」を「投稿本数」に換算して読む（ratedShareOfUploads）。
// 平均視聴率100%超はループ再生の外れ値として除く
const rated = played.filter((v) => v.twoDay.views >= 30);
const engagedRatio = summarize(rated.map((v) => v.twoDay.engagedViews / v.twoDay.views));
const avgViewPct = summarize(rated.map((v) => v.twoDay.averageViewPercentage).filter((p) => p != null && p <= 100));
const ratedShareOfUploads = round(rated.length / perVideo.length);
const twoDayShare = round(played.reduce((a, v) => a + v.twoDay.views, 0) / played.reduce((a, v) => a + v.toDate.views, 0));
// フィードに乗った率の分母はアップロードした全本数（再生0の動画も「乗らなかった」に数える）
const feedRate = round(perVideo.filter((v) => v.twoDay.views >= 100).length / perVideo.length);

const traffic = await analytics.reports.query({
  ids: "channel==MINE",
  startDate: new Date(Date.parse(TO) - 27 * 86400000)
    .toISOString()
    .slice(0, 10),
  endDate: TO,
  metrics: "views",
  dimensions: "insightTrafficSourceType",
});

const result = {
  generatedAt: new Date().toISOString(),
  range: { since: SINCE, to: TO },
  channel: {
    videoCount: Number(channel.statistics.videoCount),
    subscriberCount: Number(channel.statistics.subscriberCount),
  },
  uploads: perVideo.length,
  played: played.length,
  distribution: { views: dist("views"), engagedViews: dist("engagedViews") },
  engagedRatio30plus: engagedRatio,
  averageViewPercentage30plus: avgViewPct,
  ratedShareOfUploads,
  twoDayShareOfViews: twoDayShare,
  feedRate100In2Days: feedRate,
  trafficSourceLast28: traffic.data.rows ?? [],
  perVideo: perVideo.map(({ id, publishedAt, twoDay, toDate }) => ({
    id,
    publishedAt,
    twoDay,
    toDate,
  })),
};

const outDir = path.join(__dirname, "../../../data/analysis/sns-pdca-baseline");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `youtube-${SINCE}_${TO}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
const { perVideo: _omit, ...summary } = result;
console.log(JSON.stringify(summary, null, 2));
console.log(`書き出し: ${path.relative(process.cwd(), outPath)}`);
