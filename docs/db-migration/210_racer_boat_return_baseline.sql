-- 210: 選手ページの回収率の全国の基準（racer_boat_return_baseline）と集計の RPC
-- 案と審査: docs/design/racer-return-baseline/db-draft.md（system-architect 2026-11-26）。窓口が #3544 の SQL を写した
-- 使い道: 選手ページの通算の比べに限る（レース詳細・予想・事前の判定に使わない。後の結果が入るため）
-- 適用前の計測: 1か月分（2026-10）の集計の SELECT が 416ms（2026-11-26 窓口が本番の読み取りで EXPLAIN ANALYZE）
-- 確かめ: scripts/maintenance/verify-racer-boat-return-baseline.js（このファイルを PGlite に流す）

-- 選手ページの回収率の全国の基準（docs/design/racer-return-baseline/db-draft.md、未審査の案）
CREATE TABLE IF NOT EXISTS public.racer_boat_return_baseline (
  scope            text        NOT NULL,
  boat_number      smallint    NOT NULL CHECK (boat_number BETWEEN 0 AND 6),
  window_start     date        NOT NULL,
  window_end       date        NOT NULL,
  window_days      integer     NOT NULL,
  runs             integer     NOT NULL CHECK (runs > 0),
  unranked_runs    integer     NOT NULL,
  win_sum          bigint      NOT NULL,
  win_sumsq        bigint      NOT NULL,
  place_sum        bigint      NOT NULL,
  place_sumsq      bigint      NOT NULL,
  tri_pos1_sum     bigint      NOT NULL,
  tri_pos1_sumsq   bigint      NOT NULL,
  tri_pos2_sum     bigint      NOT NULL,
  tri_pos2_sumsq   bigint      NOT NULL,
  tri_pos3_sum     bigint      NOT NULL,
  tri_pos3_sumsq   bigint      NOT NULL,
  tri_paid_missing integer     NOT NULL,
  rule_version     smallint    NOT NULL,
  last_updated     date        NOT NULL,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, boat_number),
  CHECK (window_end >= window_start)
);

COMMENT ON TABLE public.racer_boat_return_baseline IS
  '選手ページの回収率（単勝・複勝・3連単の着順固定）の全国の基準。窓（window_start〜window_end）の全体で数えるので後の結果を含む。選手ページの通算の比べにだけ使い、レース詳細・予想・事前の判定には使わない。boat_number 0 は全艇の合計。率は持たず、合計と二乗の合計から読み手の純関数で出す（docs/design/racer-return-baseline/db-draft.md）';

ALTER TABLE public.racer_boat_return_baseline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS racer_boat_return_baseline_read ON public.racer_boat_return_baseline;
CREATE POLICY racer_boat_return_baseline_read ON public.racer_boat_return_baseline
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.racer_boat_return_baseline TO anon;
GRANT SELECT ON public.racer_boat_return_baseline TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.racer_boat_return_baseline TO service_role;

-- 窓 [p_from, p_to]（両端を含む、race_id の日付で数える）の艇ごとの合計と、全艇の合計（boat_number 0）。
-- 母数は選手ページの getRacerRaceHistory と同じ: 会場のあるレースで、不成立（race_status='no_race'）と rank1 が NULL を除く。
-- 着順なし（race_start_timings.finish_mark が空でなく 1〜6 以外）は払戻0で母数に入れる（オーナー 2026-11-26）。
-- 1着なら単勝と複勝の1着側、2着なら複勝の2着側（src/pure/racerBoatReturns.js の payoutsOf）。
-- 3連単は race_results.payout_trio（列名と中身が逆で3連単）。その艇が k 着（k=1〜3）の走の合計。payout_trio が NULL の走は数に入れて合計から外す
CREATE OR REPLACE FUNCTION public.compute_racer_boat_return_baseline(p_from date, p_to date)
RETURNS TABLE (
  boat_number smallint, runs bigint, unranked_runs bigint,
  win_sum bigint, win_sumsq bigint, place_sum bigint, place_sumsq bigint,
  tri_pos1_sum bigint, tri_pos1_sumsq bigint, tri_pos2_sum bigint, tri_pos2_sumsq bigint,
  tri_pos3_sum bigint, tri_pos3_sumsq bigint, tri_paid_missing bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT e.boat_number::smallint AS b,
           (st.finish_mark IS NOT NULL AND st.finish_mark <> '' AND st.finish_mark !~ '^[1-6]$') AS unranked,
           rr.rank1, rr.rank2, rr.rank3,
           rr.payout_win, rr.payout_place_1, rr.payout_place_2, rr.payout_trio
      FROM race_entries e
      JOIN races r ON r.race_id = e.race_id AND r.venue_code IS NOT NULL
      JOIN race_results rr ON rr.race_id = e.race_id
      LEFT JOIN race_start_timings st ON st.race_id = e.race_id AND st.boat_number = e.boat_number
     WHERE e.race_id >= to_char(p_from, 'YYYY-MM-DD')
       AND e.race_id < to_char(p_to + 1, 'YYYY-MM-DD')
       AND rr.rank1 IS NOT NULL
       AND rr.race_status IS DISTINCT FROM 'no_race'
  ), x AS (
    SELECT b, unranked,
           CASE WHEN NOT unranked AND rank1 = b THEN COALESCE(payout_win, 0) ELSE 0 END::bigint AS w,
           CASE WHEN unranked THEN 0
                WHEN rank1 = b THEN COALESCE(payout_place_1, 0)
                WHEN rank2 = b THEN COALESCE(payout_place_2, 0)
                ELSE 0 END::bigint AS p,
           CASE WHEN unranked THEN 0 WHEN rank1 = b THEN 1 WHEN rank2 = b THEN 2 WHEN rank3 = b THEN 3 ELSE 0 END AS pos,
           payout_trio::bigint AS t
      FROM base
  )
  SELECT COALESCE(b, 0)::smallint,
         count(*), count(*) FILTER (WHERE unranked),
         sum(w), sum(w * w), sum(p), sum(p * p),
         COALESCE(sum(t) FILTER (WHERE pos = 1), 0), COALESCE(sum(t * t) FILTER (WHERE pos = 1), 0),
         COALESCE(sum(t) FILTER (WHERE pos = 2), 0), COALESCE(sum(t * t) FILTER (WHERE pos = 2), 0),
         COALESCE(sum(t) FILTER (WHERE pos = 3), 0), COALESCE(sum(t * t) FILTER (WHERE pos = 3), 0),
         count(*) FILTER (WHERE pos > 0 AND t IS NULL)
    FROM x
   GROUP BY GROUPING SETS ((b), ())
$$;

COMMENT ON FUNCTION public.compute_racer_boat_return_baseline(date, date) IS
  '選手ページの回収率の全国の基準の合計を、窓 [p_from, p_to] で数える。書き手（Vercel Cron、service_role）が月ごとに呼んで足す。選手ページの通算の比べにだけ使う';

REVOKE ALL ON FUNCTION public.compute_racer_boat_return_baseline(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_racer_boat_return_baseline(date, date) FROM anon;
REVOKE ALL ON FUNCTION public.compute_racer_boat_return_baseline(date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.compute_racer_boat_return_baseline(date, date) TO service_role;
