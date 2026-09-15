-- get_today_races / get_predictions_by_date / get_predictions_by_date_light に
-- レースステージ名（race_stage、例: 予選/準優勝戦/優勝戦）を追加する（BOA-226）
--
-- 背景: race_conditions.race_stage列とそのスクレイピング（scrapeRaceStage()、
-- 058マイグレーション）は2026-09-14に別チケット（BOA-264追加調査）内で先行実装
-- 済みだったが、RPC側での公開は行われていなかった。BOA-226チケットの確定スコープ
-- （2026-09-12更新）で「レース一覧ページにこのラベルをバッジ表示する」ことが
-- 明記されており、その前提としてRPCレスポンスへの追加が必要。
--
-- Supabase Dashboard > SQL Editor で実行する。
--
-- 【重要な副次的発見・修正】get_today_races()にseriesDay/isFinalDay/raceTitleが
-- 含まれていない
-- 038マイグレーションでget_today_races()にseriesDay/isFinalDay/raceTitle
-- （race_conditionsとのLEFT JOIN）を追加したはずだったが、本番の実際の関数定義を
-- pg_get_functiondefで確認したところ、これらのフィールドが存在せず、
-- race_conditionsとのJOIN自体が無かった（2026-09-15、Supabase MCPで確認）。
-- 原因は052マイグレーション（get_today_races RPC関数にturnPredictionを追加）が、
-- 038より前の（race_conditionsをJOINしていない）関数定義をベースに
-- CREATE OR REPLACEしたため、038の変更が意図せず消えていたと推測される
-- （052のコミット時点で038の存在に気づかず上書きしてしまったリグレッション）。
-- 本マイグレーションでget_today_races()にrace_conditionsとのLEFT JOINと
-- seriesDay/isFinalDay/raceTitle/raceStageを復元・追加する。
--
-- get_predictions_by_date / get_predictions_by_date_light は本番で
-- race_conditionsとのJOIN・seriesDay/isFinalDay/raceTitleが正しく存在することを
-- 確認済み（pg_get_functiondefで確認）。この2つはraceStageフィールドの追加のみ行う。
--
-- 変更前の定義は2026-09-15にSupabase本番からpg_get_functiondefで直接取得して
-- 転記した。既存フィールドは一切変更せず、フィールド追加のみ（後方互換）。

-- ----------------------------------------------------------------------------
-- get_today_races
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_today_races()
RETURNS JSON
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSON;
  today_date DATE;
BEGIN
  -- JSTで今日の日付を取得
  today_date := (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE;

  SELECT json_build_object(
    'success', true,
    'scrapedAt', NOW(),
    'data', COALESCE((
      SELECT json_agg(venue_data ORDER BY place_cd)
      FROM (
        SELECT
          r.venue_code AS place_cd,
          CASE r.venue_code
            WHEN 1 THEN '桐生' WHEN 2 THEN '戸田' WHEN 3 THEN '江戸川'
            WHEN 4 THEN '平和島' WHEN 5 THEN '多摩川' WHEN 6 THEN '浜名湖'
            WHEN 7 THEN '蒲郡' WHEN 8 THEN '常滑' WHEN 9 THEN '津'
            WHEN 10 THEN '三国' WHEN 11 THEN 'びわこ' WHEN 12 THEN '住之江'
            WHEN 13 THEN '尼崎' WHEN 14 THEN '鳴門' WHEN 15 THEN '丸亀'
            WHEN 16 THEN '児島' WHEN 17 THEN '宮島' WHEN 18 THEN '徳山'
            WHEN 19 THEN '下関' WHEN 20 THEN '若松' WHEN 21 THEN '芦屋'
            WHEN 22 THEN '福岡' WHEN 23 THEN '唐津' WHEN 24 THEN '大村'
          END AS place_name,
          json_agg(
            json_build_object(
              'raceNo', r.race_number,
              'startTime', TO_CHAR(r.start_time, 'HH24:MI'),
              'date', r.race_date,
              'placeCd', r.venue_code,
              'raceGrade', r.race_grade,
              'seriesDay', rc.series_day,
              'isFinalDay', rc.is_final_day,
              'raceTitle', rc.race_title,
              'raceStage', rc.race_stage,
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
              'turnPrediction', (
                SELECT p.feature_contributions->'turnPrediction'->'patterns'->0
                FROM predictions p
                WHERE p.race_id = r.race_id AND p.model_id = 'unified'
                LIMIT 1
              ),
              'racers', (
                SELECT json_agg(
                  json_build_object(
                    'waku', e.boat_number,
                    'name', e.player_name,
                    'rank', e.grade,
                    'age', e.age,
                    'winRate', e.win_rate,
                    'localWinRate', e.local_win_rate,
                    'motorNo', e.motor_number,
                    'motor2Rate', e.motor_2rate,
                    'boatNo', e.boat_number_id,
                    'boat2Rate', e.boat_2rate
                  ) ORDER BY e.boat_number
                )
                FROM race_entries e
                WHERE e.race_id = r.race_id
              )
            ) ORDER BY r.race_number
          ) AS races
        FROM races r
        LEFT JOIN race_conditions rc ON rc.race_id = r.race_id
        WHERE r.race_date = today_date
        GROUP BY r.venue_code
      ) AS venue_data
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ----------------------------------------------------------------------------
-- get_predictions_by_date（raceStageフィールドを追加するのみ）
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
            'seriesDay', rc.series_day,
            'isFinalDay', rc.is_final_day,
            'raceTitle', rc.race_title,
            'raceStage', rc.race_stage,
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
-- get_predictions_by_date_light（raceStageフィールドを追加するのみ）
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
            'seriesDay', rc.series_day,
            'isFinalDay', rc.is_final_day,
            'raceTitle', rc.race_title,
            'raceStage', rc.race_stage,
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
