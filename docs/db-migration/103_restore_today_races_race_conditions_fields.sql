-- get_today_races() から欠落した race_conditions 由来の4フィールドを復旧する（BOA-431）
--
-- ## 何が起きたか
--
-- 102（当初063として追加、PR #824）が get_today_races を CREATE OR REPLACE した際、
-- 068 ではなく **068 より前の定義を土台にしていた**。その結果、068 が入れていた
-- 次の4キーと LEFT JOIN race_conditions が丸ごと消えた。
--
--   seriesDay / isFinalDay / raceTitle / raceStage
--
-- 本番実測（2026-09-25、pg_get_functiondef で照合）:
--   has_turn_prediction=true, has_volatility=true, has_race_grade=true,
--   has_cancellation=true, has_rc_join=false, has_series_day=false
--
-- ## 影響
--
-- api/races/today.js が get_today_races を呼ぶ主経路でこれらのキーが欠落する。
-- src/components/race/RaceCard.jsx が racePrediction?.raceStage で優勝戦・準優勝戦の
-- バッジを出しているため、本番でバッジが表示されなくなっていた。
--
-- src/services/supabaseDataService.js の直接クエリfallbackは race_conditions を明示
-- マップするため、主経路とfallbackでレスポンスの形が食い違う。画面は壊れないので
-- E2Eでも検知できない。
--
-- ## BOA-363 と同型
--
-- 048 が入れた cancellationStatus が 051・062・066 に上書きされて本番から数日間
-- 消えていたのと同じ経路。scripts/maintenance/verify-rpc-output-keys.js は
-- まさにこれを検知するために書かれたが、本番Supabaseへの接続が要るため
-- Quality Gates CI（ADR-0072）に載せられず tier=manual に分類されており、
-- 定期実行の仕組みが無いため誰も実行していなかった。
--
-- ## この修正の内容
--
-- 068 の get_today_races の定義をそのまま再適用する。068 は cancellationStatus を
-- 含む「現行仕様の全部入り」で、102 が足そうとしたキーも最初から持っている
-- （068 以降に get_today_races を変更したマイグレーションは 102 だけであることを
-- docs/db-migration/ 全件の grep で確認済み）。
--
-- 適用後の確認:
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--
-- ロールバック: 102 を再適用すれば元に戻る（ただし4キーが再び消える）。

CREATE OR REPLACE FUNCTION public.get_today_races()
RETURNS json
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
              'cancellationStatus', r.cancellation_status,
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
