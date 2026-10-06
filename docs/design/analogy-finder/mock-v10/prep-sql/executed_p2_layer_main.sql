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
, l AS (
SELECT p.* FROM pool p
WHERE p.race_date <= DATE '2026-09-26' AND p.b1_class = 'A1' AND p.venue_code = 20
AND p.b1_win_gap >= -1.91 AND p.b1_win_gap < -1.14
), st AS (
SELECT l.*, ARRAY(SELECT CASE WHEN l.st_by_boat[i] IS NULL THEN NULL ELSE 1 + (SELECT count(*) FROM unnest(l.st_by_boat) x WHERE x < l.st_by_boat[i]) END
FROM generate_series(1, 6) i ORDER BY i) AS st_rank
FROM l
), kt AS (
SELECT k, t, s.rank1 <> 1 AS b, coalesce(s.fin_by_boat[k] <= t, false) AS hit,
(k <> 1 AND (s.fin_by_boat[1] IS NULL OR s.fin_by_boat[1] > 3)) AS i_b1d,
(k <> 1 AND coalesce(s.st_rank[1] >= 4, false)) AS i_b1s,
coalesce(s.st_rank[k] = 1, false) AS i_st1_tie,
(coalesce(s.st_rank[k] = 1, false) AND (SELECT count(*) FROM unnest(s.st_by_boat) x WHERE x = s.st_by_boat[k]) = 1) AS i_st1_solo,
EXISTS (SELECT 1 FROM generate_series(1, k - 1) j WHERE s.ret_by_boat[j] OR s.code_by_boat[j] LIKE 'S%' OR s.code_by_boat[j] IN ('F', 'L', 'L0', 'L1')) AS i_ib,
coalesce(s.course_by_boat[k] < k, false) AS i_md
FROM st s CROSS JOIN generate_series(1, 6) k CROSS JOIN (VALUES (1), (2), (3)) tt(t)
)
SELECT jsonb_build_object(
'n', (SELECT count(*) FROM l), 'n_kb', (SELECT count(*) FROM l WHERE source = 'kb'), 'n_main', (SELECT count(*) FROM l WHERE source = 'main'),
'dmin', (SELECT min(race_date) FROM l), 'dmax', (SELECT max(race_date) FROM l),
'tech', (SELECT jsonb_object_agg(k, c) FROM (SELECT coalesce(tech_raw, 'NULL') k, count(*) c FROM l GROUP BY 1) z),
'winner_boat', (SELECT jsonb_object_agg(k, c) FROM (SELECT rank1 k, count(*) c FROM l GROUP BY 1) z),
'winner_course', (SELECT jsonb_object_agg(k, c) FROM (SELECT coalesce(winner_course::text, 'NULL') k, count(*) c FROM l GROUP BY 1) z),
'trifecta', (SELECT jsonb_object_agg(k, c) FROM (SELECT rank1 || '-' || rank2 || '-' || rank3 k, count(*) c FROM l GROUP BY 1) z),
'kt', (SELECT jsonb_agg(jsonb_build_array(k, t, n_hit, n_b, ind) ORDER BY k, t) FROM (
SELECT k, t, count(*) FILTER (WHERE hit) n_hit, count(*) FILTER (WHERE b) n_b,
CASE WHEN t = 1 THEN jsonb_build_object(
'b1d', ARRAY[count(*) FILTER (WHERE i_b1d), count(*) FILTER (WHERE i_b1d AND hit), count(*) FILTER (WHERE i_b1d AND b)],
'b1s', ARRAY[count(*) FILTER (WHERE i_b1s), count(*) FILTER (WHERE i_b1s AND hit), count(*) FILTER (WHERE i_b1s AND b)],
'st1_tie', ARRAY[count(*) FILTER (WHERE i_st1_tie), count(*) FILTER (WHERE i_st1_tie AND hit), count(*) FILTER (WHERE i_st1_tie AND b)],
'st1_solo', ARRAY[count(*) FILTER (WHERE i_st1_solo), count(*) FILTER (WHERE i_st1_solo AND hit), count(*) FILTER (WHERE i_st1_solo AND b)],
'ib', ARRAY[count(*) FILTER (WHERE i_ib), count(*) FILTER (WHERE i_ib AND hit), count(*) FILTER (WHERE i_ib AND b)],
'md', ARRAY[count(*) FILTER (WHERE i_md), count(*) FILTER (WHERE i_md AND hit), count(*) FILTER (WHERE i_md AND b)]) END ind
FROM kt GROUP BY k, t) z),
'non_b1_wins', (SELECT jsonb_agg(jsonb_build_array(race_date, race_number, rank1 || '-' || rank2 || '-' || rank3, tech_raw,
array_to_string(code_by_boat, ','), array_to_string(st_rank, ',', '-'), array_to_string(course_by_boat, ',', '-')) ORDER BY race_date)
FROM st WHERE rank1 <> 1)
) AS r;