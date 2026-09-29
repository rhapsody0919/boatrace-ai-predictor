-- 109: 予想一覧RPC（get_predictions_by_date / _light）の result に、レースの成立状態・返還艇・備考と
--      払戻明細の配列を足す。払戻明細（race_payouts）を匿名から読めるようにする（BOA-543）
--
-- 対応: src/utils/raceOutcome.js（判定の関数）、src/components/race/RaceResult.jsx（結果タブ）、
--       RaceCard.jsx・RaceAiPredictionTab.jsx・TurnPatternList.jsx（的中の判定）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが行う（docs/db-migration/APPLIED.md）。
--
-- 背景:
--   078 で race_results に race_status / refund_boats / remark を、079 で払戻明細 race_payouts を足したが、
--   画面はどちらも読んでいなかった。旧フラグ is_no_race は全行 false で、不成立のレースが普通の結果として
--   出ていた（浜名湖 2026-09-14 6R で「2着 1号艇 F」等）。不成立・返還の勝式は旧 payout_* 列が NULL になり、
--   払戻欄から黙って消えていた。
--
-- 変更（後方互換。既存のキーは1つも消さない・変えない）:
--   1. race_payouts に SELECT のみのポリシーと GRANT（anon, authenticated）。079 のコメントの予定どおり。
--      予想一覧RPCは SECURITY INVOKER（既定）で anon として実行されるため、RPC の中で読むにも権限が要る。
--      公開する内容は、既に画面に出している払戻（race_results.payout_*）と同じ公式の結果（ADR-0067）
--   2. 2関数の result の json_build_object の末尾に、次の4キーを足す:
--        'raceStatus'  race_results.race_status（'normal' / 'partial_refund' / 'no_race'。NULL=未判定）
--        'refundBoats' race_results.refund_boats（返還艇の枠番の配列。NULL=未判定）
--        'remark'      race_results.remark（備考。「【返還艇あり】」等）
--        'payoutRows'  race_payouts の行の配列（betType・seq・combination・payout・payoutStatus・popularity）。
--                      行が無ければ NULL。**light 版は race_status が no_race / partial_refund のレースだけ**
--                      （通常のレースは NULL。画面は旧 payout_* 列で払戻を出す。一覧の初期表示の容量を抑えるため。
--                      2026-09-29 ユーザー判断。2026-09-28 の実測で light は 070 の 782,398 字 → 絞らないと 961,251 字（+22.9%）、絞ると 797,866 字（+2.0%））
--
-- 土台にした定義: 070 の2関数。2026-09-29 に本番の pg_get_functiondef の md5 が、070 のファイル本文から
--   組み立てた定義の md5 と完全に一致することを確認した（本番は 070 のまま。070 以降にこの2関数を
--   変えたマイグレーションは無い）:
--     get_predictions_by_date        a65708505d8041b6d2ee303ad5bbf932
--     get_predictions_by_date_light  b5c2fe654488320e1138ecbbfd00df16
--   下の2関数は、この定義の result の json_build_object の末尾（'popularityWide3' の後）に4キーを足しただけ。
--
-- 前提: 078（列 race_status・refund_boats・remark）と 079（テーブル race_payouts）が適用済み
--   （2026-09-29 に本番で列・テーブルの存在と値を確認済み）。
--
-- 未適用の間の画面の挙動: raceStatus が届かないため、今までどおり（通常のレースとして）表示する。
--   結果タブの着順は race_start_timings の着欄で組み立てる（#949）ので、返還艇を着順に並べない修正は効いたまま。
--
-- 関数の ACL は CREATE OR REPLACE で保たれるため、関数の GRANT は再実行しない。
--
-- 適用手順・確認・元に戻す方法は、PR に添えた1ファイルの手順書（boa543-apply.sql）にまとめた。
-- 要点: 次の全体を1つのトランザクションとして実行する（末尾の DO ブロックが自己検査し、失敗すれば例外）。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
-- 適用後に `node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js` を実行する。
--
-- 元に戻す（画面は raceStatus が無い状態＝今までどおりの表示に戻る）:
--   070 の2関数の定義をそのまま再実行し、
--   DROP POLICY IF EXISTS race_payouts_public_read ON public.race_payouts;
--   REVOKE SELECT ON public.race_payouts FROM anon, authenticated;

SET LOCAL lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- 1. race_payouts を匿名から読めるようにする（SELECT のみ。書き込みは service_role のみのまま）
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS race_payouts_public_read ON public.race_payouts;
CREATE POLICY race_payouts_public_read ON public.race_payouts
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.race_payouts TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2a. get_predictions_by_date（result に raceStatus・refundBoats・remark・payoutRows を足すのみ）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_predictions_by_date(target_date date)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'date', target_date,
    'generatedAt', NOW(),
    'updatedAt', NOW(),
    'races', COALESCE((
      SELECT json_agg(race_data ORDER BY venue_code, race_number)
      FROM (
        SELECT
          r.venue_code,
          r.race_number,
          json_build_object(
            'raceId', r.race_id,
            'venue', CASE r.venue_code
              WHEN 1 THEN '桐生' WHEN 2 THEN '戸田' WHEN 3 THEN '江戸川'
              WHEN 4 THEN '平和島' WHEN 5 THEN '多摩川' WHEN 6 THEN '浜名湖'
              WHEN 7 THEN '蒲郡' WHEN 8 THEN '常滑' WHEN 9 THEN '津'
              WHEN 10 THEN '三国' WHEN 11 THEN 'びわこ' WHEN 12 THEN '住之江'
              WHEN 13 THEN '尼崎' WHEN 14 THEN '鳴門' WHEN 15 THEN '丸亀'
              WHEN 16 THEN '児島' WHEN 17 THEN '宮島' WHEN 18 THEN '徳山'
              WHEN 19 THEN '下関' WHEN 20 THEN '若松' WHEN 21 THEN '芦屋'
              WHEN 22 THEN '福岡' WHEN 23 THEN '唐津' WHEN 24 THEN '大村'
            END,
            'venueCode', r.venue_code,
            'raceNumber', r.race_number,
            'startTime', TO_CHAR(r.start_time, 'HH24:MI'),
            'raceGrade', r.race_grade,
            'cancellationStatus', r.cancellation_status,
            'seriesDay', rc.series_day,
            'isFinalDay', rc.is_final_day,
            'raceTitle', rc.race_title,
            'raceStage', rc.race_stage,
            'weather', CASE
              WHEN rc.weather IS NULL AND rc.wind_direction IS NULL
                AND rc.wind_speed IS NULL AND rc.wave_height IS NULL
                AND rc.temperature IS NULL AND rc.water_temperature IS NULL
              THEN NULL
              ELSE json_build_object(
                'weather', rc.weather,
                'windDirection', rc.wind_direction,
                'windSpeed', rc.wind_speed,
                'waveHeight', rc.wave_height,
                'temperature', rc.temperature,
                'waterTemperature', rc.water_temperature,
                'observedAt', rc.weather_observed_at
              )
            END,
            'volatility', (
              SELECT CASE
                WHEN p.feature_contributions->>'volatilityPercentile' IS NOT NULL THEN
                  json_build_object(
                    'percentile', (p.feature_contributions->>'volatilityPercentile')::numeric,
                    'isFallback', COALESCE((p.feature_contributions->>'volatilityPercentileIsFallback')::boolean, false),
                    'level', CASE
                      WHEN (p.feature_contributions->>'volatilityPercentile')::numeric >= 0.7 THEN 'high'
                      WHEN (p.feature_contributions->>'volatilityPercentile')::numeric <= 0.3 THEN 'low'
                      ELSE 'standard'
                    END
                  )
                ELSE NULL
              END
              FROM predictions p
              WHERE p.race_id = r.race_id AND p.model_id = 'unified'
              LIMIT 1
            ),
            'entries', (
              SELECT json_agg(
                json_build_object(
                  'number', e.boat_number,
                  'name', e.player_name,
                  'racerId', e.racer_id,
                  'grade', e.grade,
                  'age', e.age,
                  'winRate', e.win_rate::text,
                  'localWinRate', e.local_win_rate::text,
                  'motorNumber', e.motor_number,
                  'motor2Rate', e.motor_2rate::text,
                  'boatNumber', e.boat_number_id,
                  'boat2Rate', e.boat_2rate::text,
                  'global2Rate', e.global_2rate::text,
                  'aiScoreStandard', e.ai_score_standard,
                  'aiScoreSafeBet', e.ai_score_safe_bet,
                  'aiScoreUpsetFocus', e.ai_score_upset_focus
                ) ORDER BY e.boat_number
              )
              FROM race_entries e
              WHERE e.race_id = r.race_id
            ),
            'exhibitionData', (
              SELECT json_agg(
                json_build_object(
                  'boatNumber', ed.boat_number,
                  'exhibitionTime', ed.exhibition_time,
                  'startTiming', ed.start_timing
                ) ORDER BY ed.boat_number
              )
              FROM exhibition_data ed
              WHERE ed.race_id = r.race_id
            ),
            'predictions', (
              SELECT json_object_agg(
                p.model_id,
                json_build_object(
                  'topPick', p.top_pick,
                  'top3', ARRAY[p.top_pick, p.top_2nd, p.top_3rd],
                  'confidence', p.confidence,
                  'isHitWin', p.is_hit_win,
                  'isHitPlace', p.is_hit_place,
                  'isHitTrifecta', p.is_hit_trifecta,
                  'isHitTrio', p.is_hit_trio,
                  'payoutWin', p.payout_win,
                  'payoutPlace', p.payout_place,
                  'payoutTrifecta', p.payout_trifecta,
                  'payoutTrio', p.payout_trio,
                  'turnPrediction', p.feature_contributions->'turnPrediction',
                  'racerStats', p.feature_contributions->'racerStats',
                  'volatilityPercentile', p.feature_contributions->'volatilityPercentile',
                  'volatilityPercentileIsFallback', p.feature_contributions->'volatilityPercentileIsFallback',
                  'volatilityReasons', p.feature_contributions->'volatilityReasons'
                )
              )
              FROM predictions p
              WHERE p.race_id = r.race_id
            ),
            'predictionOdds', (
              SELECT json_build_object(
                'updatedAt',               po.updated_at,
                'trifectaPredStandard',    po.trifecta_pred_standard,
                'trifectaOddsStandard',    po.trifecta_odds_standard,
                'trioPredStandard',        po.trio_pred_standard,
                'trioOddsStandard',        po.trio_odds_standard,
                'trifectaPredSafeBet',     po.trifecta_pred_safe_bet,
                'trifectaOddsSafeBet',     po.trifecta_odds_safe_bet,
                'trioPredSafeBet',         po.trio_pred_safe_bet,
                'trioOddsSafeBet',         po.trio_odds_safe_bet,
                'trifectaPredUpsetFocus',  po.trifecta_pred_upset_focus,
                'trifectaOddsUpsetFocus',  po.trifecta_odds_upset_focus,
                'trioPredUpsetFocus',      po.trio_pred_upset_focus,
                'trioOddsUpsetFocus',      po.trio_odds_upset_focus
              )
              FROM prediction_odds po
              WHERE po.race_id = r.race_id
            ),
            'result', (
              SELECT json_build_object(
                'finished', true,
                'isCancelled', COALESCE(res.is_cancelled, false),
                'isNoRace', COALESCE(res.is_no_race, false),
                'rank1', res.rank1,
                'rank2', res.rank2,
                'rank3', res.rank3,
                'rank4', res.rank4,
                'rank5', res.rank5,
                'rank6', res.rank6,
                'raceTime1', res.race_time_1,
                'raceTime2', res.race_time_2,
                'raceTime3', res.race_time_3,
                'raceTime4', res.race_time_4,
                'raceTime5', res.race_time_5,
                'raceTime6', res.race_time_6,
                'winningTechnique', res.winning_technique,
                'payoutWin', res.payout_win,
                'payoutPlace1', res.payout_place_1,
                'payoutPlace2', res.payout_place_2,
                'payoutTrifecta', res.payout_trifecta,
                'payoutTrio', res.payout_trio,
                'payoutExacta', res.payout_exacta,
                'payoutQuinella', res.payout_quinella,
                'payoutWide1', res.payout_wide_1,
                'payoutWide2', res.payout_wide_2,
                'payoutWide3', res.payout_wide_3,
                'popularityTrifecta', res.popularity_trifecta,
                'popularityTrio', res.popularity_trio,
                'popularityExacta', res.popularity_exacta,
                'popularityQuinella', res.popularity_quinella,
                'popularityWide1', res.popularity_wide_1,
                'popularityWide2', res.popularity_wide_2,
                'popularityWide3', res.popularity_wide_3,
                'raceStatus', res.race_status,
                'refundBoats', res.refund_boats,
                'remark', res.remark,
                'payoutRows', (
                  SELECT json_agg(
                    json_build_object(
                      'betType', pp.bet_type,
                      'seq', pp.seq,
                      'combination', pp.combination,
                      'payout', pp.payout,
                      'payoutStatus', pp.payout_status,
                      'popularity', pp.popularity
                    ) ORDER BY pp.bet_type, pp.seq
                  )
                  FROM race_payouts pp
                  WHERE pp.race_id = r.race_id
                )
              )
              FROM race_results res
              WHERE res.race_id = r.race_id
              LIMIT 1
            )
          ) AS race_data
        FROM races r
        LEFT JOIN race_conditions rc ON rc.race_id = r.race_id
        WHERE r.race_date = target_date
      ) subq
    ), '[]'::json)
  ) INTO result;

-- ----------------------------------------------------------------------------
-- 2b. get_predictions_by_date_light（result に raceStatus・refundBoats・remark・payoutRows を足すのみ。
--     payoutRows は race_status が no_race / partial_refund のレースだけ。通常のレースは NULL）
-- ----------------------------------------------------------------------------
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_predictions_by_date_light(target_date date)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'date', target_date,
    'generatedAt', NOW(),
    'updatedAt', NOW(),
    'races', COALESCE((
      SELECT json_agg(race_data ORDER BY venue_code, race_number)
      FROM (
        SELECT
          r.venue_code,
          r.race_number,
          json_build_object(
            'raceId', r.race_id,
            'venue', CASE r.venue_code
              WHEN 1 THEN '桐生' WHEN 2 THEN '戸田' WHEN 3 THEN '江戸川'
              WHEN 4 THEN '平和島' WHEN 5 THEN '多摩川' WHEN 6 THEN '浜名湖'
              WHEN 7 THEN '蒲郡' WHEN 8 THEN '常滑' WHEN 9 THEN '津'
              WHEN 10 THEN '三国' WHEN 11 THEN 'びわこ' WHEN 12 THEN '住之江'
              WHEN 13 THEN '尼崎' WHEN 14 THEN '鳴門' WHEN 15 THEN '丸亀'
              WHEN 16 THEN '児島' WHEN 17 THEN '宮島' WHEN 18 THEN '徳山'
              WHEN 19 THEN '下関' WHEN 20 THEN '若松' WHEN 21 THEN '芦屋'
              WHEN 22 THEN '福岡' WHEN 23 THEN '唐津' WHEN 24 THEN '大村'
            END,
            'venueCode', r.venue_code,
            'raceNumber', r.race_number,
            'startTime', TO_CHAR(r.start_time, 'HH24:MI'),
            'raceGrade', r.race_grade,
            'cancellationStatus', r.cancellation_status,
            'seriesDay', rc.series_day,
            'isFinalDay', rc.is_final_day,
            'raceTitle', rc.race_title,
            'raceStage', rc.race_stage,
            'weather', CASE
              WHEN rc.weather IS NULL AND rc.wind_direction IS NULL
                AND rc.wind_speed IS NULL AND rc.wave_height IS NULL
                AND rc.temperature IS NULL AND rc.water_temperature IS NULL
              THEN NULL
              ELSE json_build_object(
                'weather', rc.weather,
                'windDirection', rc.wind_direction,
                'windSpeed', rc.wind_speed,
                'waveHeight', rc.wave_height,
                'temperature', rc.temperature,
                'waterTemperature', rc.water_temperature,
                'observedAt', rc.weather_observed_at
              )
            END,
            'volatility', (
              SELECT CASE
                WHEN p.feature_contributions->>'volatilityPercentile' IS NOT NULL THEN
                  json_build_object(
                    'percentile', (p.feature_contributions->>'volatilityPercentile')::numeric,
                    'isFallback', COALESCE((p.feature_contributions->>'volatilityPercentileIsFallback')::boolean, false),
                    'level', CASE
                      WHEN (p.feature_contributions->>'volatilityPercentile')::numeric >= 0.7 THEN 'high'
                      WHEN (p.feature_contributions->>'volatilityPercentile')::numeric <= 0.3 THEN 'low'
                      ELSE 'standard'
                    END
                  )
                ELSE NULL
              END
              FROM predictions p
              WHERE p.race_id = r.race_id AND p.model_id = 'unified'
              LIMIT 1
            ),
            'entries', (
              SELECT json_agg(
                json_build_object(
                  'number', e.boat_number,
                  'name', e.player_name,
                  'racerId', e.racer_id,
                  'grade', e.grade,
                  'age', e.age,
                  'winRate', e.win_rate::text,
                  'localWinRate', e.local_win_rate::text,
                  'global2Rate', e.global_2rate::text,
                  'motorNumber', e.motor_number,
                  'motor2Rate', e.motor_2rate::text,
                  'boatNumber', e.boat_number_id,
                  'boat2Rate', e.boat_2rate::text,
                  'aiScoreStandard', e.ai_score_standard,
                  'aiScoreSafeBet', e.ai_score_safe_bet,
                  'aiScoreUpsetFocus', e.ai_score_upset_focus
                ) ORDER BY e.boat_number
              )
              FROM race_entries e
              WHERE e.race_id = r.race_id
            ),
            'exhibitionData', (
              SELECT json_agg(
                json_build_object(
                  'boatNumber', ed.boat_number,
                  'exhibitionTime', ed.exhibition_time,
                  'startTiming', ed.start_timing
                ) ORDER BY ed.boat_number
              )
              FROM exhibition_data ed
              WHERE ed.race_id = r.race_id
            ),
            'predictions', (
              SELECT json_object_agg(
                p.model_id,
                json_build_object(
                  'topPick', p.top_pick,
                  'top3', ARRAY[p.top_pick, p.top_2nd, p.top_3rd],
                  'confidence', p.confidence,
                  'isHitWin', p.is_hit_win,
                  'isHitPlace', p.is_hit_place,
                  'isHitTrifecta', p.is_hit_trifecta,
                  'isHitTrio', p.is_hit_trio,
                  'payoutWin', p.payout_win,
                  'payoutPlace', p.payout_place,
                  'payoutTrifecta', p.payout_trifecta,
                  'payoutTrio', p.payout_trio,
                  'volatilityPercentile', p.feature_contributions->'volatilityPercentile',
                  'volatilityPercentileIsFallback', p.feature_contributions->'volatilityPercentileIsFallback',
                  'volatilityReasons', p.feature_contributions->'volatilityReasons'
                )
              )
              FROM predictions p
              WHERE p.race_id = r.race_id
            ),
            'predictionOdds', (
              SELECT json_build_object(
                'trifectaPredStandard',    po.trifecta_pred_standard,
                'trifectaOddsStandard',    po.trifecta_odds_standard,
                'trioPredStandard',        po.trio_pred_standard,
                'trioOddsStandard',        po.trio_odds_standard,
                'trifectaPredSafeBet',     po.trifecta_pred_safe_bet,
                'trifectaOddsSafeBet',     po.trifecta_odds_safe_bet,
                'trioPredSafeBet',         po.trio_pred_safe_bet,
                'trioOddsSafeBet',         po.trio_odds_safe_bet,
                'trifectaPredUpsetFocus',  po.trifecta_pred_upset_focus,
                'trifectaOddsUpsetFocus',  po.trifecta_odds_upset_focus,
                'trioPredUpsetFocus',      po.trio_pred_upset_focus,
                'trioOddsUpsetFocus',      po.trio_odds_upset_focus
              )
              FROM prediction_odds po
              WHERE po.race_id = r.race_id
            ),
            'result', (
              SELECT json_build_object(
                'finished', true,
                'isCancelled', COALESCE(res.is_cancelled, false),
                'isNoRace', COALESCE(res.is_no_race, false),
                'rank1', res.rank1,
                'rank2', res.rank2,
                'rank3', res.rank3,
                'rank4', res.rank4,
                'rank5', res.rank5,
                'rank6', res.rank6,
                'raceTime1', res.race_time_1,
                'raceTime2', res.race_time_2,
                'raceTime3', res.race_time_3,
                'raceTime4', res.race_time_4,
                'raceTime5', res.race_time_5,
                'raceTime6', res.race_time_6,
                'winningTechnique', res.winning_technique,
                'payoutWin', res.payout_win,
                'payoutPlace1', res.payout_place_1,
                'payoutPlace2', res.payout_place_2,
                'payoutTrifecta', res.payout_trifecta,
                'payoutTrio', res.payout_trio,
                'payoutExacta', res.payout_exacta,
                'payoutQuinella', res.payout_quinella,
                'payoutWide1', res.payout_wide_1,
                'payoutWide2', res.payout_wide_2,
                'payoutWide3', res.payout_wide_3,
                'popularityTrifecta', res.popularity_trifecta,
                'popularityTrio', res.popularity_trio,
                'popularityExacta', res.popularity_exacta,
                'popularityQuinella', res.popularity_quinella,
                'popularityWide1', res.popularity_wide_1,
                'popularityWide2', res.popularity_wide_2,
                'popularityWide3', res.popularity_wide_3,
                'raceStatus', res.race_status,
                'refundBoats', res.refund_boats,
                'remark', res.remark,
                -- light 版は、不成立・一部返還のレースだけ払戻明細を返す（通常のレースは NULL。
                -- 画面は旧 payout_* 列で払戻を出す）。一覧の初期表示の容量を抑えるため（2026-09-29 ユーザー判断）
                'payoutRows', CASE
                  WHEN res.race_status IN ('no_race', 'partial_refund') THEN (
                    SELECT json_agg(
                      json_build_object(
                        'betType', pp.bet_type,
                        'seq', pp.seq,
                        'combination', pp.combination,
                        'payout', pp.payout,
                        'payoutStatus', pp.payout_status,
                        'popularity', pp.popularity
                      ) ORDER BY pp.bet_type, pp.seq
                    )
                    FROM race_payouts pp
                    WHERE pp.race_id = r.race_id
                  )
                END
              )
              FROM race_results res
              WHERE res.race_id = r.race_id
              LIMIT 1
            )
          ) AS race_data
        FROM races r
        LEFT JOIN race_conditions rc ON rc.race_id = r.race_id
        WHERE r.race_date = target_date
      ) subq
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 適用結果の自己検査
--   (1) 2関数の現行定義に新しい4キーが含まれること
--   (2) 既存のキー（cancellationStatus・raceStage・weather・observedAt・isNoRace・payoutWide3）が消えていないこと
--       （古い定義を土台にした回帰の検知。BOA-363・BOA-431）
--   (3) anon が race_payouts を SELECT でき、INSERT はできないこと
--   (4) 2関数が実際に実行できること（列・テーブルの存在は実行時に解決されるため）
-- 満たさなければ例外になり、トランザクション内で実行していればロールバックされる。
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO missing
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_predictions_by_date', 'get_predictions_by_date_light')
    AND (
      p.prosrc NOT LIKE '%''raceStatus'', res.race_status%'
      OR p.prosrc NOT LIKE '%''refundBoats'', res.refund_boats%'
      OR p.prosrc NOT LIKE '%''remark'', res.remark%'
      OR p.prosrc NOT LIKE '%''payoutRows''%FROM race_payouts pp%'
      -- light 版だけ、払戻明細を不成立・一部返還に絞る（full 版は絞らない）
      OR (p.proname = 'get_predictions_by_date_light'
          AND p.prosrc NOT LIKE '%''payoutRows'', CASE%WHEN res.race_status IN (''no_race'', ''partial_refund'')%')
      OR (p.proname = 'get_predictions_by_date'
          AND p.prosrc LIKE '%''payoutRows'', CASE%')
      OR p.prosrc NOT LIKE '%''cancellationStatus''%'
      OR p.prosrc NOT LIKE '%''raceStage''%'
      OR p.prosrc NOT LIKE '%''weather''%'
      OR p.prosrc NOT LIKE '%''observedAt''%'
      OR p.prosrc NOT LIKE '%''isNoRace''%'
      OR p.prosrc NOT LIKE '%''popularityWide3''%'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '新しいキーが含まれない、または既存のキーが欠けた関数があります: %', missing;
  END IF;

  IF NOT has_table_privilege('anon', 'public.race_payouts', 'SELECT') THEN
    RAISE EXCEPTION 'anon が race_payouts を SELECT できません';
  END IF;
  IF has_table_privilege('anon', 'public.race_payouts', 'INSERT') THEN
    RAISE EXCEPTION 'anon が race_payouts に INSERT できてしまいます';
  END IF;

  PERFORM public.get_predictions_by_date('2000-01-01'::date);
  PERFORM public.get_predictions_by_date_light('2000-01-01'::date);
END
$verify$;
