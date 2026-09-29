-- 110: get_today_races() の各レースに、着順つきの結果の有無（result.rank1）を足す（BOA-542）
--
-- 対応: src/components/race/TodaysVolatilityHighlights.jsx（ホームの注目レース）、
--       src/services/supabaseDataService.js getRaces（直接クエリの代替経路も同じ形にした）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが行う（docs/db-migration/APPLIED.md）。
--
-- 背景:
--   BOA-525 で画面の中止判定を「cancellation_status が confirmed かつ 結果（rank1）が無い」に変えた
--   （isRaceCancelled / hasRaceResult）。get_today_races は結果を返さないため、ホームの注目レースでは
--   従来どおり confirmed だけで中止扱いになり、confirmed が誤って残った「結果のあるレース」
--   （BOA-512: 2026-09-12 に32本）が一覧から抜けていた。
--
-- 変更（後方互換。既存のキーは1つも消さない・変えない）:
--   レースの json_build_object の 'raceStage' の後に 'result' を1つ足す。
--     'result'  race_results に rank1 のある行があれば {"rank1": <1着の艇番>}、無ければ NULL。
--   画面の結果オブジェクトと同じ形（result.rank1）にしたので、isRaceCancelled をそのまま渡せる。
--   raceStatus（BOA-543、不成立・一部返還）は足さない。ホームの注目レースは中止の判定しか使わず、
--   不成立も「レースは行われた」ので中止ではない（rank1 は入る）。使い道の無いキーで容量を増やさない。
--
-- 容量: 2026-09-29（144レース、うち結果あり143）の実測で、関数の出力は 233,103 字 → 下の定義の本体を
--   同じ時点に読み取りの SELECT として実行すると 236,838 字（+3,735 字、+1.6%）。
--
-- 土台にした定義: 103 の get_today_races。2026-09-29 に本番の pg_get_functiondef の本文
--   （$function$ の間）の md5 が、103 のファイル本文（AS $$ と $$; の間）の md5 と一致することを確認した:
--     afb6a15a2d8ecb4eb8abd7797ce11021（本番は 103 のまま。103 以降にこの関数を変えたマイグレーションは無い）
--   下の定義は、103 の定義に 'result' の1キーを足しただけ。
--
-- 権限: 関数は SECURITY INVOKER（既定）。race_results は RLS 有効・"Public read access"（SELECT, true）・
--   anon に SELECT 権限あり（2026-09-29 本番で確認）なので、追加の GRANT は要らない。
--   関数の ACL は CREATE OR REPLACE で保たれる。
--
-- 未適用の間の画面の挙動: 'result' が届かないため、今までどおり confirmed だけで中止扱いする。
--
-- 適用後の確認:
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--   （台帳で 110 が「適用済み」になるまで、get_today_races の result の欠落は WARN。適用後は失敗にする）
--
-- 元に戻す: 103 の get_today_races の定義をそのまま再実行する（画面は今までどおりの判定に戻る）。

SET LOCAL lock_timeout = '10s';

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
