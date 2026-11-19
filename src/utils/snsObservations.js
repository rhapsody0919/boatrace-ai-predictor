/** SNS観測の共通契約。ネットワーク・認証・環境変数に依存しない。 */
// 窓・取得元・指標・時刻の判定は snsObservationWindows.js、入力の検査は snsObservationChecks.js へ移した（外へは同じ名で出す）
import {
  displayWindowFor,
  FULL_PICTURE_FORMAT,
  OBSERVED_PLATFORMS,
  observationPeriod,
  timestamp,
} from "../pure/snsObservationWindows.js";
import {
  assertCompleteness,
  assertDataThrough,
  assertDefinitionAndKind,
  assertDurationAndExternalId,
  assertMetricAndSource,
  assertObservationEnvelope,
  assertObservedAt,
  assertPeriodBounds,
  assertPlatformMatch,
  assertValueAndMissing,
  checkedCurve,
  checkedDenominator,
} from "../pure/snsObservationChecks.js";

export {
  DEFAULT_WINDOWS,
  displayWindowFor,
  FULL_PICTURE_FORMAT,
  FULL_PICTURE_WINDOWS,
  isObservationTimestamp,
  OBSERVATION_METRICS,
  OBSERVATION_SOURCES,
  OBSERVATION_WINDOWS,
  OBSERVED_PLATFORMS,
  observationPeriod,
  SNAPSHOT_TOLERANCE_MS,
  WINDOW_LABELS,
  windowsFor,
  withinSnapshotTolerance,
} from "../pure/snsObservationWindows.js";


export function validateObservation(input, draft) {
  return validateObservationInput(input, draft, true);
}

/** provider入力は保存窓への適合以外を先に検査する。保存にはvalidateObservationが必須。 */
export function validateProviderObservation(input, draft) {
  validateObservationInput(input, draft, false);
}

function validateObservationInput(input, draft, requireWindowMatch) {
  assertObservationEnvelope(input, draft);
  const period = observationPeriod(draft.posted_at, input.window);
  assertMetricAndSource(input);
  assertObservedAt(input, period);
  assertPeriodBounds(input, period, requireWindowMatch);
  assertDataThrough(input, period);
  assertPlatformMatch(input, draft);
  assertDefinitionAndKind(input);
  assertValueAndMissing(input);
  assertCompleteness(input, period, requireWindowMatch);
  const denominator = checkedDenominator(input);
  const points = checkedCurve(input);
  assertDurationAndExternalId(input);
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
    denominator_name: denominator.name,
    denominator_value: denominator.value,
    measurement_kind: input.measurement_kind,
    duration_seconds: input.duration_seconds,
    external_post_id: input.external_post_id,
    curve: points,
  };
}

/** 画面で選んだ窓・指標の最新版の行だけ（同じ下書き・取得元・定義・測り方で revision の最大）。mock は除く */
function latestObservationRows(draftById, observations, window, metric) {
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
  return latest;
}

/** 最新版の行を下書きの id ごとの配列にする */
function rowsByDraftId(latest) {
  const byDraft = new Map();
  for (const row of latest.values()) {
    if (!byDraft.has(row.draft_id)) byDraft.set(row.draft_id, []);
    byDraft.get(row.draft_id).push(row);
  }
  return byDraft;
}

/** 観測が1行も無い下書きに当てる「未収集」の行 */
function uncollectedRow() {
  return {
    source: "未収集",
    definition: "未収集",
    measurement_kind: "period",
    duration_seconds: null,
    metric_value: null,
    missing_reason: "未収集",
  };
}

/** 集計の組の鍵（窓・チャネル・言語・型・版・尺・取得元・定義・測り方・分母の名称） */
function observationGroupKey(draftWindow, draft, row, requiresDuration) {
  return JSON.stringify([
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
}

/** 集計の組の空の入れ物 */
function newObservationGroup(key, draftWindow, draft, row, requiresDuration) {
  return {
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
  };
}

/** 欠測の理由（無ければ null）。行の理由 → 尺未確認 → 型の版未確認 の順 */
function observationMissingReason(row, draft, requiresDuration) {
  return (
    row.missing_reason ||
    (requiresDuration && row.duration_seconds === null
      ? "尺未確認"
      : // 全貌（format=full_picture）は型の版の仕組みを持たない（1つの決まった型）ので、版の確認をしない
        !draft.template_variant_id && draft.format !== FULL_PICTURE_FORMAT
        ? "型の版未確認"
        : null)
  );
}

/** 行1つを集計の組に足す（投稿の記録・欠測の数・値と維持曲線） */
function addRowToGroup(group, draft, row, requiresDuration) {
  group.count++;
  group.posts.push({
    draft_id: draft.id,
    observed_at: row.observed_at,
    data_through: row.data_through,
    revision: row.revision,
    value: row.metric_value,
    denominator_value: row.denominator_value ?? null,
  });
  const reason = observationMissingReason(row, draft, requiresDuration);
  if (reason || row.metric_value === null)
    group.missing[reason || "未収集"] =
      (group.missing[reason || "未収集"] || 0) + 1;
  else {
    group.values.push(row.metric_value);
    if (row.curve?.length)
      group.curves.push({ draft_id: draft.id, points: row.curve });
  }
}

/** 下書きを順に見て、行（無ければ「未収集」の1行）を集計の組に入れる。窓が終わっていない・対象外の下書きは飛ばす */
function groupObservationRows(drafts, byDraft, window, metric, now) {
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
    for (const row of rows.length ? rows : [uncollectedRow()]) {
      const key = observationGroupKey(draftWindow, draft, row, requiresDuration);
      if (!groups.has(key))
        groups.set(
          key,
          newObservationGroup(key, draftWindow, draft, row, requiresDuration),
        );
      addRowToGroup(groups.get(key), draft, row, requiresDuration);
    }
  }
  return groups;
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
  const latest = latestObservationRows(draftById, observations, window, metric);
  const groups = groupObservationRows(
    drafts,
    rowsByDraftId(latest),
    window,
    metric,
    now,
  );
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

/** 正式公開の確認（確認者・参照・確認時刻があり、確認した URL が対象と同じ）。無ければ投げる */
function assertReleaseConfirmed(releaseEvidence, expectedUrl) {
  if (
    !releaseEvidence?.confirmed_by ||
    !releaseEvidence?.reference ||
    !timestamp(releaseEvidence?.confirmed_at) ||
    releaseEvidence.url !== expectedUrl
  )
    throw new Error("正式公開URLの確認が必要です");
}

/** 公開レースの URL の形（origin・パス・クエリ・hash・認証情報）。不正なら投げる */
function assertPublicRaceUrl(url) {
  if (
    url.origin !== "https://www.boat-ai.jp" ||
    !/^\/race\/[^/]+$/.test(url.pathname) ||
    !allowedRaceQuery(url) ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("公開レースURLが不正です");
}

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
  assertReleaseConfirmed(releaseEvidence, raceUrl);
  const url = new URL(raceUrl);
  assertPublicRaceUrl(url);
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
  assertReleaseConfirmed(releaseEvidence, destinationUrl);
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
