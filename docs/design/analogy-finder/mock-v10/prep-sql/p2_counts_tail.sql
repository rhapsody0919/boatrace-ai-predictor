-- prep2 Q2/Q5: 例のレース 2026-09-27-20-12 の条件（gap_band=1・b1_class=A1・venue=20・top_boat=4、任意: round=yusho・grade=G1・motor_band=2）で、
-- 前日（2026-09-26）までの母集団の深さ1〜4の件数と、各深さに任意の条件を1つずつ足した件数。
-- gap_band は analogy_gap_band のインライン（境界ちょうどは上の帯）。motor_band は analogy_motor_band のインライン
, c AS (
  SELECT p.*,
    CASE WHEN p.b1_win_gap IS NULL THEN 5 WHEN p.b1_win_gap >= 0.19 THEN 4 WHEN p.b1_win_gap >= -0.49 THEN 3
         WHEN p.b1_win_gap >= -1.14 THEN 2 WHEN p.b1_win_gap >= -1.91 THEN 1 ELSE 0 END AS gap_band,
    CASE WHEN p.motor_rank IS NULL THEN 3 WHEN p.motor_rank <= 2 THEN 0 WHEN p.motor_rank <= 4 THEN 1 ELSE 2 END AS motor_band
  FROM pool p WHERE p.race_date <= DATE '2026-09-26'
), d AS (
  SELECT c.*, (c.gap_band = 1) AS d1, (c.gap_band = 1 AND c.b1_class = 'A1') AS d2,
    (c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20) AS d3,
    (c.gap_band = 1 AND c.b1_class = 'A1' AND c.venue_code = 20 AND c.top_boat = 4) AS d4,
    (c.round = 'yusho') AS o_r, (c.grade = 'G1') AS o_g, (c.motor_band = 2) AS o_m
  FROM c
)
SELECT jsonb_build_object(
  'n', ARRAY[count(*) FILTER (WHERE d1), count(*) FILTER (WHERE d2), count(*) FILTER (WHERE d3), count(*) FILTER (WHERE d4)],
  'plus_round', ARRAY[count(*) FILTER (WHERE d1 AND o_r), count(*) FILTER (WHERE d2 AND o_r), count(*) FILTER (WHERE d3 AND o_r), count(*) FILTER (WHERE d4 AND o_r)],
  'plus_grade', ARRAY[count(*) FILTER (WHERE d1 AND o_g), count(*) FILTER (WHERE d2 AND o_g), count(*) FILTER (WHERE d3 AND o_g), count(*) FILTER (WHERE d4 AND o_g)],
  'plus_motor', ARRAY[count(*) FILTER (WHERE d1 AND o_m), count(*) FILTER (WHERE d2 AND o_m), count(*) FILTER (WHERE d3 AND o_m), count(*) FILTER (WHERE d4 AND o_m)],
  'plus_all3', ARRAY[count(*) FILTER (WHERE d1 AND o_r AND o_g AND o_m), count(*) FILTER (WHERE d2 AND o_r AND o_g AND o_m), count(*) FILTER (WHERE d3 AND o_r AND o_g AND o_m), count(*) FILTER (WHERE d4 AND o_r AND o_g AND o_m)],
  'n_pool', count(*), 'pool_min', min(race_date), 'pool_max', max(race_date),
  'n_kb_main_d', ARRAY[count(*) FILTER (WHERE source='kb'), count(*) FILTER (WHERE source='main')]) AS r
FROM d;
