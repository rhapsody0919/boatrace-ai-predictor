/**
 * SNS の 48h・7d の取り込みの部品。snsMetricsRunner.js から、指標の定義・欠測／値の行の組み立て・job の不備の判定を移した（振る舞いは同じ）。
 */
import {
  OBSERVATION_WINDOWS,
  windowsFor,
  validateObservation,
  withinSnapshotTolerance,
} from "../../src/utils/snsObservations.js";

export const YOUTUBE_BATCH = 50;

// 指標の定義（定義の文字列が違う系列は比較で混ぜない。値を変えるときは末尾の版を上げる）
export const YOUTUBE_METRICS = [
  [
    "views",
    "viewCount",
    "YouTube Data API videos.list statistics.viewCount の累積値・分母なし・v1",
  ],
  [
    "likes",
    "likeCount",
    "YouTube Data API videos.list statistics.likeCount の累積値・分母なし・v1",
  ],
  [
    "comments",
    "commentCount",
    "YouTube Data API videos.list statistics.commentCount の累積値・分母なし・v1",
  ],
];
export const X_METRICS = [
  [
    "impressions",
    "non_public_metrics",
    "impression_count",
    "X API v2 non_public_metrics.impression_count の累積値・分母なし・v1",
  ],
  [
    "url_link_clicks",
    "non_public_metrics",
    "url_link_clicks",
    "X API v2 non_public_metrics.url_link_clicks の累積値（リンクのない投稿は返らない）・分母なし・v1",
  ],
  [
    "likes",
    "public_metrics",
    "like_count",
    "X API v2 public_metrics.like_count の累積値・分母なし・v1",
  ],
  [
    "shares",
    "public_metrics",
    "retweet_count",
    "X API v2 public_metrics.retweet_count の累積値（引用は含まない）・分母なし・v1",
  ],
  [
    "saves",
    "public_metrics",
    "bookmark_count",
    "X API v2 public_metrics.bookmark_count の累積値・分母なし・v1",
  ],
  // 返信・引用（hq 2026-10-27 /today の型の比べの副の数。X の推薦の重みは返信・引用が大きい）。同じ読み取りの応答に入っている
  [
    "replies",
    "public_metrics",
    "reply_count",
    "X API v2 public_metrics.reply_count の累積値（自分の返信も含む）・分母なし・v1",
  ],
  [
    "quotes",
    "public_metrics",
    "quote_count",
    "X API v2 public_metrics.quote_count の累積値（リポストは含まない）・分母なし・v1",
  ],
];
export const METRICS_BY_CHANNEL = {
  youtube: YOUTUBE_METRICS.map(([name, , definition]) => ({
    name,
    definition,
  })),
  x: X_METRICS.map(([name, , , definition]) => ({ name, definition })),
};
export const SOURCE_BY_CHANNEL = { youtube: "youtube-data", x: "x-api" };

export const shortError = (error) => String(error?.message ?? error).slice(0, 200);

export function brokenReason(job) {
  if (!job.draft) return "draft_missing";
  if (job.draft.status !== "posted" || !job.draft.posted_at)
    return "draft_not_posted";
  if (!job.external_post_id) return "external_post_id_missing";
  if (!METRICS_BY_CHANNEL[job.channel]) return "unknown_channel";
  if (!Object.hasOwn(OBSERVATION_WINDOWS, job.window)) return "unknown_window";
  // 型が測らない窓（SQL169 の前に古いトリガーが全貌に作った 48h・7d など）は、やり直しても入れられないので閉じる
  if (!windowsFor(job.draft).includes(job.window)) return "window_not_measured";
  return null;
}

export function* chunks(list, size) {
  for (let i = 0; i < list.length; i += size) yield list.slice(i, i + size);
}

const baseRow = (job, period, observedAt) => ({
  window: job.window,
  ...period,
  observed_at: observedAt,
  source: SOURCE_BY_CHANNEL[job.channel],
  measurement_kind: "snapshot",
  duration_seconds: null,
  external_post_id: job.external_post_id,
  curve: [],
});

export function missingRows(job, period, now, reason) {
  return METRICS_BY_CHANNEL[job.channel].map(({ name, definition }) =>
    validateObservation(
      {
        ...baseRow(job, period, now.toISOString()),
        metric_name: name,
        metric_value: null,
        missing_reason: reason,
        data_through: null,
        definition,
      },
      job.draft,
    ),
  );
}

// 応答を受けた時刻が15分を過ぎていたら、値は捨てて欠測にする（遅い累積値を過去の窓に入れない）
export function valueRows(job, period, { observedAt, values }) {
  const late = !withinSnapshotTolerance(observedAt, period.period_end);
  return METRICS_BY_CHANNEL[job.channel].map(({ name, definition }) => {
    const value = values[name];
    const ok = !late && Number.isFinite(value) && value >= 0;
    return validateObservation(
      {
        ...baseRow(job, period, observedAt),
        metric_name: name,
        metric_value: ok ? value : null,
        missing_reason: ok
          ? null
          : late
            ? "取得が遅れた（応答が窓の終わりから15分を過ぎた）"
            : "API が値を返さない",
        data_through: ok ? observedAt : null,
        definition,
      },
      job.draft,
    );
  });
}
