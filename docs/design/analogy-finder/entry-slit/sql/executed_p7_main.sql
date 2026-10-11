-- 実行版: pool_base6 のmain部分から使う列だけ残したもの（母集団の条件は同じ）＋ p7_tail.sql
WITH
mr_r AS (
SELECT r.race_id, r.race_date, r.venue_code, r.race_number, c.race_stage AS stage_raw,
c.weather, c.wind_speed, c.wave_height,
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
SELECT rr.*, mr_r.race_date, mr_r.venue_code AS v, mr_r.race_number AS rn, mr_r.round, mr_r.grade, mr_r.stage_raw, mr_r.weather AS wx, mr_r.wind_speed AS ws, mr_r.wave_height AS wh
FROM race_results rr JOIN mr_r ON mr_r.race_id = rr.race_id
WHERE rr.rank1 IS NOT NULL AND NOT coalesce(rr.is_cancelled, false) AND NOT coalesce(rr.is_no_race, false)
AND coalesce(rr.race_status, 'normal') <> 'no_race'
),
m_b AS (
SELECT e.race_id, e.boat_number,
res.race_date, res.v, res.rn, res.round, res.grade, res.winning_technique AS tech, res.stage_raw, res.payout_trio, res.wx, res.ws, res.wh,
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
max(race_date) AS race_date, max(v) AS venue_code, max(round) AS round, max(grade) AS grade, max(tech) AS tech,
count(*) AS n_boats,
bool_or(absent) AS has_absent,
bool_or(returned AND finish_rank <= 3) AS returned_top3,
count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) AS n_win,
max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
array_agg(CASE WHEN course BETWEEN 1 AND 6 THEN course END ORDER BY boat_number) AS course_by_boat,
array_agg(CASE WHEN NOT returned THEN start_timing END ORDER BY boat_number) AS st_by_boat,
array_agg(returned ORDER BY boat_number) AS ret_by_boat
FROM m_b GROUP BY race_id
),
pool AS (
SELECT a.race_date, a.venue_code::smallint AS venue_code, a.round, a.grade, a.rank1::smallint AS rank1, a.tech::text AS tech_raw,
a.course_by_boat::smallint[] AS course_by_boat, a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat
FROM m_a a
WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
)
, x AS (
SELECT p.*, sc AS scope,
coalesce(bool_or_ret, false) AS has_ret,
(array_position(p.course_by_boat, NULL) IS NOT NULL) AS course_unknown
FROM pool p
CROSS JOIN LATERAL (SELECT bool_or(r) AS bool_or_ret FROM unnest(p.ret_by_boat) r) rr
CROSS JOIN LATERAL unnest(ARRAY['all']
|| CASE WHEN p.venue_code = 20 THEN ARRAY['v20'] ELSE '{}'::text[] END
|| CASE WHEN p.venue_code = 20 AND p.grade = 'G1' THEN ARRAY['v20G1'] ELSE '{}'::text[] END
|| CASE WHEN p.grade IN ('G1', 'SG') AND p.round = 'yusho' THEN ARRAY['G1y'] ELSE '{}'::text[] END) sc
WHERE p.race_date <= DATE '2026-09-26'
), ok AS (
SELECT x.*,
CASE WHEN x.course_by_boat = ARRAY[1,2,3,4,5,6]::smallint[] THEN 'waku' ELSE 'other' END AS a,
(SELECT string_agg(k::text, '' ORDER BY k) FROM generate_series(1, 6) k WHERE x.course_by_boat[k] < k) AS b,
CASE WHEN x.course_by_boat[1] = 1 THEN 'yes' ELSE 'no' END AS c,
ARRAY(SELECT round(x.st_by_boat[array_position(x.course_by_boat, cc::smallint)] * 100)::int FROM generate_series(1, 6) cc ORDER BY cc) AS cst
FROM x WHERE NOT x.has_ret AND NOT x.course_unknown
), sl AS (
SELECT ok.*, (array_position(cst, NULL) IS NULL) AS st_ok,
ARRAY_REMOVE(ARRAY[
CASE WHEN (SELECT max(v) - min(v) FROM unnest(cst) v) <= 6 THEN 'flat' END,
CASE WHEN greatest(cst[1], cst[2], cst[3]) - least(cst[1], cst[2], cst[3]) <= 2 THEN 'wall' END,
CASE WHEN cst[2] - least(cst[1], cst[3]) >= 5 THEN 'd2' END,
CASE WHEN cst[3] - least(cst[2], cst[4]) >= 5 THEN 'd3' END,
CASE WHEN least(cst[1], cst[2], cst[3]) - cst[4] >= 3 THEN 'kado' END,
CASE WHEN cst[1] - cst[2] >= 5 THEN 'd1' END,
CASE WHEN (cst[1] + cst[2] + cst[3]) - (cst[4] + cst[5] + cst[6]) >= 15 THEN 'dash' END], NULL) AS forms
FROM ok
), u AS (
SELECT scope, rank1, tech_raw, dim, val FROM sl CROSS JOIN LATERAL (
SELECT 'all' dim, '' val UNION ALL SELECT 'a', a UNION ALL SELECT 'b', b WHERE a = 'other' UNION ALL SELECT 'c', c
UNION ALL SELECT 's', '' WHERE st_ok
UNION ALL SELECT 'f', f FROM unnest(forms) f WHERE st_ok
UNION ALL SELECT 'af', a || ':' || f FROM unnest(forms) f WHERE st_ok
UNION ALL SELECT 'cf', c || ':' || f FROM unnest(forms) f WHERE st_ok
UNION ALL SELECT 'as', a WHERE st_ok UNION ALL SELECT 'cs', c WHERE st_ok) d
)
SELECT jsonb_build_object(
'cells', (SELECT string_agg(concat_ws('|', scope, dim, coalesce(val, ''), n, r1, tc), ';' ORDER BY scope, dim, val) FROM (
SELECT scope, dim, val, count(*) n,
concat_ws(',', count(*) FILTER (WHERE rank1 = 1), count(*) FILTER (WHERE rank1 = 2), count(*) FILTER (WHERE rank1 = 3), count(*) FILTER (WHERE rank1 = 4), count(*) FILTER (WHERE rank1 = 5), count(*) FILTER (WHERE rank1 = 6)) r1,
concat_ws(',', count(*) FILTER (WHERE tech_raw = '逃げ'), count(*) FILTER (WHERE tech_raw = '差し'), count(*) FILTER (WHERE tech_raw = 'まくり'), count(*) FILTER (WHERE tech_raw = 'まくり差し'), count(*) FILTER (WHERE tech_raw = '抜き'), count(*) FILTER (WHERE tech_raw = '恵まれ'), count(*) FILTER (WHERE tech_raw IS NULL OR tech_raw NOT IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ'))) tc
FROM u GROUP BY scope, dim, val) z),
'excl', (SELECT string_agg(concat_ws('|', scope, n_pool, n_ret, n_course_only, n_ok, n_st_missing), ';' ORDER BY scope) FROM (
SELECT x.scope, count(*) n_pool, count(*) FILTER (WHERE has_ret) n_ret, count(*) FILTER (WHERE NOT has_ret AND course_unknown) n_course_only,
count(*) FILTER (WHERE NOT has_ret AND NOT course_unknown) n_ok,
(SELECT count(*) FROM sl WHERE sl.scope = x.scope AND NOT st_ok) n_st_missing
FROM x GROUP BY x.scope) z)
) AS r;