-- prep8 kb 母集団: executed_p7_kb.sql の pool に、race_id・2着3着・3連単払戻（kb_archive_races.payout_3tan）・開催名・3着同着フラグを足したもの（条件は同じ）
WITH
kr AS (
SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan, kr.stage, kr.stage_kind,
kr.weather, kr.wind_speed, kr.wave_height,
vd.race_grade AS g0, vd.title AS title0
FROM kb_archive_races kr
LEFT JOIN kb_archive_venue_days vd ON vd.venue_day_id = kr.venue_day_id
WHERE kr.venue_code = 20 AND kr.has_result AND kr.race_date BETWEEN DATE '2019-04-01' AND least(DATE '2025-12-02', DATE '2025-12-02')
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
array_agg(returned ORDER BY boat_number) AS ret_by_boat,
count(*) FILTER (WHERE finish_rank = 2) > 1 AS dh2,
count(*) FILTER (WHERE finish_rank = 3) > 1 AS dh3
FROM kb_b GROUP BY race_id
),
pool AS (
SELECT r.race_date, r.venue_code::smallint AS venue_code, r.round, r.grade, a.rank1::smallint AS rank1, r.technique::text AS tech_raw,
a.course_by_boat::smallint[] AS course_by_boat, a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat,
'kb'::text AS src, r.race_id::text AS race_id, r.race_number::int AS race_number, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3, a.dh2, a.dh3,
CASE WHEN r.payout_3tan > 0 THEN r.payout_3tan END::int AS pay3, r.title0::text AS title, r.stage::text AS stage_raw
FROM kb_a a JOIN kr_r r ON r.race_id = a.race_id
WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
)
-- prep8 一覧用（長期版。行数を抑えるため、件数30未満のセルごとに新しい順30件に入るレースだけ返す）: 件数30未満のセルは 若松の inlost（flat・wall）と 若松×G1 の waku 以外だけだったので、
-- 若松で「inlost、または G1 で waku 以外」のレースを1行ずつ返す（セルへの振り分け・新しい順30件は build8.js）。
-- 進入の型・形の判定は p8_common_tail.sql と同じ。pool は会場20に絞って実行（kr／mr_r に venue_code = 20 を足しただけ）
-- 1行 = race_id|日付|会場|グレード|開催名|ステージ|R|1着-2着-3着|決まり手|3連単払戻|進入コース(1..6号艇)|形(,区切り)|進入の型
, ok AS (
  SELECT p.*,
    CASE WHEN p.course_by_boat = ARRAY[1,2,3,4,5,6]::smallint[] THEN 'waku' ELSE 'other' END AS a,
    (SELECT string_agg(k::text, '' ORDER BY k) FROM generate_series(1, 6) k WHERE p.course_by_boat[k] < k) AS b,
    ARRAY(SELECT round(p.st_by_boat[array_position(p.course_by_boat, cc::smallint)] * 100)::int FROM generate_series(1, 6) cc ORDER BY cc) AS cst
  FROM pool p
  WHERE p.race_date <= DATE '2026-09-26' AND p.venue_code = 20
    AND NOT coalesce((SELECT bool_or(r) FROM unnest(p.ret_by_boat) r), false)
    AND array_position(p.course_by_boat, NULL) IS NULL
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
), e AS (
  SELECT sl.*, CASE WHEN course_by_boat[1] <> 1 THEN 'inlost' WHEN a = 'waku' THEN 'waku'
    WHEN b = '6' THEN 'mae6' WHEN b = '5' THEN 'mae5' WHEN b = '56' THEN 'mae56' ELSE 'maeOther' END AS et
  FROM sl
)
, k AS (
  SELECT e.*, sc || '|' || et2 || '|' || fm AS key FROM e
  CROSS JOIN LATERAL unnest(ARRAY['v20'] || CASE WHEN e.grade = 'G1' THEN ARRAY['v20G1'] ELSE '{}'::text[] END) sc
  CROSS JOIN LATERAL unnest(ARRAY[e.et, 'all'] || CASE WHEN e.et LIKE 'mae%' THEN ARRAY['mae'] ELSE '{}'::text[] END) et2
  CROSS JOIN LATERAL unnest(ARRAY['any'] || CASE WHEN e.st_ok THEN e.forms ELSE '{}'::text[] END) fm
), kk AS (
  SELECT k.*, row_number() OVER (PARTITION BY key ORDER BY race_date DESC, race_number DESC) AS rn FROM k
  WHERE key = ANY (ARRAY['v20|inlost|flat', 'v20|inlost|wall', 'v20G1|inlost|any', 'v20G1|inlost|flat', 'v20G1|inlost|wall', 'v20G1|inlost|d2', 'v20G1|inlost|d3', 'v20G1|inlost|kado', 'v20G1|inlost|d1', 'v20G1|inlost|dash', 'v20G1|mae|flat', 'v20G1|mae|wall', 'v20G1|mae|kado', 'v20G1|mae|d1', 'v20G1|mae|dash', 'v20G1|mae6|flat', 'v20G1|mae6|wall', 'v20G1|mae6|d2', 'v20G1|mae6|d3', 'v20G1|mae6|kado', 'v20G1|mae6|d1', 'v20G1|mae6|dash', 'v20G1|mae5|any', 'v20G1|mae5|flat', 'v20G1|mae5|wall', 'v20G1|mae5|d2', 'v20G1|mae5|d3', 'v20G1|mae5|kado', 'v20G1|mae5|d1', 'v20G1|mae5|dash', 'v20G1|mae56|any', 'v20G1|mae56|flat', 'v20G1|mae56|wall', 'v20G1|mae56|d2', 'v20G1|mae56|d3', 'v20G1|mae56|kado', 'v20G1|mae56|d1', 'v20G1|mae56|dash', 'v20G1|maeOther|flat', 'v20G1|maeOther|wall', 'v20G1|maeOther|d2', 'v20G1|maeOther|d3', 'v20G1|maeOther|kado', 'v20G1|maeOther|d1', 'v20G1|maeOther|dash'])
), sel AS (SELECT DISTINCT race_id FROM kk WHERE rn <= 30)
SELECT count(*) AS n, string_agg(concat_ws('|', race_id, race_date, venue_code, coalesce(grade, ''), replace(coalesce(title, ''), '|', '/'), replace(coalesce(stage_raw, ''), '|', '/'), race_number,
  rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, ''), coalesce(pay3::text, ''), array_to_string(course_by_boat, ','), array_to_string(forms, ','), et), ';' ORDER BY race_date DESC, race_number DESC) AS rows
FROM e WHERE race_id IN (SELECT race_id FROM sel);
