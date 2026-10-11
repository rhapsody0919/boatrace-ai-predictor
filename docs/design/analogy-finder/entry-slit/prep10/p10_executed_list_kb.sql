-- 実行時の設定（結果は変わらない。round='yusho' で件数見積もりが1行になり入れ子ループで時間切れになるのを避ける）
SET statement_timeout = '300s'; SET enable_nestloop = off;
-- prep10 kb 母集団（prep9b の pool をさらに round = 'yusho'〔優勝戦〕に絞ったもの）。prep9b の説明: （prep8 の pool に、6艇とも出走時の級別 kb_archive_boats.class が A1 の列 all_a1 を足し、pool を all_a1 に絞ったもの）。元の説明: executed_p7_kb.sql の pool に、race_id・2着3着・3連単払戻（kb_archive_races.payout_3tan）・開催名・3着同着フラグを足したもの（条件は同じ）
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
b.class AS cls,
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
coalesce(bool_and(cls = 'A1'), false) AS all_a1,
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
WHERE a.all_a1 AND r.round = 'yusho' AND a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
)
-- prep10 共通部（prep9b と同じ。範囲の展開だけ allA1Y に置換。pool は既に all_a1・round='yusho' に絞ってある）。prep9b の説明: （prep8 と同じ。範囲の展開だけ allA1・v20A1 に置換。pool は既に all_a1 に絞ってある）。元の説明: x/ok/sl は p7_tail.sql と同じ（範囲は all・v20・v20G1 の3つだけ）。e で進入の型（et）を1つ決める。
--   inlost: 1号艇が1コース以外（前付けの有無より優先）／waku: 全艇枠なり／
--   それ以外（1号艇1コース・枠なり以外）は前付けした艇（艇番より内のコースに入った艇）の組で mae6・mae5・mae56・maeOther
, x AS (
  SELECT p.*, sc AS scope,
    coalesce(bool_or_ret, false) AS has_ret,
    (array_position(p.course_by_boat, NULL) IS NOT NULL) AS course_unknown
  FROM pool p
  CROSS JOIN LATERAL (SELECT bool_or(r) AS bool_or_ret FROM unnest(p.ret_by_boat) r) rr
  CROSS JOIN LATERAL unnest(ARRAY['allA1Y']) sc
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

-- prep10 一覧用（prep9b と同じ。キーだけ差し替え）: 件数30未満のセルごとに新しい順30件に入るレースを1行ずつ返す（セルへの振り分けと件数の照合は build10.js）。e までは p10_common_tail.sql と同じ
-- 1行 = race_id|日付|会場|グレード|開催名|ステージ|R|1着-2着-3着|決まり手|3連単払戻|進入コース(1..6号艇)|形(,区切り)|進入の型
, k AS (
  SELECT e.*, scope || '|' || et2 || '|' || fm AS key FROM e
  CROSS JOIN LATERAL unnest(ARRAY[e.et, 'all'] || CASE WHEN e.et LIKE 'mae%' THEN ARRAY['mae'] ELSE '{}'::text[] END) et2
  CROSS JOIN LATERAL unnest(ARRAY['any'] || CASE WHEN e.st_ok THEN e.forms ELSE '{}'::text[] END) fm
), kk AS (
  SELECT k.*, row_number() OVER (PARTITION BY key ORDER BY race_date DESC, race_number DESC) AS rn FROM k
  WHERE key = ANY (ARRAY['allA1Y|waku|d1', 'allA1Y|inlost|any', 'allA1Y|inlost|wall', 'allA1Y|inlost|d2', 'allA1Y|inlost|d3', 'allA1Y|inlost|dash', 'allA1Y|mae|flat', 'allA1Y|mae|wall', 'allA1Y|mae|kado', 'allA1Y|mae|d1', 'allA1Y|mae|dash', 'allA1Y|mae6|flat', 'allA1Y|mae6|wall', 'allA1Y|mae6|d2', 'allA1Y|mae6|d3', 'allA1Y|mae6|kado', 'allA1Y|mae6|dash', 'allA1Y|mae5|any', 'allA1Y|mae5|d2', 'allA1Y|mae5|d3', 'allA1Y|mae5|kado', 'allA1Y|mae5|dash', 'allA1Y|mae56|any', 'allA1Y|mae56|flat', 'allA1Y|mae56|wall', 'allA1Y|mae56|d2', 'allA1Y|mae56|d3', 'allA1Y|mae56|kado', 'allA1Y|mae56|dash', 'allA1Y|maeOther|flat', 'allA1Y|maeOther|wall', 'allA1Y|maeOther|d2', 'allA1Y|maeOther|d3', 'allA1Y|maeOther|kado', 'allA1Y|maeOther|d1', 'allA1Y|maeOther|dash', 'allA1Y|all|d1'])
), sel AS (SELECT DISTINCT race_id FROM kk WHERE rn <= 30)
SELECT q.n, q.rows, md5(q.rows) AS md5_rows FROM (SELECT count(*) AS n, string_agg(concat_ws('|', race_id, race_date, venue_code, coalesce(grade, ''), replace(coalesce(title, ''), '|', '/'), replace(coalesce(stage_raw, ''), '|', '/'), race_number,
  rank1 || '-' || rank2 || '-' || rank3, coalesce(tech_raw, ''), coalesce(pay3::text, ''), array_to_string(course_by_boat, ','), array_to_string(forms, ','), et), ';' ORDER BY race_date DESC, race_number DESC) AS rows
FROM (SELECT DISTINCT ON (race_id) * FROM e WHERE race_id IN (SELECT race_id FROM sel) ORDER BY race_id) z) q;
