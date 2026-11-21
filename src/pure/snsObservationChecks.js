/**
 * SNS観測の入力の検査（src/utils/snsObservations.js の validateObservationInput の中の検査を、順を変えずに名前のある関数へ移した物）。
 * どれも不備なら Error を投げ、無ければ何も返さない（checkedDenominator・checkedCurve だけは検査して値を返す）。
 */
import {
  OBSERVATION_METRICS,
  OBSERVATION_SOURCES,
  timestamp,
  windowsFor,
  withinSnapshotTolerance,
} from "./snsObservationWindows.js";

/** 入力が object で、投稿済みの下書きで、その型の測る窓か（observationPeriod の前の検査） */
export function assertObservationEnvelope(input, draft) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("観測データが不正です");
  if (draft.status !== "posted") throw new Error("投稿済みのみ観測できます");
  if (!windowsFor(draft).includes(input.window))
    throw new Error("この投稿の型では測らない観測窓です");
}

/** 指標名・取得元 */
export function assertMetricAndSource(input) {
  if (
    !OBSERVATION_METRICS.includes(input.metric_name) ||
    !OBSERVATION_SOURCES.includes(input.source)
  )
    throw new Error("指標名・取得元が不正です");
}

/** 観測時刻（窓の終了の後） */
export function assertObservedAt(input, period) {
  if (
    !timestamp(input.observed_at) ||
    Date.parse(input.observed_at) < Date.parse(period.period_end)
  )
    throw new Error("観測窓の終了前です");
}

/** 対象期間（保存では窓と一致、provider 入力では時刻の形だけ） */
export function assertPeriodBounds(input, period, requireWindowMatch) {
  if (
    !timestamp(input.period_start) ||
    !timestamp(input.period_end) ||
    (requireWindowMatch &&
      (Date.parse(input.period_start) !== Date.parse(period.period_start) ||
        Date.parse(input.period_end) !== Date.parse(period.period_end)))
  )
    throw new Error("対象期間は投稿日時から観測窓の終了までです");
}

/** データ最終時点（null か、窓の始めから観測時刻の間） */
export function assertDataThrough(input, period) {
  if (
    input.data_through !== null &&
    (!timestamp(input.data_through) ||
      Date.parse(input.data_through) < Date.parse(period.period_start) ||
      Date.parse(input.data_through) > Date.parse(input.observed_at))
  )
    throw new Error("データ最終時点が不正です");
}

/** 取得元がチャネル専用なら下書きのチャネルと一致 */
export function assertPlatformMatch(input, draft) {
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
}

/** 指標の定義・期間値か累積値かの区別 */
export function assertDefinitionAndKind(input) {
  if (
    typeof input.definition !== "string" ||
    !input.definition.trim() ||
    input.definition.length > 500
  )
    throw new Error("指標の定義が必要です");
  if (!["period", "snapshot"].includes(input.measurement_kind))
    throw new Error("期間値と累積スナップショットを区別してください");
}

/** 値（null か 0 以上の有限数）と、欠測の理由（null なら理由が要る、値があれば理由は null） */
export function assertValueAndMissing(input) {
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
}

/** 保存の入力だけ: 値があるなら期間が窓と合い、累積値は窓の終わりから許容差の中 */
export function assertCompleteness(input, period, requireWindowMatch) {
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
}

/** 分母の名称と値を検査して { name, value } にする（無ければ null・null） */
export function checkedDenominator(input) {
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
  return { name: denominatorName, value: denominatorValue };
}

/** 維持曲線の点列を検査して返す（無ければ []） */
export function checkedCurve(input) {
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
  return points;
}

/** 尺・外部投稿ID */
export function assertDurationAndExternalId(input) {
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
}
