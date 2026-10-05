-- pool_base.sql から本体（main）部分だけを抜き出したもの。2025-12-03 以降のチャンクに使う（kb 部分は空になるため結果は同じ）
-- 120_analogy_strata.sql の analogy_pool_rows_kb / analogy_pool_rows_main を SELECT 内にインライン化したもの（読み取りのみ・CREATE なし）。
-- 120 の関数をそのまま書き写し、追加で各艇の着(fin_by_boat)・着の生コード(code_by_boat)・ST(st_by_boat、返還艇は NULL)・
-- 返還フラグ(ret_by_boat)・技の生値(tech_raw)を持たせた。母集団の条件（WHERE）は 120 と同一。
-- プレースホルダ: {{FROM}} {{TO}}（date リテラル）。render.js が置換する。
-- 出力 CTE: pool
WITH
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
  SELECT e.race_id, e.boat_number,
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
    a.round, a.grade, a.rank1::smallint AS rank1, a.rank2::smallint AS rank2, a.rank3::smallint AS rank3,
    CASE WHEN a.tech IN ('逃げ', '差し', 'まくり', 'まくり差し', '抜き', '恵まれ') THEN a.tech END AS winning_technique,
    a.tech::text AS tech_raw,
    a.winner_course::smallint AS winner_course, a.course_by_boat::smallint[] AS course_by_boat,
    a.fin_by_boat::smallint[] AS fin_by_boat, a.code_by_boat::text[] AS code_by_boat,
    a.st_by_boat::numeric[] AS st_by_boat, a.ret_by_boat AS ret_by_boat, 'main'::text AS source
  FROM m_a a
  WHERE a.n_boats = 6 AND NOT a.has_absent AND NOT a.returned_top3 AND a.n_win = 1
    AND a.rank2 IS NOT NULL AND a.rank3 IS NOT NULL
),
pool AS (SELECT * FROM m_pool)
