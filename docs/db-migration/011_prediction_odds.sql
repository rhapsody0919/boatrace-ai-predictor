-- BOA-51: 予測買い目オッズテーブル
-- 各レース・各モデルの3連単・3連複買い目と最新オッズを保存する。
-- Supabase Dashboard > SQL Editor で実行してください。

-- ============================================================================
-- 1. prediction_odds テーブル作成
--    race_id ごとに1行（最新オッズを上書き）
-- ============================================================================
CREATE TABLE IF NOT EXISTS prediction_odds (
    race_id VARCHAR(20) PRIMARY KEY REFERENCES races(race_id) ON DELETE CASCADE,

    -- スタンダードモデル
    trifecta_pred_standard   VARCHAR(10),   -- 3連単買い目 e.g. "1-2-3"
    trifecta_odds_standard   DECIMAL(8,1),  -- 3連単オッズ
    trio_pred_standard       VARCHAR(10),   -- 3連複買い目（昇順ソート）
    trio_odds_standard       DECIMAL(8,1),  -- 3連複オッズ

    -- 本命狙いモデル
    trifecta_pred_safe_bet   VARCHAR(10),
    trifecta_odds_safe_bet   DECIMAL(8,1),
    trio_pred_safe_bet       VARCHAR(10),
    trio_odds_safe_bet       DECIMAL(8,1),

    -- 穴狙いモデル
    trifecta_pred_upset_focus VARCHAR(10),
    trifecta_odds_upset_focus DECIMAL(8,1),
    trio_pred_upset_focus     VARCHAR(10),
    trio_odds_upset_focus     DECIMAL(8,1),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: anon ユーザーが読み取れるようにする
ALTER TABLE prediction_odds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prediction_odds_public_read" ON prediction_odds;
CREATE POLICY "prediction_odds_public_read"
  ON prediction_odds FOR SELECT
  USING (true);

-- ============================================================================
-- 2. get_predictions_by_date RPC に prediction_odds を追加
-- ============================================================================
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
                  'racerStats', p.feature_contributions->'racerStats'
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
        WHERE r.race_date = target_date
      ) subq
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================================
-- 3. get_predictions_by_date_light RPC に prediction_odds を追加
-- ============================================================================
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
            -- 軽量版: turnPrediction と racerStats を除外
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
                  'payoutTrio', p.payout_trio
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
        WHERE r.race_date = target_date
      ) subq
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================================
-- 4. 実行権限付与
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_predictions_by_date(DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_predictions_by_date_light(DATE) TO anon, authenticated;
