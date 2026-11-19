/**
 * SNS の暦日の取り込みの YouTube 側。snsDailyRunner.js から、collectYoutube・collectEngaged・ytRow・YouTube Analytics のクライアントを移した
 * （振る舞いは同じ）。
 */
import {
  CHANNEL_METRICS,
  ENGAGED_BUDGET_MS,
  ENGAGED_METRICS,
  ENGAGED_PT_DAYS,
  ENGAGED_RETRY_HOURS,
  ENGAGED_WINDOW,
  VIDEO_METRICS,
  YT_MISSING,
  addDays,
  def,
  ptDate,
  ptMidnightUtc,
} from "./snsDailyRunnerParts.js";

export async function collectYoutube({
  yt,
  videos,
  ptDays,
  push,
  youtubeZeroFinalizations,
}) {
  const pushDaily = (args) => {
    const finalDayWithoutRow = args.day === ptDays[0] && args.row === undefined;
    const finalizeZero =
      finalDayWithoutRow && CHANNEL_METRICS.includes(args.metric);
    const row = ytRow({ ...args, finalDayWithoutRow, finalizeZero });
    push(row);
    if (finalizeZero)
      youtubeZeroFinalizations.push({
        day: row.day,
        channel: row.channel,
        draft_id: row.draft_id,
        metric_name: row.metric_name,
        reason: "Analytics が行を返さない日を D−3 で0と確定",
      });
  };
  const channelRows = await yt.report({
    startDate: ptDays[0],
    endDate: ptDays.at(-1),
    dimensions: "day",
    metrics: CHANNEL_METRICS.join(","),
  });
  const byDay = new Map(channelRows.map((r) => [r.day, r]));
  for (const day of ptDays)
    for (const metric of CHANNEL_METRICS)
      pushDaily({
        day,
        metric,
        row: byDay.get(day),
        definition: def.ytChannel(metric),
      });

  // 投稿日か翌日が取り直しの範囲に入る動画だけ。動画ごとに1回（クォータ1）
  for (const video of videos) {
    const posted = ptDate(new Date(video.posted_at));
    const days = [posted, addDays(posted, 1)].filter((d) => ptDays.includes(d));
    if (!days.length || !video.external_post_id) continue;
    const videoRows = await yt.report({
      startDate: days[0],
      endDate: days.at(-1),
      dimensions: "day",
      metrics: VIDEO_METRICS.join(","),
      filters: `video==${video.external_post_id}`,
    });
    const videoByDay = new Map(videoRows.map((r) => [r.day, r]));
    for (const day of days)
      for (const metric of VIDEO_METRICS)
        pushDaily({
          day,
          metric,
          row: videoByDay.get(day),
          definition: def.ytVideo(metric),
          draft_id: video.draft_id,
        });
  }
}

/**
 * pt3d の観測（sns_metric_observations、append_sns_metric_observation に渡す形）。投稿日から3日目が D−3 より前の動画で、
 * まだ値の入った観測が無いものだけ。動画ごとに1回（クォータ1）。engagedViews は分母 views を持つ
 */
export async function collectEngaged({
  yt,
  store,
  videos,
  ptDays,
  now,
  startedMs = Date.now(),
  errors = [],
}) {
  const due = videos.filter(
    (v) =>
      v.external_post_id &&
      v.posted_at &&
      // D−3 は今日も取り直す日（反映が日で揺れる）なので、それより前だけ（system-architect の審査 P2-3）
      addDays(ptDate(new Date(v.posted_at)), ENGAGED_PT_DAYS - 1) < ptDays[0],
  );
  if (!due.length) return [];
  // 指標ごとに、まだ入れる要るものだけを残す（Codex の審査 P1: 4指標は別々に保存するので、1つだけ落ちても取り直す）。
  // 入れない: 値のある観測がある指標（engagedViews は分母も）と、直近（同じ日の2回目の起動）に欠測で入れた指標
  const since = now.getTime() - ENGAGED_RETRY_HOURS * 3600000;
  const settled = new Set(
    (
      await store.engagedObservations(
        due.map((v) => v.draft_id),
        ENGAGED_METRICS,
      )
    )
      .filter(
        (o) =>
          o.definition === def.ytEngaged(o.metric_name) &&
          ((o.metric_value !== null &&
            (o.metric_name !== "engagedViews" ||
              o.denominator_value !== null)) ||
            Date.parse(o.observed_at) >= since),
      )
      .map((o) => `${o.draft_id}|${o.metric_name}`),
  );
  const pending = (v) =>
    ENGAGED_METRICS.filter((m) => !settled.has(`${v.draft_id}|${m}`));
  const out = [];
  for (const video of due.filter((v) => pending(v).length)) {
    if (Date.now() - startedMs > ENGAGED_BUDGET_MS) break; // 残りは次の起動（値が入るまで毎日やり直す）
    const start = ptDate(new Date(video.posted_at));
    let row;
    try {
      [row] = await yt.report({
        startDate: start,
        endDate: addDays(start, ENGAGED_PT_DAYS - 1),
        metrics: ENGAGED_METRICS.join(","),
        filters: `video==${video.external_post_id}`,
      });
    } catch (error) {
      // 1本の失敗で残りの動画を止めない。この動画は次の日にやり直す
      errors.push(
        `engagedViews の観測（${video.draft_id}）の読み取り: ${error.message}`,
      );
      continue;
    }
    const periodEnd = ptMidnightUtc(addDays(start, ENGAGED_PT_DAYS));
    const value = (m) =>
      Number.isFinite(row?.[m]) && row[m] >= 0 ? row[m] : null;
    for (const metric of pending(video)) {
      const v = value(metric);
      out.push({
        draft_id: video.draft_id,
        observation: {
          window: ENGAGED_WINDOW,
          external_post_id: video.external_post_id,
          observed_at: now.toISOString(),
          period_start: video.posted_at,
          period_end: periodEnd,
          data_through: v === null ? null : periodEnd,
          source: "youtube-analytics",
          metric_name: metric,
          metric_value: v,
          missing_reason: v === null ? YT_MISSING : null,
          definition: def.ytEngaged(metric),
          measurement_kind: "period",
          ...(metric === "engagedViews" && value("views") !== null
            ? { denominator_name: "views", denominator_value: value("views") }
            : {}),
        },
      });
    }
  }
  return out;
}

function ytRow({
  day,
  metric,
  row,
  definition,
  draft_id = null,
  finalDayWithoutRow = false,
  finalizeZero = false,
}) {
  // DB の CHECK は値と missing_reason のどちらか一方。規則による0の理由は report に残す。
  const value = finalizeZero ? 0 : row?.[metric];
  const ok = Number.isFinite(value) && value >= 0;
  return {
    day,
    channel: "youtube",
    draft_id,
    source: "youtube-analytics",
    metric_name: metric,
    metric_value: ok ? value : null,
    missing_reason: ok
      ? null
      : finalDayWithoutRow
        ? "Analytics が行を返さない日を D−3 で確定したが、視聴なしの平均は算出できない"
        : YT_MISSING,
    definition,
  };
}

/** YouTube Analytics の reports（channel==MINE）。行を {day, 指標...} にする */
export function createYoutubeAnalyticsClient({
  accessToken,
  fetchImpl = fetch,
}) {
  if (!accessToken)
    throw new Error("YouTube Analytics の access token がありません");
  return {
    async report(params) {
      const query = new URLSearchParams({ ids: "channel==MINE", ...params });
      const response = await fetchImpl(
        `https://youtubeanalytics.googleapis.com/v2/reports?${query}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body)
        throw new Error(
          `YouTube Analytics reports が失敗: HTTP ${response.status}`,
        );
      const names = (body.columnHeaders ?? []).map((h) => h.name);
      return (body.rows ?? []).map((row) =>
        Object.fromEntries(row.map((value, i) => [names[i], value])),
      );
    },
  };
}
