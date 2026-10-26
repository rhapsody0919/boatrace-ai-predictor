-- 181: /today の X 投稿の型 b（v2「今日走る選手のコース別1着率」、hq 2026-10-27 オーナー決定）の材料。
-- 級別の全国のコース別1着率（各走の race_entries.grade で数える）と、今日の選手のコース別の走数・1着数を返す RPC。
-- 1着は決まり手を問わない（rank1 = 枠番）。racer_course_technique_stats（098）は逃げ・まくりの数だけで、
-- 4コースの1着数と級別の全国の値を持たないので、新しい関数にする（098 の表・関数は変えない）。
--
-- 呼ぶのは朝の一覧の生成（scripts/daily/generate-morning-digest.js、完全性チェックを通った回だけ。実際は1日1回）だけ。
-- 結果は morning_digest_days.notes.courseWin に入れ、/today の計画と撮影用のページはそれを読む（この関数は呼ばない）。
--
-- 母集団（098 の compute_racer_course_technique_stats の base と同じ条件）:
--   races × race_results × race_entries、実進入コースあり・決まり手あり・中止でない・不成立でない・欠場でない・racer_id あり、
--   race_date <= p_until（呼び出し側は「前々日」を渡す。前日の進入は当日 7:00 の K ファイル同期まで埋まらないため）。
--   窓の始まりはデータのある最初の日（098 と同じ「利用可能な全期間」）
--
-- 返す値: jsonb の1つ（集合で返すと PostgREST の上限1000行で黙って切れる。1日の選手は 530〜634人×6コースで約3,700行。
--   system-architect の審査 P0）
--   { "window_start": 日付, "window_end": 日付,
--     "grade": [{grade, course, runs, wins}]          … 級（A1・A2・B1・B2）× 実進入コース（全国、各走の級）
--     "racer": [{racer_id, course, runs, wins, off_frame_runs}] … p_racer_ids の選手 × 実進入コース。
--              off_frame_runs は枠番と違うコースに入った走数（1コースなら「2〜6号艇から1コースに入った回数」＝前付けの回数） }
--   母集団が空なら window_* は null、配列は []
--
-- 費用の目安: 2026-10-27 の本番で同等の問い合わせが 2.4〜2.9 秒（30万行、共有バッファの読みで、ディスクの読みなし。一時ファイル 約20〜28MB）。
--   効く statement_timeout は authenticator の 8 秒、クライアントの打ち切りは 15 秒。窓は全期間なのでデータとともに伸びる。
--   線はログの「コース別1着率の RPC: Nms」（通信を含む呼び出し側の時間。手元から 10/27 に約5秒）で見る。6秒を超えたら
--   （DB の 8 秒の打ち切りの手前）、窓の上限（直近N日）を入れて見直す
--
-- 適用の順: どちらが先でもよい。コードは関数が無い（PGRST202）ときは notes.courseWin を unavailable にして一覧を作り、
--   /today は今の型 a で送る（型 b は材料がそろった日だけ）
--
-- 適用前の確認（読み取り）:
--   SELECT count(*) FROM pg_proc WHERE proname = 'compute_today_course_win_stats';  期待: 0
--
-- 適用後の確認（読み取り。SQL Editor で）:
--   SELECT jsonb_array_length(r->'grade') AS grade_rows, jsonb_array_length(r->'racer') AS racer_rows, r->>'window_end' AS window_end
--     FROM (SELECT public.compute_today_course_win_stats(
--       (now() AT TIME ZONE 'Asia/Tokyo')::date - 2,
--       ARRAY(SELECT DISTINCT e.racer_id FROM race_entries e JOIN races ra ON ra.race_id = e.race_id
--             WHERE ra.race_date = (now() AT TIME ZONE 'Asia/Tokyo')::date AND e.racer_id IS NOT NULL)) AS r) x;
--     期待: grade_rows が 24前後（4級×6コース）、racer_rows が 1000 を超えても切れない（10/27 の出走表で 1,200 前後の見込み）、window_end が前々日
--   SELECT has_function_privilege('anon', 'public.compute_today_course_win_stats(date, integer[])', 'EXECUTE');  期待: false
--   翌朝の一覧で: SELECT notes->'courseWin'->>'status', notes->'courseWin'->'counts' FROM morning_digest_days ORDER BY digest_date DESC LIMIT 1;
--     期待: ok と段ごとの候補の数（1コース 80〜100 前後）
--
-- 戻し方: DROP FUNCTION IF EXISTS public.compute_today_course_win_stats(date, integer[]);
--   （呼び出し側は関数が無い状態に倒れ、型 b を出さずに型 a で送る）

CREATE OR REPLACE FUNCTION public.compute_today_course_win_stats(
  p_until DATE,
  p_racer_ids INTEGER[]
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH base AS MATERIALIZED (
  SELECT
    ra.race_date,
    e.racer_id,
    e.grade::TEXT                    AS grade,
    e.boat_number,
    (rr.rank1 = e.boat_number)       AS is_win,
    CASE e.boat_number
      WHEN 1 THEN rr.actual_course_1 WHEN 2 THEN rr.actual_course_2
      WHEN 3 THEN rr.actual_course_3 WHEN 4 THEN rr.actual_course_4
      WHEN 5 THEN rr.actual_course_5 WHEN 6 THEN rr.actual_course_6
    END AS course
  FROM races ra
  JOIN race_results rr ON rr.race_id = ra.race_id
  JOIN race_entries e  ON e.race_id  = ra.race_id
  WHERE rr.actual_course_1 IS NOT NULL
    AND rr.winning_technique IS NOT NULL AND rr.winning_technique <> ''
    AND COALESCE(rr.is_cancelled, false) = false
    AND COALESCE(rr.is_no_race, false)   = false
    AND COALESCE(e.is_absent, false)     = false
    AND e.racer_id IS NOT NULL
    AND ra.race_date <= p_until
),
grade_rows AS (
  SELECT b.grade, b.course::INTEGER AS course,
         COUNT(*)::INTEGER AS runs,
         COUNT(*) FILTER (WHERE b.is_win)::INTEGER AS wins
  FROM base b
  WHERE b.course BETWEEN 1 AND 6
    AND b.grade IN ('A1', 'A2', 'B1', 'B2')
  GROUP BY b.grade, b.course
),
racer_rows AS (
  SELECT b.racer_id, b.course::INTEGER AS course,
         COUNT(*)::INTEGER AS runs,
         COUNT(*) FILTER (WHERE b.is_win)::INTEGER AS wins,
         COUNT(*) FILTER (WHERE b.boat_number <> b.course)::INTEGER AS off_frame_runs
  FROM base b
  -- 使うのは 1コース（1号艇の段と前付けの判定）と 4コース（4号艇の段）だけ。全コースだと 10/27 で 3,706件・約460KB
  WHERE b.course IN (1, 4)
    AND b.racer_id = ANY (p_racer_ids)
  GROUP BY b.racer_id, b.course
)
SELECT jsonb_build_object(
  'window_start', (SELECT MIN(race_date) FROM base),
  'window_end',   (SELECT MAX(race_date) FROM base),
  'grade', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.grade, g.course) FROM grade_rows g), '[]'::jsonb),
  'racer', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.racer_id, r.course) FROM racer_rows r), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.compute_today_course_win_stats(DATE, INTEGER[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_today_course_win_stats(DATE, INTEGER[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_today_course_win_stats(DATE, INTEGER[]) TO service_role;

COMMENT ON FUNCTION public.compute_today_course_win_stats(DATE, INTEGER[]) IS
  '/today の X 投稿の型 b の材料（181）。jsonb の1つで、級別の全国のコース別1着率（grade、各走の級）と、指定の選手のコース別の走数・1着数・枠番と違うコースに入った走数（racer）、窓（window_start・window_end）。母集団は compute_racer_course_technique_stats と同じ、race_date <= p_until。朝の一覧の生成だけが呼ぶ';
