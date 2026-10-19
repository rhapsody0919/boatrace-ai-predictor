/** SNS観測の共通契約。ネットワーク・認証・環境変数に依存しない。 */
// 窓の長さ（時間）。day_end は「投稿日の JST 23:00 まで」で長さが投稿ごとに違う（null）
export const OBSERVATION_WINDOWS = {
  "48h": 48,
  "7d": 168,
  "24h": 24,
  day_end: null,
};
// 全貌動画（format=full_picture）は当日の全レース終了後（JST 23:00）と投稿の24時間後で測る（2026-10-19 オーナー決定。
// 過去のレースの全貌にはユーザーは興味を持たないので 48h・7d は測らない）。それ以外は今までどおり 48h・7d（SQL167）
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
  "sessions",
  "new_users",
  "returning_users",
];
/** ISO 8601 の時刻の文字列か（オフセットつき） */
export const isObservationTimestamp = (value) => timestamp(value);
const timestamp = (value) =>
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

export function validateObservation(input, draft) {
  return validateObservationInput(input, draft, true);
}

/** provider入力は保存窓への適合以外を先に検査する。保存にはvalidateObservationが必須。 */
export function validateProviderObservation(input, draft) {
  validateObservationInput(input, draft, false);
}

function validateObservationInput(input, draft, requireWindowMatch) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("観測データが不正です");
  if (draft.status !== "posted") throw new Error("投稿済みのみ観測できます");
  if (!windowsFor(draft).includes(input.window))
    throw new Error("この投稿の型では測らない観測窓です");
  const period = observationPeriod(draft.posted_at, input.window);
  if (
    !OBSERVATION_METRICS.includes(input.metric_name) ||
    !OBSERVATION_SOURCES.includes(input.source)
  )
    throw new Error("指標名・取得元が不正です");
  if (
    !timestamp(input.observed_at) ||
    Date.parse(input.observed_at) < Date.parse(period.period_end)
  )
    throw new Error("観測窓の終了前です");
  if (
    !timestamp(input.period_start) ||
    !timestamp(input.period_end) ||
    (requireWindowMatch &&
      (Date.parse(input.period_start) !== Date.parse(period.period_start) ||
        Date.parse(input.period_end) !== Date.parse(period.period_end)))
  )
    throw new Error("対象期間は投稿日時から観測窓の終了までです");
  if (
    input.data_through !== null &&
    (!timestamp(input.data_through) ||
      Date.parse(input.data_through) < Date.parse(period.period_start) ||
      Date.parse(input.data_through) > Date.parse(input.observed_at))
  )
    throw new Error("データ最終時点が不正です");
  const platformBySource = {
    "youtube-data": "youtube",
    "youtube-analytics": "youtube",
    "x-api": "x",
  };
  if (
    platformBySource[input.source] &&
    platformBySource[input.source] !== draft.platform
  )
    throw new Error("取得元とチャネルが一致しません");
  if (
    typeof input.definition !== "string" ||
    !input.definition.trim() ||
    input.definition.length > 500
  )
    throw new Error("指標の定義が必要です");
  if (!["period", "snapshot"].includes(input.measurement_kind))
    throw new Error("期間値と累積スナップショットを区別してください");
  if (
    input.metric_value !== null &&
    (typeof input.metric_value !== "number" ||
      !Number.isFinite(input.metric_value) ||
      input.metric_value < 0)
  )
    throw new Error("値はnullまたは0以上の有限数です");
  if (
    input.metric_value === null
      ? typeof input.missing_reason !== "string" ||
        !input.missing_reason.trim() ||
        input.missing_reason.length > 1000
      : input.missing_reason !== null
  )
    throw new Error("欠測はnullと理由を記録してください");
  // 期間の値は窓の終わりまでのデータ、累積値は取得した時点までのデータ（data_through=observed_at、SQL154）
  const complete =
    input.data_through !== null &&
    Date.parse(input.data_through) ===
      Date.parse(
        input.measurement_kind === "snapshot"
          ? input.observed_at
          : period.period_end,
      );
  if (requireWindowMatch && input.metric_value !== null && !complete)
    throw new Error("遅延・期間不一致は欠測として記録してください");
  if (
    requireWindowMatch &&
    input.measurement_kind === "snapshot" &&
    input.metric_value !== null &&
    !withinSnapshotTolerance(input.observed_at, period.period_end)
  )
    throw new Error("遅い累積値を過去の窓に代入できません");
  const denominatorName = input.denominator_name ?? null;
  const denominatorValue = input.denominator_value ?? null;
  if (
    denominatorName !== null &&
    (typeof denominatorName !== "string" ||
      !denominatorName.trim() ||
      denominatorName.length > 200)
  )
    throw new Error("分母の名称が不正です");
  if (
    denominatorValue !== null &&
    (denominatorName === null ||
      typeof denominatorValue !== "number" ||
      !Number.isFinite(denominatorValue) ||
      denominatorValue < 0)
  )
    throw new Error("分母の値が不正です");
  const points = input.curve ?? [];
  if (
    !Array.isArray(points) ||
    points.length > 1000 ||
    points.some(
      (p, i) =>
        !p ||
        !Number.isFinite(p.elapsed_ratio) ||
        p.elapsed_ratio < 0 ||
        p.elapsed_ratio > 1 ||
        !Number.isFinite(p.value) ||
        p.value < 0 ||
        (i > 0 && p.elapsed_ratio <= points[i - 1].elapsed_ratio),
    )
  )
    throw new Error("維持曲線が不正です");
  if (
    points.length &&
    (input.metric_name !== "audienceWatchRatio" || input.metric_value === null)
  )
    throw new Error("維持曲線は取得済みaudienceWatchRatioのみです");
  if (
    input.duration_seconds !== null &&
    (typeof input.duration_seconds !== "number" ||
      !Number.isFinite(input.duration_seconds) ||
      input.duration_seconds <= 0)
  )
    throw new Error("尺が不正です");
  if (
    input.external_post_id !== null &&
    (typeof input.external_post_id !== "string" ||
      !input.external_post_id.trim() ||
      input.external_post_id.length > 200)
  )
    throw new Error("外部投稿IDが不正です");
  return {
    ...period,
    window: input.window,
    observed_at: new Date(input.observed_at).toISOString(),
    data_through:
      input.data_through === null
        ? null
        : new Date(input.data_through).toISOString(),
    source: input.source,
    metric_name: input.metric_name,
    metric_value: input.metric_value,
    missing_reason: input.missing_reason,
    definition: input.definition.trim(),
    denominator_name: denominatorName,
    denominator_value: denominatorValue,
    measurement_kind: input.measurement_kind,
    duration_seconds: input.duration_seconds,
    external_post_id: input.external_post_id,
    curve: points,
  };
}

/** 最新版のみ。同じ取得元・定義・尺で分離し、欠測を分母と中央値から除く。
 * window は画面で選んだ窓。下書きごとに読む窓は displayWindowFor で決まる（既定の 48h では全貌は当日の値）
 */
export function compareObservations(
  drafts,
  observations,
  { window, metric, now = Date.now() },
) {
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const latest = new Map();
  for (const row of observations) {
    if (
      row.window !== displayWindowFor(draftById.get(row.draft_id), window) ||
      row.metric_name !== metric ||
      row.source === "mock"
    )
      continue;
    const key = JSON.stringify([
      row.draft_id,
      row.source,
      row.definition,
      row.measurement_kind,
    ]);
    if (!latest.has(key) || row.revision > latest.get(key).revision)
      latest.set(key, row);
  }
  const byDraft = new Map();
  for (const row of latest.values()) {
    if (!byDraft.has(row.draft_id)) byDraft.set(row.draft_id, []);
    byDraft.get(row.draft_id).push(row);
  }
  const groups = new Map();
  for (const draft of drafts) {
    const draftWindow = draft.posted_at
      ? displayWindowFor(draft, window)
      : null;
    if (
      !OBSERVED_PLATFORMS.includes(draft.platform) ||
      !draftWindow ||
      Date.parse(observationPeriod(draft.posted_at, draftWindow).period_end) >
        now
    )
      continue;
    const requiresDuration =
      draft.platform !== "x" ||
      !["url_link_clicks", "impressions"].includes(metric);
    const rows = byDraft.get(draft.id) || [];
    for (const row of rows.length
      ? rows
      : [
          {
            source: "未収集",
            definition: "未収集",
            measurement_kind: "period",
            duration_seconds: null,
            metric_value: null,
            missing_reason: "未収集",
          },
        ]) {
      const key = JSON.stringify([
        draftWindow,
        draft.platform,
        draft.language,
        draft.format,
        draft.template_variant_id,
        requiresDuration ? row.duration_seconds : null,
        row.source,
        row.definition,
        row.measurement_kind,
        row.denominator_name ?? null,
      ]);
      if (!groups.has(key))
        groups.set(key, {
          key,
          window: draftWindow,
          platform: draft.platform,
          language: draft.language,
          format: draft.format,
          variant: draft.template_variant_id,
          duration: requiresDuration ? row.duration_seconds : null,
          source: row.source,
          definition: row.definition,
          kind: row.measurement_kind,
          denominator: row.denominator_name ?? null,
          count: 0,
          values: [],
          missing: {},
          curves: [],
          posts: [],
        });
      const group = groups.get(key);
      group.count++;
      group.posts.push({
        draft_id: draft.id,
        observed_at: row.observed_at,
        data_through: row.data_through,
        revision: row.revision,
        value: row.metric_value,
        denominator_value: row.denominator_value ?? null,
      });
      const reason =
        row.missing_reason ||
        (requiresDuration && row.duration_seconds === null
          ? "尺未確認"
          : // 全貌（format=full_picture）は型の版の仕組みを持たない（1つの決まった型）ので、版の確認をしない
            !draft.template_variant_id && draft.format !== FULL_PICTURE_FORMAT
            ? "型の版未確認"
            : null);
      if (reason || row.metric_value === null)
        group.missing[reason || "未収集"] =
          (group.missing[reason || "未収集"] || 0) + 1;
      else {
        group.values.push(row.metric_value);
        if (row.curve?.length)
          group.curves.push({ draft_id: draft.id, points: row.curve });
      }
    }
  }
  return [...groups.values()].map((group) => {
    const values = group.values.sort((a, b) => a - b);
    const n = values.length;
    return {
      ...group,
      median: n
        ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2
        : null,
      provisional: n < 10,
    };
  });
}

export const OBSERVATION_UTM_CAMPAIGNS = ["sonar-preview", "race-full"];
// レースの URL に付けてよいクエリ（タブを直接開くリンク。送る前の表示の確認 checkPublicDisplay と同じ許可）
export const RACE_URL_TABS = ["sonar"];
const allowedRaceQuery = (url) =>
  !url.search ||
  ([...url.searchParams.keys()].join(",") === "tab" &&
    RACE_URL_TABS.includes(url.searchParams.get("tab")));

/** 呼び出し側が正式公開証拠を確認するまでURLを返さない。投稿本文は変更しない。
 * campaign: sonar-preview（型の版つき）・race-full（sns-pdca-loop の通り道 A。素材 v1 は型の版が無いので variantId は任意）
 */
export function buildObservationUtm({
  raceUrl,
  draftId,
  variantId = null,
  releaseEvidence,
  campaign = "sonar-preview",
}) {
  if (
    !releaseEvidence?.confirmed_by ||
    !releaseEvidence?.reference ||
    !timestamp(releaseEvidence?.confirmed_at) ||
    releaseEvidence.url !== raceUrl
  )
    throw new Error("正式公開URLの確認が必要です");
  const url = new URL(raceUrl);
  if (
    url.origin !== "https://www.boat-ai.jp" ||
    !/^\/race\/[^/]+$/.test(url.pathname) ||
    !allowedRaceQuery(url) ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("公開レースURLが不正です");
  if (!OBSERVATION_UTM_CAMPAIGNS.includes(campaign))
    throw new Error("UTM の campaign が不正です");
  if (!draftId || (campaign === "sonar-preview" && !variantId))
    throw new Error("投稿と型の版が必要です");
  const content = variantId ? `${draftId}/${variantId}` : draftId;
  url.searchParams.set("utm_source", "x");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", campaign);
  url.searchParams.set("utm_content", content);
  return {
    url: url.toString(),
    release_evidence: releaseEvidence,
    draft_id: draftId,
    template_variant_id: variantId,
    race_url: raceUrl,
    tracking_url: url.toString(),
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: campaign,
    utm_content: content,
  };
}

/** YouTubeプロフィール共通リンク。公開確認後に手動設定用URLを生成する。 */
export function buildYoutubeProfileUtm({ destinationUrl, releaseEvidence }) {
  if (
    !releaseEvidence?.confirmed_by ||
    !releaseEvidence?.reference ||
    !timestamp(releaseEvidence?.confirmed_at) ||
    releaseEvidence.url !== destinationUrl
  ) throw new Error("正式公開URLの確認が必要です");
  const url = new URL(destinationUrl);
  if (url.origin !== "https://www.boat-ai.jp" || url.username || url.password)
    throw new Error("公開URLが不正です");
  const params = {
    utm_source: "youtube",
    utm_medium: "social",
    utm_campaign: "profile",
    utm_content: "profile",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { url: url.toString(), tracking_url: url.toString(), destination_url: destinationUrl,
    release_evidence: releaseEvidence, ...params };
}
