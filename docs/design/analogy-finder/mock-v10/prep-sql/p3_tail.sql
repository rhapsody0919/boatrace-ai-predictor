-- prep3: 若松(20)・全グレード・全ラウンド と 若松×G1、2026-09-26 まで。艇番1〜6ごとの 1着・2着以内・3着以内 の件数
-- 1行 = [unit, n, n_kb, n_main, dmin, dmax, [艇1の1着,2着以内,3着以内], …, [艇6 …]]
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
