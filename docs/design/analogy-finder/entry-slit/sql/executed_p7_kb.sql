-- 実行版: pool_base6 のkb部分から使う列だけ残したもの（母集団の条件は同じ）＋ p7_tail.sql
WITH
kr AS (
SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan, kr.stage, kr.stage_kind,
kr.weather, kr.wind_speed, kr.wave_height,
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
array_agg(course ORDER BY boat_number) AS course_by_boat,
array_agg(CASE WHEN NOT returned THEN start_timing END ORDER BY boat_number) AS st_by_boat,
array_agg(returned ORDER BY boat_number) AS ret_by_boat
FROM kb_b GROUP BY race_id
),
pool AS (
SELECT r.race_date, r.venue_code::smallint AS venue_code, r.round, r.grade, a.rank1::smallint AS rank1, r.technique::text AS tech_raw,
a.course_by_boat::smallint[] AS course_by_boat, a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat
FROM kb_a a JOIN kr_r r ON r.race_id = a.race_id
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