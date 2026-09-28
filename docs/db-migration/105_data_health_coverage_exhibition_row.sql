-- 105: data_health_coverage を CREATE OR REPLACE し、展示の「行の有無」の数え方を直す（BOA-500）
--
-- 背景:
--   BOA-500 で、展示航走の前でも当日体重・調整重量が公開されていれば exhibition_data の行を書くようにした
--   （scripts/lib/preRaceRows.js の buildExhibitionRows）。その結果、存在充足率の指標 exhibition_row を
--   「exhibition_data に行があるか」で数えたままだと、発走の前から行が書かれるため常に100%近くになり、
--   指標として意味を失う。
--
--   数え方を「展示の値がある行があるか」（exhibition_time か start_timing が非NULL）に変える。
--   展示タイムより先に展示STだけが公開される会場がある（鳴門・丸亀・児島・江戸川等。BOA-356）ため、
--   どちらか一方でもあれば「行あり」とする。指標 exhibition_time（exhibition_time が非NULLの艇が1件以上）は変えない。
--
-- 影響:
--   読み取りの集計関数の置き換えのみ。テーブル・データの変更は無い。
--   適用前は、旧い数え方（行の有無）のままで、exhibition_row が実態より高く出る（欠損を見逃す向きの誤りに
--   なりうるが、同じ期間を exhibition_time の指標が見ているため、取りこぼしそのものは検知できる）。
--
--   SQLの正本は scripts/lib/dataHealth/coverageSpec.js（buildCoverageSql）で、この本文はそこから生成した。
--   生成: node scripts/maintenance/render-data-health-functions.js data_health_coverage
--   npm run verify:data-health-job が、このファイルに生成結果が一字一句含まれることを機械検査する。
--
-- 確認（適用後）:
--   SELECT proname, prosecdef, provolatile FROM pg_proc WHERE proname = 'data_health_coverage';
--     -- prosecdef=false（SECURITY INVOKER）・provolatile='s'（STABLE）
--   SELECT has_function_privilege('anon', 'public.data_health_coverage(date, date)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('service_role', 'public.data_health_coverage(date, date)', 'EXECUTE');  -- true
--
-- ロールバック（必要な場合のみ）: 089_data_health_functions.sql の data_health_coverage を貼り直す

SET LOCAL lock_timeout = '10s';

-- data_health_coverage
CREATE OR REPLACE FUNCTION data_health_coverage(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_coverage: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
with o as (
  select x.race_id,
      bool_or((x.trifecta_all is not null and x.trifecta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.trio_all is not null and x.trio_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.exacta_all is not null and x.exacta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.quinella_all is not null and x.quinella_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)) and (x.wide_all is not null and x.wide_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_odds_all,
      bool_or((x.trifecta_all is not null and x.trifecta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_trifecta_all,
      bool_or((x.trio_all is not null and x.trio_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_trio_all,
      bool_or((x.exacta_all is not null and x.exacta_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_exacta_all,
      bool_or((x.quinella_all is not null and x.quinella_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_quinella_all,
      bool_or((x.wide_all is not null and x.wide_all not in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb))) as has_wide_all
  from race_odds x
  where x.race_id >= p_from::text and x.race_id < (p_to + 1)::text
  group by x.race_id
), fin as (
  select x.race_id, count(*) as n_rows, count(x.finish_mark) as n_mark,
      count(x.finish_rank) as n_fin, count(x.start_timing) as n_st_value
  from race_start_timings x
  where x.race_id >= p_from::text and x.race_id < (p_to + 1)::text
  group by x.race_id
), b as (
  select r.race_id, r.race_date,
      (r.cancellation_status is distinct from 'confirmed') as active,
      rr.rank1, rr.rank4, rr.rank5, rr.rank6, rr.actual_course_1, rr.winning_technique,
      (rr.rank1 is not null)::int + (rr.rank2 is not null)::int + (rr.rank3 is not null)::int
        + (rr.rank4 is not null)::int + (rr.rank5 is not null)::int + (rr.rank6 is not null)::int as n_ranked,
      rc.race_stage,
      coalesce(f.n_rows, 0) as n_st_rows,
      coalesce(f.n_st_value, 0) as n_st_value,
      coalesce(f.n_rows = 6 and f.n_mark = 6, false) as fin_known,
      f.n_fin,
      -- 「行の有無」ではなく「展示の値がある行の有無」で数える（BOA-500）。展示航走の前でも当日体重・
      -- 調整重量が公開されていれば行を書くようになったため、行の有無だと常に100%近くになり指標として意味を失う。
      -- 展示タイムより先に展示STだけが公開される会場がある（BOA-356）ので、どちらかがあれば「行あり」とする
      exists(select 1 from exhibition_data x where x.race_id = r.race_id
        and (x.exhibition_time is not null or x.start_timing is not null)) as has_exhibition_row,
      -- check-exhibition-gap-rate.js（BOA-356）と同じ基準: 1艇でも展示タイムが入っていれば取得済み
      (select count(*) from exhibition_data x where x.race_id = r.race_id and x.exhibition_time is not null) as n_exh_time,
      (o.race_id is not null) as has_odds,
      o.has_odds_all,
      o.has_trifecta_all, o.has_trio_all, o.has_exacta_all, o.has_quinella_all, o.has_wide_all
  from races r
  left join race_results rr on rr.race_id = r.race_id
  left join race_conditions rc on rc.race_id = r.race_id
  left join fin f on f.race_id = r.race_id
  left join o on o.race_id = r.race_id
  where r.race_date between p_from and p_to
), c as (
  select b.*,
      case
        when not active then null
        when fin_known and n_fin >= 4 then 'determined'
        when fin_known then 'le3'
        when rank1 is null then 'no_result'
        when rank4 is not null and rank5 is not null and rank6 is not null then 'full'
        else 'undetermined'
      end as rank_class
  from b
)
select race_date::text as d,
    count(*) as total,
    count(*) filter (where not active) as excluded,
    count(*) filter (where active) as denom,
    count(*) filter (where active and rank1 is not null) as result,
    -- rank4_6: 分子=順位が付くべき最大順位まで付いている（確定=完走艇数まで、未確定=rank4〜6がそろっている）
    count(*) filter (where rank_class in ('determined', 'full')) as rank_denom,
    count(*) filter (where rank_class = 'full'
        or (rank_class = 'determined' and rank4 is not null
            and (n_fin < 5 or rank5 is not null) and (n_fin < 6 or rank6 is not null))) as rank4_6,
    count(*) filter (where rank_class = 'determined') as rank_determined,
    count(*) filter (where rank_class = 'full') as rank_full,
    count(*) filter (where rank_class = 'le3') as rank_le3,
    count(*) filter (where rank_class = 'no_result') as rank_no_result,
    count(*) filter (where rank_class = 'undetermined') as rank_undetermined,
    -- 判定不能のうち、STと展示が5艇分以下（欠場艇がいる可能性が高い。非完走の目安であり確定ではない）
    count(*) filter (where rank_class = 'undetermined'
        and n_st_rows between 1 and 5 and n_exh_time between 1 and 5) as rank_undetermined_absent_hint,
    -- 参考（BOA-362）: 順位に非完走艇が入っている。確定=艇別の着欄で、完走艇数より多くの順位が付いている。
    -- 疑い=着欄を確定できないレースで6着まで付いているのに展示タイムが5艇分以下（欠場艇が着順に入っている可能性。展示の欠損も含む上限値）
    count(*) filter (where rank_class in ('determined', 'le3') and n_ranked > n_fin) as rank_polluted_confirmed,
    count(*) filter (where rank_class = 'full' and n_exh_time < 6) as rank_absent_suspect,
    count(*) filter (where active and rank4 is not null and rank5 is not null and rank6 is not null) as rank4_6_all_present,
    count(*) filter (where active and actual_course_1 is not null) as actual_course,
    count(*) filter (where active and winning_technique is not null) as winning_technique,
    count(*) filter (where active and race_stage is not null) as race_stage,
    count(*) filter (where active and n_st_rows > 0) as st_row,
    count(*) filter (where active and n_st_value > 0) as st_value,
    count(*) filter (where active and has_exhibition_row) as exhibition_row,
    count(*) filter (where active and n_exh_time > 0) as exhibition_time,
    count(*) filter (where active and has_odds) as odds,
    count(*) filter (where active and coalesce(has_odds_all, false)) as odds_all,
    count(*) filter (where active and coalesce(has_trifecta_all, false)) as trifecta_all,
    count(*) filter (where active and coalesce(has_trio_all, false)) as trio_all,
    count(*) filter (where active and coalesce(has_exacta_all, false)) as exacta_all,
    count(*) filter (where active and coalesce(has_quinella_all, false)) as quinella_all,
    count(*) filter (where active and coalesce(has_wide_all, false)) as wide_all
from c group by race_date order by race_date
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_coverage(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_coverage(date, date) TO service_role;
COMMENT ON FUNCTION data_health_coverage(date, date) IS 'データ健全性の日次監視: 存在充足率（結果・着順・実進入・決まり手・レース種別・ST・展示・オッズ・全券種オッズ）の日別集計。定義は scripts/lib/dataHealth/coverageSpec.js';
