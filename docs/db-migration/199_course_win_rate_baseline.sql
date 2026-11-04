-- 199: 全選手の同じコースの1着率（全国・直近3期）と、会場の同じコースの1着率（当地）を返す RPC get_course_win_rate_baseline
-- （BOA-1290、親 BOA-1287。設計: docs/design/course-grid-six-boats/spec.md §1.1・§6）
--
-- 使うのはレース詳細の枠別情報タブの「6艇の想定コース別成績」の「差」と「平均の値」（BOA-1292・1293・1294）。
-- フロントの口は src/services/supabaseDataService.js の getCourseWinRateBaseline(raceDate, venueCode)。
--
-- national（直近3期）: 公式の期別成績 racer_period_stats のうち calc_to < p_race_date の期を calc_from の新しい順に3つ
--   （レースの日と同じ日に終わる期は入れない。過去のレースで、その日より後に終わる期が入らない）。
--   その3期の starts > 0 の全選手（B2 を含む）で、コースごとに Σc{n}_p1 ÷ Σc{n}_entries（走の重み。選手ごとの率の平均ではない）。
--   進入数は公式の c{n}_entries。選手ページの直近3期（src/utils/racerOfficialPeriodStats.js の buildCourseRows）と同じ表・同じ列。
--   ※ buildCourseRows は選手ごとに「出走のある新しい3期」を取る。全国の平均は表全体の新しい3期で固定する（休んだ期のある選手は
--     その選手の3期が1期古くなるが、平均の側はそろえない。起票 BOA-1290 の決定）
-- venue（当地）: 当社データの実進入コース（race_results.actual_course_N）で、その会場の同じコースの1着率。
--   窓は [p_race_date − 730日, p_race_date)。6艇の表の「当地」行（getRacerScopedRaceStats の730日の窓 ＋ recordsBeforeRace）と同じ数え方:
--   着順の付いたレース（rank1 あり・race_status が no_race でない）、中止（races.cancellation_status = 'confirmed'）を除く、
--   実進入コースのある艇だけ（欠場の艇は実進入コースが null。本番 2026-11-04 で欠場181走のうち実進入コースあり0）。
--   1着は rank1 = 艇番（決まり手を問わない）。
--   ※ フロントの窓の始まりは「今日 − 730日」、ここは「レースの日 − 730日」。当社データは 2025-12-02 からなので、
--     2027-12 まではどちらも同じ範囲になる（その時点で注記の見直しと一緒に合わせる。supabaseDataService.js の getRacerVenueStats のコメント）
--
-- 返す値（jsonb の1つ。BOA-1292 がこの形を前提にする）:
--   { "terms": [{ "calc_from": "2024-11-01", "calc_to": "2025-04-30" }, …（古い順、最大3つ）],
--     "national": { "1": { "wins": n, "entries": n, "winRate": 百分率 | null }, … "6": {…} },
--     "venue": { "venueCode": n, "from": 日付 | null, "to": 日付 | null, "byCourse": { "1": {…}, … "6": {…} } } | null }
--   winRate は百分率（0〜100、小数4桁で丸め）。entries が0なら null（0% にしない）。
--   venue は p_venue_code が null なら null。from・to は数えたレースの最初と最後の日（数えたレースが無ければ null）。
--   期が1つも無ければ terms は []、national の各コースは wins 0・entries 0・winRate null。
--
-- 重さ（本番 2026-11-04、同じ問い合わせを EXPLAIN ANALYZE、共有バッファの読みだけでディスクの読みなし）:
--   national 28.7ms（racer_period_stats 24,165行の Seq Scan ×2、使う行 4,748）
--   venue（桐生 01）50.0ms（race_results 51,912行の Seq Scan と races の会場の索引の Hash Join、使うレース 2,193・走 13,138）
--   合わせて 80ms 前後。race_results は年に約2.6万行で増え、730日の窓が埋まる 2027-12 で約10万行（Seq Scan が倍の約100ms の見込み）。
--   前計算の表は要らない。重くなったら（ログで1秒を超えたら）会場×コース×日の前計算の表（compute_* を cron で作る形、
--   st_course_baseline と同じ）に分ける。
--
-- 権限: STABLE・SECURITY INVOKER・search_path 固定。anon・authenticated に EXECUTE（画面が匿名で呼ぶ）。
--   読む表（racer_period_stats・races・race_results）はいずれも RLS 有効で anon・authenticated に SELECT のポリシーと権限がある
--   （本番 2026-11-04 に has_table_privilege と pg_policy で確認）。表・ポリシーは変えない。
--
-- 適用の順: どちらが先でもよい。フロントの口を呼ぶ画面（BOA-1293）は、この関数が当たってから出す。
--   関数が無いと呼び出しは PGRST202 の例外になり、画面は取得の失敗として出す（0や null の平均にしない）。
--
-- 適用前の確認（読み取り）:
--   SELECT count(*) FROM pg_proc WHERE proname = 'get_course_win_rate_baseline';  期待: 0
-- 適用後の確認（読み取り）:
--   SELECT public.get_course_win_rate_baseline('2026-11-04'::date, 1::smallint);
--     期待: terms が 2024-11-01・2025-05-01・2025-11-01 の3つ、national."1".entries が下の照合の SQL と一致、venue.byCourse が6つ
--   照合（national の1コース。3期は 2024-11-01・2025-05-01・2025-11-01）:
--     SELECT sum(c1_p1) AS wins, sum(c1_entries) AS entries FROM racer_period_stats
--       WHERE starts > 0 AND calc_from IN ('2024-11-01', '2025-05-01', '2025-11-01');
--   SELECT has_function_privilege('anon', 'public.get_course_win_rate_baseline(date, smallint)', 'EXECUTE');  期待: true
--   SELECT p.provolatile, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.proname = 'get_course_win_rate_baseline';
--     期待: s・false・{search_path=public,pg_temp}
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js  期待: get_course_win_rate_baseline が [OK]
--
-- 戻し方: DROP FUNCTION IF EXISTS public.get_course_win_rate_baseline(date, smallint);
--   （画面は取得の失敗を出す。表・データは変えていない）
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.get_course_win_rate_baseline(
  p_race_date DATE,
  p_venue_code SMALLINT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH terms AS (
  -- レースの日より前に終わった公開済みの期の新しい3つ（calc_to = p_race_date の期は入れない）
  SELECT s.calc_from, s.calc_to
  FROM public.racer_period_stats s
  WHERE s.calc_to < p_race_date
  GROUP BY s.calc_from, s.calc_to
  ORDER BY s.calc_from DESC
  LIMIT 3
),
national_sums AS (
  SELECT
    COALESCE(SUM(s.c1_p1), 0)::BIGINT AS w1, COALESCE(SUM(s.c1_entries), 0)::BIGINT AS e1,
    COALESCE(SUM(s.c2_p1), 0)::BIGINT AS w2, COALESCE(SUM(s.c2_entries), 0)::BIGINT AS e2,
    COALESCE(SUM(s.c3_p1), 0)::BIGINT AS w3, COALESCE(SUM(s.c3_entries), 0)::BIGINT AS e3,
    COALESCE(SUM(s.c4_p1), 0)::BIGINT AS w4, COALESCE(SUM(s.c4_entries), 0)::BIGINT AS e4,
    COALESCE(SUM(s.c5_p1), 0)::BIGINT AS w5, COALESCE(SUM(s.c5_entries), 0)::BIGINT AS e5,
    COALESCE(SUM(s.c6_p1), 0)::BIGINT AS w6, COALESCE(SUM(s.c6_entries), 0)::BIGINT AS e6
  FROM public.racer_period_stats s
  JOIN terms t ON t.calc_from = s.calc_from AND t.calc_to = s.calc_to
  WHERE s.starts > 0
),
national_rows AS (
  SELECT v.course, v.wins, v.entries
  FROM national_sums n
  CROSS JOIN LATERAL (VALUES
    (1, n.w1, n.e1), (2, n.w2, n.e2), (3, n.w3, n.e3),
    (4, n.w4, n.e4), (5, n.w5, n.e5), (6, n.w6, n.e6)
  ) AS v(course, wins, entries)
),
venue_runs AS (
  -- その会場の [p_race_date − 730日, p_race_date) の着順の付いたレースの、実進入コースのある艇
  SELECT r.race_date, ac.course::INTEGER AS course, (rr.rank1 = ac.boat) AS is_win
  FROM public.races r
  JOIN public.race_results rr ON rr.race_id = r.race_id
  CROSS JOIN LATERAL (VALUES
    (1, rr.actual_course_1), (2, rr.actual_course_2), (3, rr.actual_course_3),
    (4, rr.actual_course_4), (5, rr.actual_course_5), (6, rr.actual_course_6)
  ) AS ac(boat, course)
  WHERE p_venue_code IS NOT NULL
    AND r.venue_code = p_venue_code
    AND r.race_date >= p_race_date - 730
    AND r.race_date < p_race_date
    AND r.cancellation_status IS DISTINCT FROM 'confirmed'
    AND rr.race_status IS DISTINCT FROM 'no_race'
    AND rr.rank1 IS NOT NULL
    AND ac.course BETWEEN 1 AND 6
),
venue_rows AS (
  SELECT c.course,
         COUNT(v.course) FILTER (WHERE v.is_win)::BIGINT AS wins,
         COUNT(v.course)::BIGINT AS entries
  FROM generate_series(1, 6) AS c(course)
  LEFT JOIN venue_runs v ON v.course = c.course
  GROUP BY c.course
)
SELECT jsonb_build_object(
  'terms', COALESCE(
    (SELECT jsonb_agg(jsonb_build_object('calc_from', t.calc_from, 'calc_to', t.calc_to) ORDER BY t.calc_from) FROM terms t),
    '[]'::jsonb
  ),
  'national', (
    SELECT jsonb_object_agg(
      n.course::TEXT,
      jsonb_build_object(
        'wins', n.wins,
        'entries', n.entries,
        'winRate', CASE WHEN n.entries > 0 THEN ROUND(n.wins * 100.0 / n.entries, 4) END
      )
    )
    FROM national_rows n
  ),
  'venue', CASE WHEN p_venue_code IS NULL THEN NULL ELSE jsonb_build_object(
    'venueCode', p_venue_code,
    'from', (SELECT MIN(v.race_date) FROM venue_runs v),
    'to', (SELECT MAX(v.race_date) FROM venue_runs v),
    'byCourse', (
      SELECT jsonb_object_agg(
        vr.course::TEXT,
        jsonb_build_object(
          'wins', vr.wins,
          'entries', vr.entries,
          'winRate', CASE WHEN vr.entries > 0 THEN ROUND(vr.wins * 100.0 / vr.entries, 4) END
        )
      )
      FROM venue_rows vr
    )
  ) END
);
$$;

COMMENT ON FUNCTION public.get_course_win_rate_baseline(DATE, SMALLINT) IS
  '全選手の同じコースの1着率（national: racer_period_stats の calc_to < レースの日の新しい3期、starts>0 の全選手の Σc{n}_p1/Σc{n}_entries）と、会場の同じコースの1着率（venue: 実進入コース、[レースの日−730日, レースの日)、中止・不成立を除く）を jsonb の1つで返す。レース詳細の6艇の想定コース別成績が呼ぶ。BOA-1290、199';

REVOKE ALL ON FUNCTION public.get_course_win_rate_baseline(DATE, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_win_rate_baseline(DATE, SMALLINT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_course_win_rate_baseline(DATE, SMALLINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_course_win_rate_baseline(DATE, SMALLINT) TO service_role;

COMMIT;
