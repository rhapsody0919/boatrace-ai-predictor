-- 202: 前夜に取った翌日の締切予定の表 eve_race_deadlines（BOA-1282・BOA-1306、オーナー 2026-11-04 21時「前夜の投稿に翌日の締切を書く」）
--
-- 対応 plan: docs/design/eve-race-deadlines/plan.md
--
-- ⚠️ この案は「本番へ未適用」。適用はオーナーが db-apply で行う。
--
-- 背景: 翌日のレースの行（races）は当日 05:00〜の朝の初期化（races_init）で入るので、21:30 の前夜の投稿の作りの時点では
-- 翌日の締切が DB に無い。公式の raceindex は前夜に翌日の締切予定を出している（11/4 の測定: 20:3x と 21:02 で同じ値）。
-- 書き手: cron eve_deadlines（api/cron/eve-deadlines.js、JST 20:40・21:00・21:10・21:20）が翌日の24場の raceindex を取り、
--   最終日の会場だけ racelist の 12・11・10R のレース名から優勝戦を見分ける。cron eve_deadlines_reconcile（JST 06:30・08:00）が
--   当日の races.start_time と比べて day_start_time・day_mismatch・reconciled_at を書く。どちらも service_role
-- 読み手: hq（claude_ro、platform/eve_deadlines.py の race_id → 締切と final_deadline(date, jcd)）。画面では使わない
--
-- 量: 1晩 約15会場×12R＝約180行（1行 約150B、1年 約10MB）。書くのは値の変わる行だけ（2回目以降の起動はふつう0行）、朝の照合で約180行を1回
--
-- 適用前の確認（読み取り）:
--   SELECT to_regclass('public.eve_race_deadlines');  -- NULL
--   SELECT job, mode, last_success_at, last_tick_at FROM scrape_job_state WHERE job IN ('eve_deadlines', 'eve_deadlines_reconcile');
--   -- 0行（コードのデプロイの後で cron が先に動いていれば mode='off'・last_success_at NULL の行。下の INSERT が live に上書きする）
--
-- 適用後の確認（読み取り。Claude が scripts/db/ro-query.js で行う）:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.eve_race_deadlines'::regclass;  -- true
--   SELECT has_table_privilege('anon', 'public.eve_race_deadlines', 'SELECT'),
--          has_table_privilege('authenticated', 'public.eve_race_deadlines', 'SELECT'),
--          has_table_privilege('claude_ro', 'public.eve_race_deadlines', 'SELECT'),
--          has_table_privilege('service_role', 'public.eve_race_deadlines', 'UPDATE'),
--          has_table_privilege('service_role', 'public.eve_race_deadlines', 'DELETE');  -- false / false / true / true / false
--   SELECT job, mode FROM scrape_job_state WHERE job IN ('eve_deadlines', 'eve_deadlines_reconcile');  -- 2行とも live
--   get_advisors（security）の rls_disabled_in_public が0件
--   SELECT rolbypassrls FROM pg_roles WHERE rolname = 'claude_ro';  -- true（ポリシーなしで読める根拠）
--   翌晩 21:30 以後: SELECT race_date, count(*), count(*) FILTER (WHERE is_final) FROM eve_race_deadlines GROUP BY 1 ORDER BY 1 DESC LIMIT 2;
--
-- 適用の経路: GRANT・REVOKE・INSERT … ON CONFLICT を含むので db-apply は heavy（オーナーの承認の1タップ）。新しい表を作るだけで、
--   既存の表のロックは scrape_job_state の2行だけ。時間帯の制約は無い（その日の 20:40 JST より前に当てれば、その晩の 21:30 から使える）
--
-- 戻し方: UPDATE scrape_job_state SET mode = 'off' WHERE job IN ('eve_deadlines', 'eve_deadlines_reconcile');
--   DROP TABLE IF EXISTS public.eve_race_deadlines;（hq の読み口は表が無いと None で今どおり。ジョブは off のままにする）

BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.eve_race_deadlines (
    race_id          VARCHAR(20) PRIMARY KEY,
    race_date        DATE        NOT NULL,
    venue_code       SMALLINT    NOT NULL CHECK (venue_code BETWEEN 1 AND 24),
    race_number      SMALLINT    NOT NULL CHECK (race_number BETWEEN 1 AND 12),
    deadline         TIME        NOT NULL,
    day_label        TEXT,
    race_name        TEXT,
    is_final         BOOLEAN,
    first_fetched_at TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL,
    deadline_changes SMALLINT    NOT NULL DEFAULT 0 CHECK (deadline_changes >= 0),
    day_start_time   TIME,
    day_mismatch     BOOLEAN,
    reconciled_at    TIMESTAMPTZ,
    CONSTRAINT eve_race_deadlines_race_id_shape CHECK (
        race_id = to_char(race_date, 'YYYY-MM-DD') || '-' || lpad(venue_code::text, 2, '0') || '-' || lpad(race_number::text, 2, '0')
    ),
    CONSTRAINT eve_race_deadlines_fetched_order CHECK (first_fetched_at <= updated_at),
    CONSTRAINT eve_race_deadlines_reconciled_pair CHECK ((day_mismatch IS NULL) OR (reconciled_at IS NOT NULL))
);

COMMENT ON TABLE public.eve_race_deadlines IS
    '前夜（JST 20:40〜21:20）に公式の raceindex から取った翌日の締切予定（BOA-1282）。当日の正は races.start_time で、この表の deadline は前夜の値のまま残す。当日朝に races と比べた結果を day_start_time・day_mismatch に書く';
COMMENT ON COLUMN public.eve_race_deadlines.race_id IS 'races と同じ形 YYYY-MM-DD-VV-RR。前夜は races の行が無いので外部キーは付けない';
COMMENT ON COLUMN public.eve_race_deadlines.deadline IS '前夜の最後の取得の締切予定（raceindex の HH:MM、秒は 0）';
COMMENT ON COLUMN public.eve_race_deadlines.day_label IS 'raceindex の日の札（初日・２日目・最終日 等、公式の表記のまま）';
COMMENT ON COLUMN public.eve_race_deadlines.race_name IS 'racelist のレース名（優勝戦・選抜戦Ａ 等、距離表記を除く）。最終日の会場の 10〜12R だけ取る。他は NULL';
COMMENT ON COLUMN public.eve_race_deadlines.is_final IS '優勝戦か。最終日でない日の会場は false。最終日の会場は race_name に「優勝戦」を含み「準優勝戦」でなければ true、取ったが違えば false、取れなかったレースは NULL（未確認）。優勝戦は12Rとは限らない（下関 2026-11-04 は11R）、男女W優勝戦は2つ';
COMMENT ON COLUMN public.eve_race_deadlines.first_fetched_at IS '前夜に最初に取れた時刻';
COMMENT ON COLUMN public.eve_race_deadlines.updated_at IS '前夜の取得で値（締切・日の札・レース名・優勝戦の判定）を最後に書いた時刻。値が変わらない取得では書かない（各起動の取得の結果は scrape_job_state.last_report）';
COMMENT ON COLUMN public.eve_race_deadlines.deadline_changes IS '前夜の取得の間で締切が変わった回数（0 が普通）';
COMMENT ON COLUMN public.eve_race_deadlines.day_start_time IS '当日朝の照合の時点の races.start_time';
COMMENT ON COLUMN public.eve_race_deadlines.day_mismatch IS 'deadline と day_start_time が違う（分の単位で比べる）。NULL は未照合（races の行・start_time が無い）';

-- hq の final_deadline(date, jcd) の読み
CREATE INDEX IF NOT EXISTS idx_eve_race_deadlines_date_venue
    ON public.eve_race_deadlines (race_date, venue_code);

-- 権限: 191（sns_send_events）と同じ形。画面では使わないので anon・authenticated には何も付けない（076 の後の既定の権限も外す）。
-- RLS は有効でポリシーなし。書くのは service_role（RLS を迂回）、読むのは service_role と claude_ro（hq。166 で BYPASSRLS、既定の権限で SELECT）。
-- service_role は既定の権限で ALL（DELETE・TRUNCATE を含む）を持つので、外してから要る分だけ付ける（消すのは戻し方の DROP だけ）
ALTER TABLE public.eve_race_deadlines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eve_race_deadlines FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.eve_race_deadlines TO service_role;
GRANT SELECT ON public.eve_race_deadlines TO claude_ro;

-- ジョブを live で始める（初回は適用した日の 20:40 JST）。共通ラッパは行の無いジョブの初回の起動で mode='off' の行を作る
-- （cronWrapper.js の ensureRow）ので、その「作られただけで一度も動いていない行」だけを上書きする（手で off・shadow にした行は変えない）
INSERT INTO scrape_job_state (job, mode)
VALUES ('eve_deadlines', 'live'), ('eve_deadlines_reconcile', 'live')
ON CONFLICT (job) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()
  WHERE scrape_job_state.mode = 'off'
    AND scrape_job_state.last_success_at IS NULL
    AND scrape_job_state.last_tick_at IS NULL;

COMMIT;
