-- 過去データの facts の表と選手ごとの RPC（docs/design/past-data-backfill/db-draft.md、ADR-0113・ADR-0101 の追記 2026-11-27）
-- 審査: system-architect 2026-11-27（db-draft の SQL の審査、直して進める → 反映済み）
-- 直し 2026-11-27: 最初の db-apply（run 45937058925）が get_racer_runs の SET 句で「permission denied to set parameter」で失敗し全部戻った
--   （本番の postgres は superuser でなく、未知の設定の SET 句を作れない）。SET 句を外し、本文の set_config(…, true) で立てて読んだら空に戻す形にした。
--   番号は 212 のまま（未適用で台帳に行が無い。docs/operation/db-apply.md「失敗したとき」）。審査 system-architect 2026-11-27
-- 適用の手順: この塊をマイグレーションの PR（人）→ オーナーの db-apply → kb 層の CLI（オーナー、--apply）→ cron の行（人）→ mode を live（オーナー）
-- 事前の読み取り（claude_ro は anon の役を持たない〈166〉ので、anon の見え方はオーナーの SQL Editor の
--   BEGIN READ ONLY; SET LOCAL ROLE anon; …; ROLLBACK; か、anon のキーの PostgREST で見る）:
--   SELECT set_config('boatai.facts_racer_id','1',true) AS set_ok, current_setting('boatai.facts_racer_id', true) AS v;  -- 1/1 なら非特権の役で立てられる
--   SELECT pg_get_userbyid(defaclrole) AS owner, defaclnamespace::regnamespace AS nsp, defaclobjtype, defaclacl FROM pg_default_acl;  -- 既定の権限
--   SELECT rolname, rolbypassrls, rolconfig FROM pg_roles WHERE rolname IN ('service_role','anon','authenticated','authenticator');  -- pgrst.db_pre_request の有無
--   SELECT extname FROM pg_extension WHERE extname = 'pg_graphql';
--   anon が EXECUTE できる public・graphql_public の関数で prosrc に set_config・SET LOCAL・動的な EXECUTE を含む物、proconfig に boatai. を含む物（ADR-0113 決定4）
--   走の多い選手で get_racer_runs の EXPLAIN (ANALYZE, BUFFERS)（SQL Editor で SET LOCAL ROLE anon）
-- 事後: 5表の relrowsecurity が true。anon の run_facts・race_facts の SELECT が true・INSERT が false、kb_archive_extra・backfill_progress の SELECT が false。
--   anon の get_racer_runs の EXECUTE が true・PUBLIC が false。pg_proc.proconfig が {search_path=public} だけ。
--   anon のキーで POST /rest/v1/rpc/get_racer_runs {"p_racer_id":<実在の登番>,"p_from":"2025-12-03"} がエラーでなく []（本番の anon の set_config が通った決め手）、
--   GET /rest/v1/run_facts?select=race_id&limit=1 が []
-- 戻し（race_facts のポリシーが run_facts を参照するので race_facts を先に消す。kb_archive_extra を消すと取り込んだ BOATCAST の分は取り直し）:
--   BEGIN; SET LOCAL lock_timeout = '10s'; DROP FUNCTION IF EXISTS public.get_racer_runs(integer, date); DROP TABLE IF EXISTS public.race_facts;
--   DROP TABLE IF EXISTS public.run_facts; DROP TABLE IF EXISTS public.kb_archive_extra; DROP TABLE IF EXISTS public.backfill_progress; DROP TABLE IF EXISTS public.facts_coverage; COMMIT;
SET LOCAL lock_timeout = '10s';
CREATE TABLE IF NOT EXISTS public.race_facts (
  race_id           text        PRIMARY KEY,
  era               text        NOT NULL CHECK (era IN ('kb', 'main')),
  race_date         date        NOT NULL,
  venue_code        smallint    NOT NULL,
  race_number       smallint    NOT NULL,
  race_title        text,
  series_day        smallint,
  is_final_day      boolean,
  race_grade        text,
  series_kind       text,
  stage_raw         text,
  is_final          boolean,
  deadline_time     time,
  weather           text,
  wind_speed        numeric(4,1),
  wave_height       smallint,
  wind_sector       text,
  condition_source  text        CHECK (condition_source IN ('k_file', 'race_result', 'before_race')),
  temperature       numeric,
  water_temperature numeric,
  tide_cm           smallint,
  tide_phase        text,
  technique         text,
  dead_heat         boolean     NOT NULL DEFAULT false,
  payout_win        integer,
  payout_place_1    integer,
  payout_place_2    integer,
  payout_3tan       integer,
  combo_3tan        text,
  payout_3fuku      integer,
  has_result        boolean     NOT NULL,
  race_status       text,
  rule_version      smallint    NOT NULL,
  built_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((era = 'kb' AND race_date <= DATE '2025-12-02') OR (era = 'main' AND race_date >= DATE '2025-12-03')),
  CHECK (race_id ~ '^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$'),
  CHECK (left(race_id, 10) = to_char(race_date, 'YYYY-MM-DD')),
  CHECK (venue_code BETWEEN 1 AND 24 AND substr(race_id, 12, 2)::int = venue_code AND substr(race_id, 15, 2)::int = race_number),
  CHECK (condition_source IS NOT NULL OR (weather IS NULL AND wind_speed IS NULL AND wave_height IS NULL AND wind_sector IS NULL))
);

CREATE TABLE IF NOT EXISTS public.run_facts (
  race_id         text        NOT NULL,
  boat_number     smallint    NOT NULL CHECK (boat_number BETWEEN 1 AND 6),
  era             text        NOT NULL CHECK (era IN ('kb', 'main')),
  race_date       date        NOT NULL,
  racer_id        integer,
  racer_class     text,
  f_count         smallint,
  motor_number    smallint,
  course          smallint    CHECK (course BETWEEN 1 AND 6),
  start_timing    numeric,
  is_flying       boolean,
  is_late_start   boolean,
  finish_code     text,
  finish_mark     text,
  finish_rank     smallint    CHECK (finish_rank BETWEEN 1 AND 6),
  exhibition_time numeric,
  weight          numeric,
  weight_source   text        CHECK (weight_source IN ('b_file', 'beforeinfo')),
  tilt            numeric,
  parts_changed   text[],
  oriten_lap      numeric,
  oriten_turn     numeric,
  oriten_straight numeric,
  rule_version    smallint    NOT NULL,
  built_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (race_id, boat_number),
  CHECK ((era = 'kb' AND race_date <= DATE '2025-12-02') OR (era = 'main' AND race_date >= DATE '2025-12-03')),
  CHECK (left(race_id, 10) = to_char(race_date, 'YYYY-MM-DD'))
);
CREATE INDEX IF NOT EXISTS run_facts_racer_race_idx ON public.run_facts (racer_id, race_id);

COMMENT ON TABLE public.race_facts IS
  'kb（kb_archive_*、〜2025-12-02）と本体（2025-12-03〜）から組み立てた1レース1行（ADR-0113）。書き手は1つ。匿名は get_racer_runs の中で、その選手の出たレースだけ読める。tide_cm が NULL で tide_phase=''none'' は干満差の無い会場、それ以外の NULL は欠け。dead_heat は本体の期間は常に false（本体は同着を持てない）';
COMMENT ON TABLE public.run_facts IS
  'kb と本体から組み立てた1艇1行（ADR-0113）。匿名は get_racer_runs の中で1選手の行だけ読める（RLS が boatai.facts_racer_id の選手だけを通す）';

ALTER TABLE public.race_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS run_facts_one_racer ON public.run_facts;
CREATE POLICY run_facts_one_racer ON public.run_facts
  FOR SELECT TO anon, authenticated
  USING (racer_id = nullif(current_setting('boatai.facts_racer_id', true), '')::integer);
DROP POLICY IF EXISTS race_facts_one_racer ON public.race_facts;
CREATE POLICY race_facts_one_racer ON public.race_facts
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.run_facts r WHERE r.race_id = race_facts.race_id));
REVOKE ALL ON public.race_facts FROM anon;
REVOKE ALL ON public.race_facts FROM authenticated;
REVOKE ALL ON public.run_facts FROM anon;
REVOKE ALL ON public.run_facts FROM authenticated;
GRANT SELECT ON public.race_facts TO anon;
GRANT SELECT ON public.race_facts TO authenticated;
GRANT SELECT ON public.run_facts TO anon;
GRANT SELECT ON public.run_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.race_facts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_facts TO service_role;

-- 選手1人の走（p_from 以降）を、レースの値と一緒に jsonb の配列で返す（古い順）。1000行で切れない
CREATE OR REPLACE FUNCTION public.get_racer_runs(p_racer_id integer, p_from date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF p_racer_id IS NULL OR p_from IS NULL THEN
    RAISE EXCEPTION 'get_racer_runs: p_racer_id と p_from は必須（%、%）', p_racer_id, p_from;
  END IF;
  PERFORM set_config('boatai.facts_racer_id', p_racer_id::text, true);
  SELECT COALESCE(jsonb_agg(to_jsonb(u) - 'built_at' - 'rule_version' ORDER BY u.race_id), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT r.*, to_jsonb(f) - 'race_id' - 'era' - 'race_date' - 'built_at' - 'rule_version' AS race
        FROM public.run_facts r
        JOIN public.race_facts f ON f.race_id = r.race_id
       WHERE r.racer_id = p_racer_id
         AND r.race_id >= to_char(p_from, 'YYYY-MM-DD')
    ) u;
  -- 読んだらすぐ空に戻す（同じトランザクションの後の文に残さない）。関数の SET 句は本番の postgres（superuser でない）が
  -- 未知の設定に作れない（212 の db-apply の失敗、2026-11-27）ので使わない。例外のときはトランザクションごと戻り、セーブポイント・EXCEPTION 節で捕まえてもトランザクションの中だけの設定は戻る
  PERFORM set_config('boatai.facts_racer_id', '', true);
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.get_racer_runs(integer, date) IS
  '選手1人の走を jsonb で返す（ADR-0113 決定4）。SECURITY INVOKER。本文の set_config(..., true) で boatai.facts_racer_id を立てて読み、読んだらすぐ空に戻す。表の RLS がその選手の行だけを通す';

REVOKE ALL ON FUNCTION public.get_racer_runs(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_racer_runs(integer, date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_racer_runs(integer, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_racer_runs(integer, date) TO service_role;

-- K/B に無い過去分の生の値（段1 = BOATCAST のオリジナル展示）。匿名の権限なし
CREATE TABLE IF NOT EXISTS public.kb_archive_extra (
  race_id         text        NOT NULL,
  boat_number     smallint    NOT NULL CHECK (boat_number BETWEEN 0 AND 6),
  source          text        NOT NULL CHECK (source IN ('boatcast_oriten', 'raceresult', 'beforeinfo')),
  race_date       date        NOT NULL CHECK (race_date <= DATE '2025-12-02'),
  item_labels     text[],
  measure_status  smallint    CHECK (measure_status IN (1, 2)),
  oriten_lap      numeric,
  oriten_turn     numeric,
  oriten_straight numeric,
  temperature     numeric,
  water_temperature numeric,
  wind_direction16 smallint,
  tilt            numeric,
  parts_changed   text[],
  fetched_at      timestamptz NOT NULL,
  PRIMARY KEY (race_id, boat_number, source),
  CHECK (left(race_id, 10) = to_char(race_date, 'YYYY-MM-DD')),
  CHECK (boat_number = 0 OR (item_labels IS NULL AND measure_status IS NULL AND temperature IS NULL AND water_temperature IS NULL AND wind_direction16 IS NULL))
);
COMMENT ON TABLE public.kb_archive_extra IS
  'K/B に無い過去分（〜2025-12-02）の生の値。後日の取得で、取得の時刻を fetched_at に持つ。boat_number 0 はレースの行（item_labels・measure_status〈1=計測あり・2=計測不可、091 と同じ〉・気温・水温・16方位の風向はこの行だけ）。書き手は出所ごと・行の種類（レース・艇）ごとに分けて upsert する（キーの集合の違う行を1回に混ぜない）。読むのは facts の書き手（service_role）だけ（ADR-0113）';
ALTER TABLE public.kb_archive_extra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kb_archive_extra FROM anon;
REVOKE ALL ON public.kb_archive_extra FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_archive_extra TO service_role;

-- 取り込みの進み（出所 × 日）。匿名の権限なし
CREATE TABLE IF NOT EXISTS public.backfill_progress (
  source          text        NOT NULL,
  unit_id         text        NOT NULL,
  target_date     date        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('pending', 'done', 'no_race', 'no_file', 'retry', 'failed')),
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  http_status     smallint,
  last_error      text,
  last_attempt_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, unit_id),
  CHECK (left(unit_id, 10) = to_char(target_date, 'YYYY-MM-DD')),
  CHECK (status = 'pending' OR last_attempt_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS backfill_progress_todo_idx ON public.backfill_progress (source, target_date)
  WHERE status IN ('pending', 'retry', 'failed');
CREATE INDEX IF NOT EXISTS backfill_progress_attempt_idx ON public.backfill_progress (source, last_attempt_at);
COMMENT ON TABLE public.backfill_progress IS
  '過去分の取り込みの進み（ADR-0101 の追記 2026-11-27）。1行は取得の単位（BOATCAST は race_id、日の単位の出所は YYYY-MM-DD）。no_file は遡れる最古の日より前のファイル無し、retry は本来あるはずの範囲の 403（確定にしない。3回で failed）。その晩の試行の数は last_attempt_at で数え、1つの単位はその晩に1回だけ試す';
ALTER TABLE public.backfill_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backfill_progress FROM anon;
REVOKE ALL ON public.backfill_progress FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backfill_progress TO service_role;

-- 画面の注記の「いつから」。毎晩 facts から数え直す
CREATE TABLE IF NOT EXISTS public.facts_coverage (
  item        text        PRIMARY KEY,
  first_date  date        NOT NULL,
  last_date   date        NOT NULL CHECK (last_date >= first_date),
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facts_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facts_coverage_read ON public.facts_coverage;
CREATE POLICY facts_coverage_read ON public.facts_coverage FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.facts_coverage FROM anon;
REVOKE ALL ON public.facts_coverage FROM authenticated;
GRANT SELECT ON public.facts_coverage TO anon;
GRANT SELECT ON public.facts_coverage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facts_coverage TO service_role;
