// データ健全性レポートのSQL（日付はDATE_PATTERN検証済みの文字列のみ埋め込む）。
// data-health-report.js から移しただけ（SQLは1字も変えない）。

import {
  buildCoverageSql,
  buildMonthlySql,
  literalCoverageSlots,
} from "../lib/dataHealth/coverageSpec.js";
import {
  EXPECTED_UNPUBLISHED,
  firstRaceSql,
  laterOffsetsOf,
  laterWindowHitSql,
} from "../lib/scrapeJobs/expectedUnpublished.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import {
  EXPECTED_UNPUBLISHED_MINUTES,
  KNOWN_INCIDENTS,
  LATER_WINDOW_MINUTES,
  TIMING_TABLES,
  WINDOW_MINUTES,
  WINDOW_TOLERANCE_MIN,
} from "./dataHealthReportConfig.js";

/** 指標2: 窓内取得率（日別×窓）のSQL */
function buildWindowsSql({ windowStart, endDate }) {
  const incidentRanges =
    KNOWN_INCIDENTS.length === 0
      ? "select null::tstzrange as r where false"
      : `values ${KNOWN_INCIDENTS.map((i) => `(tstzrange('${i.start}'::timestamptz, '${i.end}'::timestamptz))`).join(",")}`;
  return `
with base as (
  select r.race_id, r.race_date,
      (r.race_date::timestamp + r.start_time) at time zone 'Asia/Tokyo' as dl,
      ${firstRaceSql("r")} as is_first
  from races r
  where r.race_date between '${windowStart}' and '${endDate}'
    and r.start_time is not null
    and r.cancellation_status is distinct from 'confirmed'
    and exists (select 1 from race_results rr where rr.race_id = r.race_id and rr.rank1 is not null)
), w(m) as (values ${WINDOW_MINUTES.map((m) => `(${m})`).join(",")}),
inc(r) as (${incidentRanges})
select b.race_date::text as d, w.m,
    count(*) as races,
    count(*) filter (where c.hit) as in_window,
    count(*) filter (where c.clean) as races_clean,
    count(*) filter (where c.clean and c.hit) as in_window_clean,
    -- 第1レースの対象の窓（${EXPECTED_UNPUBLISHED_MINUTES}分前）の件数と、窓内の件数（第1レースだけの率を別に出す）
    count(*) filter (where w.m = ${EXPECTED_UNPUBLISHED_MINUTES} and b.is_first) as first_race,
    count(*) filter (where w.m = ${EXPECTED_UNPUBLISHED_MINUTES} and b.is_first and c.hit) as first_race_in_window,
    -- 想定内の未公開: 第1レースの対象の窓が窓内に取れておらず、後続の窓のどれかには取れている（後で公開された）
    count(*) filter (where w.m = ${EXPECTED_UNPUBLISHED_MINUTES} and b.is_first and not c.hit and c.later_hit) as structural
from base b cross join w
cross join lateral (
  select exists (
      select 1 from race_odds o
      where o.race_id = b.race_id
        and o.captured_at between b.dl - make_interval(mins => w.m + ${WINDOW_TOLERANCE_MIN})
                              and b.dl - make_interval(mins => w.m - ${WINDOW_TOLERANCE_MIN})
    ) as hit,
    (w.m = ${EXPECTED_UNPUBLISHED_MINUTES} and b.is_first and ${laterWindowHitSql(
      {
        raceIdExpr: "b.race_id",
        deadlineExpr: "b.dl",
        laterMinutesBefore: LATER_WINDOW_MINUTES,
        toleranceMin: WINDOW_TOLERANCE_MIN,
      },
    )}) as later_hit,
    -- 窓の時間帯が既知の障害期間と重なる(レース,窓)は除外した集計に含めない
    not exists (
      select 1 from inc
      where inc.r && tstzrange(b.dl - make_interval(mins => w.m + 3),
                               b.dl - make_interval(mins => w.m - 3))
    ) as clean
) c
group by b.race_date, w.m order by b.race_date, w.m desc`;
}

export function buildQueries({ coverageStart, windowStart, endDate }) {
  return {
    // 指標1: 存在充足率（日別）。分母は開催中止(confirmed)を除いたレース。定義・SQLは coverageSpec.js
    // （汎用の日次監視 data_health のマイグレーション089の関数 data_health_coverage と同じテンプレート）
    coverage: buildCoverageSql(literalCoverageSlots(coverageStart, endDate)),

    // 指標2: 窓内取得率（日別×窓）。締切=発走時刻(JST)。窓=中心±3分
    windows: buildWindowsSql({ windowStart, endDate }),

    // 指標2補足: 監視と同じ予定表の行から、confirmed の検知の遅れを共通関数で計測する。
    // races は classifyExpectedUnpublished が期限・確定中止を判定するために必要。
    detectionLag: `
select s.job, s.race_id, s.offset_min, s.race_date, s.status, s.attempts,
    s.first_attempt_at, s.last_attempt_at, s.done_at, s.outcome, s.run_mode,
    json_build_object('start_time', r.start_time, 'cancellation_status', r.cancellation_status) as races
from scrape_slots s
join races r on r.race_id = s.race_id
where s.job = 'odds'
  and s.race_date between '${windowStart}' and '${endDate}'
  and s.offset_min in (${[EXPECTED_UNPUBLISHED.offsetMin, ...laterOffsetsOf(SCRAPE_JOBS.odds)].join(",")})`,

    // 指標3: 取得時刻列の有無
    timingColumns: `
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in (${TIMING_TABLES.map((t) => `'${t}'`).join(",")})
  and (data_type like 'timestamp%' or data_type = 'date')
  and column_name ~ '(scraped|captured|created|updated|predicted|result_at|checked|fetched)'
order by table_name, ordinal_position`,

    tableExistence: `
select table_name from information_schema.tables
where table_schema = 'public' and table_name in (${TIMING_TABLES.map((t) => `'${t}'`).join(",")})`,

    // 指標4: 月別の結果充足率（全期間、当日以降は結果未確定のため除く）。日単位の集計を経由して月に丸める。
    // 定義・SQLは coverageSpec.js（汎用の日次監視 data_health の関数 data_health_monthly_result と同じテンプレート）
    monthly: buildMonthlySql({ toDate: `'${endDate}'` }),

    // 指標5: 取得系の小規模テーブルの件数と鮮度
    freshness: `
select 'race_special_notes' as t, count(*)::int as n, max(scraped_at)::text as latest_time, max(race_date)::text as latest_date from race_special_notes
union all select 'racer_series_points', count(*)::int, max(scraped_at)::text, max(meet_start_date)::text from racer_series_points
union all select 'venue_entry_course_stats', count(*)::int, max(scraped_at)::text, max(stats_period_end)::text from venue_entry_course_stats
union all select 'venue_motor_stats', count(*)::int, max(scraped_date)::text, max(stats_period_end)::text from venue_motor_stats
union all select 'racer_profiles', count(*)::int, max(scraped_at)::text, max(official_updated_at)::text from racer_profiles
union all select 'racer_profiles.ability_index(非NULL)', count(ability_index)::int, null, null from racer_profiles
union all select 'race_notices_health', count(*)::int, max(last_checked_at)::text, max(check_date)::text from race_notices_health
union all select 'race_notices_health(had_success)', (count(*) filter (where had_success))::int, null, null from race_notices_health`,

    // 指標5補足: 主要テーブルの最新データ位置（PKのbtree末尾のみを読む軽量クエリ）
    latest: `
select 'races.race_date' as k, max(race_date)::text as v from races
union all select 'race_results.race_id', max(race_id) from race_results
union all select 'race_conditions.race_id', max(race_id) from race_conditions
union all select 'exhibition_data.race_id', max(race_id) from exhibition_data
union all select 'race_start_timings.race_id', max(race_id) from race_start_timings
union all select 'race_odds.race_id', max(race_id) from race_odds
union all select 'race_odds.captured_at(${endDate}以降)', max(captured_at)::text from race_odds where race_id >= '${endDate}'`,

    // 指標7: DBサイズ
    dbSize: `select pg_database_size(current_database())::bigint as bytes`,
    tableSizes: `
select c.relname as table_name, pg_total_relation_size(c.oid)::bigint as bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 2 desc limit 10`,
  };
}
