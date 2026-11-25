-- 207: data_health の夜の鮮度に Search Console の日別（growth_gsc_daily）を足す
--
-- 背景: 2026-11-24、growth-gsc-daily.yml が鍵の欠けで落ち続け、表 growth_gsc_daily が空のままだった。job-watch の鍵の
--   Issue はカナリア（範囲外の鍵を見ない）が緑で自動で閉じ、data_health は growth-gsc-daily.yml を watched_elsewhere で
--   外していたため、誰も気づかなかった（設計 SEO・GEO・AIO のデータの輪 §6 の直し3。案 docs/design/seo-data-loop/
--   db-draft-data-health-growth.md）。表の側から「取れた日が進んでいるか」を見る。
--
-- 実装: scripts/lib/dataHealth/freshnessSql.js（NIGHTLY_FRESHNESS_ITEMS に growth_gsc_daily）・checks.js（nightly.growth_gsc）・
--   workflowCoverage.js（growth-gsc-daily.yml を除外から外す）。下の関数は
--   `node scripts/maintenance/render-data-health-functions.js data_health_nightly_freshness` の出力（手で書き写さない）。
--
-- 判定: GSC は PT の日付で2〜3日遅れ、毎日 JST 10 時台に直近7日を取り直す。06:35 JST の評価（p_to = 前日）で
--   max(date) + 2 >= p_to - 1（= max(date) が4日前以降）。余裕の日数は目安・根拠なし（11/25 の max(date) は前々日）。
--
-- 変更: CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（読み取りの関数。表・データは変えない。ロックなし・冪等）。
--   170 の data_health_nightly_freshness を上書きする。
--
-- 適用の前提: lib の差分が master に入っていること（db-apply は master の SQL を当てる）。適用までの 06:35 JST の実行では
--   関数が growth_gsc_daily の項目を返さない。
-- 適用後の確認（読み取りのみ）:
--   SELECT data_health_nightly_freshness(current_date - 1) -> 'growth_gsc_daily';   -- ok が true
--   SELECT has_function_privilege('anon', 'data_health_nightly_freshness(date)', 'EXECUTE');  -- false
-- 戻し: `node scripts/maintenance/render-data-health-functions.js --migration 170_data_health_freshness.sql` の
--   data_health_nightly_freshness を当て直し、lib の差分を revert する。

-- data_health_nightly_freshness
CREATE OR REPLACE FUNCTION data_health_nightly_freshness(p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_to IS NULL THEN
    RAISE EXCEPTION 'data_health_nightly_freshness: p_to が NULL です';
  END IF;
  RETURN (
    select q.o from (
with w as (
  select ((p_to::date + time '21:00') at time zone 'Asia/Tokyo') as since
), y as (
  select
    exists (
      select 1 from races r join race_results rr on rr.race_id = r.race_id
      where r.race_date = p_to::date and r.cancellation_status is distinct from 'confirmed' and rr.rank1 is not null
    ) as had_results,
    exists (
      select 1 from bet_recommendations b
      join races r on r.race_id = b.race_id
      join race_results rr on rr.race_id = b.race_id
      where r.race_date = p_to::date and b.model_id = 'moriarty' and b.recommendation <> 'skip' and rr.rank1 is not null
    ) as had_moriarty_bets,
    exists (
      select 1 from races r join race_conditions c on c.race_id = r.race_id
      where r.race_date = p_to::date and r.race_grade in ('SG', 'G1') and c.series_day >= 4
        and r.cancellation_status is distinct from 'confirmed'
    ) as had_point_rank
)
select jsonb_build_object(
  'outcome_distribution', jsonb_build_object('applicable', true, 'ok', coalesce((select max(created_at) from outcome_distribution) >= (select since from w), false), 'observed', (select max(created_at) from outcome_distribution)),
  'exhibition_time_top_stats', jsonb_build_object('applicable', true, 'ok', coalesce((select max(created_at) from exhibition_time_top_stats) >= (select since from w), false), 'observed', (select max(created_at) from exhibition_time_top_stats)),
  'losing_technique_stats', jsonb_build_object('applicable', true, 'ok', coalesce((select max(created_at) from losing_technique_stats) >= (select since from w), false), 'observed', (select max(created_at) from losing_technique_stats)),
  'nige_outcome_distribution', jsonb_build_object('applicable', true, 'ok', coalesce((select max(created_at) from nige_outcome_distribution) >= (select since from w), false), 'observed', (select max(created_at) from nige_outcome_distribution)),
  'winning_technique_stats', jsonb_build_object('applicable', true, 'ok', coalesce((select max(created_at) from winning_technique_stats) >= (select since from w), false), 'observed', (select max(created_at) from winning_technique_stats)),
  'top_start_stats', jsonb_build_object('applicable', true, 'ok', coalesce((select max(created_at) from top_start_stats) >= (select since from w), false), 'observed', (select max(created_at) from top_start_stats)),
  'venue_technique_period_stats', jsonb_build_object('applicable', true, 'ok', coalesce((select max(last_updated) from venue_technique_period_stats) >= p_to::date + 1, false), 'observed', (select max(last_updated) from venue_technique_period_stats)),
  'st_course_baseline', jsonb_build_object('applicable', y.had_results, 'ok', coalesce((select max(window_end) from st_course_baseline) >= p_to::date - 1, false), 'observed', (select max(window_end) from st_course_baseline)),
  'nige_second_by_course', jsonb_build_object('applicable', y.had_results, 'ok', coalesce((select max(window_end) from nige_second_by_course) >= p_to::date - 1, false), 'observed', (select max(window_end) from nige_second_by_course)),
  'growth_gsc_daily', jsonb_build_object('applicable', true, 'ok', coalesce((select max(date) + 2 from growth_gsc_daily) >= p_to::date - 1, false), 'observed', (select max(date) + 2 from growth_gsc_daily)),
  'accuracy_summary', jsonb_build_object('applicable', true, 'ok', coalesce((select max(updated_at) from accuracy_cache where key = 'accuracy_summary') >= (select since from w), false), 'observed', (select max(updated_at) from accuracy_cache where key = 'accuracy_summary')),
  'unified_model_accuracy', jsonb_build_object('applicable', true, 'ok', coalesce((select max(updated_at) from accuracy_cache where key = 'unified_model_accuracy') >= (select since from w), false), 'observed', (select max(updated_at) from accuracy_cache where key = 'unified_model_accuracy')),
  'unified_volatility_accuracy', jsonb_build_object('applicable', true, 'ok', coalesce((select max(updated_at) from accuracy_cache where key = 'unified_volatility_accuracy') >= (select since from w), false), 'observed', (select max(updated_at) from accuracy_cache where key = 'unified_volatility_accuracy')),
  'race_history_cache', jsonb_build_object('applicable', true, 'ok', coalesce((select max(updated_at) from race_history_cache) >= (select since from w), false), 'observed', (select max(updated_at) from race_history_cache)),
  'racer_grade_cache', jsonb_build_object('applicable', true, 'ok', coalesce((select max(updated_at) from racer_grade_cache) >= (select since from w), false), 'observed', (select max(updated_at) from racer_grade_cache)),
  'model_performance_daily', jsonb_build_object('applicable', y.had_moriarty_bets, 'ok', coalesce((select max(date) from model_performance_daily where model_id = 'moriarty') >= p_to::date, false), 'observed', (select max(date) from model_performance_daily where model_id = 'moriarty')),
  'racer_series_points', jsonb_build_object('applicable', y.had_point_rank, 'ok', coalesce((select max(scraped_at) from racer_series_points) >= (select since from w), false), 'observed', (select max(scraped_at) from racer_series_points)),
  'venues', jsonb_build_object('applicable', true, 'ok', coalesce((select max(updated_at) from venues) >= (select since from w), false), 'observed', (select max(updated_at) from venues)),
  'racer_aggregated_stats', jsonb_build_object('applicable', y.had_results, 'ok', coalesce((select max(calculated_at) from racer_aggregated_stats) >= (select since from w), false), 'observed', (select max(calculated_at) from racer_aggregated_stats)),
  'venue_grade_boat_stats', jsonb_build_object('applicable', y.had_results, 'ok', coalesce((select max(updated_at) from venue_grade_boat_stats) >= (select since from w), false), 'observed', (select max(updated_at) from venue_grade_boat_stats))
) || jsonb_build_object('_since', (select since from w)) as o
from y
) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_nightly_freshness(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_nightly_freshness(date) TO service_role;
COMMENT ON FUNCTION data_health_nightly_freshness(date) IS 'データ健全性の日次監視: 夜の集計（前日22時〜当日1時 JST）が書く表の鮮度（最終の更新時刻・日付が締めまでに進んだか）。p_to は前日。項目は scripts/lib/dataHealth/functions.js の NIGHTLY_FRESHNESS_ITEMS';
