-- BOA-822 PR-1（#1461）マージ後のオーナーの本番の手順（3つ。上から順に）
--
-- 手順1: この下の「155」をそのまま SQL Editor で実行する（docs/db-migration/155_in_caution_gap_band_daily.sql と同じ本文）。
--        事前の確認・事後の確認（RLS 有効・anon が読めない・advisor）は BOA-822 のレーンが読み取りで行う。
-- 手順2: GitHub Actions の「In-Caution Nightly」を Run workflow で、full にチェック・force にチェックを入れて1回実行する
--        （SQL ではない。2019-04-01〜前日の全期間の表を作る。約5万行、数分〜十数分）。
--        終わったら BOA-822 のレーンが年ごとの件数を統計検証の値と照合する。
-- 手順3: 手順2が成功してから、いちばん下の「毎晩の起動を live にする」を SQL Editor で実行する（JST 2:30 に直近14日を書き直すようになる）。
--
-- 元に戻す: 手順3は mode を 'off' にする。手順1は docs/db-migration/155 の冒頭の「元に戻す」。

-- ============================================================ 手順1: 155
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
-- first_date・last_date は期間の中で行がある最初・最後の日（帯ごとではなく全体。全行に同じ値）。朝の生成は
-- first_date が inCautionConfig.json の from より後、last_date が前日より3日以上古い、合計の n が下限未満の
-- どれかなら値を書かない（表が欠けた状態で、もっともらしいが違う率を書かない。plan §1）
CREATE OR REPLACE FUNCTION public.get_in_caution_band_rates(p_from date, p_through date)
RETURNS TABLE (round_grp text, gap_band smallint, n bigint, non_win bigint, first_date date, last_date date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT d.round_grp, d.gap_band, sum(d.n)::bigint, sum(d.non_win)::bigint,
         min(min(d.race_date)) OVER (), max(max(d.race_date)) OVER ()
  FROM public.in_caution_gap_band_daily d
  WHERE (p_from IS NULL OR d.race_date >= p_from)
    AND d.race_date <= p_through
  GROUP BY d.round_grp, d.gap_band
  ORDER BY d.round_grp, d.gap_band;
$$;

REVOKE ALL ON FUNCTION public.get_in_caution_band_rates(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_in_caution_band_rates(date, date) TO service_role;

-- ============================================================ 手順3: 毎晩の起動を live にする（手順2の成功の後）
insert into scrape_job_state (job, mode) values ('in_caution_dispatch', 'live')
on conflict (job) do update set mode = excluded.mode;
