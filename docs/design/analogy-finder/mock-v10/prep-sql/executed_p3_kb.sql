WITH
kr AS (
SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan, kr.stage, kr.stage_kind,
vd.race_grade AS g0
FROM kb_archive_races kr
LEFT JOIN kb_archive_venue_days vd ON vd.venue_day_id = kr.venue_day_id
WHERE kr.has_result AND kr.race_date BETWEEN DATE '2019-04-01' AND least(DATE '2025-12-02', DATE '2025-12-02') AND kr.venue_code = 20
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
SELECT b.race_id, b.boat_number,
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
r.round, r.grade, a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
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