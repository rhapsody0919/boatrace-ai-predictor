-- kb 分の差（120 の母集団 362,763R と Phase M の 362,927R）の内訳。Phase M 相当 = 6艇・欠場なし・1着の艇がちょうど1艇
WITH kb_b AS (
  SELECT b.race_id, b.boat_number, coalesce(b.is_flying,false) OR coalesce(b.is_late_start,false) AS returned, b.finish_rank, b.finish_raw
  FROM kb_archive_boats b JOIN kb_archive_races kr ON kr.race_id = b.race_id
  WHERE kr.has_result AND kr.race_date BETWEEN DATE '2019-04-01' AND DATE '2025-12-02'),
a AS (SELECT race_id, count(*) n_boats, bool_or(finish_raw IS NULL OR finish_raw LIKE 'K%') has_absent,
  bool_or(returned AND finish_rank <= 3) returned_top3, count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) n_win,
  count(*) FILTER (WHERE finish_rank = 1) n_rank1_any,
  max(boat_number) FILTER (WHERE finish_rank = 2) r2, max(boat_number) FILTER (WHERE finish_rank = 3) r3
  FROM kb_b GROUP BY race_id)
SELECT count(*) FILTER (WHERE n_boats=6 AND NOT has_absent AND NOT returned_top3 AND n_win=1 AND r2 IS NOT NULL AND r3 IS NOT NULL) pool_120,
  count(*) FILTER (WHERE n_boats=6 AND NOT has_absent AND n_rank1_any=1) phase_m_like,
  count(*) FILTER (WHERE n_boats=6 AND NOT has_absent AND n_rank1_any=1 AND returned_top3) excluded_by_returned_top3,
  count(*) FILTER (WHERE n_boats=6 AND NOT has_absent AND n_rank1_any=1 AND NOT returned_top3 AND (r2 IS NULL OR r3 IS NULL)) excluded_by_missing_r2r3
FROM a;
