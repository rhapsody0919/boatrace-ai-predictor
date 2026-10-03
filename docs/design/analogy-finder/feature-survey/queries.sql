-- BOA-271 特徴量候補の置き場所・埋まり具合調査（2026-10-03、本番 SELECT のみ、Supabase MCP execute_sql）

-- Q1 列の一覧
select table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position) cols
from information_schema.columns where table_schema='public'
  and table_name in ('races','race_entries','exhibition_data','race_conditions','race_start_timings',
    'race_results','racer_period_stats','racer_profiles','racer_series_points','motor_pretest_stats',
    'race_pit_reports','race_special_notes','race_series','kb_archive_boats','venue_entry_course_stats',
    'race_original_exhibition','race_original_exhibition_values')
group by table_name;

-- Q2 本体: 出走表・直前情報の列の月別欠損率（艇単位）
select to_char(r.race_date,'YYYY-MM') ym, count(*) boats,
 round(100.0*avg((e.f_count is null)::int),1) f_null,
 round(100.0*avg((e.l_count is null)::int),1) l_null,
 round(100.0*avg((e.f_count>0)::int),1) f_pos,
 round(100.0*avg((e.global_3rate is null)::int),1) g3_null,
 round(100.0*avg((x.race_id is null)::int),1) exh_row_null,
 round(100.0*avg((x.start_timing is null)::int),1) exst_null,
 round(100.0*avg((x.exhibition_course is null)::int),1) excourse_null,
 round(100.0*avg((x.tilt is null)::int),1) tilt_null,
 round(100.0*avg((x.parts_changed is null)::int),1) parts_null,
 round(100.0*avg((coalesce(array_length(x.parts_changed,1),0)>0)::int),1) parts_pos,
 round(100.0*avg((x.propeller_change is null)::int),1) prop_null,
 round(100.0*avg((x.exhibition_time is null)::int),1) ext_null
from races r join race_entries e on e.race_id=r.race_id
left join exhibition_data x on x.race_id=e.race_id and x.boat_number=e.boat_number
group by 1 order by 1;

-- Q3 本体: 2026-08-25 以降の日別（開始日の特定）
select r.race_date, count(*) n,
 round(100.0*avg((e.f_count is null)::int),1) f_null,
 round(100.0*avg((x.tilt is null)::int),1) tilt_null,
 round(100.0*avg((x.exhibition_course is null)::int),1) excourse_null,
 round(100.0*avg((x.parts_changed is null)::int),1) parts_null,
 round(100.0*avg((x.parts_changed = '{}')::int),1) parts_empty,
 round(100.0*avg((x.adjustment_weight is null)::int),1) adjw_null,
 round(100.0*avg((x.prev_finish_rank is null)::int),1) prevrank_null
from races r join race_entries e on e.race_id=r.race_id
left join exhibition_data x on x.race_id=e.race_id and x.boat_number=e.boat_number
where r.race_date >= '2026-08-25' group by 1 order by 1;

-- Q4 本体: 気温・水温・オリジナル展示・ピットレポートの月別（レース単位）
select to_char(r.race_date,'YYYY-MM') ym, count(*) races,
 round(100.0*avg((c.race_id is null)::int),1) cond_row_null,
 round(100.0*avg((c.temperature is null)::int),1) temp_null,
 round(100.0*avg((c.water_temperature is null)::int),1) wtemp_null,
 round(100.0*avg((c.weather_observed_at is null)::int),1) obs_null,
 round(100.0*avg((o.race_id is null)::int),1) oe_row_null,
 round(100.0*avg((o.measure_status is not null and o.item_count>0)::int),1) oe_has_items,
 round(100.0*avg((p.race_id is null)::int),1) pit_null
from races r left join race_conditions c on c.race_id=r.race_id
left join race_original_exhibition o on o.race_id=r.race_id
left join race_pit_reports p on p.race_id=r.race_id
group by 1 order by 1;

-- Q5 オリジナル展示の開始日・項目
select min(substr(race_id,1,10)) first_day, count(distinct race_id) races,
 (select string_agg(distinct kind, ',') from race_original_exhibition_values) kinds,
 (select string_agg(distinct item_labels, ' | ') from race_original_exhibition) labels
from race_original_exhibition where item_count>0;

-- Q6 補助テーブルの期間
select 'pretest' t, min(race_date)::text a, max(race_date)::text b, count(*) n, count(distinct (race_date,venue_code)) days from motor_pretest_stats
union all select 'series_points', min(meet_start_date)::text, max(meet_start_date)::text, count(*), count(distinct (venue_code,meet_start_date)) from racer_series_points
union all select 'venue_entry_course', min(substr(race_id,1,10)), max(substr(race_id,1,10)), count(*), count(distinct race_id) from venue_entry_course_stats
union all select 'racer_period', min(period_year||'-'||period_no), max(period_year||'-'||period_no), count(*), count(distinct racer_id) from racer_period_stats
union all select 'special_notes', min(race_date)::text, max(race_date)::text, count(*), count(distinct category) from race_special_notes
union all select 'race_series', min(start_date)::text, max(start_date)::text, count(*), 0 from race_series
union all select 'kb_boats_course', min(substr(race_id,1,10)), max(substr(race_id,1,10)), count(*) filter (where course is null), count(*) from kb_archive_boats;

-- Q7 前検タイム: 選手×会場で節内（7日以内）に行があるか（艇単位の欠損率）
with e as (select r.race_date, r.venue_code, e.racer_id from races r join race_entries e using(race_id) where e.racer_id is not null)
select to_char(e.race_date,'YYYY-MM') ym, count(*) n,
 round(100.0*avg((not exists (select 1 from motor_pretest_stats p where p.racer_id=e.racer_id and p.venue_code=e.venue_code
   and p.race_date between e.race_date-7 and e.race_date and p.pretest_time is not null))::int),1) miss
from e group by 1 order by 1;

-- Q8 ファン手帳（期別成績）の期ごと
select period_year, period_no, min(calc_from) cf, max(calc_to) ct, count(*) racers,
 round(100.0*avg((c1_entries is null)::int),1) c1_null, round(100.0*avg((grade_prev is null)::int),1) gp_null,
 round(100.0*avg((avg_st is null)::int),1) st_null, min(source_file) src
from racer_period_stats group by 1,2 order by 1,2;

-- Q9 長期: kb_archive_boats の月別欠損率と枠なり外れ率
select substr(race_id,1,7) ym, count(*) n,
 round(100.0*avg((course is null)::int),2) course_null,
 round(100.0*avg((start_timing is null)::int),2) st_null,
 round(100.0*avg((exhibition_time is null)::int),2) ext_null,
 round(100.0*avg((finish_rank is null)::int),2) fr_null,
 round(100.0*avg((course is not null and course<>boat_number)::int),2) waku_nare
from kb_archive_boats group by 1 order by 1;

-- Q10 本体: 結果側の進入コース・着の月別
select to_char(r.race_date,'YYYY-MM') ym, count(*) n,
 round(100.0*avg((s.race_id is null)::int),1) st_row_null,
 round(100.0*avg((s.entry_course is null)::int),1) ec_null,
 round(100.0*avg((s.start_timing is null)::int),1) st_null,
 round(100.0*avg((s.finish_rank is null)::int),1) fr_null,
 round(100.0*avg((s.race_seconds is null)::int),1) sec_null,
 round(100.0*avg((x.prev_finish_rank is not null)::int),1) prev_rank_has
from races r join race_entries e using(race_id)
left join race_start_timings s on s.race_id=e.race_id and s.boat_number=e.boat_number
left join exhibition_data x on x.race_id=e.race_id and x.boat_number=e.boat_number
where r.cancellation_status is null group by 1 order by 1;

select to_char(r.race_date,'YYYY-MM') ym, count(*) races,
 round(100.0*avg((rr.race_id is null)::int),1) res_null,
 round(100.0*avg((rr.course_1 is null)::int),1) course1_null,
 round(100.0*avg((rr.actual_course_1 is null)::int),1) actual1_null,
 round(100.0*avg((rr.rank1 is null)::int),1) rank1_null,
 round(100.0*avg((rr.winning_technique is null)::int),1) tech_null
from races r left join race_results rr using(race_id) where r.cancellation_status is null group by 1 order by 1;

-- Q11 F数・L数を過去の結果から作り直せるか（出走表の f_count との一致、期首=5/1）
with fl as (
  select e.racer_id, r.race_date, s.is_flying, s.is_late_start from race_start_timings s
  join race_entries e on e.race_id=s.race_id and e.boat_number=s.boat_number join races r on r.race_id=s.race_id
  where r.race_date >= '2026-05-01' and (s.is_flying or s.is_late_start)),
tgt as (
  select distinct on (e.racer_id) e.racer_id, r.race_date, e.f_count, e.l_count from race_entries e join races r using(race_id)
  where r.race_date between '2026-09-23' and '2026-10-03' and e.f_count is not null and e.racer_id is not null
  order by e.racer_id, r.race_date),
calc as (
  select t.*, coalesce(sum((f.is_flying)::int) filter (where f.race_date < t.race_date),0) f_rec,
         coalesce(sum((f.is_late_start)::int) filter (where f.race_date < t.race_date),0) l_rec
  from tgt t left join fl f on f.racer_id=t.racer_id group by t.racer_id, t.race_date, t.f_count, t.l_count)
select count(*) n, round(100.0*avg((f_rec=f_count)::int),1) f_match, round(100.0*avg((f_rec>f_count)::int),1) f_rec_more,
 round(100.0*avg((f_rec<f_count)::int),1) f_rec_less, round(100.0*avg((l_rec=l_count)::int),1) l_match,
 sum((f_count>0)::int) f_pos, sum((f_rec>0)::int) frec_pos
from calc;

-- Q12 節の日目（今節成績の節の区切り）
select substr(race_date::text,1,4) y, count(*) vd, round(100.0*avg((series_day is null)::int),2) sd_null,
 round(100.0*avg((race_grade is null)::int),2) grade_null, round(100.0*avg((has_b)::int),2) has_b
from kb_archive_venue_days group by 1 order by 1;
select to_char(r.race_date,'YYYY-MM') ym, round(100.0*avg((c.series_day is null)::int),1) sd_null
from races r left join race_conditions c using(race_id) group by 1 order by 1;

-- Q13 racer_profiles（静的属性）の網羅
select count(*) n, round(100.0*avg((sex is null)::int),1) sex_null, round(100.0*avg((birth_date is null)::int),1) bd_null,
 round(100.0*avg((height_cm is null)::int),1) h_null,
 (select round(100.0*avg((p.racer_id is null)::int),2) from (select distinct racer_id from kb_archive_boats where racer_id is not null) k
   left join racer_profiles p using(racer_id)) kb_racer_missing
from racer_profiles;

-- Q14 母集団の件数（結果のあるレース）
select 'kb' src, count(*) filter (where has_result) races from kb_archive_races
union all select 'main_all', count(*) from races r join race_results rr using(race_id) where r.cancellation_status is null and rr.rank1 is not null and not coalesce(rr.is_no_race,false)
union all select 'main_from_0914', count(*) from races r join race_results rr using(race_id) where r.race_date>='2026-09-14' and r.cancellation_status is null and rr.rank1 is not null
union all select 'main_from_0922', count(*) from races r join race_results rr using(race_id) where r.race_date>='2026-09-22' and r.cancellation_status is null and rr.rank1 is not null
union all select 'main_from_0301', count(*) from races r join race_results rr using(race_id) where r.race_date>='2026-03-01' and r.cancellation_status is null and rr.rank1 is not null
union all select 'main_from_0201', count(*) from races r join race_results rr using(race_id) where r.race_date>='2026-02-01' and r.cancellation_status is null and rr.rank1 is not null;
