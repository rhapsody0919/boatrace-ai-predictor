WITH
mr_r AS (
SELECT r.race_id, r.race_date, r.venue_code, r.race_number,
CASE
WHEN c.race_stage IS NULL OR c.race_stage = '' THEN NULL
WHEN n.s LIKE '%準々%' OR n.s LIKE '%準優進出%' THEN 'other'
WHEN n.s LIKE '%準優勝戦%' THEN 'junyu'
WHEN n.s LIKE '%優勝戦%' THEN 'yusho'
WHEN n.s LIKE '%ドリーム%' OR n.s LIKE '%DR%' THEN 'other'
WHEN n.s LIKE '%予選%' AND k.sp THEN 'yosen'
WHEN n.s LIKE '%一般%' AND k.sp THEN 'other'
WHEN k.sp THEN 'other'
WHEN n.s LIKE '%予選%' THEN 'yosen'
ELSE 'other' END AS round,
CASE WHEN r.race_grade IN ('ippan', 'G3', 'G2', 'G1', 'SG') THEN r.race_grade
ELSE (SELECT s.grade FROM race_series s
WHERE s.venue_code = r.venue_code::smallint AND r.race_date BETWEEN s.start_date AND s.end_date
AND s.grade IN ('ippan', 'G3', 'G2', 'G1', 'SG')
ORDER BY s.start_date LIMIT 1) END AS grade
FROM races r
LEFT JOIN race_conditions c ON c.race_id = r.race_id
CROSS JOIN LATERAL (SELECT normalize(c.race_stage, NFKC) AS s) n
CROSS JOIN LATERAL (SELECT (n.s LIKE '%特選%' OR n.s LIKE '%特賞%' OR n.s LIKE '%特別%' OR n.s LIKE '%選抜%') AS sp) k
WHERE r.race_date BETWEEN greatest(DATE '2025-12-03', DATE '2025-12-03') AND DATE '2026-10-02'
AND coalesce(r.cancellation_status, '') = ''
),
res AS (
SELECT rr.*, mr_r.race_date, mr_r.venue_code AS v, mr_r.race_number AS rn, mr_r.round, mr_r.grade
FROM race_results rr JOIN mr_r ON mr_r.race_id = rr.race_id
WHERE rr.rank1 IS NOT NULL AND NOT coalesce(rr.is_cancelled, false) AND NOT coalesce(rr.is_no_race, false)
AND coalesce(rr.race_status, 'normal') <> 'no_race'
),
m_b AS (
SELECT e.race_id, e.boat_number,
res.race_date, res.v, res.rn, res.round, res.grade, res.winning_technique AS tech,
coalesce(e.is_absent, false) OR coalesce(x.is_absent, false) AS absent,
coalesce(st.is_flying, false) OR coalesce(st.is_late_start, false)
OR coalesce(st.finish_mark IN ('F', 'L', '欠'), false)
OR e.boat_number = ANY (coalesce(res.refund_boats, '{}')) AS returned,
st.start_timing,
coalesce(st.official_finish_code, st.finish_mark) AS code,
(ARRAY[res.actual_course_1, res.actual_course_2, res.actual_course_3,
res.actual_course_4, res.actual_course_5, res.actual_course_6])[e.boat_number] AS course,
array_position(ARRAY[res.rank1, res.rank2, res.rank3, res.rank4, res.rank5, res.rank6], e.boat_number) AS finish_rank
FROM race_entries e
JOIN res ON res.race_id = e.race_id
LEFT JOIN exhibition_data x ON x.race_id = e.race_id AND x.boat_number = e.boat_number
LEFT JOIN race_start_timings st ON st.race_id = e.race_id AND st.boat_number = e.boat_number
),
m_a AS (
SELECT race_id,
max(race_date) AS race_date, max(v) AS venue_code, max(rn) AS race_number, max(round) AS round, max(grade) AS grade,
max(tech) AS tech,
count(*) AS n_boats,
bool_or(absent) AS has_absent,
bool_or(returned AND finish_rank <= 3) AS returned_top3,
count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) AS n_win,
max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
max(CASE WHEN course BETWEEN 1 AND 6 THEN course END) FILTER (WHERE finish_rank = 1) AS winner_course,
array_agg(CASE WHEN course BETWEEN 1 AND 6 THEN course END ORDER BY boat_number) AS course_by_boat,
array_agg(finish_rank ORDER BY boat_number) AS fin_by_boat,
array_agg(code ORDER BY boat_number) AS code_by_boat,
array_agg(CASE WHEN NOT returned THEN start_timing END ORDER BY boat_number) AS st_by_boat,
array_agg(returned ORDER BY boat_number) AS ret_by_boat
FROM m_b GROUP BY race_id
),
m_pool AS (
SELECT a.race_id, a.race_date, a.venue_code::smallint AS venue_code, a.race_number::smallint AS race_number,
a.round, a.grade, a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
CASE WHEN a.tech IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN a.tech END AS winning_technique,
a.tech::text AS tech_raw,
a.winner_course::smallint AS winner_course, a.course_by_boat::smallint[] AS course_by_boat,
a.fin_by_boat::smallint[] AS fin_by_boat, a.code_by_boat::text[] AS code_by_boat,
a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat AS ret_by_boat, 'main'::text AS source
FROM m_a a
WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
),
pool AS (SELECT * FROM m_pool)
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