-- 120_analogy_strata.sql の analogy_pool_rows_kb / analogy_pool_rows_main を SELECT 内にインライン化したもの（読み取りのみ・CREATE なし）。
-- 120 の関数をそのまま書き写し、追加で各艇の着(fin_by_boat)・着の生コード(code_by_boat)・ST(st_by_boat、返還艇は NULL)・
-- 返還フラグ(ret_by_boat)・技の生値(tech_raw)を持たせた。母集団の条件（WHERE）は 120 と同一。
-- プレースホルダ: {{FROM}} {{TO}}（date リテラル）。render.js が置換する。
-- 出力 CTE: pool
-- prep2 版: 120 の4条件（b1_class・b1_win_gap・top_boat）と1号艇のモーター2連率の順位（motor_rank）も持たせた（120 と同じ式）
WITH
kr AS (
  SELECT kr.race_id, kr.race_date, kr.venue_code, kr.race_number, kr.technique, kr.payout_3tan, kr.stage, kr.stage_kind,
    vd.race_grade AS g0
  FROM kb_archive_races kr
  LEFT JOIN kb_archive_venue_days vd ON vd.venue_day_id = kr.venue_day_id
  WHERE kr.has_result AND kr.race_date BETWEEN {{FROM}} AND least({{TO}}, DATE '2025-12-02')
),
kr_r AS (  -- analogy_round_from_kb(stage, stage_kind) / analogy_grade_of のインライン
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
  SELECT b.race_id, b.boat_number, b.class, b.national_win_rate AS w, nullif(b.motor_2rate, 0) AS m,
    max(nullif(b.motor_2rate, 0)) FILTER (WHERE b.boat_number = 1) OVER (PARTITION BY b.race_id) AS m1,
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
    coalesce(max(class) FILTER (WHERE boat_number = 1 AND class IN ('A1', 'A2', 'B1', 'B2')), '') AS b1_class,
    round(max(w) FILTER (WHERE boat_number = 1) - max(w) FILTER (WHERE boat_number > 1), 2) AS gap,
    (array_agg(boat_number ORDER BY w DESC NULLS LAST, boat_number))[1] AS top_boat,
    CASE WHEN max(m1) IS NOT NULL THEN 1 + count(*) FILTER (WHERE boat_number > 1 AND m > m1) END AS motor_rank,
    max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
    max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
    max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
    max(course) FILTER (WHERE finish_rank = 1) AS winner_course,
    array_agg(course ORDER BY boat_number) AS course_by_boat,
    array_agg(finish_rank ORDER BY boat_number) AS fin_by_boat,
    array_agg(finish_raw ORDER BY boat_number) AS code_by_boat,
    array_agg(CASE WHEN NOT returned THEN start_timing END ORDER BY boat_number) AS st_by_boat,
    array_agg(returned ORDER BY boat_number) AS ret_by_boat
  FROM kb_b GROUP BY race_id
),
kb_pool AS (
  SELECT r.race_id, r.race_date, r.venue_code::smallint AS venue_code, r.race_number::smallint AS race_number,
    r.round, r.grade, a.b1_class, a.gap AS b1_win_gap, a.top_boat::smallint AS top_boat, a.motor_rank::int AS motor_rank,
    a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
    CASE WHEN r.technique IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN r.technique END AS winning_technique,
    r.technique::text AS tech_raw,
    a.winner_course::smallint AS winner_course, a.course_by_boat::smallint[] AS course_by_boat,
    a.fin_by_boat::smallint[] AS fin_by_boat, a.code_by_boat::text[] AS code_by_boat,
    a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat AS ret_by_boat, 'kb'::text AS source
  FROM kb_a a JOIN kr_r r ON r.race_id = a.race_id
  WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
    AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
),
-- 本体部分。120 の analogy_pool_rows_main と同じ条件だが、CTE を各1回だけ参照する形に組み替えた
-- （CTE を複数回参照すると実体化されて件数の推定が数十件になり、入れ子ループでタイムアウトしたため。2026-10-03）。
-- レース単位の値（日付・会場・ラウンド・グレード・決まり手）は m_b で各艇の行に載せ、m_a で max() で戻す。
mr_r AS (  -- analogy_round_from_stage / analogy_grade_of のインライン
  SELECT r.race_id, r.race_date, r.venue_code, r.race_number,
    CASE
      WHEN c.race_stage IS NULL OR c.race_stage = '' THEN NULL
      WHEN n.s LIKE '%準々%' OR n.s LIKE '%準優進出%' THEN 'other'
      WHEN n.s LIKE '%準優勝戦%' THEN 'junyu'
      WHEN n.s LIKE '%優勝戦%' THEN 'yusho'
      WHEN n.s LIKE '%ドリーム%' OR n.s LIKE '%DR%' THEN 'other'
      WHEN n.s LIKE '%予選%' AND k.sp THEN 'yosen'
      WHEN n.s LIKE '%一般%' AND k.sp THEN 'other'
      WHEN k.sp THEN 'other'
      WHEN n.s LIKE '%予選%' THEN 'yosen'
      ELSE 'other' END AS round,
    CASE WHEN r.race_grade IN ('ippan', 'G3', 'G2', 'G1', 'SG') THEN r.race_grade
      ELSE (SELECT s.grade FROM race_series s
            WHERE s.venue_code = r.venue_code::smallint AND r.race_date BETWEEN s.start_date AND s.end_date
              AND s.grade IN ('ippan', 'G3', 'G2', 'G1', 'SG')
            ORDER BY s.start_date LIMIT 1) END AS grade
  FROM races r
  LEFT JOIN race_conditions c ON c.race_id = r.race_id
  CROSS JOIN LATERAL (SELECT normalize(c.race_stage, NFKC) AS s) n
  CROSS JOIN LATERAL (SELECT (n.s LIKE '%特選%' OR n.s LIKE '%特賞%' OR n.s LIKE '%特別%' OR n.s LIKE '%選抜%') AS sp) k
  WHERE r.race_date BETWEEN greatest({{FROM}}, DATE '2025-12-03') AND {{TO}}
    AND coalesce(r.cancellation_status, '') = ''
),
res AS (
  SELECT rr.*, mr_r.race_date, mr_r.venue_code AS v, mr_r.race_number AS rn, mr_r.round, mr_r.grade
  FROM race_results rr JOIN mr_r ON mr_r.race_id = rr.race_id
  WHERE rr.rank1 IS NOT NULL AND NOT coalesce(rr.is_cancelled, false) AND NOT coalesce(rr.is_no_race, false)
    AND coalesce(rr.race_status, 'normal') <> 'no_race'
),
m_b AS (
  SELECT e.race_id, e.boat_number, e.grade AS cls, e.win_rate AS w, nullif(e.motor_2rate, 0) AS m,
    max(nullif(e.motor_2rate, 0)) FILTER (WHERE e.boat_number = 1) OVER (PARTITION BY e.race_id) AS m1,
    res.race_date, res.v, res.rn, res.round, res.grade, res.winning_technique AS tech,
    coalesce(e.is_absent, false) OR coalesce(x.is_absent, false) AS absent,
    coalesce(st.is_flying, false) OR coalesce(st.is_late_start, false)
      OR coalesce(st.finish_mark IN ('F', 'L', '欠'), false)
      OR e.boat_number = ANY (coalesce(res.refund_boats, '{}')) AS returned,
    st.start_timing,
    coalesce(st.official_finish_code, st.finish_mark) AS code,
    (ARRAY[res.actual_course_1, res.actual_course_2, res.actual_course_3,
           res.actual_course_4, res.actual_course_5, res.actual_course_6])[e.boat_number] AS course,
    array_position(ARRAY[res.rank1, res.rank2, res.rank3, res.rank4, res.rank5, res.rank6], e.boat_number) AS finish_rank
  FROM race_entries e
  JOIN res ON res.race_id = e.race_id
  LEFT JOIN exhibition_data x ON x.race_id = e.race_id AND x.boat_number = e.boat_number
  LEFT JOIN race_start_timings st ON st.race_id = e.race_id AND st.boat_number = e.boat_number
),
m_a AS (
  SELECT race_id,
    max(race_date) AS race_date, max(v) AS venue_code, max(rn) AS race_number, max(round) AS round, max(grade) AS grade,
    max(tech) AS tech,
    count(*) AS n_boats,
    bool_or(absent) AS has_absent,
    bool_or(returned AND finish_rank <= 3) AS returned_top3,
    count(*) FILTER (WHERE finish_rank = 1 AND NOT returned) AS n_win,
    coalesce(max(cls) FILTER (WHERE boat_number = 1 AND cls IN ('A1', 'A2', 'B1', 'B2')), '') AS b1_class,
    round(max(w) FILTER (WHERE boat_number = 1) - max(w) FILTER (WHERE boat_number > 1), 2) AS gap,
    (array_agg(boat_number ORDER BY w DESC NULLS LAST, boat_number))[1] AS top_boat,
    CASE WHEN max(m1) IS NOT NULL THEN 1 + count(*) FILTER (WHERE boat_number > 1 AND m > m1) END AS motor_rank,
    max(boat_number) FILTER (WHERE finish_rank = 1) AS rank1,
    max(boat_number) FILTER (WHERE finish_rank = 2) AS rank2,
    max(boat_number) FILTER (WHERE finish_rank = 3) AS rank3,
    max(CASE WHEN course BETWEEN 1 AND 6 THEN course END) FILTER (WHERE finish_rank = 1) AS winner_course,
    array_agg(CASE WHEN course BETWEEN 1 AND 6 THEN course END ORDER BY boat_number) AS course_by_boat,
    array_agg(finish_rank ORDER BY boat_number) AS fin_by_boat,
    array_agg(code ORDER BY boat_number) AS code_by_boat,
    array_agg(CASE WHEN NOT returned THEN start_timing END ORDER BY boat_number) AS st_by_boat,
    array_agg(returned ORDER BY boat_number) AS ret_by_boat
  FROM m_b GROUP BY race_id
),
m_pool AS (
  SELECT a.race_id, a.race_date, a.venue_code::smallint AS venue_code, a.race_number::smallint AS race_number,
    a.round, a.grade, a.b1_class, a.gap AS b1_win_gap, a.top_boat::smallint AS top_boat, a.motor_rank::int AS motor_rank,
    a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
    CASE WHEN a.tech IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN a.tech END AS winning_technique,
    a.tech::text AS tech_raw,
    a.winner_course::smallint AS winner_course, a.course_by_boat::smallint[] AS course_by_boat,
    a.fin_by_boat::smallint[] AS fin_by_boat, a.code_by_boat::text[] AS code_by_boat,
    a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat AS ret_by_boat, 'main'::text AS source
  FROM m_a a
  WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
    AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
),
pool AS (
  SELECT * FROM kb_pool UNION ALL SELECT * FROM m_pool
)
