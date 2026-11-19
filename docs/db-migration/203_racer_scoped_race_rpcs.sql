-- 203: レースの頁が選手の全走を6表の生の行で読むのをやめるための RPC 2本（Supabase の Egress・Log Ingestion の枠越えの主因の直し）
--   (1) get_racer_front_taking_counts  出走6選手の「前付けの走の件数」だけを返す（頁を開いただけで走る「イン屋」の札の読み）
--   (2) get_racer_scoped_race_rows     選手の走を「1走1行」にまとめて返す（タブを開いたときの読み）
--
-- 背景（本番の edge のログの調べ、2026-11-19）:
--   レースの頁は、出走6選手それぞれの全期間（730日の窓）の走を、画面から6表の生の行のまま読んでいた
--   （src/services/racerQueries2.js の getRacerScopedRaceStats。race_entries の後に races・race_results・race_conditions を
--   race_id の in() で、race_start_timings・exhibition_data は同じレースの6艇ぶんを読む）。
--   E2E の録画（2026-11-19 の本番の応答、428組）の実測で、1選手の中央は217走・3,464行・要求8本、1頁（6選手）で約2万行・要求 約50本。
--   2026-11-10（#2426）から、タブの上の出走6艇の欄が「イン屋」の札の判定にこの読みを使い、頁を開いただけで6選手ぶんが走る。
--   これを JS を実行するクローラーと E2E が大量に描き、REST の返す量（Egress）と要求の数（Log Ingestion）が枠を越えた。
--
-- (1) get_racer_front_taking_counts(p_racer_ids, p_since, p_before_race_id)
--   返す値: 選手ごとに1行（racer_id・runs・taken）。数える走が無い選手は行を返さない（画面は 0 走として扱う）。
--     runs  = 2〜6号艇で出て、実進入コース（race_results.actual_course_{艇番}）が 1〜6 で記録されている走
--     taken = そのうち、枠番より内のコースに入った走（actual_course < boat_number）
--   数える走は、画面の今までの数え方（getRacerScopedRaceStats の行 → src/utils/frontTaking.js の summarizeFrontTaking）と同じ:
--     race_id が p_since 以上（730日の窓）・p_before_race_id より前（表示中のレース自身と後の結果を混ぜない）、
--     races の行があり、結果が使える（rank1 があり、race_status が no_race でない。NULL は通常として通す）。
--   割合と札の下限（20走・30%）は SQL に入れない。画面側の1か所（frontTaking.js の frontTakingOfCounts）で判定する。
--   1頁で6行・要求1本（今までは約2万行・要求 約50本）。
--
-- (2) get_racer_scoped_race_rows(p_racer_id, p_since)
--   返す値（1走＝race_entries の1行につき1行。race_id・boat_number の順）:
--     race_id・boat_number・grade・f_count          race_entries（その選手の行）
--     race_date・venue_code・race_grade             races
--     ranks            [rank1..rank6]（艇番）        race_results。結果の行が無ければ null
--     race_status・winning_technique・payout_win    race_results
--     actual_courses   [艇番1..6 の実進入コース]     race_results。結果の行が無ければ null
--     race_stage・race_title・wave_height・series_day・is_final_day   race_conditions（行が無ければ全部 null）
--     st_rows          [[boat_number, start_timing, is_flying, is_late_start, finish_mark, entry_course], …]
--                      そのレースの race_start_timings の全艇（艇番の順）。1行も無ければ null
--     exhibition_rows  [[boat_number, exhibition_time], …] そのレースの exhibition_data の全艇（艇番の順）。1行も無ければ null
--   計算は入れない（表の値をそのまま返す）。ST の順位・内側の最速・展示の順位・欠場・不成立の除外などの派生は、
--     今までどおり画面側の1か所（src/services/racerScopedRaceRows.js の buildRacerScopedRaceRows）で行う。
--     src/pure/racerScopedRunTables.js がこの行を元の6つの配列の形へ戻して渡すので、規則は SQL と JS の2か所にならない。
--   量（同じ録画の428組の実測）: 行は 1/15.8、要求は 1/7.8、応答の本文は無圧縮で 1/2.95・gzip 後で 1/1.74。
--     中身（6艇ぶんの ST・展示）は同じなので、字の量は行数ほどは減らない。
--   行数: 1選手の窓は最大で約1460走（1日2走×730日）になりうる。PostgREST の1,000行の上限で黙って切れないよう、
--     画面は race_id・boat_number の順で .range() のページを読み切る（src/services/racerQueries4.js の fetchRacerScopedRunsOrNull）。
--
-- 2本とも、同じ表からの「6表の読み」と「RPC の道」が同じ値になることを scripts/maintenance/verify-racer-scoped-race-rpc.js（PGlite）が確かめる。
--
-- 窓: p_since 以上の race_id（YYYY-MM-DD-会場-R の文字列の比較。画面の racerHistoryCutoff() の日付をそのまま渡す。
--   今までの race_entries の .gte("race_id", cutoff) と同じ比較）。p_before_race_id は画面の JS の文字列の比較（r.raceId < beforeRaceId）と
--   同じ結果になるよう、バイトの順（COLLATE "C"）で比べる。
--
-- 重さ: race_entries の索引 idx_race_entries_racer_id_race_id（racer_id, race_id DESC）で選手の走を引き、
--   races・race_results・race_conditions は主キーで1行ずつ、race_start_timings・exhibition_data は主キー（race_id, boat_number）の
--   先頭の列で6行ずつ引く。(1) は6選手×約220走×2表、(2) は1選手 約220走×（3+12）行。本番での EXPLAIN ANALYZE は未実施（適用後の確認に入れた）。
--
-- 権限: STABLE・SECURITY INVOKER・search_path 固定。anon・authenticated・service_role に EXECUTE（画面が匿名で呼ぶ。113 の方針どおり明示）。
--   読む6表はいずれも RLS 有効で anon・authenticated に SELECT のポリシーと権限がある
--   （docs/reference/schema-snapshot.json、2026-10-27 の写し）。表・ポリシー・データは変えない。
--
-- 適用の順: どちらが先でもよい。関数が無い間（PGRST202・42883・権限なし）、画面は今までの6表の読みに落ちる
--   （値は同じ。量は減らず、1頁に失敗の要求が最大7本増える）。量が減るのは、この2本が本番に当たった後。
--
-- 適用前の確認（読み取り）:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('get_racer_scoped_race_rows', 'get_racer_front_taking_counts');  期待: 0
-- 適用後の確認（読み取り。3024 は例。出走の多い選手の登録番号に替えてよい）:
--   SELECT count(*) FROM public.get_racer_scoped_race_rows(3024, to_char(current_date - 730, 'YYYY-MM-DD'));
--   SELECT count(*) FROM race_entries WHERE racer_id = 3024 AND race_id >= to_char(current_date - 730, 'YYYY-MM-DD');
--     期待: 2つが同じ数
--   SELECT * FROM public.get_racer_front_taking_counts(ARRAY[3024], to_char(current_date - 730, 'YYYY-MM-DD'), '9999');
--     期待: runs が上の走の数以下・taken が runs 以下
--   EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.get_racer_scoped_race_rows(3024, to_char(current_date - 730, 'YYYY-MM-DD'));
--   EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.get_racer_front_taking_counts(ARRAY[3024], to_char(current_date - 730, 'YYYY-MM-DD'), '9999');
--     期待: race_entries・race_start_timings・exhibition_data に Seq Scan が出ていないこと。100ms 前後より短い（目安・根拠なし）
--   SELECT has_function_privilege('anon', 'public.get_racer_scoped_race_rows(integer, text)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.get_racer_front_taking_counts(integer[], text, text)', 'EXECUTE');  期待: true・true
--   SELECT p.proname, p.provolatile, p.prosecdef, p.proconfig FROM pg_proc p
--     WHERE p.proname IN ('get_racer_scoped_race_rows', 'get_racer_front_taking_counts');
--     期待: どちらも s・false・{"search_path=public, pg_temp"}
--   node --env-file=.env.local scripts/maintenance/check-anon-access.js  期待: 想定外の anon の関数なし
--   適用後も呼び出しが PGRST202 のままなら PostgREST のスキーマのキャッシュが古い: NOTIFY pgrst, 'reload schema';（オーナーが SQL Editor で）
--   その後、E2E の録画の撮り直し（e2e-rerecord）で、録画がこの2本の応答を持つ（撮り直すまで PR の E2E はこの要求を本番へ素通しする）。
--
-- 戻し方: DROP FUNCTION IF EXISTS public.get_racer_scoped_race_rows(integer, text);
--         DROP FUNCTION IF EXISTS public.get_racer_front_taking_counts(integer[], text, text);
--   （画面は今までの6表の読みに落ちる。表・データは変えていない）
BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.get_racer_front_taking_counts(
  p_racer_ids INTEGER[],
  p_since TEXT,
  p_before_race_id TEXT
)
RETURNS TABLE (
  racer_id INTEGER,
  runs INTEGER,
  taken INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    re.racer_id,
    count(*)::INTEGER AS runs,
    (count(*) FILTER (WHERE ac.course < re.boat_number))::INTEGER AS taken
  FROM public.race_entries re
  JOIN public.races r ON r.race_id = re.race_id
  JOIN public.race_results rr ON rr.race_id = re.race_id
  CROSS JOIN LATERAL (
    SELECT CASE re.boat_number
      WHEN 1 THEN rr.actual_course_1
      WHEN 2 THEN rr.actual_course_2
      WHEN 3 THEN rr.actual_course_3
      WHEN 4 THEN rr.actual_course_4
      WHEN 5 THEN rr.actual_course_5
      WHEN 6 THEN rr.actual_course_6
    END AS course
  ) ac
  WHERE re.racer_id = ANY (p_racer_ids)
    AND re.race_id >= p_since
    AND re.race_id::TEXT < p_before_race_id COLLATE "C"
    AND re.boat_number >= 2
    AND ac.course BETWEEN 1 AND 6
    AND rr.rank1 IS NOT NULL
    AND rr.race_status IS DISTINCT FROM 'no_race'
  GROUP BY re.racer_id
$$;

REVOKE ALL ON FUNCTION public.get_racer_front_taking_counts(INTEGER[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_racer_front_taking_counts(INTEGER[], TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_racer_front_taking_counts(INTEGER[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_racer_front_taking_counts(INTEGER[], TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_racer_scoped_race_rows(
  p_racer_id INTEGER,
  p_since TEXT
)
RETURNS TABLE (
  race_id TEXT,
  boat_number SMALLINT,
  grade TEXT,
  f_count SMALLINT,
  race_date DATE,
  venue_code SMALLINT,
  race_grade TEXT,
  ranks SMALLINT[],
  race_status TEXT,
  winning_technique TEXT,
  payout_win INTEGER,
  actual_courses SMALLINT[],
  race_stage TEXT,
  race_title TEXT,
  wave_height SMALLINT,
  series_day SMALLINT,
  is_final_day BOOLEAN,
  st_rows JSONB,
  exhibition_rows JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    re.race_id::TEXT,
    re.boat_number,
    re.grade::TEXT,
    re.f_count,
    r.race_date,
    r.venue_code,
    r.race_grade::TEXT,
    CASE WHEN rr.race_id IS NULL THEN NULL
      ELSE ARRAY[rr.rank1, rr.rank2, rr.rank3, rr.rank4, rr.rank5, rr.rank6]
    END AS ranks,
    rr.race_status,
    rr.winning_technique::TEXT,
    rr.payout_win,
    CASE WHEN rr.race_id IS NULL THEN NULL
      ELSE ARRAY[
        rr.actual_course_1, rr.actual_course_2, rr.actual_course_3,
        rr.actual_course_4, rr.actual_course_5, rr.actual_course_6
      ]
    END AS actual_courses,
    rc.race_stage::TEXT,
    rc.race_title::TEXT,
    rc.wave_height,
    rc.series_day,
    rc.is_final_day,
    (
      SELECT jsonb_agg(
        jsonb_build_array(
          s.boat_number, s.start_timing, s.is_flying, s.is_late_start, s.finish_mark, s.entry_course
        )
        ORDER BY s.boat_number
      )
      FROM public.race_start_timings s
      WHERE s.race_id = re.race_id
    ) AS st_rows,
    (
      SELECT jsonb_agg(jsonb_build_array(e.boat_number, e.exhibition_time) ORDER BY e.boat_number)
      FROM public.exhibition_data e
      WHERE e.race_id = re.race_id
    ) AS exhibition_rows
  FROM public.race_entries re
  LEFT JOIN public.races r ON r.race_id = re.race_id
  LEFT JOIN public.race_results rr ON rr.race_id = re.race_id
  LEFT JOIN public.race_conditions rc ON rc.race_id = re.race_id
  WHERE re.racer_id = p_racer_id
    AND re.race_id >= p_since
  ORDER BY re.race_id, re.boat_number
$$;

REVOKE ALL ON FUNCTION public.get_racer_scoped_race_rows(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_racer_scoped_race_rows(INTEGER, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_racer_scoped_race_rows(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_racer_scoped_race_rows(INTEGER, TEXT) TO service_role;

COMMIT;
