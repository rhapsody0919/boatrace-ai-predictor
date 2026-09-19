-- get_predictions_by_date / get_predictions_by_date_light の weather に観測時刻（observedAt）を追加する（BOA-358）
--
-- 背景: PR #724（マイグレーション069）で race_conditions.weather_observed_at（気象の観測時刻）を
-- 追加し、展示取得・結果取得・レース情報更新がこの列を書くようにした。フロント
-- （src/components/race/RaceBeforeInfoTab.jsx）は weather.observedAt があれば、気象カードの
-- 見出しに「10:34現在」を表示する。しかし本番の主経路（/api/predictions/{date} →
-- get_predictions_by_date / _light）が返す weather オブジェクトには observedAt が無く
-- （066が組み立てた weather は観測時刻を持たない）、本番の画面には観測時刻が出ない。
-- （Supabase直接クエリのフォールバック経路の buildWeather() は observedAt を返す。）
--
-- 土台にした定義: 2026-09-19 に本番から pg_get_functiondef で取得した現行定義。取得した定義の
-- md5 は、068（get_predictions_by_date / _light / get_today_races）のファイル本文から
-- pg_get_functiondef の形式で組み立てた定義の md5 と完全に一致した（本番は068のまま、差分なし）:
--   get_predictions_by_date        bee916439e3920a5d0fbfca9ca14aff1
--   get_predictions_by_date_light  1f43c8585aee44a858efedcfb6f523c2
--   get_today_races                e886512030e2e8528d60acd8c6140d58（本マイグレーションでは触れない）
-- 下の2関数は、この定義に、weather の json_build_object の末尾へ次の1行を足しただけ
-- （既存フィールドは一切変更しない。後方互換）:
--   'observedAt', rc.weather_observed_at
-- 全項目が NULL のとき weather 自体を NULL にする既存の挙動（066）はそのまま
-- （観測時刻だけが非NULLで気象6項目が全てNULLの場合も weather は NULL。フロントの
-- buildWeather() と同じ扱い）。
--
-- 値の形式: timestamptz を json_build_object に渡すと、JSON では ISO 8601 文字列になる
-- （例: "2026-09-19T01:34:00+00:00"。オフセットはセッションのTimeZone次第）。フロントの
-- formatObservedTime()（src/components/race/weatherInfo.js）は new Date(observedAt) で解釈し
-- JST の「HH:MM」に整形するため、どのオフセットでも同じ表示になる。フォールバック経路の
-- buildWeather() も同じ列の値（PostgRESTが返すISO 8601文字列）をそのまま observedAt に渡す。
-- 値が NULL（観測時刻不明・069適用前に保存された行）の場合もキー自体は出力され、
-- フロントは null を「表示しない」として扱う。
--
-- get_today_races は weather を返さない（062の定義。フロントも参照しない）ため、触らない。
--
-- 前提: 069_race_conditions_weather_observed_at.sql（列 race_conditions.weather_observed_at）が
-- 適用済みであること（2026-09-19 適用済みを確認）。未適用だと下の関数は実行時に列が無く失敗する
-- （plpgsql は実行時に列を解決するため、CREATE 自体は通る点に注意。適用後に必ず検証する）。
--
-- 関数の ACL（PUBLIC / anon / authenticated / service_role の EXECUTE）は
-- CREATE OR REPLACE で保たれるため、GRANT は再実行しない。
--
-- 適用手順（親が実行する）: Supabase Dashboard > SQL Editor、または Management API で、
--   BEGIN; <このファイル全体>; （末尾の DO ブロックが2関数の定義を自己検査する）
--   確認後に COMMIT;（問題があれば ROLLBACK;）
-- 適用後は `npm run verify:rpc-output-keys` で、出力のキーを検証する。


-- ----------------------------------------------------------------------------
-- get_predictions_by_date（weather に 'observedAt' を追加するのみ）
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
                'popularityWide3', res.popularity_wide_3
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
-- get_predictions_by_date_light（weather に 'observedAt' を追加するのみ）
-- ----------------------------------------------------------------------------
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
                'popularityWide3', res.popularity_wide_3
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
--   (1) 2関数の現行定義に observedAt が含まれること
--   (2) 既存フィールド（cancellationStatus・raceStage・weather）が消えていないこと
--       （古い定義を土台にした回帰の検知。BOA-363）
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
      p.prosrc NOT LIKE '%''observedAt''%'
      OR p.prosrc NOT LIKE '%''cancellationStatus''%'
      OR p.prosrc NOT LIKE '%''raceStage''%'
      OR p.prosrc NOT LIKE '%''weather''%'
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'observedAt が含まれない、または既存フィールドが欠けた関数があります: %', missing;
  END IF;
END
$verify$;
