-- prep2 Q3/Q4: 自動の深さ（3: gap_band=1・b1_class=A1・venue=20）の層、前日 2026-09-26 まで。
-- 返す: n・期間・kb/本体、決まり手（DB の値）、1着艇番、1着艇の進入コース、3連単の出目の全件、
--       艇k×t(1,2,3) の n_hit、t=1 の指標（q_all_tail と同じ定義、比較 B）、1号艇以外が1着のレースの一覧
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
