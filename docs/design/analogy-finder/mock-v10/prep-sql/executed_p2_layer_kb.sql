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