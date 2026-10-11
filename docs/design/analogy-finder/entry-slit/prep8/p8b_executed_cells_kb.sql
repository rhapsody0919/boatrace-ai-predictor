-- prep8 kb 母集団: executed_p7_kb.sql の pool に、race_id・2着3着・3連単払戻（kb_archive_races.payout_3tan）・開催名・3着同着フラグを足したもの（条件は同じ）
WITH
kr AS (
SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan, kr.stage, kr.stage_kind,
kr.weather, kr.wind_speed, kr.wave_height,
vd.race_grade AS g0, vd.title AS title0
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
-- prep8 共通部: x/ok/sl は p7_tail.sql と同じ（範囲は all・v20・v20G1 の3つだけ）。e で進入の型（et）を1つ決める。
--   inlost: 1号艇が1コース以外（前付けの有無より優先）／waku: 全艇枠なり／
--   それ以外（1号艇1コース・枠なり以外）は前付けした艇（艇番より内のコースに入った艇）の組で mae6・mae5・mae56・maeOther
, x AS (
  SELECT p.*, sc AS scope,
    coalesce(bool_or_ret, false) AS has_ret,
    (array_position(p.course_by_boat, NULL) IS NOT NULL) AS course_unknown
  FROM pool p
  CROSS JOIN LATERAL (SELECT bool_or(r) AS bool_or_ret FROM unnest(p.ret_by_boat) r) rr
  CROSS JOIN LATERAL unnest(ARRAY['all']
    || CASE WHEN p.venue_code = 20 THEN ARRAY['v20'] ELSE '{}'::text[] END
    || CASE WHEN p.venue_code = 20 AND p.grade = 'G1' THEN ARRAY['v20G1'] ELSE '{}'::text[] END) sc
  WHERE p.race_date <= DATE '2026-09-26'
), ok AS (
  SELECT x.*,
    CASE WHEN x.course_by_boat = ARRAY[1,2,3,4,5,6]::smallint[] THEN 'waku' ELSE 'other' END AS a,
    (SELECT string_agg(k::text, '' ORDER BY k) FROM generate_series(1, 6) k WHERE x.course_by_boat[k] < k) AS b,
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
), e AS (
  SELECT sl.*, CASE WHEN course_by_boat[1] <> 1 THEN 'inlost' WHEN a = 'waku' THEN 'waku'
    WHEN b = '6' THEN 'mae6' WHEN b = '5' THEN 'mae5' WHEN b = '56' THEN 'mae56' ELSE 'maeOther' END AS et
  FROM sl
), u AS (
  -- form: any＝形を問わない（ST がそろわないレースも含む。今回は0件）、7形は ST がそろうレースだけ
  SELECT e.*, fm AS form FROM e CROSS JOIN LATERAL (SELECT 'any' fm UNION ALL SELECT f FROM unnest(e.forms) f WHERE e.st_ok) z
)

-- prep8b セル集計（u は p8_common_tail.sql と同じ）: 1行 = scope|et|form|tri|wt
--   u を1回だけ (scope, et, form, 着順, 決まり手) で集計（g）し、そこから tri と wt を作る（長期で statement timeout を避けるため）
--   tri: 3連単の着順（rank1 rank2 rank3 を連結した3桁）:件数 をカンマ区切り。件数0は出ない。3着同着は p8 と同じく rank3=max(boat_number)
--   wt: 1着艇番 決まり手番号:件数 をカンマ区切り（例 "11:525" = 1号艇の逃げ525件）。件数0は出ない
--       決まり手番号 1逃げ,2差し,3まくり,4まくり差し,5抜き,6恵まれ,7その他（NULL 含む）
--   mae と all は build8b.js で基本の型から足し上げる
, g AS MATERIALIZED (
  SELECT scope, et, form, rank1, rank2, rank3,
    CASE tech_raw WHEN '逃げ' THEN 1 WHEN '差し' THEN 2 WHEN 'まくり' THEN 3 WHEN 'まくり差し' THEN 4 WHEN '抜き' THEN 5 WHEN '恵まれ' THEN 6 ELSE 7 END AS tj,
    count(*) AS c
  FROM u GROUP BY 1, 2, 3, 4, 5, 6, 7
), t AS (
  SELECT scope, et, form, string_agg(o || ':' || c, ',' ORDER BY o) AS tri FROM (
    SELECT scope, et, form, concat(rank1, rank2, rank3) AS o, sum(c) AS c FROM g GROUP BY 1, 2, 3, 4) z
  GROUP BY 1, 2, 3
), w AS (
  SELECT scope, et, form, string_agg(o || ':' || c, ',' ORDER BY o) AS wt FROM (
    SELECT scope, et, form, concat(rank1, tj) AS o, sum(c) AS c FROM g GROUP BY 1, 2, 3, 4) z
  GROUP BY 1, 2, 3
)
SELECT string_agg(concat_ws('|', t.scope, t.et, t.form, t.tri, w.wt), ';' ORDER BY t.scope, t.et, t.form) AS r
FROM t JOIN w USING (scope, et, form);
