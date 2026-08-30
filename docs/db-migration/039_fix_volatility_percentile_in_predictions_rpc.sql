-- get_predictions_by_date / get_predictions_by_date_light の predictions.<model_id> オブジェクトに
-- unifiedモデルの volatilityPercentile / volatilityPercentileIsFallback / volatilityReasons を追加する。
--
-- 背景: 031マイグレーション（2026-08-13起票）で同じ修正が用意されていたが、SUPABASE_ACCESS_TOKEN
-- 失効中のため未適用のまま放置されていた。本番（Edge API経由）ではレース詳細ページ
-- （/race/:raceId）のイン崩れ注意度バッジ（VolatilityDisplay.jsx、AiAnalysisSection内）と
-- イン崩れ注意度の振り返り（RaceResult.jsx、2026-08-29追加）の両方が、この間ずっと
-- volatilityPercentile=null 扱いとなり非表示になっていた（2026-08-30、ユーザー指摘で発覚）。
-- ローカル開発時（Edge APIが到達不可でSupabase直接クエリにフォールバックする経路）は
-- feature_contributions列を丸ごと取得するため、本マイグレーション未適用でも正しく表示されており、
-- 発覚が遅れた（e2eテストもローカルdevサーバー相手のためこの経路を検証できていなかった）。
--
-- 031との違い: 031起草時点の関数定義をそのまま再適用すると、その後追加された
-- entries.racerId（選手個人ページ機能）・seriesDay/isFinalDay/raceTitle（034/038マイグレーション、
-- 開催場一覧ページ再設計）が失われ別の退行を招くため、本マイグレーションは
-- 現在実際にデータベースに適用されている関数定義（pg_get_functiondefで確認済み）を
-- ベースに、volatilityPercentile関連3フィールドの追加のみを行う。
--
-- get_today_races は034マイグレーションで既にunifiedモデル基準（volatilityPercentile）に
-- 統一済みのため対象外（ホーム画面の会場一覧グリッドは今回の不具合の影響を受けていない）。

CREATE OR REPLACE FUNCTION get_predictions_by_date(target_date DATE)
RETURNS JSON
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
            'volatility', CASE WHEN r.volatility_score IS NOT NULL THEN
              json_build_object(
                'score', r.volatility_score,
                'level', r.volatility_level,
                'recommendedModel', r.recommended_model,
                'reasons', COALESCE(r.volatility_reasons, '[]'::jsonb)
              )
            ELSE NULL END,
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
                'rank1', res.rank1,
                'rank2', res.rank2,
                'rank3', res.rank3,
                'payoutWin', res.payout_win,
                'payoutPlace1', res.payout_place_1,
                'payoutPlace2', res.payout_place_2,
                'payoutTrifecta', res.payout_trifecta,
                'payoutTrio', res.payout_trio
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

CREATE OR REPLACE FUNCTION get_predictions_by_date_light(target_date DATE)
RETURNS JSON
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
            'volatility', CASE WHEN r.volatility_score IS NOT NULL THEN
              json_build_object(
                'score', r.volatility_score,
                'level', r.volatility_level,
                'recommendedModel', r.recommended_model,
                'reasons', COALESCE(r.volatility_reasons, '[]'::jsonb)
              )
            ELSE NULL END,
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
                'rank1', res.rank1,
                'rank2', res.rank2,
                'rank3', res.rank3,
                'payoutWin', res.payout_win,
                'payoutPlace1', res.payout_place_1,
                'payoutPlace2', res.payout_place_2,
                'payoutTrifecta', res.payout_trifecta,
                'payoutTrio', res.payout_trio
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

GRANT EXECUTE ON FUNCTION get_predictions_by_date(DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_predictions_by_date_light(DATE) TO anon, authenticated;
