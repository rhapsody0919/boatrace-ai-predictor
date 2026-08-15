-- get_today_races RPC関数のvolatilityフィールドをunifiedモデル基準に変更
--
-- 背景: レースカード一覧（RaceCard.jsx）のイン崩れ指数バッジが
-- races.volatility_score/volatility_level（旧3モデル時代のgenerate-predictions.js
-- が今も日次で書き込み続けている値）を参照していたのに対し、レース詳細パネル
-- （VolatilityDisplay.jsx）はpredictions.feature_contributions.volatilityPercentile
-- （unifiedモデル、generate-unified-predictions.js）を参照しており、
-- 別々のロジックから算出された値が2箇所に混在していた。
-- 実データで突き合わせたところ既に食い違いが発生していることを確認したため
-- （2026-08-15、ユーザー指摘）、一覧側もunifiedモデル基準に統一する。
--
-- レベル判定閾値（percentile >= 0.7 → high, <= 0.3 → low, それ以外 → standard）は
-- VolatilityDisplay.jsx・calculate-unified-volatility-accuracy.jsと同一。

CREATE OR REPLACE FUNCTION get_today_races()
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
        WHERE r.race_date = today_date
        GROUP BY r.venue_code
      ) AS venue_data
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_today_races() TO anon, authenticated;
