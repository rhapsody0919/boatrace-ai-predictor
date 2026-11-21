/** SNS観測の共通契約。ネットワーク・認証・環境変数に依存しない。窓・取得元・指標・時刻の判定（src/utils/snsObservations.js から移した。外へは snsObservations.js が同じ名で出す）。 */
// 窓の長さ（時間）。day_end は「投稿日の JST 23:00 まで」で長さが投稿ごとに違う（null）
export const OBSERVATION_WINDOWS = {
  "48h": 48,
  "7d": 168,
  "24h": 24,
  day_end: null,
};
// 全貌動画（format=full_picture）は当日の全レース終了後（JST 23:00）と投稿の24時間後で測る（2026-10-19 オーナー決定。
// 過去のレースの全貌にはユーザーは興味を持たないので 48h・7d は測らない）。それ以外は今までどおり 48h・7d（SQL169）
export const FULL_PICTURE_FORMAT = "full_picture";
export const FULL_PICTURE_WINDOWS = ["day_end", "24h"];
export const DEFAULT_WINDOWS = ["48h", "7d"];
/** その下書きを測る窓。全貌で JST 23:00 を過ぎてから投稿されたものは day_end を持たない（24h だけ） */
export function windowsFor(draft) {
  if (draft?.format !== FULL_PICTURE_FORMAT) return DEFAULT_WINDOWS;
  return FULL_PICTURE_WINDOWS.filter(
    (w) =>
      w !== "day_end" ||
      Date.parse(draft.posted_at) < dayEndOf(draft.posted_at),
  );
}
/**
 * 画面で選んだ窓から、その下書きで読む窓。既定の 48h で開いたとき、全貌は当日（day_end）の値を出す。
 * 7d には全貌を出さない（測っていないので「未収集」と数えない）。day_end・24h は全貌だけ。無ければ null
 */
export function displayWindowFor(draft, selected) {
  const own = windowsFor(draft);
  // 23:00 を過ぎて投稿された全貌は day_end を持たないので、既定の 48h では 24h の値を出す（画面から消さない）
  const w =
    draft?.format === FULL_PICTURE_FORMAT && selected === "48h" ? own[0] : selected;
  return own.includes(w) ? w : null;
}
/** 画面に出す窓の名前（観測の比較・投稿ごとの一覧で共用） */
export const WINDOW_LABELS = {
  "48h": "48h",
  "7d": "7d",
  day_end: "当日23時",
  "24h": "24h",
};
/** 投稿日（JST）の 23:00 の時刻（ミリ秒） */
function dayEndOf(postedAt) {
  const jstDate = new Date(Date.parse(postedAt) + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
  return Date.parse(`${jstDate}T23:00:00+09:00`);
}
// 累積値（snapshot）は窓の終わりから15分以内に取れた値だけ保存する（2026-10-13 ユーザー決定、SQL154 の CHECK と同じ）
export const SNAPSHOT_TOLERANCE_MS = 15 * 60 * 1000;

/** 累積値の取得時刻が窓の終わりから許容差の中か */
export const withinSnapshotTolerance = (observedAt, periodEnd) => {
  const lag = Date.parse(observedAt) - Date.parse(periodEnd);
  return lag >= 0 && lag <= SNAPSHOT_TOLERANCE_MS;
};
// 型比較の対象は運用中のチャネルだけ（hq判断 2026-10-08）。TikTok・blog・noteは「未収集」としても出さない
export const OBSERVED_PLATFORMS = ["x", "youtube"];
export const OBSERVATION_SOURCES = [
  "manual",
  "csv",
  "youtube-data",
  "youtube-analytics",
  "x-api",
  "site-analytics",
  "mock",
];
export const OBSERVATION_METRICS = [
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "impressions",
  "engagedViews",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "audienceWatchRatio",
  "url_link_clicks",
  // X の返信・引用（2026-10-27 hq の /today の比べの副の数、scripts/lib/snsMetricsRunner.js）
  "replies",
  "quotes",
  "sessions",
  "new_users",
  "returning_users",
];
/** ISO 8601 の時刻の文字列か（オフセットつき） */
export const isObservationTimestamp = (value) => timestamp(value);
export const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  ) &&
  Number.isFinite(Date.parse(value));

export function observationPeriod(postedAt, window) {
  if (!timestamp(postedAt) || !Object.hasOwn(OBSERVATION_WINDOWS, window))
    throw new Error("投稿日時・観測窓が不正です");
  const end =
    window === "day_end"
      ? dayEndOf(postedAt)
      : Date.parse(postedAt) + OBSERVATION_WINDOWS[window] * 3600000;
  if (end <= Date.parse(postedAt))
    throw new Error("当日の23時を過ぎた投稿には当日の窓がありません");
  return {
    period_start: new Date(postedAt).toISOString(),
    period_end: new Date(end).toISOString(),
  };
}
