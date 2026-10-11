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
AND coalesce(r.cancellation_status, '') = ''
),
res AS (
SELECT rr.*, mr_r.race_date, mr_r.venue_code AS v, mr_r.race_number AS rn, mr_r.round, mr_r.grade
FROM race_results rr JOIN mr_r ON mr_r.race_id = rr.race_id
WHERE rr.rank1 IS NOT NULL AND NOT coalesce(rr.is_cancelled, false) AND NOT coalesce(rr.is_no_race, false)
AND coalesce(rr.race_status, 'normal') <> 'no_race'
),
m_b AS (
SELECT e.race_id, e.boat_number, e.grade AS cls, e.win_rate AS w, nullif(e.motor_2rate, 0) AS m,
max(nullif(e.motor_2rate, 0)) FILTER (WHERE e.boat_number = 1) OVER (PARTITION BY e.race_id) AS m1,
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
coalesce(max(cls) FILTER (WHERE boat_number = 1 AND cls IN ('A1', 'A2', 'B1', 'B2')), '') AS b1_class,
round(max(w) FILTER (WHERE boat_number = 1) - max(w) FILTER (WHERE boat_number > 1), 2) AS gap,
(array_agg(boat_number ORDER BY w DESC NULLS LAST, boat_number))[1] AS top_boat,
CASE WHEN max(m1) IS NOT NULL THEN 1 + count(*) FILTER (WHERE boat_number > 1 AND m > m1) END AS motor_rank,
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
a.round, a.grade, a.b1_class, a.gap AS b1_win_gap, a.top_boat::smallint AS top_boat, a.motor_rank::int AS motor_rank,
a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
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
, c AS (
SELECT p.*,
CASE WHEN p.b1_win_gap IS NULL THEN 5 WHEN p.b1_win_gap >= 0.19 THEN 4 WHEN p.b1_win_gap >= -0.49 THEN 3
WHEN p.b1_win_gap >= -1.14 THEN 2 WHEN p.b1_win_gap >= -1.91 THEN 1 ELSE 0 END AS gap_band,
CASE WHEN p.motor_rank IS NULL THEN 3 WHEN p.motor_rank <= 2 THEN 0 WHEN p.motor_rank <= 4 THEN 1 ELSE 2 END AS motor_band
FROM pool p WHERE p.race_date <= DATE '2026-09-26'
), d AS (
SELECT c.*, (c.gap_band = 1) AS d1, (c.gap_band = 1 AND c.b1_class = 'A1') AS d2,
(c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20) AS d3,
(c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20 AND c.top_boat = 4) AS d4,
(c.round = 'yusho') AS o_r, (c.grade = 'G1') AS o_g, (c.motor_band = 2) AS o_m
FROM c
)
SELECT jsonb_build_object(
'n', ARRAY[count(*) FILTER (WHERE d1), count(*) FILTER (WHERE d2), count(*) FILTER (WHERE d3), count(*) FILTER (WHERE d4)],
'plus_round', ARRAY[count(*) FILTER (WHERE d1 AND o_r), count(*) FILTER (WHERE d2 AND o_r), count(*) FILTER (WHERE d3 AND o_r), count(*) FILTER (WHERE d4 AND o_r)],
'plus_grade', ARRAY[count(*) FILTER (WHERE d1 AND o_g), count(*) FILTER (WHERE d2 AND o_g), count(*) FILTER (WHERE d3 AND o_g), count(*) FILTER (WHERE d4 AND o_g)],
'plus_motor', ARRAY[count(*) FILTER (WHERE d1 AND o_m), count(*) FILTER (WHERE d2 AND o_m), count(*) FILTER (WHERE d3 AND o_m), count(*) FILTER (WHERE d4 AND o_m)],
'plus_all3', ARRAY[count(*) FILTER (WHERE d1 AND o_r AND o_g AND o_m), count(*) FILTER (WHERE d2 AND o_r AND o_g AND o_m), count(*) FILTER (WHERE d3 AND o_r AND o_g AND o_m), count(*) FILTER (WHERE d4 AND o_r AND o_g AND o_m)],
'n_pool', count(*), 'pool_min', min(race_date), 'pool_max', max(race_date),
'n_kb_main_d', ARRAY[count(*) FILTER (WHERE source='kb'), count(*) FILTER (WHERE source='main')]) AS r
FROM d;