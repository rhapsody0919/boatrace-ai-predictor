-- 157: get_predictions_by_date・get_predictions_by_date_light・get_today_races の各レースに、
--      イン崩れ注意度（inCaution）を1キー足す（BOA-822）
--
-- 対応spec/plan: docs/design/in-collapse-caution/plan.md §3「RPC（157）と画面への経路」、ADR-0095
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが SQL Editor で行う（docs/db-migration/APPLIED.md）。
--
-- 変更（後方互換。既存のキーは1つも消さない・変えない）:
--   レースの json_build_object の 'volatility' の前に 'inCaution' を足す。中身は unified の
--   predictions.feature_contributions->'inCaution' をそのまま返す（無ければ NULL）。段（level）は朝の生成が
--   決めて保存したものなので、RPC では閾値をかけない（'volatility' の 0.7/0.3 のような判定を足さない）。
--   'volatility'・'turnPrediction' は残す（旧キーの読み手が切り替わるまで。plan「切り替えの順」）。
--
-- 土台にした定義（書く前に本番の md5(prosrc) とファイルの本文の md5 の一致を読み取りで確かめる。plan「本番の手順」）:
--   get_predictions_by_date・get_predictions_by_date_light: 109（109 以降にこの2関数を変えたマイグレーションは無い）
--   get_today_races: 110（本番の md5 8f6cf80c52ef01ea842d5e8aa19736da、APPLIED.md:170）
--   下の3定義は、土台に 'inCaution' の1キーを足しただけ（scripts で機械的に差し込んだ）。
--   md5(prosrc)（AS $$ と $$; の間の本文）:
--     適用前（2026-10-13 本番で読み取り確認、109・110 のファイルと一致）: get_predictions_by_date 5d0ff6d89311bc368dc053e5e4bac166、
--       get_predictions_by_date_light a5c39f55938fc59550f740592bd4a877、get_today_races 8f6cf80c52ef01ea842d5e8aa19736da
--     適用後の期待値: get_predictions_by_date 012ecc95edba6dee8757a763c65d7d04、
--       get_predictions_by_date_light 2cd99677b99cb450b85e92ecd6cf0351、get_today_races bada0caa7995ba4a457362e1af70b942
--   適用の直前にもう一度読み取りで適用前の値と一致するかを確かめ、違えば適用しない。
--
-- 権限: 3関数とも SECURITY INVOKER（既定）。predictions は今も読んでいる表なので追加の GRANT は要らない。
--   関数の ACL は CREATE OR REPLACE で保たれる（113 の anon の EXECUTE の許可のリストに3関数とも入っている）。
--
-- 未適用の間の画面の挙動: 'inCaution' が届かないので、注意度は「—」（画面は volatility に戻らない）。
--   画面は機能フラグ（isInCautionEnabled）で隠してあるので、公開前に適用すればよい。
--
-- 適用後の確認:
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--   （MIGRATION_157_IN_CAUTION_KEYS。台帳で 157 が「適用済み」になるまで欠落は WARN、適用後は失敗）
--
-- 元に戻す: 109 の2関数と 110 の get_today_races の定義をそのまま再実行する。

-- function-exempt: get_predictions_by_date 既存関数の本文だけの差し替え。ACL は CREATE OR REPLACE で保たれる（113 の anon の許可のリスト）
-- function-exempt: get_predictions_by_date_light 既存関数の本文だけの差し替え。ACL は CREATE OR REPLACE で保たれる（113 の anon の許可のリスト）
-- function-exempt: get_today_races 既存関数の本文だけの差し替え。ACL は CREATE OR REPLACE で保たれる（113 の anon の許可のリスト）

SET LOCAL lock_timeout = '10s';

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
            -- BOA-822: イン崩れ注意度（勝率差の帯の全国実績）。朝の unified の生成が書いたものをそのまま返す
            'inCaution', (
              SELECT p.feature_contributions->'inCaution'
              FROM predictions p
              WHERE p.race_id = r.race_id AND p.model_id = 'unified'
              LIMIT 1
            ),
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
            -- BOA-822: イン崩れ注意度（勝率差の帯の全国実績）。朝の unified の生成が書いたものをそのまま返す
            'inCaution', (
              SELECT p.feature_contributions->'inCaution'
              FROM predictions p
              WHERE p.race_id = r.race_id AND p.model_id = 'unified'
              LIMIT 1
            ),
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
              -- 110（BOA-542）: 着順つきの結果があれば {rank1}、無ければ NULL。
              -- 画面の isRaceCancelled（src/utils/raceCancellation.js）がこれを見て、
              -- confirmed が残っていても結果のあるレースを中止扱いしない（BOA-525 と同じ判定）
              'result', (
                SELECT json_build_object('rank1', rr.rank1)
                FROM race_results rr
                WHERE rr.race_id = r.race_id AND rr.rank1 IS NOT NULL
              ),
              -- BOA-822: イン崩れ注意度（勝率差の帯の全国実績）。朝の unified の生成が書いたものをそのまま返す
              'inCaution', (
                SELECT p.feature_contributions->'inCaution'
                FROM predictions p
                WHERE p.race_id = r.race_id AND p.model_id = 'unified'
                LIMIT 1
              ),
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
-- 適用結果の自己検査
--   (1) 3関数の現行定義に inCaution が含まれること
--   (2) 既存のキーが消えていないこと（古い定義を土台にした回帰の検知。BOA-363・BOA-431）。
--       get_predictions_by_date(_light) は 109 の自己検査の条件をそのまま、get_today_races は 110 の result と volatility・turnPrediction
--   (3) anon が3関数を EXECUTE できること（ACL が保たれていること）
--   (4) 3関数が実際に実行できること
-- 満たさなければ例外になり、トランザクション内で実行していればロールバックされる。
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO missing
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_predictions_by_date', 'get_predictions_by_date_light', 'get_today_races')
    AND (
      p.prosrc NOT LIKE '%''inCaution''%'
      OR p.prosrc NOT LIKE '%''volatility''%'
      OR p.prosrc NOT LIKE '%''cancellationStatus''%'
      OR p.prosrc NOT LIKE '%''raceStage''%'
      OR (p.proname = 'get_today_races' AND (
            p.prosrc NOT LIKE '%''result'', (%'
            OR p.prosrc NOT LIKE '%''turnPrediction''%'))
      OR (p.proname <> 'get_today_races' AND (
            p.prosrc NOT LIKE '%''raceStatus'', res.race_status%'
            OR p.prosrc NOT LIKE '%''refundBoats'', res.refund_boats%'
            OR p.prosrc NOT LIKE '%''remark'', res.remark%'
            OR p.prosrc NOT LIKE '%''payoutRows''%FROM race_payouts pp%'
            OR p.prosrc NOT LIKE '%''weather''%'
            OR p.prosrc NOT LIKE '%''observedAt''%'
            OR p.prosrc NOT LIKE '%''isNoRace''%'
            OR p.prosrc NOT LIKE '%''popularityWide3''%'))
      OR (p.proname = 'get_predictions_by_date_light'
          AND p.prosrc NOT LIKE '%''payoutRows'', CASE%WHEN res.race_status IN (''no_race'', ''partial_refund'')%')
      OR (p.proname = 'get_predictions_by_date'
          AND (p.prosrc LIKE '%''payoutRows'', CASE%' OR p.prosrc NOT LIKE '%''turnPrediction''%'))
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '157 の検査に失敗（inCaution が無い、または既存のキーが欠けた関数）: %', missing;
  END IF;

  IF NOT has_function_privilege('anon', 'public.get_predictions_by_date(date)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.get_predictions_by_date_light(date)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.get_today_races()', 'EXECUTE') THEN
    RAISE EXCEPTION '157 の検査に失敗: anon が3関数のどれかを EXECUTE できません';
  END IF;

  PERFORM public.get_predictions_by_date('2000-01-01'::date);
  PERFORM public.get_predictions_by_date_light('2000-01-01'::date);
  PERFORM public.get_today_races();
END
$verify$;
