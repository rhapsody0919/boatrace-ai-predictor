-- prep9a: 展示のスリットの形と本番のスリットの形の一致（本体のみ）。
-- 母集団: sql/p7_exh.sql と同じ（2025-12-03〜2026-09-26、中止でなく rank1 あり、展示の進入 exhibition_course が6艇とも1〜6、本番の進入 actual_course_1..6 がそろう）
--   ＋展示の進入が1〜6の並べ替え（重複なし）＋展示 ST 6艇そろう＋本番 ST 6艇そろう。
--   本番の ST は prep7 と同じく返還艇（is_flying/is_late_start/着 F・L・欠/refund_boats）の ST を NULL 扱い＝返還艇がいるレースは本番 ST がそろわないので外れる。
-- 展示の F（exhibition_data.start_flag='F'）: start_timing は F でも正の数で入る（F.09→0.09、migration 082 のコメント）。3通りで数える:
--   raw   : 値をそのまま（F.09 を 0.09 として並べる）
--   signed: F の艇は負にする（F.09 → −0.09。スタートラインを 0.09 秒早く越えた＝実際の位置関係）
--   noF   : 展示 F がいるレースを除く
-- 形の判定は p8_common_tail.sql と同じ（BOA-635 1段目、round(st*100) をコース順）。none＝7形のどれにも当たらない。
-- 例のレース 2026-09-27-20-12 は期間外なので、build9.js が raw/p8_example.json（sql/p8_example.sql）から同じ判定で出す。
-- 1行 = variant|n|exh形の件数(8)|本番形の件数(8)|cross(展示形8 × 本番形8 を行優先64個)  形の順: flat,wall,d2,d3,kado,d1,dash,none
WITH r AS (
  SELECT rr.race_id, ra.race_date, ra.venue_code,
    ARRAY[rr.actual_course_1, rr.actual_course_2, rr.actual_course_3, rr.actual_course_4, rr.actual_course_5, rr.actual_course_6]::int[] AS ac,
    coalesce(rr.refund_boats, '{}') AS refund
  FROM race_results rr JOIN races ra ON ra.race_id = rr.race_id
  WHERE ra.race_date BETWEEN DATE '2025-12-03' AND DATE '2026-09-26' AND coalesce(ra.cancellation_status, '') = '' AND rr.rank1 IS NOT NULL
), ex AS (
  SELECT x.race_id,
    array_agg(x.exhibition_course::int ORDER BY x.boat_number) AS ec,
    array_agg(x.start_timing ORDER BY x.boat_number) AS est,
    array_agg(x.start_flag = 'F' ORDER BY x.boat_number) AS ef,
    count(*) FILTER (WHERE x.exhibition_course BETWEEN 1 AND 6) AS n_ec,
    count(DISTINCT x.exhibition_course) FILTER (WHERE x.exhibition_course BETWEEN 1 AND 6) AS n_ec_distinct,
    count(x.start_timing) AS n_est
  FROM exhibition_data x WHERE x.race_id IN (SELECT race_id FROM r) GROUP BY x.race_id
), st AS (
  SELECT s.race_id,
    array_agg(CASE WHEN coalesce(s.is_flying, false) OR coalesce(s.is_late_start, false) OR coalesce(s.finish_mark IN ('F', 'L', '欠'), false)
      OR s.boat_number = ANY (r.refund) THEN NULL ELSE s.start_timing END ORDER BY s.boat_number) AS ast,
    count(*) AS n_st_rows,
    bool_or(coalesce(s.is_flying, false) OR coalesce(s.is_late_start, false) OR coalesce(s.finish_mark IN ('F', 'L', '欠'), false) OR s.boat_number = ANY (r.refund)) AS has_ret
  FROM race_start_timings s JOIN r ON r.race_id = s.race_id GROUP BY s.race_id
), base AS (
  SELECT r.race_id, r.ac, ex.ec, ex.est, ex.ef, st.ast, coalesce(st.has_ret, false) AS has_ret, ex.n_est, coalesce(st.n_st_rows, 0) AS n_st_rows
  FROM r JOIN ex ON ex.race_id = r.race_id LEFT JOIN st ON st.race_id = r.race_id
  WHERE ex.n_ec = 6 AND array_position(r.ac, NULL) IS NULL
), ok AS (
  SELECT b.*, coalesce((SELECT bool_or(f) FROM unnest(b.ef) f), false) AS has_f
  FROM base b
  WHERE (SELECT count(DISTINCT c) FROM unnest(b.ec) c) = 6 AND b.n_est = 6 AND b.n_st_rows = 6 AND NOT b.has_ret
    AND array_position(b.ast, NULL) IS NULL AND array_position(b.est, NULL) IS NULL
), v AS (
  SELECT ok.race_id, vv AS variant, ok.has_f,
    ARRAY(SELECT round(ok.ast[array_position(ok.ac, cc)] * 100)::int FROM generate_series(1, 6) cc ORDER BY cc) AS acst,
    ARRAY(SELECT round(ok.est[array_position(ok.ec, cc)] * 100 * CASE WHEN vv = 'signed' AND ok.ef[array_position(ok.ec, cc)] THEN -1 ELSE 1 END)::int
      FROM generate_series(1, 6) cc ORDER BY cc) AS ecst
  FROM ok CROSS JOIN unnest(ARRAY['raw', 'signed', 'noF']) vv
  WHERE vv <> 'noF' OR NOT ok.has_f
), fm AS (
  SELECT v.*, z.ef_forms, z2.af_forms FROM v
  CROSS JOIN LATERAL (SELECT ARRAY_REMOVE(ARRAY[
      CASE WHEN (SELECT max(q) - min(q) FROM unnest(c) q) <= 6 THEN 'flat' END,
      CASE WHEN greatest(c[1], c[2], c[3]) - least(c[1], c[2], c[3]) <= 2 THEN 'wall' END,
      CASE WHEN c[2] - least(c[1], c[3]) >= 5 THEN 'd2' END,
      CASE WHEN c[3] - least(c[2], c[4]) >= 5 THEN 'd3' END,
      CASE WHEN least(c[1], c[2], c[3]) - c[4] >= 3 THEN 'kado' END,
      CASE WHEN c[1] - c[2] >= 5 THEN 'd1' END,
      CASE WHEN (c[1] + c[2] + c[3]) - (c[4] + c[5] + c[6]) >= 15 THEN 'dash' END], NULL) AS ef_forms FROM (SELECT v.ecst AS c) q0) z
  CROSS JOIN LATERAL (SELECT ARRAY_REMOVE(ARRAY[
      CASE WHEN (SELECT max(q) - min(q) FROM unnest(c) q) <= 6 THEN 'flat' END,
      CASE WHEN greatest(c[1], c[2], c[3]) - least(c[1], c[2], c[3]) <= 2 THEN 'wall' END,
      CASE WHEN c[2] - least(c[1], c[3]) >= 5 THEN 'd2' END,
      CASE WHEN c[3] - least(c[2], c[4]) >= 5 THEN 'd3' END,
      CASE WHEN least(c[1], c[2], c[3]) - c[4] >= 3 THEN 'kado' END,
      CASE WHEN c[1] - c[2] >= 5 THEN 'd1' END,
      CASE WHEN (c[1] + c[2] + c[3]) - (c[4] + c[5] + c[6]) >= 15 THEN 'dash' END], NULL) AS af_forms FROM (SELECT v.acst AS c) q0) z2
), fm2 AS (
  SELECT fm.*, CASE WHEN cardinality(ef_forms) = 0 THEN ARRAY['none'] ELSE ef_forms END AS e8,
    CASE WHEN cardinality(af_forms) = 0 THEN ARRAY['none'] ELSE af_forms END AS a8 FROM fm
), F AS (SELECT * FROM unnest(ARRAY['flat','wall','d2','d3','kado','d1','dash','none']) WITH ORDINALITY AS t(f, i))
SELECT jsonb_build_object(
  'n_races_with_result', (SELECT count(*) FROM r),
  'n_base_exh_course6_actual_course6', (SELECT count(*) FROM base),
  'n_drop_exh_course_dup', (SELECT count(*) FROM base WHERE (SELECT count(DISTINCT c) FROM unnest(base.ec) c) <> 6),
  'n_drop_exh_st_missing', (SELECT count(*) FROM base WHERE (SELECT count(DISTINCT c) FROM unnest(base.ec) c) = 6 AND (base.n_est <> 6 OR array_position(base.est, NULL) IS NOT NULL)),
  'n_drop_returned', (SELECT count(*) FROM base WHERE (SELECT count(DISTINCT c) FROM unnest(base.ec) c) = 6 AND base.n_est = 6 AND array_position(base.est, NULL) IS NULL AND base.has_ret),
  'n_drop_actual_st_missing', (SELECT count(*) FROM base WHERE (SELECT count(DISTINCT c) FROM unnest(base.ec) c) = 6 AND base.n_est = 6 AND array_position(base.est, NULL) IS NULL AND NOT base.has_ret AND (base.n_st_rows <> 6 OR array_position(base.ast, NULL) IS NOT NULL)),
  'n_ok', (SELECT count(*) FROM ok), 'n_ok_has_f', (SELECT count(*) FROM ok WHERE has_f),
  'n_f_boats', (SELECT sum((SELECT count(*) FROM unnest(ef) f WHERE f)) FROM ok),
  'f_hist', (SELECT jsonb_object_agg(k, c) FROM (SELECT (SELECT count(*) FROM unnest(ef) f WHERE f) k, count(*) c FROM ok GROUP BY 1) z),
  'dmin', (SELECT min(r.race_date) FROM ok JOIN r USING (race_id)), 'dmax', (SELECT max(r.race_date) FROM ok JOIN r USING (race_id)),
  'n_ok_exh_waku', (SELECT count(*) FROM ok WHERE ec = ARRAY[1,2,3,4,5,6]),
  'rows', (SELECT string_agg(line, ';' ORDER BY variant) FROM (
    SELECT variant, concat_ws('|', variant, count(*),
      (SELECT string_agg((SELECT count(*) FROM fm2 b WHERE b.variant = a.variant AND F.f = ANY (b.e8))::text, ',' ORDER BY F.i) FROM F),
      (SELECT string_agg((SELECT count(*) FROM fm2 b WHERE b.variant = a.variant AND F.f = ANY (b.a8))::text, ',' ORDER BY F.i) FROM F),
      (SELECT string_agg((SELECT count(*) FROM fm2 b WHERE b.variant = a.variant AND F1.f = ANY (b.e8) AND F2.f = ANY (b.a8))::text, ',' ORDER BY F1.i, F2.i) FROM F F1 CROSS JOIN F F2)) AS line
    FROM fm2 a GROUP BY variant) z)
) AS r;
