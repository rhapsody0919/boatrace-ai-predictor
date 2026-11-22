-- 204: Search Console の日別の明細（query × page × date）を置く表（BOA-1706、hq 閉鎖 R2）
--
-- 背景: GSC の日別は非公開の hq が Mac の launchd で取り、hq の中のファイルに置いていた。hq を閉じるので、
--   龍神の Actions（.github/workflows/growth-gsc-daily.yml、Environment prod-jobs）で取り、この表に置く。
--   龍神は公開のリポジトリなので、数字は repo・ログ・artifact に出さず、この表にだけ置く。
--
-- 書き手: scripts/growth/collect-gsc-daily.js だけ（service_role）。毎回 PT の今日を除く直近7日を取り直して upsert し、
--   全部を取り切れた日（行数が API の上限 50,000 未満）だけ、その日の fetched_at が今回より古い行を消す。
-- 読み手: claude_ro（窓口の会話の読み取り）。画面では使わないので anon・authenticated には何も付けない。
--
-- 戻し方: DROP TABLE public.growth_gsc_daily;（他の表から参照されない）

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.growth_gsc_daily (
    date        DATE        NOT NULL,
    query       TEXT        NOT NULL,
    page        TEXT        NOT NULL,
    clicks      INTEGER     NOT NULL CHECK (clicks >= 0),
    impressions INTEGER     NOT NULL CHECK (impressions >= 0),
    position    REAL        NOT NULL CHECK (position >= 0),
    fetched_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (date, query, page)
);

COMMENT ON TABLE public.growth_gsc_daily IS
    'Search Console の検索（web）の query × page × date の明細（BOA-1706）。国・端末で絞らない。dataState=all（確定前の日も含む）を毎回直近7日ぶん取り直す。匿名化された query は Search Console が返さないので、この表の合計はサイトの合計より小さい';
COMMENT ON COLUMN public.growth_gsc_daily.date IS 'Search Console の日付（太平洋時間 PT の日）。GA4・配備の JST の日と1日ずれうる';
COMMENT ON COLUMN public.growth_gsc_daily.page IS 'Search Console が返す URL のまま（https://www.boat-ai.jp/… と https://boat-ai.jp/… が別の行になりうる）';
COMMENT ON COLUMN public.growth_gsc_daily.position IS 'その日の平均の掲載順位（Search Console の値のまま）';
COMMENT ON COLUMN public.growth_gsc_daily.fetched_at IS 'この行を最後に書いた取得の開始時刻。全部を取り切れた日は、今回より古い行（今回の取得に無い組）を消す';

-- 日付で読む・消す
CREATE INDEX IF NOT EXISTS idx_growth_gsc_daily_date_fetched
    ON public.growth_gsc_daily (date, fetched_at);

-- 権限: 202（eve_race_deadlines）と同じ形。RLS は有効でポリシーなし。書くのは service_role（RLS を迂回）、読むのは claude_ro。
-- service_role は既定の権限で ALL を持つので、外してから要る分だけ付ける（古い行を消すので DELETE を付ける）
ALTER TABLE public.growth_gsc_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_gsc_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_gsc_daily TO service_role;
GRANT SELECT ON public.growth_gsc_daily TO claude_ro;

COMMIT;
