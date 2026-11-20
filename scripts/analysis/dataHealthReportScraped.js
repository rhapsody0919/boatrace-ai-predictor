import { addDaysToDateString } from "../lib/dateUtils.js";
import { rate } from "./dataHealthReportConfig.js";

// 取得時刻の分布を出す対象。minutes は「発走m分前までに保存されたレースの割合」を出す基準時刻。
// exhibition_data は展示取得の窓（30/15/10分前）と体重だけの窓（60分前。BOA-500）、race_entries は出走表更新の窓（60分前）。
// BOA-500 以降、exhibition_data の最初の保存は発走60分前の体重だけの行になるため、展示の取得時刻は「値が揃った時刻」で見る。
// race_start_timings は発走後に保存されるため、基準時刻は無い（発走後に保存された割合のみ）
const SCRAPED_TIMESTAMP_TABLES = [
  { table: "exhibition_data", minutes: [60, 30, 15, 10], hasValueFilled: true },
  { table: "race_entries", minutes: [60], hasValueFilled: false },
  { table: "race_start_timings", minutes: [], hasValueFilled: false },
];

// ---------------------------------------------------------------------------
// SQL（日付はDATE_PATTERN検証済みの文字列のみ埋め込む）
// ---------------------------------------------------------------------------

/**
 * 取得時刻（created_at）の分布のクエリ（テーブルごとに1本、サーバー側集計）。
 * 「発走時刻 − 行が最初に保存された時刻」（分。発走前に保存されていれば正、発走後なら負）を、
 * レースごとに1値（そのレースの行のうち最も早い created_at）で出し、created_at が非NULLのレースだけを
 * 分母にする（マイグレーション071より前に保存された行はNULLで、含めない）。
 * 期間は窓内取得率と同じ直近7日。主キー（race_id）の範囲検索のみ（Disk IO予算への配慮）。
 *
 * @param {{table: string, minutes: number[], hasValueFilled: boolean}} spec
 */
export function buildScrapedTimestampQuery(
  { table, minutes, hasValueFilled },
  { windowStart, endDate },
) {
  const endExclusive = addDaysToDateString(endDate, 1);
  const hits = minutes
    .map((m) => `count(*) filter (where lead_min >= ${m}) as hit_${m}`)
    .join(",\n    ");
  const percentiles = (col) =>
    [10, 50, 90]
      .map(
        (q) =>
          `percentile_cont(${q / 100}) within group (order by ${col}) as ${col}_p${q}`,
      )
      .join(",\n    ");
  return `
with base as (
  select r.race_id,
      (r.race_date::timestamp + r.start_time) at time zone 'Asia/Tokyo' as dl
  from races r
  where r.race_date between '${windowStart}' and '${endDate}'
    and r.start_time is not null
    and r.cancellation_status is distinct from 'confirmed'
), t as (
  select x.race_id, count(*) as rows_total,
      -- マイグレーション071より前の行（created_atがNULL）が混ざるレースは、最も早い保存時刻を
      -- 特定できないため除く（NULLを無視すると、後から保存された行の時刻を初回と誤る）
      case when count(x.created_at) = count(*) then min(x.created_at) end as first_created_at${
        hasValueFilled
          ? `,
      -- 展示タイムが入っている行の updated_at の最大値＝展示タイムが揃った時刻の上限の近似
      -- （値が変わった最後の時刻。展示タイム以外の列が後から変わると、その分だけ遅く出る）
      case when count(x.created_at) = count(*)
          then max(x.updated_at) filter (where x.exhibition_time is not null) end as value_filled_at`
          : ""
      }
  from ${table} x
  where x.race_id >= '${windowStart}' and x.race_id < '${endExclusive}'
  group by x.race_id
), l as (
  select t.rows_total,
      (extract(epoch from (b.dl - t.first_created_at)) / 60.0)::float8 as lead_min${
        hasValueFilled
          ? `,
      (extract(epoch from (b.dl - t.value_filled_at)) / 60.0)::float8 as filled_lead_min`
          : ""
      }
  from base b left join t on t.race_id = b.race_id
)
select
    count(*) as races_in_period,
    count(rows_total) as races_with_rows,
    count(lead_min) as races_with_created_at,
    count(*) filter (where lead_min < 0) as saved_after_start,
    ${percentiles("lead_min")}${hits ? `,\n    ${hits}` : ""}${
      hasValueFilled
        ? `,
    count(filled_lead_min) as races_with_value_filled,
    ${percentiles("filled_lead_min")}`
        : ""
    }
from l`;
}

const toNumberOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);
const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);

/**
 * 取得時刻の分布のクエリ結果を、レポート用の値にする（純粋関数）。
 * 分母は created_at が非NULLのレース（マイグレーション071より前の行はNULLで含まれない）
 */
export function summarizeScrapedTimestamp(spec, row) {
  const denominator = Number(row.races_with_created_at);
  const distribution = (key) => ({
    p10: round1(toNumberOrNull(row[`${key}_p10`])),
    p50: round1(toNumberOrNull(row[`${key}_p50`])),
    p90: round1(toNumberOrNull(row[`${key}_p90`])),
  });
  return {
    table: spec.table,
    applied: true,
    racesInPeriod: Number(row.races_in_period),
    racesWithRows: Number(row.races_with_rows),
    racesWithCreatedAt: denominator,
    savedAfterStart: Number(row.saved_after_start),
    // 発走の何分前に保存されたか（分。正=発走前、負=発走後）
    leadMinutes: distribution("lead_min"),
    // 発走m分前までに（窓の中心より前に）保存されていたレースの割合（累積）
    savedBy: spec.minutes.map((m) => ({
      minutesBefore: m,
      hit: Number(row[`hit_${m}`]),
      denominator,
      rate: rate(Number(row[`hit_${m}`]), denominator),
    })),
    valueFilled: spec.hasValueFilled
      ? {
          races: Number(row.races_with_value_filled),
          leadMinutes: distribution("filled_lead_min"),
        }
      : null,
  };
}

/**
 * 取得時刻（created_at・updated_at）の分布を集める。列が無い（マイグレーション071が未適用の）
 * テーブルは、クエリを発行せず「未適用のため計測不能」とする。
 * 計測に失敗しても、レポート全体は失敗させない（エラーを結果に残す）。
 *
 * @param {{timingColumns: Array<{table_name: string, column_name: string}>,
 *   windowStart: string, endDate: string,
 *   fetch: (queries: Record<string, string>) => Promise<Record<string, Object[]>>}} args
 */
export async function collectScrapedTimestamps({
  timingColumns,
  windowStart,
  endDate,
  fetch,
}) {
  const hasColumns = (table) =>
    ["created_at", "updated_at"].every((column) =>
      timingColumns.some(
        (r) => r.table_name === table && r.column_name === column,
      ),
    );
  const specs = SCRAPED_TIMESTAMP_TABLES.map((spec) => ({
    spec,
    applied: hasColumns(spec.table),
  }));
  const appliedSpecs = specs.filter((s) => s.applied).map((s) => s.spec);
  const unmeasured = (spec) => ({
    table: spec.table,
    applied: false,
    reason:
      "created_at・updated_at 列が無いため計測不能（マイグレーション071が未適用）",
  });
  if (appliedSpecs.length === 0) {
    return {
      period: { start: windowStart, end: endDate },
      error: null,
      tables: specs.map((s) => unmeasured(s.spec)),
    };
  }
  try {
    const queries = Object.fromEntries(
      appliedSpecs.map((spec) => [
        `scraped_${spec.table}`,
        buildScrapedTimestampQuery(spec, { windowStart, endDate }),
      ]),
    );
    const raw = await fetch(queries);
    return {
      period: { start: windowStart, end: endDate },
      error: null,
      tables: specs.map(({ spec, applied }) =>
        applied
          ? summarizeScrapedTimestamp(spec, raw[`scraped_${spec.table}`][0])
          : unmeasured(spec),
      ),
    };
  } catch (error) {
    return {
      period: { start: windowStart, end: endDate },
      error: `取得時刻の計測に失敗（他の指標は影響なし）: ${error.message}`,
      tables: specs.map((s) => unmeasured(s.spec)),
    };
  }
}

export { toNumberOrNull, round1 };
