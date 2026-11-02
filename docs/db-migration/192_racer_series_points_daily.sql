-- 192: 公式の得点率一覧（pointrank）を、節×日ごとに上書きせず残す表 racer_series_points_daily（BOA-1210）
--
-- 対応 plan: docs/design/pointrank-history/plan.md
--
-- ⚠️ この案は「本番へ未適用」。適用はオーナーが db-apply で行う。
--
-- 背景: racer_series_points は (venue_code, meet_start_date, racer_id) で毎晩上書きされ、最終日の値しか残らない。
-- Shorts 型B「準優に残れるか」は、予選最終日の朝 05:10 に「前の晩（予選の最後の前の日）」の得点率を読む。
-- 書き手は cron point_rank（scripts/daily/scrape-point-rank.js）で、racer_series_points と同じ取得の結果を、
-- 取得の対象日（snapshot_date）をキーに足して書く。取得の回数は変わらない（毎晩、開催中の全会場を取っている）。
-- 公式は過去の日付（hd）で開いても節の最新の表を返すので、表の注記「N日目MR終了時点」の N が対象日の日目と同じ会場だけ書く
-- （予選の後は「４日目１２R終了時点」で止まるので、5日目以降の行はできない）。
-- 書くのは値が変わった行と新しい行だけ（scripts/lib/unchangedRows.js の upsertChangedRows）。
--
-- 読み手: hq（claude_ro。166 の既定の権限で SELECT が付くが、この表は明示する）・anon（今は画面で使わない。
-- racer_series_points と同じく公開の値なので SELECT だけ付ける）。
--
-- 量: SG/G1 の節で、表の注記の日目が対象日の日目と同じ日（1〜4日目）ごとに約52行（1行 約200B）。1か月に SG/G1 が約5節×表のある日 約4日 → 約1,000行・約0.2MB。
--
-- 適用前の確認（読み取り）:
--   SELECT to_regclass('public.racer_series_points_daily');  -- NULL
--
-- 適用後の確認（読み取り。Claude が scripts/db/ro-query.js で行う）:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.racer_series_points_daily'::regclass;  -- true
--   SELECT has_table_privilege('anon', 'public.racer_series_points_daily', 'SELECT'),
--          has_any_column_privilege('anon', 'public.racer_series_points_daily', 'INSERT'),
--          has_any_column_privilege('authenticated', 'public.racer_series_points_daily', 'UPDATE'),
--          has_table_privilege('claude_ro', 'public.racer_series_points_daily', 'SELECT');  -- true / false / false / true
--   get_advisors（security）の rls_disabled_in_public が0件
--
-- 適用の経路: GRANT・POLICY を含むので db-apply は heavy（オーナーの承認の1タップ）。新しい表を作るだけで、既存の表のロックは無い。
--   時間帯の制約は無い。次の SG/G1 の予選3日目の 22:00 JST より前に当てる。PostgREST のスキーマは本番の DDL の
--   イベントトリガーで読み直されるので NOTIFY は要らない
--
-- 戻し方: DROP TABLE IF EXISTS public.racer_series_points_daily;
--   （書き手は表が無いと「未適用」として履歴を飛ばし、racer_series_points は書き続ける。戻した後に失う物はこの表の行だけ）

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.racer_series_points_daily (
    snapshot_date   DATE     NOT NULL,
    venue_code      SMALLINT NOT NULL CHECK (venue_code BETWEEN 1 AND 24),
    racer_id        INTEGER  NOT NULL,
    meet_start_date DATE     NOT NULL,
    series_day      SMALLINT NOT NULL CHECK (series_day BETWEEN 1 AND 9),
    race_grade      VARCHAR(10),
    player_name     VARCHAR(50),
    grade           VARCHAR(5),
    rank            SMALLINT,
    score_rate      NUMERIC(4, 2),
    placements      TEXT,
    total_points    SMALLINT,
    penalty_points  SMALLINT,
    remarks         VARCHAR(30),
    next_race_1     SMALLINT CHECK (next_race_1 BETWEEN 1 AND 12),
    next_race_2     SMALLINT CHECK (next_race_2 BETWEEN 1 AND 12),
    next_series_day SMALLINT CHECK (next_series_day BETWEEN 1 AND 9),
    as_of_race      SMALLINT NOT NULL CHECK (as_of_race BETWEEN 1 AND 12),
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_date, venue_code, racer_id),
    CONSTRAINT rspd_meet_start_not_after_snapshot CHECK (meet_start_date <= snapshot_date)
);

COMMENT ON TABLE public.racer_series_points_daily IS
    '公式の得点率一覧（pointrank）の、取得の対象日（snapshot_date）ごとの写し（BOA-1210）。racer_series_points は節ごとに上書きされるので、日ごとの値はこちらで読む。SG/G1 だけで、表の注記の日目が対象日の日目と同じ日だけ行がある（予選の後の5日目以降は無い）';
COMMENT ON COLUMN public.racer_series_points_daily.snapshot_date IS
    '取得の対象日（JST）。cron point_rank が 22:00 JST の指定時刻から解決した日で、その日の全レースの後の値（as_of_race で確かめる）。予選最終日の前の日の行は、順延で日付がずれうるので series_day と snapshot_date の範囲で引く';
COMMENT ON COLUMN public.racer_series_points_daily.series_day IS
    'snapshot_date の節の日目（race_conditions.series_day）。表の注記の日目と同じ';
COMMENT ON COLUMN public.racer_series_points_daily.meet_start_date IS
    'snapshot_date − (series_day − 1)（racer_series_points と同じ式）。丸一日の中止で同じ日目が2日続くと、順延した日より後の行は1日遅くなるので、節の中の日ごとの読みのキーにしない';
COMMENT ON COLUMN public.racer_series_points_daily.as_of_race IS
    '表の注記「N日目MR終了時点」の M。N は series_day と同じ日の表だけを書く（過去の日付で開くと節の最新が返るため）。12 未満ならその日の途中か、後半のレースが中止';
COMMENT ON COLUMN public.racer_series_points_daily.scraped_at IS
    'この行の値を最後に書いた時刻。値が変わらない再取得では書かない（upsertChangedRows）ので、最初に取れた時刻が残る';

-- 節の中の日ごとの読み（venue_code と snapshot_date の範囲＋series_day）用
CREATE INDEX IF NOT EXISTS idx_racer_series_points_daily_venue
    ON public.racer_series_points_daily (venue_code, snapshot_date);

-- 権限: 076 の後、postgres が作る表の anon・authenticated の既定の権限は外れている。SELECT だけを明示する。
-- 書くのは service_role（RLS を迂回）だけ
REVOKE ALL ON public.racer_series_points_daily FROM PUBLIC, anon, authenticated;
ALTER TABLE public.racer_series_points_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS racer_series_points_daily_public_read ON public.racer_series_points_daily;
CREATE POLICY racer_series_points_daily_public_read ON public.racer_series_points_daily
    FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.racer_series_points_daily TO anon, authenticated;
GRANT SELECT ON public.racer_series_points_daily TO claude_ro;
GRANT SELECT, INSERT, UPDATE ON public.racer_series_points_daily TO service_role;

COMMIT;
