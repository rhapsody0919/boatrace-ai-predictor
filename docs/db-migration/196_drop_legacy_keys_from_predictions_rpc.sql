-- 196: get_predictions_by_date・get_predictions_by_date_light の応答から、廃止した3モデルの点（entries[].aiScoreStandard・
--      aiScoreSafeBet・aiScoreUpsetFocus）と予想オッズ（races[].predictionOdds）を外す（BOA-1126、基盤の計画 R1-4）
--
-- 設計: docs/design/legacy-prediction-cleanup/plan.md §3 の R1-4。/api/predictions は #1906（BOA-1110）で2欄を名指しで外し済み。
--   同じ RPC は anon キーで直接呼べるので、RPC の側でも外す。
--
-- 変えないもの（オーナー決定 D1 2026-10-28「/holmes は tinaba の担当」）:
--   表 prediction_odds・列 race_entries.ai_score_*・predictions の safeBet・upsetFocus の行と、それを書く処理は残す。
--   /holmes（Moriarty）は表を直接読み、この RPC は呼ばない。'predictions'（モデル別の欄）も今のまま。
--
-- 読み手（2026-11-03、origin/master c750f5c88 の grep と hq の grep。読み取りのみ）:
--   src: RPC 直のフォールバック（supabaseDataService.js）は aiScore* を読まない（BOA-1110）。predictionOdds を読む所は無い
--   api: api/_lib/predictionsResponse.js が2欄を外して返す（#1906）
--   hq: /api/predictions を叩くだけ（2欄はもう届いていない）。表・RPC を直接は読まない
--
-- 土台: 157 の2関数（157 以降にこの2関数の本文を変えたマイグレーションは無い。187 は ALTER で search_path を付けただけ）。
--   本文は 157 から次だけを機械的に外した: entries の aiScore* の3行、レース直下の 'predictionOdds' のサブクエリ、
--   157 で関数1の本文に紛れ込んだ見出しのコメント（2b）。187 の search_path を保つため SET search_path を書く。
--   適用前の md5(prosrc)（2026-11-03 本番で読み取り確認、187 の記録と一致）:
--     get_predictions_by_date 012ecc95edba6dee8757a763c65d7d04、get_predictions_by_date_light 2cd99677b99cb450b85e92ecd6cf0351
--   適用後の md5(prosrc)（PGlite で 157 の本文に当てて得た値。verify-predictions-rpc-legacy-keys-migration.js が照合）:
--     get_predictions_by_date 5a277551136c2b20c7e3fda2f552bf75、get_predictions_by_date_light 15ee9f0a40db9d14f5e7b1ebf23cc086
--   下の前提の検査は、本番の本文がこの適用前・適用後のどちらでもなければ、何も変えずに失敗する
--   （別の変更が先に入っている。土台を取り直す）。適用後の値も受け付けるのは、2回目の実行を通すため。
--
-- 権限: SECURITY INVOKER（既定）のまま。関数の ACL は CREATE OR REPLACE で保たれる（113 の anon の EXECUTE の許可）。
--
-- 互換: 画面・/api は2欄を読まないので、適用の前後で変わらない。変わるのは anon キーで RPC を直接呼んだときの応答だけ
--   （欄が減り、prediction_odds を引くサブクエリが1本減る）。
--
-- 適用: オーナーの db-apply（時間帯の制約なし。関数の差し替えだけで、表のロックは取らない）。
-- 適用後の確認:
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--   （196 が台帳で「適用済み」になると、2欄が残っていたら失敗。未適用の間は WARN）
--
-- 元に戻す: 新しい番号のマイグレーションで、157 の2関数の本文（get_today_races は含めない）に
--   SET search_path = public, pg_temp を付けて当て直す。157 のファイルをそのまま流すと、SET が無いので3関数とも
--   187 の search_path を失い、get_today_races まで置き換わる（157 の頭の「元に戻す」は 187 より前の記述で使えない）。
--   戻しの SQL はこのファイルに字面のまま貼らない（verify-rpc-key-regression.js はコメントの中の関数定義も
--   最新の定義として拾う）。手順の検証は verify-predictions-rpc-legacy-keys-migration.js の (g)。
--
-- CREATE OR REPLACE が保つのは ACL と所有者だけ。STABLE・SET search_path は下に書き、SECURITY DEFINER は付けない
--   （157 と同じ INVOKER）。末尾の自己検査で provolatile・proconfig・prosecdef を確かめる。

-- function-exempt: get_predictions_by_date 既存関数の本文だけの差し替え。ACL は CREATE OR REPLACE で保たれる（113 の anon の許可のリスト）
-- function-exempt: get_predictions_by_date_light 既存関数の本文だけの差し替え。ACL は CREATE OR REPLACE で保たれる（113 の anon の許可のリスト）

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ----------------------------------------------------------------------------
-- 前提の検査: 本番の2関数が 157 の本文のまま（187 の search_path つき）であること
-- ----------------------------------------------------------------------------
DO $precheck$
DECLARE
  drifted text;
BEGIN
  SELECT string_agg(p.proname || '=' || md5(p.prosrc), ', ') INTO drifted
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (
      (p.proname = 'get_predictions_by_date'
        AND md5(p.prosrc) <> '012ecc95edba6dee8757a763c65d7d04'
        AND md5(p.prosrc) <> '5a277551136c2b20c7e3fda2f552bf75')
      OR (p.proname = 'get_predictions_by_date_light'
        AND md5(p.prosrc) <> '2cd99677b99cb450b85e92ecd6cf0351'
        AND md5(p.prosrc) <> '15ee9f0a40db9d14f5e7b1ebf23cc086')
    );
  IF drifted IS NOT NULL THEN
    RAISE EXCEPTION '196 の前提の検査に失敗（本番の本文が 157 とも 196 とも違う。土台を取り直す）: %', drifted;
  END IF;
END
$precheck$;

CREATE OR REPLACE FUNCTION public.get_predictions_by_date(target_date date)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
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
                  'global2Rate', e.global_2rate::text
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

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_predictions_by_date_light(target_date date)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
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
                  'boat2Rate', e.boat_2rate::text
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
--   (1) 2関数の現行定義に aiScore*・predictionOdds・prediction_odds が無いこと
--   (2) 既存のキーが消えていないこと（157 の自己検査の条件と同じ。古い定義を土台にした回帰の検知。BOA-363・BOA-431）
--   (3) search_path が public, pg_temp のまま（187）、STABLE、SECURITY INVOKER であること。本文の md5 が上の適用後の値であること
--   (4) anon が2関数を EXECUTE できること（ACL が保たれていること）
--   (5) 2関数が実際に実行できること
-- 満たさなければ例外になり、トランザクション全体が戻る。
-- ----------------------------------------------------------------------------
DO $verify$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_predictions_by_date', 'get_predictions_by_date_light')
    AND (
      p.prosrc LIKE '%aiScore%'
      OR p.prosrc LIKE '%predictionOdds%'
      OR p.prosrc LIKE '%prediction_odds%'
      OR p.prosrc NOT LIKE '%''inCaution''%'
      OR p.prosrc NOT LIKE '%''volatility''%'
      OR p.prosrc NOT LIKE '%''cancellationStatus''%'
      OR p.prosrc NOT LIKE '%''raceStage''%'
      OR p.prosrc NOT LIKE '%''racerId''%'
      OR p.prosrc NOT LIKE '%''exhibitionData''%'
      OR p.prosrc NOT LIKE '%''predictions''%'
      OR p.prosrc NOT LIKE '%''raceStatus'', res.race_status%'
      OR p.prosrc NOT LIKE '%''refundBoats'', res.refund_boats%'
      OR p.prosrc NOT LIKE '%''remark'', res.remark%'
      OR p.prosrc NOT LIKE '%''payoutRows''%FROM race_payouts pp%'
      OR p.prosrc NOT LIKE '%''weather''%'
      OR p.prosrc NOT LIKE '%''observedAt''%'
      OR p.prosrc NOT LIKE '%''isNoRace''%'
      OR p.prosrc NOT LIKE '%''popularityWide3''%'
      OR (p.proname = 'get_predictions_by_date_light'
          AND p.prosrc NOT LIKE '%''payoutRows'', CASE%WHEN res.race_status IN (''no_race'', ''partial_refund'')%')
      OR (p.proname = 'get_predictions_by_date'
          AND (p.prosrc LIKE '%''payoutRows'', CASE%' OR p.prosrc NOT LIKE '%''turnPrediction''%'))
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR p.provolatile <> 's'
      OR p.prosecdef
      OR (p.proname = 'get_predictions_by_date' AND md5(p.prosrc) <> '5a277551136c2b20c7e3fda2f552bf75')
      OR (p.proname = 'get_predictions_by_date_light' AND md5(p.prosrc) <> '15ee9f0a40db9d14f5e7b1ebf23cc086')
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '196 の検査に失敗（外す欄が残る、既存のキーが欠けた、属性か本文が想定と違う関数）: %', bad;
  END IF;

  IF NOT has_function_privilege('anon', 'public.get_predictions_by_date(date)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.get_predictions_by_date_light(date)', 'EXECUTE') THEN
    RAISE EXCEPTION '196 の検査に失敗: anon が2関数のどれかを EXECUTE できません';
  END IF;

  PERFORM public.get_predictions_by_date('2000-01-01'::date);
  PERFORM public.get_predictions_by_date_light('2000-01-01'::date);
END
$verify$;

COMMIT;
