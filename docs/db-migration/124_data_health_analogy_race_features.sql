-- 124: data-health の日次監視に、レースごとの寄与度の特徴量（analogy_race_features、123）の充足率を足す（BOA-271 B）
-- 対応spec/plan: docs/design/analogy-finder/plan.md（「学習側の設計」の監視）
--
-- 関数（SQL の正本は scripts/lib/dataHealth/functions.js。render-data-health-functions.js で生成して貼った）
--   data_health_analogy_race_features(p_from, p_to)  出走行（開催中止を除く）のうち、特徴量の行がある数。service_role のみ
--   data_health_table_rows()                         空テーブルの検知の対象に analogy_race_features を足す（CREATE OR REPLACE）
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う。123 の後に適用する（analogy_race_features を参照する）。
--   読み取りの集計関数の追加・置き換えだけで、表は書き換えない。

BEGIN;

-- data_health_analogy_race_features
CREATE OR REPLACE FUNCTION data_health_analogy_race_features(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'data_health_analogy_race_features: 期間が不正です（from <= to、最大32日）: % 〜 %', p_from, p_to;
  END IF;
  RETURN (
    select coalesce(jsonb_agg(to_jsonb(q) order by q.d), '[]'::jsonb)
    from (
select r.race_date::text as d,
    count(*) as expected,
    count(f.race_id) as with_features
from races r
join race_entries e on e.race_id = r.race_id
left join analogy_race_features f on f.race_id = e.race_id and f.boat_number = e.boat_number
where r.race_date between p_from and p_to
  and r.cancellation_status is distinct from 'confirmed'
group by r.race_date
order by 1
    ) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_analogy_race_features(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_analogy_race_features(date, date) TO service_role;
COMMENT ON FUNCTION data_health_analogy_race_features(date, date) IS 'データ健全性の日次監視: 出走行のうち、レースごとの寄与度の特徴量（analogy_race_features、123）がある行の数';

-- data_health_table_rows
CREATE OR REPLACE FUNCTION data_health_table_rows()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  RETURN (
    select q.o from (
select jsonb_build_object(
  'races', exists (select 1 from races),
  'race_entries', exists (select 1 from race_entries),
  'race_results', exists (select 1 from race_results),
  'race_conditions', exists (select 1 from race_conditions),
  'race_start_timings', exists (select 1 from race_start_timings),
  'exhibition_data', exists (select 1 from exhibition_data),
  'race_odds', exists (select 1 from race_odds),
  'race_payouts', exists (select 1 from race_payouts),
  'racer_profiles', exists (select 1 from racer_profiles),
  'racer_series_points', exists (select 1 from racer_series_points),
  'venue_entry_course_stats', exists (select 1 from venue_entry_course_stats),
  'venue_motor_stats', exists (select 1 from venue_motor_stats),
  'external_predictions', exists (select 1 from external_predictions),
  'race_pit_reports', exists (select 1 from race_pit_reports),
  'race_special_notes', exists (select 1 from race_special_notes),
  'race_series', exists (select 1 from race_series),
  'racer_period_stats', exists (select 1 from racer_period_stats),
  'analogy_race_features', exists (select 1 from analogy_race_features)
) as o
) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_table_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_table_rows() TO service_role;
COMMENT ON FUNCTION data_health_table_rows() IS 'データ健全性の日次監視: 主要テーブルに1行以上あるか（空テーブルの検知）。対象テーブルは関数の中の固定の一覧';

COMMIT;

-- 確認（service_role で）:
--   select data_health_table_rows() ? 'analogy_race_features';                       -- t
--   select data_health_analogy_race_features(current_date - 1, current_date - 1);     -- [{d, expected, with_features}]
