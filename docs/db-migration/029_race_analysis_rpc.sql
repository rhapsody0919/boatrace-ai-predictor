-- 029: レース分析クエリのRPC化（BOA-168/BOA-169）
--
-- 背景: レースページのデータ出走表・振り返りで使う分析クエリ4本が、
-- 過去90〜180日分の生データ（1レース表示あたり約0.5MB）をクライアントに
-- 転送してブラウザで集計していた。サーバー側で集計し6行のサマリーのみ
-- 返すことでegressを約1/25に削減する。
--
-- 各関数はsrc/services/supabaseDataService.jsの既存クライアント集計と
-- 同一の結果を返すよう実装している（フライング除外・キャンセルレース除外・
-- COALESCEによるnull→false扱いなど）。
--
-- 注: 旧クライアント実装にはexhibition_data.start_timingがnullの行を
-- 0として扱う潜在バグがあった（全体で5行のみ該当）。本RPCでは両STが
-- 非nullの行のみ集計する（正しい挙動に修正）。

-- 1. 展示ST/本番STのズレ（BOA-153相当）
CREATE OR REPLACE FUNCTION get_race_st_predictability(p_race_id TEXT)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
WITH entries AS (
  SELECT boat_number, player_name, racer_id
  FROM race_entries
  WHERE race_id = p_race_id
),
cutoff AS (
  SELECT to_char((now() AT TIME ZONE 'utc') - interval '90 days', 'YYYY-MM-DD') AS d
),
today_ex AS (
  SELECT boat_number, start_timing
  FROM exhibition_data
  WHERE race_id = p_race_id
),
past AS (
  SELECT pe.race_id, pe.boat_number, pe.racer_id
  FROM race_entries pe
  CROSS JOIN cutoff c
  WHERE pe.racer_id IN (SELECT racer_id FROM entries WHERE racer_id IS NOT NULL)
    AND pe.race_id >= c.d
    AND pe.race_id < p_race_id
),
devs AS (
  SELECT p.racer_id, abs(rst.start_timing - ex.start_timing) AS dev
  FROM past p
  JOIN race_start_timings rst
    ON rst.race_id = p.race_id AND rst.boat_number = p.boat_number
  JOIN exhibition_data ex
    ON ex.race_id = p.race_id AND ex.boat_number = p.boat_number
  WHERE COALESCE(rst.is_flying, false) = false
    AND rst.start_timing IS NOT NULL
    AND ex.start_timing IS NOT NULL
),
agg AS (
  SELECT racer_id, avg(dev)::float AS avg_deviation, count(*)::int AS n
  FROM devs
  GROUP BY racer_id
)
SELECT COALESCE(json_agg(json_build_object(
  'boat_number', e.boat_number,
  'player_name', e.player_name,
  'racer_id', e.racer_id,
  'exhibition_st', t.start_timing,
  'avg_deviation', a.avg_deviation,
  'sample_count', COALESCE(a.n, 0)
) ORDER BY e.boat_number), '[]'::json)
FROM entries e
LEFT JOIN today_ex t ON t.boat_number = e.boat_number
LEFT JOIN agg a ON a.racer_id = e.racer_id;
$$;

GRANT EXECUTE ON FUNCTION get_race_st_predictability(TEXT) TO anon, authenticated;

-- 2. 選手別展示タイム推移（BOA-164相当）
CREATE OR REPLACE FUNCTION get_race_exhibition_trend(p_race_id TEXT)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
WITH entries AS (
  SELECT boat_number, player_name, racer_id
  FROM race_entries
  WHERE race_id = p_race_id
),
cutoff AS (
  SELECT to_char((now() AT TIME ZONE 'utc') - interval '90 days', 'YYYY-MM-DD') AS d
),
today_ex AS (
  SELECT boat_number, exhibition_time
  FROM exhibition_data
  WHERE race_id = p_race_id
),
past AS (
  SELECT pe.race_id, pe.boat_number, pe.racer_id
  FROM race_entries pe
  CROSS JOIN cutoff c
  WHERE pe.racer_id IN (SELECT racer_id FROM entries WHERE racer_id IS NOT NULL)
    AND pe.race_id >= c.d
    AND pe.race_id < p_race_id
),
times AS (
  SELECT p.racer_id, ex.exhibition_time
  FROM past p
  JOIN exhibition_data ex
    ON ex.race_id = p.race_id AND ex.boat_number = p.boat_number
  WHERE ex.exhibition_time IS NOT NULL
),
agg AS (
  SELECT racer_id, avg(exhibition_time)::float AS avg_time, count(*)::int AS n
  FROM times
  GROUP BY racer_id
)
SELECT COALESCE(json_agg(json_build_object(
  'boat_number', e.boat_number,
  'player_name', e.player_name,
  'racer_id', e.racer_id,
  'exhibition_time', t.exhibition_time,
  'avg_exhibition_time', a.avg_time,
  'sample_count', COALESCE(a.n, 0)
) ORDER BY e.boat_number), '[]'::json)
FROM entries e
LEFT JOIN today_ex t ON t.boat_number = e.boat_number
LEFT JOIN agg a ON a.racer_id = e.racer_id;
$$;

GRANT EXECUTE ON FUNCTION get_race_exhibition_trend(TEXT) TO anon, authenticated;

-- 3. 選手別決まり手傾向（BOA-165相当）
CREATE OR REPLACE FUNCTION get_race_technique_profile(p_race_id TEXT)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
WITH entries AS (
  SELECT boat_number, player_name, racer_id
  FROM race_entries
  WHERE race_id = p_race_id
),
cutoff AS (
  SELECT to_char((now() AT TIME ZONE 'utc') - interval '90 days', 'YYYY-MM-DD') AS d
),
wins AS (
  SELECT pe.racer_id, rr.winning_technique, count(*)::int AS cnt
  FROM race_entries pe
  JOIN race_results rr ON rr.race_id = pe.race_id
  CROSS JOIN cutoff c
  WHERE pe.racer_id IN (SELECT racer_id FROM entries WHERE racer_id IS NOT NULL)
    AND pe.race_id >= c.d
    AND pe.race_id < p_race_id
    AND rr.winning_technique IS NOT NULL
    AND rr.rank1 = pe.boat_number
  GROUP BY pe.racer_id, rr.winning_technique
),
totals AS (
  SELECT racer_id, sum(cnt)::int AS win_count
  FROM wins
  GROUP BY racer_id
)
SELECT COALESCE(json_agg(json_build_object(
  'boat_number', e.boat_number,
  'player_name', e.player_name,
  'racer_id', e.racer_id,
  'win_count', COALESCE(t.win_count, 0),
  'techniques', COALESCE((
    SELECT json_agg(json_build_object(
      'technique', w.winning_technique,
      'count', w.cnt,
      'percentage', w.cnt::float / t.win_count * 100
    ) ORDER BY w.cnt DESC, w.winning_technique)
    FROM wins w
    WHERE w.racer_id = e.racer_id
  ), '[]'::json)
) ORDER BY e.boat_number), '[]'::json)
FROM entries e
LEFT JOIN totals t ON t.racer_id = e.racer_id;
$$;

GRANT EXECUTE ON FUNCTION get_race_technique_profile(TEXT) TO anon, authenticated;

-- 4. 選手×艇番別 回収率（BOA-167相当）
CREATE OR REPLACE FUNCTION get_race_return_rate(p_race_id TEXT)
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
WITH entries AS (
  SELECT boat_number, player_name, racer_id
  FROM race_entries
  WHERE race_id = p_race_id
),
cutoff AS (
  SELECT to_char((now() AT TIME ZONE 'utc') - interval '180 days', 'YYYY-MM-DD') AS d
),
past AS (
  SELECT pe.race_id, pe.boat_number, pe.racer_id
  FROM race_entries pe
  JOIN entries e
    ON e.racer_id = pe.racer_id AND e.boat_number = pe.boat_number
  CROSS JOIN cutoff c
  WHERE pe.race_id >= c.d
    AND pe.race_id < p_race_id
),
scored AS (
  SELECT p.racer_id, p.boat_number,
    count(*)::int AS n,
    sum(CASE WHEN rr.rank1 = p.boat_number THEN COALESCE(rr.payout_win, 0) ELSE 0 END) AS win_sum,
    sum(CASE WHEN rr.rank1 = p.boat_number THEN COALESCE(rr.payout_place_1, 0)
             WHEN rr.rank2 = p.boat_number THEN COALESCE(rr.payout_place_2, 0)
             ELSE 0 END) AS place_sum
  FROM past p
  JOIN race_results rr ON rr.race_id = p.race_id
  WHERE COALESCE(rr.is_cancelled, false) = false
    AND COALESCE(rr.is_no_race, false) = false
  GROUP BY p.racer_id, p.boat_number
)
SELECT COALESCE(json_agg(json_build_object(
  'boat_number', e.boat_number,
  'player_name', e.player_name,
  'racer_id', e.racer_id,
  'sample_count', COALESCE(s.n, 0),
  -- (合計払戻 / (サンプル数 × 100円)) × 100% = 合計払戻 / サンプル数
  'win_return_rate', CASE WHEN s.n > 0 THEN (s.win_sum::float / s.n) ELSE NULL END,
  'place_return_rate', CASE WHEN s.n > 0 THEN (s.place_sum::float / s.n) ELSE NULL END
) ORDER BY e.boat_number), '[]'::json)
FROM entries e
LEFT JOIN scored s ON s.racer_id = e.racer_id AND s.boat_number = e.boat_number;
$$;

GRANT EXECUTE ON FUNCTION get_race_return_rate(TEXT) TO anon, authenticated;
