-- 205: Search Console の日別のページ別（date × page、query を付けない）の表（SEO・GEO・AIO のデータの輪 段1 PR2、2026-11-24 オーナー承認）
--
-- 背景: growth_gsc_daily（204、query × page）は、Search Console が匿名化した語を返さないので、ページの合計がサイトの実際より小さい。
--   記事ごとの効き（T+28）の主の物差しは、query を付けない date × page のクリック。
--   設計: side の設計案 seo-data-loop-design-2026-11-24（審査を受けた版）、案は docs/design/seo-data-loop/db-draft.md。
-- 書き手: scripts/maintenance/backfill-gsc-daily.js（--tables page、2025-12-21〜の補充）と、後の PR で日次の取り込み（service_role）。
-- 読み手: claude_ro（窓口の朝の1枚）。画面では使わないので anon・authenticated には何も付けない。数字は公開の場所に出さない。
--
-- 戻し方: DROP TABLE public.growth_gsc_page_daily;（他の表から参照されない）

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.growth_gsc_page_daily (
    date        DATE        NOT NULL,
    page        TEXT        NOT NULL,
    clicks      INTEGER     NOT NULL CHECK (clicks >= 0),
    impressions INTEGER     NOT NULL CHECK (impressions >= 0),
    position    REAL        NOT NULL CHECK (position >= 0),
    fetched_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (date, page)
);

COMMENT ON TABLE public.growth_gsc_page_daily IS
    'Search Console の検索（web）の date × page（query を付けない。匿名化された語も合計に入る）。dataState=all を取り直す。growth_gsc_daily（query 付き）より合計が大きい';
COMMENT ON COLUMN public.growth_gsc_page_daily.date IS 'Search Console の日付（太平洋時間 PT の日）。GA4・配備の JST の日と1日ずれうる';
COMMENT ON COLUMN public.growth_gsc_page_daily.page IS 'Search Console が返す URL のまま（www と無印が別の行になりうる）';
COMMENT ON COLUMN public.growth_gsc_page_daily.position IS 'その日の平均の掲載順位（Search Console の値のまま。ページ間の平均は表示で重みを付ける）';

-- ページごとの時系列（記事の効き）を引く
CREATE INDEX IF NOT EXISTS idx_growth_gsc_page_daily_page_date
    ON public.growth_gsc_page_daily (page, date);

-- 権限: 204（growth_gsc_daily）と同じ形。anon・authenticated には何も付けない
ALTER TABLE public.growth_gsc_page_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_gsc_page_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_gsc_page_daily TO service_role;
GRANT SELECT ON public.growth_gsc_page_daily TO claude_ro;

COMMIT;
