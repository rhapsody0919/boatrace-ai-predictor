-- prep8 例のレース: 2026-09-27 若松12R（本体の race_id 形式 YYYY-MM-DD-VV-RR）。展示の進入・展示 ST、本番の進入・ST、結果、3連単払戻
-- 3連単は race_results.payout_trio（列名と券種が逆）。race_payouts の 3tan と突き合わせる
SELECT ra.race_id, ra.race_date, ra.venue_code, ra.race_number, ra.race_grade, ra.cancellation_status, c.race_title, c.race_stage,
 rr.rank1, rr.rank2, rr.rank3, rr.rank4, rr.rank5, rr.rank6, rr.winning_technique, rr.payout_trio AS pay3tan_payout_trio_col, rr.payout_trifecta AS pay3fuku_payout_trifecta_col, rr.popularity_trifecta, rr.refund_boats, rr.race_status,
 ARRAY[rr.actual_course_1, rr.actual_course_2, rr.actual_course_3, rr.actual_course_4, rr.actual_course_5, rr.actual_course_6] AS actual_course_by_boat,
 (SELECT array_agg(x.exhibition_course ORDER BY x.boat_number) FROM exhibition_data x WHERE x.race_id = ra.race_id) AS exh_course_by_boat,
 (SELECT array_agg(x.start_timing ORDER BY x.boat_number) FROM exhibition_data x WHERE x.race_id = ra.race_id) AS exh_st_by_boat,
 (SELECT array_agg(x.start_flag ORDER BY x.boat_number) FROM exhibition_data x WHERE x.race_id = ra.race_id) AS exh_start_flag,
 (SELECT array_agg(st.start_timing ORDER BY st.boat_number) FROM race_start_timings st WHERE st.race_id = ra.race_id) AS st_by_boat,
 (SELECT array_agg(st.entry_course ORDER BY st.boat_number) FROM race_start_timings st WHERE st.race_id = ra.race_id) AS st_entry_course,
 (SELECT array_agg(coalesce(st.is_flying,false) OR coalesce(st.is_late_start,false) ORDER BY st.boat_number) FROM race_start_timings st WHERE st.race_id = ra.race_id) AS returned,
 (SELECT array_agg(st.finish_mark ORDER BY st.boat_number) FROM race_start_timings st WHERE st.race_id = ra.race_id) AS finish_mark,
 (SELECT jsonb_agg(jsonb_build_object('t',p.bet_type,'c',p.combination,'p',p.payout,'pop',p.popularity) ORDER BY p.bet_type) FROM race_payouts p WHERE p.race_id = ra.race_id AND p.bet_type IN ('3tan','3fuku')) AS payouts
FROM races ra LEFT JOIN race_conditions c ON c.race_id = ra.race_id LEFT JOIN race_results rr ON rr.race_id = ra.race_id
WHERE ra.race_id = '2026-09-27-20-12';
