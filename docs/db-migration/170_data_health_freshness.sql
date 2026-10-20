-- 170: 夜の集計・朝の生成の鮮度を見る、日次監視の集計関数2つと、朝の監視ジョブのモードの行
--
-- 背景: 2026-10-20 朝、Environment prod-jobs の SUPABASE の鍵の値が誤っていて、定期の job 15本（夜の集計など）と
--   龍神ソナーの朝のバッチが Invalid API key で落ちた。画面は前日のまま、/today も出なかったが、誰も気づかなかった。
--   job の失敗の見張り（job-watch.yml）とは別に、画面が読む表の側から「締めまでに書かれたか」を見る
--   （~/hq/drafts/site-freshness-watch-20261020.md v2 の項目2）。
--
-- 実装: scripts/lib/dataHealth/functions.js（SQLの正本。NIGHTLY_FRESHNESS_ITEMS・MORNING_FRESHNESS_ITEMS）・
--   checks.js（登録表の nightly.*・morning.*）・job.js（data_health と data_health_morning）
--
--   data_health_nightly_freshness(p_to)  p_to=前日。夜の集計11本が書く表の、最終の更新時刻（前日 21:00 JST 以降か）・
--                                        集計の終端日・日付の行。data_health（06:35 JST）が呼ぶ
--   data_health_morning_freshness(p_to)  p_to=当日。龍神ソナー（出走表の段）・ポアロ・モリアーティの当日の件数。
--                                        data_health_morning（07:55 JST）が呼ぶ
--
-- テーブル・データの変更: scrape_job_state の job='data_health_morning' の行の mode を、今の data_health と同じ値にする
--   （data_health の行が無ければ何もしない＝off）。行が無ければ作る。行があっても、共通ラッパが作っただけで一度も動いて
--   いない off の行（last_success_at・last_tick_at が NULL）なら上書きする。それ以外の行（手で off・shadow にした等）は
--   変えない。ほかは CREATE OR REPLACE FUNCTION・REVOKE・GRANT・COMMENT のみ（読み取りの関数。ロックなし）。
--   再適用しても失敗しない（冪等）。
--
-- 適用の順序: db-apply は master の SQL を当てるので、コード（PR）のデプロイが先になる。
--   - data_health: 適用までの 06:35 の実行で、関数が無いため「検査を実行できませんでした」が1回通知される
--     （同じ状態が続いても毎日は通知しない。適用後の最初の実行で消える）
--   - data_health_morning: 適用までに 07:55・08:55 の cron が動くと、共通ラッパが off の行を作って何もしない。
--     この SQL がその行を data_health と同じ mode に上書きする
--   - SQL Editor で先に当てた場合: 古いコードはレジストリに無いジョブを見ないので、何も起きない
--
-- 適用後の確認（読み取りのみ）:
--   SELECT data_health_nightly_freshness(current_date - 1);
--     -> 19項目（outcome_distribution 〜 venue_technique_period_stats）と _since。夜の集計が動いた翌朝は、
--        applicable=true の項目が全て ok=true
--   SELECT data_health_morning_freshness(current_date);
--     -> 07:50 JST 以降は sonar_racecard の observed > 0
--   SELECT job, mode FROM scrape_job_state WHERE job IN ('data_health', 'data_health_morning');
--     -> 2行とも同じ mode
--   SELECT has_function_privilege('anon', 'data_health_nightly_freshness(date)', 'EXECUTE');  -> false

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

-- data_health_morning_freshness
CREATE OR REPLACE FUNCTION data_health_morning_freshness(p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
SET statement_timeout = '60s'
AS $data_health$
BEGIN
  IF p_to IS NULL THEN
    RAISE EXCEPTION 'data_health_morning_freshness: p_to が NULL です';
  END IF;
  RETURN (
    select q.o from (
with t as (
  select race_id from races
  where race_date = p_to::date and cancellation_status is distinct from 'confirmed'
)
select jsonb_build_object(
  'sonar_racecard', jsonb_build_object('applicable', (select count(*) > 0 from t), 'ok', coalesce((select count(*) from analogy_v16_snapshots s where s.stage = 'racecard' and s.race_id in (select race_id from t)) > 0, false), 'observed', (select count(*) from analogy_v16_snapshots s where s.stage = 'racecard' and s.race_id in (select race_id from t))),
  'poirot_predictions', jsonb_build_object('applicable', (select count(*) > 0 from t), 'ok', coalesce((select count(distinct p.race_id) from poirot_predictions p where p.race_id in (select race_id from t)) > 0, false), 'observed', (select count(distinct p.race_id) from poirot_predictions p where p.race_id in (select race_id from t))),
  'moriarty_recommendations', jsonb_build_object('applicable', (select count(*) > 0 from t), 'ok', coalesce((select count(*) from bet_recommendations b where b.model_id = 'moriarty' and b.race_id in (select race_id from t)) > 0, false), 'observed', (select count(*) from bet_recommendations b where b.model_id = 'moriarty' and b.race_id in (select race_id from t)))
) as o
) q
  );
END
$data_health$;

REVOKE ALL ON FUNCTION data_health_morning_freshness(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION data_health_morning_freshness(date) TO service_role;
COMMENT ON FUNCTION data_health_morning_freshness(date) IS 'データ健全性の朝の監視: 当日の龍神ソナー（出走表の段）・ポアロ・モリアーティの件数。p_to は当日。項目は scripts/lib/dataHealth/functions.js の MORNING_FRESHNESS_ITEMS';

-- 朝の監視ジョブのモードの行（始めのモードは、今の data_health に従う）
INSERT INTO scrape_job_state (job, mode)
SELECT 'data_health_morning', mode FROM scrape_job_state WHERE job = 'data_health'
ON CONFLICT (job) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()
  -- 共通ラッパは、行の無いジョブの初回の起動で mode='off' の行を作る（cronWrapper.js の ensureRow）。db-apply は
  -- master の SQL を当てるのでコードのデプロイが先になり、その間に 07:55 の cron が動くと off の行が先にできる。
  -- その「作られただけで一度も動いていない行」だけを上書きする（手で off・shadow にした行は変えない）
  WHERE scrape_job_state.mode = 'off'
    AND scrape_job_state.last_success_at IS NULL
    AND scrape_job_state.last_tick_at IS NULL;
