-- get_predictions_by_date / get_predictions_by_date_light のトップレベル volatility フィールドを
-- unifiedモデル基準（predictions.feature_contributions.volatilityPercentile）に統一する。
--
-- 背景: 034マイグレーションで get_today_races（ホーム画面の会場一覧カード用）のみ
-- 旧races.volatility_score/volatility_level列（旧3モデル時代のgenerate-predictions.jsが
-- 今も日次で書き込み続けている値）からunifiedモデル基準に統一したが、同じトップレベル
-- volatilityフィールドを持つget_predictions_by_date/_light（/venue/:code等の会場別
-- レース一覧が使うRPC、RaceCard.jsxのバッジ表示に使われる）への同じ修正が漏れていた。
-- 039マイグレーションはpredictions.<model_id>オブジェクト内のvolatilityPercentile
-- （レース詳細ページのVolatilityDisplay.jsxが参照）を追加したが、トップレベルの
-- volatilityフィールド（一覧ページのバッジが参照）は対象外のまま残っていた。
--
-- 実データで確認したところ、2026-08-31時点で新旧ロジックの食い違いが発生していた
-- （例: 多摩川5R race_id=2026-08-31-05-10、旧volatility_level='medium'のため一覧では
-- バッジ非表示だが、unified percentile=0.19（<=0.3→low）のため詳細ページでは
-- 「本命有利」バッジが表示される。逆に2R/5Rは旧ロジックでは'low'だがunified percentileは
-- standard相当で、一覧側の「本命有利」表示自体が不正確だった）。2026-08-31、ユーザー指摘。
--
-- 039との違い: 039起草時点でDBに実際に適用されている関数定義（pg_get_functiondefで確認済み、
-- entries.racerId・seriesDay/isFinalDay/raceTitleを含む）をベースに、トップレベル
-- volatilityフィールドのCASE文のみを034のget_today_racesと同じロジックに置き換える。
--
-- 出力形式の変更: 旧{score, level, recommendedModel, reasons} → 新{percentile, isFallback, level}。
-- RaceCard.jsx（唯一のトップレベルvolatility参照元）は既に.level/.isFallbackのみ参照しており、
-- .score/.recommendedModel/.reasonsを参照する箇所は無いため、フィールド構成の変更による
-- 影響は無い（grep確認済み）。

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
