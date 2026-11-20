/**
 * 空でないことを確認するテーブル（data_health_table_rows）。テーブルを足すときは、
 * マイグレーションで data_health_table_rows を CREATE OR REPLACE し、ここにも足す（一覧は関数の中にある）
 */
export const TABLE_ROWS_TABLES = Object.freeze([
  "races",
  "race_entries",
  "race_results",
  "race_conditions",
  "race_start_timings",
  "exhibition_data",
  "race_odds",
  "race_payouts",
  "racer_profiles",
  "racer_series_points",
  "venue_entry_course_stats",
  "venue_motor_stats",
  "external_predictions",
  "race_pit_reports",
  "race_special_notes",
  "race_series",
  "racer_period_stats",
]);

/**
 * 出走表の拡張列（マイグレーション081）。race_entries の行ごと・race_conditions のレースごとの、取得済みの件数。
 * 分母は、開催中止(confirmed)を除いたレースの出走行・レース。
 */
const preRaceFieldsSql = ({ fromDate, toDate }) => `
with e as (
  select r.race_date::text as d,
      count(*) as entries,
      count(*) filter (where x.weight_kg is not null) as weight_kg,
      count(*) filter (where x.f_count is not null) as f_count,
      count(*) filter (where x.l_count is not null) as l_count,
      count(*) filter (where x.branch is not null) as branch,
      count(*) filter (where x.is_absent is not null) as is_absent
  from races r
  join race_entries x on x.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date
), c as (
  select r.race_date::text as d,
      count(*) as races,
      count(*) filter (where x.race_distance_m is not null) as race_distance_m,
      count(*) filter (where x.race_labels is not null) as race_labels,
      count(*) filter (where x.series_day is not null) as series_day
  from races r
  left join race_conditions x on x.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date
)
select coalesce(e.d, c.d) as d,
    coalesce(e.entries, 0) as entries,
    coalesce(e.weight_kg, 0) as weight_kg,
    coalesce(e.f_count, 0) as f_count,
    coalesce(e.l_count, 0) as l_count,
    coalesce(e.branch, 0) as branch,
    coalesce(e.is_absent, 0) as is_absent,
    coalesce(c.races, 0) as races,
    coalesce(c.race_distance_m, 0) as race_distance_m,
    coalesce(c.race_labels, 0) as race_labels,
    coalesce(c.series_day, 0) as series_day
from e full join c on c.d = e.d
order by 1`;

/**
 * ピットレポート（選手コメント。マイグレーション085）。対象レース = SG（全レース）・G1・G2（7R以降）
 * （scripts/lib/pitReportRows.js の isPitReportCandidate と同じ規則）で、開催中止(confirmed)を除く。
 * with_report = race_pit_reports の行がある（公開済み・対象外のいずれかを、ページの表示で確認できた）。
 * 公開されないまま（行が無い）のレースが、欠損。
 */
const pitReportsSql = ({ fromDate, toDate }) => `
select r.race_date::text as d,
    count(*) as expected,
    count(*) filter (where p.race_id is not null) as with_report,
    count(*) filter (where p.status = 'published') as published
from races r
left join race_pit_reports p on p.race_id = r.race_id
where r.race_date between ${fromDate} and ${toDate}
  and r.cancellation_status is distinct from 'confirmed'
  and (r.race_grade = 'SG' or (r.race_grade in ('G1', 'G2') and r.race_number >= 7))
group by r.race_date
order by 1`;

/**
 * 節（race_series。マイグレーション084）。期待件数 = 開催があった会場×日、covered = その会場×日を含む節がある
 * （start_date <= race_date <= end_date）。節が取り込まれていない期間・会場が、欠損。
 */
const raceSeriesSql = ({ fromDate, toDate }) => `
select d,
    count(*) as expected,
    count(*) filter (where covered) as covered
from (
  select r.race_date::text as d, r.venue_code,
      bool_or(s.venue_code is not null) as covered
  from races r
  left join race_series s
    on s.venue_code = r.venue_code and r.race_date between s.start_date and s.end_date
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date, r.venue_code
) t
group by d
order by 1`;

/**
 * 選手の期別成績（racer_period_stats。マイグレーション083）。期待件数 = その日に出走する選手（登録番号）の数、
 * with_stats = いずれかの期の成績がある選手。新人（期別成績の公開前）は欠損に数える（公開は最大約2か月遅れる）。
 */
const racerPeriodStatsSql = ({ fromDate, toDate }) => `
with s as (
  select distinct racer_id from racer_period_stats
)
select r.race_date::text as d,
    count(distinct e.racer_id) as expected,
    count(distinct e.racer_id) filter (where s.racer_id is not null) as with_stats
from races r
join race_entries e on e.race_id = r.race_id
left join s on s.racer_id = e.racer_id
where r.race_date between ${fromDate} and ${toDate}
  and r.cancellation_status is distinct from 'confirmed'
  and e.racer_id is not null
group by r.race_date
order by 1`;

/** 空でないことを確認するテーブルごとの「行があるか」（exists は、先頭の1行を見つけた時点で終わる） */
const tableRowsSql = () => `
select jsonb_build_object(
${TABLE_ROWS_TABLES.map((t) => `  '${t}', exists (select 1 from ${t})`).join(",\n")}
) as o`;

/**
 * 出走表の複製検知（BOA-422・BOA-423）。同じ会場・同じレース番号で、直近21日以内の別の日と
 * 「艇番→登録番号」の組み合わせが完全一致するレースを、出走表が過去日のデータで汚染された疑いとして数える。
 *
 * 除外（誤検知を避ける）:
 *   - 開催中止(confirmed)のレースは、複製元・複製先のどちらからも外す（順延は、前日の出走表がそのまま
 *     翌日の同じ節で使われるため、正常に完全一致する）
 *   - 結果(race_results)が無いレースも、両側から外す（順延の空スタブ・未確定）
 *   - 1レースだけの一致は数えない（同じ節の別日に、同じ6人が同じ枠で再度組まれることが実際にある。
 *     2026-01-22 常滑 R6 が実例で、公式Bファイルでも一致が正しい）。汚染は必ず複数レースにまたがる
 *
 * 期待件数（分母）= その日の会場×日、clean（分子）= 複製の疑いが無い会場×日。
 */
const entriesDuplicatesSql = ({ fromDate, toDate }) => `
with win as (
  select r.race_id, r.race_date, r.venue_code, r.race_number,
      exists (select 1 from race_results rr where rr.race_id = r.race_id) as has_result,
      md5(string_agg(e.boat_number::text || ':' || coalesce(e.racer_id::text, '-'), ',' order by e.boat_number)) as sig
  from races r
  join race_entries e on e.race_id = r.race_id
  where r.race_date between (${fromDate} - 21) and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_id, r.race_date, r.venue_code, r.race_number
), dup as (
  select a.race_date, a.venue_code, a.race_number
  from win a
  join win b on b.venue_code = a.venue_code and b.race_number = a.race_number
    and b.race_date < a.race_date and a.race_date - b.race_date <= 21
    and b.sig = a.sig and b.has_result
  where a.race_date between ${fromDate} and ${toDate} and a.has_result
  group by a.race_date, a.venue_code, a.race_number
), flagged as (
  select race_date, venue_code
  from dup group by race_date, venue_code having count(*) >= 2
), base as (
  select r.race_date, r.venue_code
  from races r
  join race_entries e on e.race_id = r.race_id
  where r.race_date between ${fromDate} and ${toDate}
    and r.cancellation_status is distinct from 'confirmed'
  group by r.race_date, r.venue_code
)
select b.race_date::text as d,
    count(*) as venue_days,
    count(*) filter (where f.venue_code is null) as clean_venue_days
from base b
left join flagged f on f.race_date = b.race_date and f.venue_code = b.venue_code
group by b.race_date
order by 1`;

/**
 * 中止の誤検出（BOA-512）: 確定中止（cancellation_status='confirmed'）なのに、着順（rank1）のある結果が入っている
 * レースを日別に数える。確定中止は「開催されなかった」ことを表すため、原理的に0件のはず。2026-09-12に、結果の
 * 読み取りの一過性の失敗で「結果のあるレースを除く」ガードが外れ、32本が誤って confirmed になった（原因は PR #743 で
 * 修正済み）。race_results は race_id が主キーのため、LEFT JOIN で行は増えない。結果の行があっても rank1 が NULL
 * （中止・返還の行。マイグレーション078）は結果なしとして扱う。
 * consistent_races = races − confirmed_with_result（NULL を含む論理式の否定で数えると、cancellation_status が NULL の
 * 行を取りこぼすため、引き算で出す）
 */
const cancellationWithResultSql = ({ fromDate, toDate }) => `
select r.race_date::text as d,
    count(*) as races,
    count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as confirmed_with_result,
    count(*) - count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as consistent_races
from races r
left join race_results rr on rr.race_id = r.race_id
where r.race_date between ${fromDate} and ${toDate}
group by r.race_date
order by 1`;

/**
 * @typedef {Object} DataHealthFunction
 * @property {string} name 関数名（public スキーマ）
 * @property {Array<{name: string, type: "date"}>} args 引数
 * @property {"rows"|"object"} shape
 * @property {string} description COMMENT ON FUNCTION の内容（1行）
 * @property {string} migration DDLを含むマイグレーションのファイル名
 * @property {(slots: {fromKey: string, toKeyExclusive: string, fromDate: string, toDate: string}) => string} body 固定のSELECT
 * @property {string} [orderColumn] rows の並び順の列（既定 d）
 * @property {ReadonlyArray<FreshnessItem>} [items] 鮮度の関数の項目（checks.js の freshness の items が参照する）
 */

const FROM_TO = Object.freeze([
  { name: "p_from", type: "date" },
  { name: "p_to", type: "date" },
]);

export {
  preRaceFieldsSql,
  pitReportsSql,
  raceSeriesSql,
  racerPeriodStatsSql,
  tableRowsSql,
  entriesDuplicatesSql,
  cancellationWithResultSql,
  FROM_TO,
};
