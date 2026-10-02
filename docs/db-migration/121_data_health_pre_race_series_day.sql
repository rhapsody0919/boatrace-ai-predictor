-- 121: data_health_pre_race_fields を CREATE OR REPLACE し、日目（race_conditions.series_day）の件数を返す（BOA-510）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 背景:
--   BOA-501（PR #911）で、日目（race_conditions.series_day）が埋まらない事象（10,115レースが NULL）を
--   race_series からの導出で直した。原因側（race_series に行が無い会場×日）は race_series.covered が見ているが、
--   症状側（series_day の充足率）はどの監視項目も見ていない。
--   監視項目 pre_race.series_day を checks.js に足す前に、この関数が series_day を返している必要がある
--   （返さないうちに足すと、evaluate.js が欠けた列を 0 と読み、充足率0%の誤報が毎日鳴る）。そのため、
--   この関数の置き換えを先に本番へ適用し、監視項目は適用後の別 PR で足す（BOA-510 の手順）。
--
-- 影響:
--   読み取りの集計関数の置き換えのみ（返す JSON に series_day が1列増える）。テーブル・データの変更は無い。
--   既存の列（entries・weight_kg 等）の値は変わらない。
--
--   SQLの正本は scripts/lib/dataHealth/functions.js（preRaceFieldsSql）で、この本文はそこから生成した。
--   生成: node scripts/maintenance/render-data-health-functions.js data_health_pre_race_fields
--   npm run verify:data-health-job が、このファイルに生成結果が一字一句含まれることを機械検査する。
--
-- 確認（適用後）:
--   SELECT proname, prosecdef, provolatile FROM pg_proc WHERE proname = 'data_health_pre_race_fields';
--     -- prosecdef=false（SECURITY INVOKER）・provolatile='s'（STABLE）
--   SELECT has_function_privilege('anon', 'public.data_health_pre_race_fields(date, date)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('service_role', 'public.data_health_pre_race_fields(date, date)', 'EXECUTE');  -- true
--   SELECT jsonb_array_length(data_health_pre_race_fields('2026-09-21', '2026-09-27')) AS days,
--          data_health_pre_race_fields('2026-09-21', '2026-09-27')->0 ? 'series_day' AS has_series_day;
--     -- days=7・has_series_day=true
--
-- ロールバック（必要な場合のみ）: 089_data_health_functions.sql の data_health_pre_race_fields を貼り直す
-- data_health_pre_race_fields
CREATE OR REPLACE FUNCTION data_health_pre_race_fields(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_pre_race_fields: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
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
  where r.race_date between p_from and p_to
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
  where r.race_date between p_from and p_to
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
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_pre_race_fields(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_pre_race_fields(date, date) TO service_role;
COMMENT ON FUNCTION data_health_pre_race_fields(date, date) IS 'データ健全性の日次監視: 出走表の拡張列（081。登録体重・支部・F数・L数・欠場・距離・ラベル）と日目（series_day）の取得済み件数';
