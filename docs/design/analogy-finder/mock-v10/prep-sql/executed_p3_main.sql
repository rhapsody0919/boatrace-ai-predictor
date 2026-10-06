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
WHERE r.race_date BETWEEN greatest(DATE '2025-12-03', DATE '2025-12-03') AND DATE '2026-09-26'
AND coalesce(r.cancellation_status, '') = '' AND r.venue_code = 20
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
SELECT jsonb_agg(jsonb_build_array(unit, n, n_kb, n_main, dmin, dmax, b1, b2, b3, b4, b5, b6) ORDER BY unit) AS r FROM (
SELECT unit, count(*) n, count(*) FILTER (WHERE source = 'kb') n_kb, count(*) FILTER (WHERE source = 'main') n_main,
min(race_date) dmin, max(race_date) dmax,
ARRAY[count(*) FILTER (WHERE fin_by_boat[1] <= 1), count(*) FILTER (WHERE fin_by_boat[1] <= 2), count(*) FILTER (WHERE fin_by_boat[1] <= 3)] b1,
ARRAY[count(*) FILTER (WHERE fin_by_boat[2] <= 1), count(*) FILTER (WHERE fin_by_boat[2] <= 2), count(*) FILTER (WHERE fin_by_boat[2] <= 3)] b2,
ARRAY[count(*) FILTER (WHERE fin_by_boat[3] <= 1), count(*) FILTER (WHERE fin_by_boat[3] <= 2), count(*) FILTER (WHERE fin_by_boat[3] <= 3)] b3,
ARRAY[count(*) FILTER (WHERE fin_by_boat[4] <= 1), count(*) FILTER (WHERE fin_by_boat[4] <= 2), count(*) FILTER (WHERE fin_by_boat[4] <= 3)] b4,
ARRAY[count(*) FILTER (WHERE fin_by_boat[5] <= 1), count(*) FILTER (WHERE fin_by_boat[5] <= 2), count(*) FILTER (WHERE fin_by_boat[5] <= 3)] b5,
ARRAY[count(*) FILTER (WHERE fin_by_boat[6] <= 1), count(*) FILTER (WHERE fin_by_boat[6] <= 2), count(*) FILTER (WHERE fin_by_boat[6] <= 3)] b6
FROM pool p CROSS JOIN LATERAL unnest(CASE WHEN p.grade = 'G1' THEN ARRAY['20|all|all', '20|G1|all'] ELSE ARRAY['20|all|all'] END) unit
WHERE p.venue_code = 20 AND p.race_date <= DATE '2026-09-26'
GROUP BY unit
) z;