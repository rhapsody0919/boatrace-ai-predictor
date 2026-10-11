import {
  OBSERVATION_METRICS,
  OBSERVED_PLATFORMS,
  observationPeriod,
} from "./snsObservations.js";

const metricColumns = {
  url_link_clicks: "link_clicks",
  engagedViews: "engaged_views",
};
const provenance = [
  "revision",
  "source",
  "definition",
  "observed_at",
  "data_through",
  "period_start",
  "period_end",
  "measurement_kind",
  "missing_reason",
  "denominator_name",
  "denominator_value",
];
export const CSV_COLUMNS = [
  "dataset_kind",
  "platform",
  "external_post_id",
  "content_type_id",
  "content_version",
  "race_id",
  "published_at",
  "window",
  "revision",
  "observed_at",
  "period_start",
  "period_end",
  "data_through",
  "source_timezone",
  "coverage",
  "source_export",
  "traffic_scope",
  "missing_reason",
  "draft_id",
  "variant",
  "duration_seconds",
  "aggregation_rule",
  "content_version_missing_reason",
  "source_timezone_missing_reason",
  "traffic_scope_missing_reason",
  "external_post_id_missing_reason",
  "observed_at_missing_reason",
  "data_through_missing_reason",
  "stayed_to_watch_percent",
  "stayed_to_watch_percent_missing_reason",
  ...OBSERVATION_METRICS.flatMap((name) => {
    const col = metricColumns[name] || name;
    return [col, ...provenance.map((key) => `${col}_${key}`)];
  }),
];

export function csvPublicationRange(start, end, platform = "all") {
  const valid = (day) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day || "") &&
    Number.isFinite(Date.parse(`${day}T00:00:00Z`)) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (
    !valid(start) ||
    !valid(end) ||
    start > end ||
    !["all", ...OBSERVED_PLATFORMS].includes(platform)
  )
    throw new Error("公開日・チャネルが不正です");
  return {
    start: new Date(`${start}T00:00:00+09:00`).toISOString(),
    end: new Date(Date.parse(`${end}T00:00:00+09:00`) + 86400000).toISOString(),
    platform,
  };
}

// 同時刻はrevision、取得元、定義、idの順で決定し、選択規則をCSVに残す。
function order(a, b) {
  return (
    Date.parse(a.observed_at) - Date.parse(b.observed_at) ||
    a.revision - b.revision ||
    JSON.stringify([a.source, a.definition, a.id]).localeCompare(
      JSON.stringify([b.source, b.definition, b.id]),
    )
  );
}
export function buildObservationCsvRows(
  drafts,
  observations,
  { start, end, platform = "all", now = Date.now() },
) {
  const range = csvPublicationRange(start, end, platform);
  const byDraft = new Map();
  const postIds = new Map();
  for (const o of observations) {
    if (
      o.source === "mock" ||
      !Number.isFinite(Date.parse(o.observed_at)) ||
      Date.parse(o.observed_at) > now
    )
      continue;
    if (o.external_post_id) {
      if (!postIds.has(o.draft_id)) postIds.set(o.draft_id, new Set());
      postIds.get(o.draft_id).add(o.external_post_id);
    }
    const key = `${o.draft_id}/${o.window}`;
    if (!byDraft.has(key)) byDraft.set(key, []);
    byDraft.get(key).push(o);
  }
  return drafts
    .filter(
      (d) =>
        d.status === "posted" &&
        OBSERVED_PLATFORMS.includes(d.platform) &&
        (platform === "all" || platform === d.platform) &&
        Date.parse(d.posted_at) >= Date.parse(range.start) &&
        Date.parse(d.posted_at) < Date.parse(range.end) &&
        Date.parse(d.posted_at) <= now,
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((d) =>
      ["48h", "7d"]
        .map((window) => {
          let period;
          try {
            period = observationPeriod(d.posted_at, window);
          } catch {
            // posted_atがDate.parseには通るが厳密なISO形式ではない場合、
            // この1行だけ観測期間を計算できない。CSV全体を失敗させず、この行を除く。
            console.error(
              "SNS観測CSV: posted_atの形式が不正なため1行を除外",
              d.id,
              d.posted_at,
            );
            return null;
          }
          const history = byDraft.get(`${d.id}/${window}`) || [];
          const latest = new Map();
          for (const o of history)
            if (
              OBSERVATION_METRICS.includes(o.metric_name) &&
              (!latest.has(o.metric_name) ||
                order(o, latest.get(o.metric_name)) > 0)
            )
              latest.set(o.metric_name, o);
          const chosen = [...latest.values()];
          const reason =
            Date.parse(period.period_end) > now ? "観測窓未終了" : "未収集";
          const primary =
            d.platform === "x"
              ? [latest.get("url_link_clicks"), latest.get("impressions")]
              : [];
          const identities = [
            ...new Set(
              [
                ...(postIds.get(d.id) || []),
                d.platform === "youtube"
                  ? d.source_data?.youtube_video_id
                  : null,
              ].filter(Boolean),
            ),
          ];
          const times = chosen
            .map((o) => o.observed_at)
            .sort((a, b) => Date.parse(a) - Date.parse(b));
          const through = chosen.map((o) => o.data_through);
          const durations = [
            ...new Set(
              chosen.map((o) => o.duration_seconds).filter((v) => v != null),
            ),
          ];
          const row = {
            dataset_kind: "real",
            platform: d.platform,
            external_post_id: identities.length === 1 ? identities[0] : "",
            external_post_id_missing_reason:
              identities.length === 1
                ? ""
                : identities.length > 1
                  ? "観測間で投稿IDが不一致"
                  : "投稿ID未確認",
            content_type_id: d.format || "",
            content_version: "",
            content_version_missing_reason: "型の版と素材の版の対応未確認",
            race_id: d.source_data?.race_id || "",
            published_at: d.posted_at,
            window,
            revision: history.length + 1,
            ...period,
            observed_at: times.at(-1) || "",
            observed_at_missing_reason: times.length ? "" : reason,
            data_through:
              through.length && through.every(Boolean)
                ? through.sort((a, b) => Date.parse(a) - Date.parse(b))[0]
                : "",
            data_through_missing_reason:
              through.length && through.every(Boolean)
                ? ""
                : "データ最終時点未確認",
            source_timezone: "",
            source_timezone_missing_reason: "原本タイムゾーン未確認",
            traffic_scope: "",
            traffic_scope_missing_reason: "帰属範囲未確認",
            coverage:
              primary.length &&
              primary.every(
                (o) =>
                  o &&
                  o.metric_value !== null &&
                  Date.parse(o.period_start) ===
                    Date.parse(period.period_start) &&
                  Date.parse(o.period_end) === Date.parse(period.period_end) &&
                  Date.parse(o.data_through) === Date.parse(period.period_end),
              )
                ? "exact"
                : "missing",
            source_export: JSON.stringify(
              primary.map((o) =>
                o ? [o.source, o.definition, o.measurement_kind] : null,
              ),
            ),
            missing_reason:
              d.platform === "youtube"
                ? "継続視聴率未収集"
                : primary
                    .filter((o) => !o || o.metric_value === null)
                    .map((o) => o?.missing_reason || reason)
                    .join(" / "),
            draft_id: d.id,
            variant: d.template_variant_id || "",
            duration_seconds: durations.length === 1 ? durations[0] : "",
            aggregation_rule:
              "latest_observed_at_per_metric;tie=revision,source,definition,id;export_revision=history_count+1;observed_at=max;data_through=min_or_blank",
            stayed_to_watch_percent: "",
            stayed_to_watch_percent_missing_reason: "未収集",
          };
          for (const name of OBSERVATION_METRICS) {
            const col = metricColumns[name] || name;
            const o = latest.get(name);
            row[col] = o?.metric_value ?? "";
            for (const key of provenance) row[`${col}_${key}`] = o?.[key] ?? "";
            row[`${col}_missing_reason`] = o
              ? o.metric_value === null
                ? o.missing_reason
                : ""
              : reason;
          }
          return row;
        })
        .filter(Boolean),
    );
}

/** 全セルを引用。式の先頭文字は表計算ソフトの実行を防ぐためアポストロフィで保護する。 */
export function serializeObservationCsv(rows) {
  const cell = (value) => {
    let s = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return (
    [CSV_COLUMNS, ...rows.map((row) => CSV_COLUMNS.map((key) => row[key]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n") + "\r\n"
  );
}
