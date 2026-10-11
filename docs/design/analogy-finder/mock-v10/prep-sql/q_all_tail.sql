-- 1回の実行で Q1（条件別の決着）・Q2（若松×G1×優勝戦の明細）・Q3（全国×優勝戦の艇と着順で絞った指標）を返す。
-- Q1 行（m: は先頭6要素のみ。チャンク1は全要素で取得済み）= [unit, n, n_kb, n_main, dmin, dmax, r1[1..6], wc[c1..c6,NULL], waku_nari, course_all_known, round_null, grade_null, tech_raw{}]
--   unit: all / v:会場 / g:グレード(NULL含む) / r:ラウンド(NULL含む) / x:20G1yusho / m:YYYY-MM
-- Q2 行 = [race_id, race_date, source, rank1, rank2, rank3, tech_raw, fin_by_boat, code_by_boat, st_by_boat, st_rank_by_boat, course_by_boat]
--   ST 順位: 返還艇（F・出遅れ）と ST 不明は NULL。残りの艇で小さい順、同タイムは同順位（min。例: 1,1,3）
-- Q3 行 = [k, t, n_all, n_hit, n_b, ind{name:[all, hit, b]}, nulls{...}]
--   hit = 艇 k の着 <= t、b = 1号艇以外が1着（rank1 <> 1）
, u AS (
  SELECT p.*, unit FROM pool p
  CROSS JOIN LATERAL unnest(ARRAY['all', 'v:' || p.venue_code, 'g:' || coalesce(p.grade, 'NULL'), 'r:' || coalesce(p.round, 'NULL'),
      'm:' || to_char(p.race_date, 'YYYY-MM')]
    || CASE WHEN p.venue_code = 20 AND p.grade = 'G1' AND p.round = 'yusho' THEN ARRAY['x:20G1yusho'] ELSE '{}'::text[] END) AS unit
),
agg AS (
  SELECT unit, count(*) n, count(*) FILTER (WHERE source = 'kb') n_kb, count(*) FILTER (WHERE source = 'main') n_main,
    min(race_date) dmin, max(race_date) dmax,
    ARRAY[count(*) FILTER (WHERE rank1 = 1), count(*) FILTER (WHERE rank1 = 2), count(*) FILTER (WHERE rank1 = 3),
          count(*) FILTER (WHERE rank1 = 4), count(*) FILTER (WHERE rank1 = 5), count(*) FILTER (WHERE rank1 = 6)] r1,
    ARRAY[count(*) FILTER (WHERE winner_course = 1), count(*) FILTER (WHERE winner_course = 2), count(*) FILTER (WHERE winner_course = 3),
          count(*) FILTER (WHERE winner_course = 4), count(*) FILTER (WHERE winner_course = 5), count(*) FILTER (WHERE winner_course = 6),
          count(*) FILTER (WHERE winner_course IS NULL)] wc,
    count(*) FILTER (WHERE course_by_boat = ARRAY[1,2,3,4,5,6]::smallint[]) waku_nari,
    count(*) FILTER (WHERE array_position(course_by_boat, NULL) IS NULL) course_known,
    count(*) FILTER (WHERE round IS NULL) round_null, count(*) FILTER (WHERE grade IS NULL) grade_null
  FROM u GROUP BY unit
),
tech AS (
  SELECT unit, jsonb_object_agg(k, c) t FROM (SELECT unit, coalesce(tech_raw, 'NULL') k, count(*) c FROM u WHERE unit NOT LIKE 'm:%' GROUP BY 1, 2) z GROUP BY unit
),
q1 AS (
  SELECT jsonb_agg(CASE WHEN a.unit LIKE 'm:%' THEN jsonb_build_array(a.unit, a.n, a.n_kb, a.n_main, a.dmin, a.dmax)
    ELSE jsonb_build_array(a.unit, a.n, a.n_kb, a.n_main, a.dmin, a.dmax, a.r1, a.wc, a.waku_nari, a.course_known, a.round_null, a.grade_null, t.t) END ORDER BY a.unit) j
  FROM agg a LEFT JOIN tech t USING (unit)
),
q2 AS (
  SELECT jsonb_agg(jsonb_build_array(p.race_id, p.race_date, p.source, p.rank1, p.rank2, p.rank3, p.tech_raw, p.fin_by_boat, p.code_by_boat, p.st_by_boat,
      ARRAY(SELECT CASE WHEN p.st_by_boat[i] IS NULL THEN NULL ELSE 1 + (SELECT count(*) FROM unnest(p.st_by_boat) x WHERE x < p.st_by_boat[i]) END
            FROM generate_series(1, 6) i ORDER BY i),
      p.course_by_boat) ORDER BY p.race_date) j
  FROM pool p WHERE p.venue_code = 20 AND p.grade = 'G1' AND p.round = 'yusho'
),
yr AS (
  SELECT p.rank1, p.fin_by_boat f, p.code_by_boat c, p.st_by_boat s, p.ret_by_boat rt, p.course_by_boat cb,
    (p.fin_by_boat[1] IS NULL OR p.fin_by_boat[1] > 3) AS b1d,
    CASE WHEN p.st_by_boat[1] IS NULL THEN NULL ELSE 1 + (SELECT count(*) FROM unnest(p.st_by_boat) x WHERE x < p.st_by_boat[1]) END AS b1_st_rank
  FROM pool p WHERE p.round = 'yusho'
),
kt AS (
  SELECT k, t, yr.rank1 <> 1 AS b,
    coalesce(yr.f[k] <= t, false) AS hit,
    (k <> 1 AND yr.b1d) AS i_b1d,
    (k <> 1 AND coalesce(yr.b1_st_rank >= 4, false)) AS i_b1s,
    (yr.s[k] IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(yr.s) x WHERE x < yr.s[k])) AS i_st1_tie,
    (yr.s[k] IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(yr.s) x WHERE x < yr.s[k])
       AND (SELECT count(*) FROM unnest(yr.s) x WHERE x = yr.s[k]) = 1) AS i_st1_solo,
    EXISTS (SELECT 1 FROM generate_series(1, k - 1) j
            WHERE yr.rt[j] OR yr.c[j] LIKE 'S%' OR yr.c[j] IN ('F', 'L', 'L0', 'L1')) AS i_ib,
    coalesce(yr.cb[k] < k, false) AS i_md,
    (k <> 1 AND yr.b1_st_rank IS NULL) AS nl_b1st,
    (yr.s[k] IS NULL) AS nl_stk,
    (yr.cb[k] IS NULL) AS nl_cbk
  FROM yr CROSS JOIN generate_series(1, 6) k CROSS JOIN (VALUES (1), (3)) tt(t)
),
q3 AS (
  SELECT jsonb_agg(jsonb_build_array(k, t, n_all, n_hit, n_b, ind) ORDER BY k, t) j FROM (
    SELECT k, t, count(*) n_all, count(*) FILTER (WHERE hit) n_hit, count(*) FILTER (WHERE b) n_b,
      jsonb_build_object(
        'b1d', ARRAY[count(*) FILTER (WHERE i_b1d), count(*) FILTER (WHERE i_b1d AND hit), count(*) FILTER (WHERE i_b1d AND b)],
        'b1s', ARRAY[count(*) FILTER (WHERE i_b1s), count(*) FILTER (WHERE i_b1s AND hit), count(*) FILTER (WHERE i_b1s AND b)],
        'st1_tie', ARRAY[count(*) FILTER (WHERE i_st1_tie), count(*) FILTER (WHERE i_st1_tie AND hit), count(*) FILTER (WHERE i_st1_tie AND b)],
        'st1_solo', ARRAY[count(*) FILTER (WHERE i_st1_solo), count(*) FILTER (WHERE i_st1_solo AND hit), count(*) FILTER (WHERE i_st1_solo AND b)],
        'ib', ARRAY[count(*) FILTER (WHERE i_ib), count(*) FILTER (WHERE i_ib AND hit), count(*) FILTER (WHERE i_ib AND b)],
        'md', ARRAY[count(*) FILTER (WHERE i_md), count(*) FILTER (WHERE i_md AND hit), count(*) FILTER (WHERE i_md AND b)],
        'null_b1_st', ARRAY[count(*) FILTER (WHERE nl_b1st), count(*) FILTER (WHERE nl_b1st AND hit), count(*) FILTER (WHERE nl_b1st AND b)],
        'null_st_k', ARRAY[count(*) FILTER (WHERE nl_stk), count(*) FILTER (WHERE nl_stk AND hit), count(*) FILTER (WHERE nl_stk AND b)],
        'null_course_k', ARRAY[count(*) FILTER (WHERE nl_cbk), count(*) FILTER (WHERE nl_cbk AND hit), count(*) FILTER (WHERE nl_cbk AND b)]) ind
    FROM kt GROUP BY k, t) z
)
SELECT jsonb_build_object('q1', (SELECT j FROM q1), 'q2', (SELECT j FROM q2), 'q3', (SELECT j FROM q3)) AS r;
