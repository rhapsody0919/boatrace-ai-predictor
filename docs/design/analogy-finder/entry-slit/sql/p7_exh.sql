-- prep7 項目4: 展示の進入（exhibition_data.exhibition_course）と本番の進入（race_results.actual_course_N）の一致。
-- 対象: 2025-12-03〜2026-09-26 の本体レースで、中止でなく結果があり、6艇とも展示の進入と本番の進入が分かるもの（120 の母集団とは別に、この2列がそろうレースで数える）
WITH r AS (
  SELECT rr.race_id, ra.race_date, ra.venue_code,
    ARRAY[rr.actual_course_1, rr.actual_course_2, rr.actual_course_3, rr.actual_course_4, rr.actual_course_5, rr.actual_course_6]::int[] AS ac,
    (SELECT array_agg(x.exhibition_course::int ORDER BY x.boat_number) FROM exhibition_data x WHERE x.race_id = rr.race_id) AS ec,
    (SELECT count(*) FROM exhibition_data x WHERE x.race_id = rr.race_id AND x.exhibition_course BETWEEN 1 AND 6) AS n_ec
  FROM race_results rr JOIN races ra ON ra.race_id = rr.race_id
  WHERE ra.race_date BETWEEN DATE '2025-12-03' AND DATE '2026-09-26' AND coalesce(ra.cancellation_status, '') = '' AND rr.rank1 IS NOT NULL
), ok AS (
  SELECT * FROM r WHERE n_ec = 6 AND array_position(ac, NULL) IS NULL
)
SELECT jsonb_build_object(
  'n_races_with_result', (SELECT count(*) FROM r),
  'n_races_exh_course_6', (SELECT count(*) FROM r WHERE n_ec = 6),
  'n_ok', (SELECT count(*) FROM ok), 'dmin', (SELECT min(race_date) FROM ok), 'dmax', (SELECT max(race_date) FROM ok),
  'by_month', (SELECT jsonb_object_agg(m, c) FROM (SELECT to_char(race_date, 'YYYY-MM') m, count(*) c FROM ok GROUP BY 1) z),
  'boat_match', (SELECT sum((SELECT count(*) FROM generate_series(1, 6) k WHERE ok.ac[k] = ok.ec[k])) FROM ok),
  'boats', (SELECT count(*) * 6 FROM ok),
  'race_all_match', (SELECT count(*) FROM ok WHERE ac = ec),
  'exh_waku_actual_waku', (SELECT count(*) FROM ok WHERE ec = ARRAY[1,2,3,4,5,6] AND ac = ARRAY[1,2,3,4,5,6]),
  'exh_waku_actual_not', (SELECT count(*) FROM ok WHERE ec = ARRAY[1,2,3,4,5,6] AND ac <> ARRAY[1,2,3,4,5,6]),
  'exh_not_actual_waku', (SELECT count(*) FROM ok WHERE ec <> ARRAY[1,2,3,4,5,6] AND ac = ARRAY[1,2,3,4,5,6]),
  'exh_not_actual_not', (SELECT count(*) FROM ok WHERE ec <> ARRAY[1,2,3,4,5,6] AND ac <> ARRAY[1,2,3,4,5,6]),
  'b1_course1_exh_actual', (SELECT jsonb_build_object('yy', count(*) FILTER (WHERE ec[1] = 1 AND ac[1] = 1), 'yn', count(*) FILTER (WHERE ec[1] = 1 AND ac[1] <> 1),
     'ny', count(*) FILTER (WHERE ec[1] <> 1 AND ac[1] = 1), 'nn', count(*) FILTER (WHERE ec[1] <> 1 AND ac[1] <> 1)) FROM ok)
) AS r;
