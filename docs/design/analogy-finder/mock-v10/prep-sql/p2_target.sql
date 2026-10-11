-- 例のレース（2026-09-27 若松 12R）の出走表・条件の素材
SELECT r.race_id, r.race_date, r.venue_code, r.race_number, r.race_grade, r.start_time, r.cancellation_status, c.race_stage,
 (SELECT jsonb_agg(jsonb_build_array(e.boat_number, e.grade, e.win_rate, e.motor_2rate, e.is_absent) ORDER BY e.boat_number) FROM race_entries e WHERE e.race_id=r.race_id) entries
FROM races r LEFT JOIN race_conditions c ON c.race_id=r.race_id WHERE r.venue_code=20 AND r.race_date='2026-09-27' AND r.race_number=12;
-- 実際の結果
SELECT rr.race_id, rr.rank1, rr.rank2, rr.rank3, rr.rank4, rr.rank5, rr.rank6, rr.winning_technique, rr.race_status, rr.refund_boats, rr.payout_trio, rr.payout_trifecta,
 ARRAY[rr.actual_course_1, rr.actual_course_2, rr.actual_course_3, rr.actual_course_4, rr.actual_course_5, rr.actual_course_6] actual_course,
 (SELECT jsonb_agg(jsonb_build_array(st.boat_number, st.start_timing, st.is_flying, st.is_late_start, st.finish_mark, st.official_finish_code, st.entry_course) ORDER BY st.boat_number) FROM race_start_timings st WHERE st.race_id = rr.race_id) st,
 (SELECT jsonb_agg(jsonb_build_array(x.boat_number, x.is_absent) ORDER BY x.boat_number) FROM exhibition_data x WHERE x.race_id = rr.race_id) exh
FROM race_results rr WHERE rr.race_id = '2026-09-27-20-12';
