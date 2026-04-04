-- BOA-53: /races ページ用のサマリーRPC関数
-- 90日分の日付ごとにモデル別の的中数・配当合計を1回のクエリで取得

CREATE OR REPLACE FUNCTION get_race_history_summary(days_back INTEGER DEFAULT 90)
RETURNS JSON
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSON;
  start_date DATE;
BEGIN
  start_date := CURRENT_DATE - days_back;

  -- 単一パスで races + predictions を集計
  -- finished は is_hit_win IS NOT NULL で判定（race_results トリガーで自動更新される）
  WITH base AS (
    SELECT
      r.race_date,
      p.model_id,
      p.race_id,
      p.is_hit_win,
      p.is_hit_place,
      p.is_hit_trifecta,
      p.is_hit_trio,
      p.payout_win,
      p.payout_place,
      p.payout_trifecta,
      p.payout_trio
    FROM races r
    INNER JOIN predictions p ON r.race_id = p.race_id
    WHERE r.race_date >= start_date
  ),
  model_stats AS (
    SELECT
      race_date,
      model_id,
      COUNT(*) FILTER (WHERE is_hit_win IS NOT NULL) AS finished,
      COUNT(*) FILTER (WHERE is_hit_win = true) AS win_hits,
      COALESCE(SUM(payout_win) FILTER (WHERE is_hit_win = true), 0) AS win_payouts,
      COUNT(*) FILTER (WHERE is_hit_place = true) AS place_hits,
      COALESCE(SUM(payout_place) FILTER (WHERE is_hit_place = true), 0) AS place_payouts,
      COUNT(*) FILTER (WHERE is_hit_trifecta = true) AS trifecta_hits,
      COALESCE(SUM(payout_trifecta) FILTER (WHERE is_hit_trifecta = true), 0) AS trifecta_payouts,
      COUNT(*) FILTER (WHERE is_hit_trio = true) AS trio_hits,
      COALESCE(SUM(payout_trio) FILTER (WHERE is_hit_trio = true), 0) AS trio_payouts
    FROM base
    GROUP BY race_date, model_id
  ),
  day_counts AS (
    -- standardモデルの件数 = 1日あたりのレース数
    SELECT
      race_date,
      COUNT(DISTINCT race_id) AS total_races,
      COUNT(DISTINCT race_id) FILTER (WHERE is_hit_win IS NOT NULL) AS finished_races
    FROM base
    WHERE model_id = 'standard'
    GROUP BY race_date
  ),
  models_per_day AS (
    SELECT
      race_date,
      json_agg(
        json_build_object(
          'modelId', model_id,
          'finishedRaces', finished,
          'winHits', win_hits,
          'winPayouts', win_payouts,
          'placeHits', place_hits,
          'placePayouts', place_payouts,
          'trifectaHits', trifecta_hits,
          'trifectaPayouts', trifecta_payouts,
          'trioHits', trio_hits,
          'trioPayouts', trio_payouts
        )
      ) AS models
    FROM model_stats
    GROUP BY race_date
  )
  SELECT json_build_object(
    'days', COALESCE(json_agg(
      json_build_object(
        'date', dc.race_date,
        'totalRaces', dc.total_races,
        'finishedRaces', dc.finished_races,
        'models', COALESCE(mpd.models, '[]'::json)
      ) ORDER BY dc.race_date DESC
    ), '[]'::json)
  ) INTO result
  FROM day_counts dc
  LEFT JOIN models_per_day mpd ON dc.race_date = mpd.race_date;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_race_history_summary(INTEGER) TO anon, authenticated;
