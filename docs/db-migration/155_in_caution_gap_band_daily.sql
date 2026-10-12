-- 155: イン崩れ注意度の「日×ラウンド×勝率差の帯」の表と、期間を指定して合計する RPC（BOA-822）
--
-- 対応spec/plan: docs/design/in-collapse-caution/plan.md「データ設計」、ADR-0095
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーが SQL Editor で行う（docs/db-migration/APPLIED.md）。
--
-- 背景:
--   イン崩れ注意度は「1号艇の全国勝率 − 2〜6号艇の最高の全国勝率」を 0.5 刻みの帯にし、その帯の全国の過去レース
--   （完全レース）で1号艇が1着を逃した割合（spec FR-2）。帯ごとの割合を朝の生成で毎回出し直すと 2019-04 からの
--   約48万レースを読むことになるので、夜の Python（scripts/ml/analogy/in_caution_bands.py）が日ごとの件数だけを
--   この表に書き、朝は RPC で期間を指定して合計する（約45行）。PostgREST は GROUP BY できず、JS で合計すると
--   1000行で黙って切れる（docs/knowledge/db-operations.md）。
--
-- 表の行: 1日 × ラウンド（other / junyu / yusho）× 帯（-8〜6）。帯 -8 は「−4.0未満」、6 は「+3.0以上」。
--   帯 = clamp(floor(勝率差の 1/100 の整数 / 50), -8, 6)。勝率差が出せないレース（1号艇か他の5艇全部の勝率が無い）は
--   書かない。約2,400日 × 最大45行、実際は約5万行。
--   source は長期（kb_archive、2025-12-02 まで）と本体（2025-12-03〜）のどちらから作ったか（確認用）。
--
-- 権限: 表は RLS 有効でポリシーなし（anon・authenticated は読めない）。書くのは夜のジョブ（service_role）だけ。
--   RPC は service_role だけが実行できる（朝の生成と /accuracy の夜のジョブが呼ぶ。画面は呼ばない）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.in_caution_gap_band_daily'::regclass;  -- true
--   SELECT has_table_privilege('anon', 'public.in_caution_gap_band_daily', 'SELECT');              -- false
--   SELECT has_function_privilege('anon', 'public.get_in_caution_band_rates(date, date)', 'EXECUTE'); -- false
--   advisor の rls_disabled_in_public が 0 件
--
-- 元に戻す: 生成側（inCaution を書く処理）と夜のジョブを先に戻してから
--   DROP FUNCTION public.get_in_caution_band_rates(date, date); DROP TABLE public.in_caution_gap_band_daily;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.in_caution_gap_band_daily (
  race_date   date        NOT NULL,
  round_grp   text        NOT NULL CHECK (round_grp IN ('other', 'junyu', 'yusho')),
  gap_band    smallint    NOT NULL CHECK (gap_band BETWEEN -8 AND 6),
  n           integer     NOT NULL CHECK (n > 0),
  non_win     integer     NOT NULL CHECK (non_win >= 0 AND non_win <= n),
  source      text        NOT NULL CHECK (source IN ('kb', 'main')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (race_date, round_grp, gap_band)
);

COMMENT ON TABLE public.in_caution_gap_band_daily IS
  'BOA-822 イン崩れ注意度: 完全レースの日×ラウンド×勝率差の帯ごとの件数と1号艇の非1着数。夜の in_caution_bands.py が書く';

ALTER TABLE public.in_caution_gap_band_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.in_caution_gap_band_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.in_caution_gap_band_daily TO service_role;

-- 期間（p_from〜p_through、両端を含む）の帯ごとの合計。p_from が NULL なら表の最初の日から。
-- last_date は期間の中で行がある最後の日（朝の生成が inCaution.through に書き、夜のジョブの遅れを見る）
CREATE OR REPLACE FUNCTION public.get_in_caution_band_rates(p_from date, p_through date)
RETURNS TABLE (round_grp text, gap_band smallint, n bigint, non_win bigint, last_date date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT d.round_grp, d.gap_band, sum(d.n)::bigint, sum(d.non_win)::bigint, max(d.race_date)
  FROM public.in_caution_gap_band_daily d
  WHERE (p_from IS NULL OR d.race_date >= p_from)
    AND d.race_date <= p_through
  GROUP BY d.round_grp, d.gap_band
  ORDER BY d.round_grp, d.gap_band;
$$;

REVOKE ALL ON FUNCTION public.get_in_caution_band_rates(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_in_caution_band_rates(date, date) TO service_role;
