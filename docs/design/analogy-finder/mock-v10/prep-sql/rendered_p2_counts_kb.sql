WITH
kr AS (
SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan, kr.stage, kr.stage_kind,
vd.race_grade AS g0
FROM kb_archive_races kr
LEFT JOIN kb_archive_venue_days vd ON vd.venue_day_id = kr.venue_day_id
WHERE kr.has_result AND kr.race_date BETWEEN DATE '2019-04-01' AND least(DATE '2025-12-02', DATE '2025-12-02')
),
kr_r AS (
SELECT kr.*,
CASE
WHEN kr.stage LIKE '%準優進出%' OR kr.stage LIKE '%準々%' THEN 'other'
WHEN f.rfs IN ('junyu', 'yusho') THEN f.rfs
ELSE CASE kr.stage_kind WHEN 'qualifier' THEN 'yosen' WHEN 'semifinal' THEN 'junyu'
WHEN 'final' THEN 'yusho' WHEN 'other' THEN 'other' END
END AS round,
CASE WHEN kr.g0 IN ('ippan', 'G3', 'G2', 'G1', 'SG') THEN kr.g0
ELSE (SELECT s.grade FROM race_series s
WHERE s.venue_code = kr.venue_code AND kr.race_date BETWEEN s.start_date AND s.end_date
AND s.grade IN ('ippan', 'G3', 'G2', 'G1', 'SG')
ORDER BY s.start_date LIMIT 1) END AS grade
FROM kr
CROSS JOIN LATERAL (SELECT normalize(kr.stage, NFKC) AS s) n
CROSS JOIN LATERAL (SELECT (n.s LIKE '%特選%' OR n.s LIKE '%特賞%' OR n.s LIKE '%特別%' OR n.s LIKE '%選抜%') AS sp) k
CROSS JOIN LATERAL (SELECT CASE
WHEN kr.stage IS NULL OR kr.stage = '' THEN NULL
WHEN n.s LIKE '%準々%' OR n.s LIKE '%準優進出%' THEN 'other'
WHEN n.s LIKE '%準優勝戦%' THEN 'junyu'
WHEN n.s LIKE '%優勝戦%' THEN 'yusho'
WHEN n.s LIKE '%ドリーム%' OR n.s LIKE '%DR%' THEN 'other'
WHEN n.s LIKE '%予選%' AND k.sp THEN 'yosen'
WHEN n.s LIKE '%一般%' AND k.sp THEN 'other'
WHEN k.sp THEN 'other'
WHEN n.s LIKE '%予選%' THEN 'yosen'
ELSE 'other' END AS rfs) f
),
kb_b AS (
SELECT b.race_id, b.boat_number, b.class, b.national_win_rate AS w, nullif(b.motor_2rate, 0) AS m,
max(nullif(b.motor_2rate, 0)) FILTER (WHERE b.boat_number = 1) OVER (PARTITION BY b.race_id) AS m1,
CASE WHEN b.course BETWEEN 1 AND 6 THEN b.course END AS course,
coalesce(b.is_flying, false) OR coalesce(b.is_late_start, false) AS returned,
b.start_timing, b.finish_rank, b.finish_raw
FROM kb_archive_boats b JOIN kr ON kr.race_id = b.race_id
),
kb_a AS (
SELECT race_id,
count(*) AS n_boats,
bool_or(finish_raw IS NULL OR finish_raw LIKE 'K%') AS has_absent,
bool_or(returned AND finish_rank <= 3) AS returned_top3,
count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) AS n_win,
coalesce(max(class) FILTER (WHERE boat_number = 1 AND class IN ('A1', 'A2', 'B1', 'B2')), '') AS b1_class,
round(max(w) FILTER (WHERE boat_number = 1) - max(w) FILTER (WHERE boat_number > 1), 2) AS gap,
(array_agg(boat_number ORDER BY w DESC NULLS LAST, boat_number))[1] AS top_boat,
CASE WHEN max(m1) IS NOT NULL THEN 1 + count(*) FILTER (WHERE boat_number > 1 AND m > m1) END AS motor_rank,
max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
max(course) FILTER (WHERE finish_rank = 1) AS winner_course,
array_agg(course ORDER BY boat_number) AS course_by_boat,
array_agg(finish_rank ORDER BY boat_number) AS fin_by_boat,
array_agg(finish_raw ORDER BY boat_number) AS code_by_boat,
array_agg(CASE WHEN NOT returned THEN start_timing END ORDER BY boat_number) AS st_by_boat,
array_agg(returned ORDER BY boat_number) AS ret_by_boat
FROM kb_b GROUP BY race_id
),
kb_pool AS (
SELECT r.race_id, r.race_date, r.venue_code::smallint AS venue_code, r.race_number::smallint AS race_number,
r.round, r.grade, a.b1_class, a.gap AS b1_win_gap, a.top_boat::smallint AS top_boat, a.motor_rank::int AS motor_rank,
a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
CASE WHEN r.technique IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN r.technique END AS winning_technique,
r.technique::text AS tech_raw,
a.winner_course::smallint AS winner_course, a.course_by_boat::smallint[] AS course_by_boat,
a.fin_by_boat::smallint[] AS fin_by_boat, a.code_by_boat::text[] AS code_by_boat,
a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat AS ret_by_boat, 'kb'::text AS source
FROM kb_a a JOIN kr_r r ON r.race_id = a.race_id
WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
),
pool AS (SELECT * FROM kb_pool)
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