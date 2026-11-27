# 過去データの取り込み（DB の変更の案）

> **未審査の案。適用の根拠にしない。** マイグレーションは作り手が作らない（AGENTS.md 安全の3）。人がマイグレーションの PR を作り、オーナーが db-apply で当てる。設計は [plan.md](./plan.md)。system-architect の1回目の審査（2026-11-27、plan.md §12）の指摘は反映したが、表の形の再審査はまだ。

ここでは表の形と、出所の列との対応を書く。SQL の完全な形は §9（system-architect の審査 2026-11-27「直して進める」を反映済み、PGlite の手元の試験つき）。

## 0. 共通の決まり

- **書き手は1つ**（組み立ての関数）。毎回、kb_archive・kb_archive_extra・潮位・本体を全部読んで1行を作る。列の一部だけを書く書き手は作らない
- 全行が同じ列を持つ payload で `upsertChangedRows`。`built_at` は値の比べから外す
- 窓の中の PK の集合の差で、消えたレースの行を消す
- RLS 有効。facts の2表は anon・authenticated に SELECT を付けるが、ポリシーで1選手の行だけを通す（ADR-0113 決定4: run_facts は racer_id と RPC が立てる設定、race_facts は run_facts への EXISTS）。表を直に引くと0行。`facts_coverage` と件数の表は USING (true)。GRANT を明示（076 以降は既定で剥がす）。書き手は service_role だけ。RPC は1関数1文で REVOKE・GRANT

## 1. `race_facts`（1レース1行）

| 列 | 型 | kb（2019-04-01〜2025-12-02） | main（2025-12-03〜） |
|---|---|---|---|
| race_id（PK） | text | kb_archive_races.race_id | races.race_id |
| era | text | 'kb' | 'main' |
| race_date・venue_code・race_number | date・smallint・smallint | kb_archive_races | races |
| race_title・series_day・is_final_day | text・smallint・boolean | kb_archive_venue_days（title・series_day・is_final_day） | race_conditions（race_title・series_day・is_final_day） |
| race_grade | text（NULL 可） | kb_archive_venue_days.race_grade（NULL がありうる。数は未確認） | races.race_grade → race_series.grade → class_code（ADR-0104 決定4） |
| series_kind | text | race_series.kind を節で照合 | race_series.kind |
| stage_raw・is_final | text・boolean | kb_archive_races.stage と `isFinalStage`（v2） | race_conditions.race_stage と同じ関数 |
| deadline_time | time | kb_archive_races.deadline_time | races.start_time |
| weather・wind_speed・wave_height | text・numeric(4,1)・smallint（本体の wind_speed は numeric(4,1)、kb は smallint。広い方に合わせる） | kb_archive_races（レースの時点） | race_conditions |
| wind_sector | text | K の8方位から検証済みの扇形 | 16方位から同じ扇形 |
| condition_source | text | 'k_file' | **行ごと**: 結果ページで上書きした行（2026-09-19〜、raceResultPersist.js:230）は 'race_result'、K で埋めた行は 'k_file'、発走前の値の行は 'before_race'。条件の軸は 'before_race' の行を数えない |
| temperature・water_temperature | numeric | kb_archive_extra（raceresult、段2の後。それまで NULL） | race_conditions |
| tide_cm・tide_phase | smallint・text | venue_tide_hourly（plan.md §5 の検証の後）。干満差の無い会場は tide_phase='none'・tide_cm NULL。干満差のある会場で tide_cm が NULL なら欠け（COMMENT に書く） | 同じ |
| technique | text | kb_archive_races.technique | race_results の決まり手 |
| dead_heat | boolean | kb_archive_races.dead_heat | false（本体は同着を持てない。COMMENT に書く） |
| payout_win・payout_3tan・combo_3tan・payout_3fuku | integer・integer・text・integer | kb_archive_races（payout_win・payout_3tan・combo_3tan・payout_3fuku） | race_results（payout_win、**payout_trio が3連単**・payout_trifecta が3連複。列名と中身が逆、data-columns.md 6行目） |
| payout_place_1・payout_place_2 | integer（NULL 可） | **無い**（074 に複勝の列が無い。パーサーは読むが kbArchiveRows.js:107-109 で保存しない。LZH から読み直すまで NULL） | race_results |
| has_result・race_status | boolean・text | kb_archive_races.has_result | race_results.race_status・races.cancellation_status |
| rule_version・built_at | smallint・timestamptz | 書き手 | 書き手 |

- CHECK: `(era='kb' AND race_date<='2025-12-02') OR (era='main' AND race_date>='2025-12-03')`。2025-12-02 は kb から作る（kbArchiveBoundary.js）
- 列の名前は kb の `payout_3tan`・`payout_3fuku` に合わせる。本体の `payout_trifecta`（3連複）と同じ名前を3連単に使わない

## 2. `run_facts`（1艇1行）

| 列 | 型 | kb | main |
|---|---|---|---|
| race_id・boat_number（PK） | text・smallint | kb_archive_boats | race_entries |
| era・race_date | text・date | race_facts と同じ（CHECK も同じ） | 同じ |
| racer_id | integer | kb_archive_boats.racer_id | race_entries.racer_id |
| racer_class・f_count | text・smallint | kb_archive_boats.class・（F数は B に有るかを確かめる、未確認） | race_entries.grade・f_count |
| motor_number | smallint | kb_archive_boats.motor_number | race_entries.motor_number |
| course | smallint | kb_archive_boats.course | race_start_timings.entry_course → race_results.actual_course_N（racerRaceHistoryRows.js:92 と同じ順） |
| start_timing・is_flying・is_late_start | numeric・boolean・boolean | kb_archive_boats | race_start_timings |
| finish_code | text | kb_archive_boats.finish_raw | race_start_timings.official_finish_code（どちらも K の生コード、190 と同じ） |
| finish_mark・finish_rank | text・smallint | 着のコードから書き手が出す | race_start_timings.finish_mark・着のコードから |
| exhibition_time | numeric | kb_archive_boats.exhibition_time | exhibition_data |
| weight・weight_source | numeric・text | kb_archive_boats.weight（B の登録の体重）・'b_file' | exhibition_data（当日）・'beforeinfo' |
| tilt・parts_changed | numeric・text[] | kb_archive_extra（段3の後。それまで NULL） | exhibition_data |
| oriten_lap・oriten_turn・oriten_straight | numeric | kb_archive_extra（BOATCAST、段1の後） | race_original_exhibition_values |

- 索引: PK と (racer_id, race_id)。一括で入れるときは索引を後で作るか race_id の順に入れる
- 容量（推定、実測なし）: 2019-04〜今で約253万艇。1行と索引で約180B として約 450MB、race_facts 約42万行で約 85MB。2005-01〜2019-03 を足すと約 +0.8GB
- 選手の読み: `get_racer_runs(p_racer_id, p_from)`（SECURITY INVOKER・plpgsql・`SET boatai.facts_racer_id = ''` の句、本文で `PERFORM set_config(..., true)` を先に、anon に EXECUTE、jsonb を1つ返す。jsonb_agg に ORDER BY race_id）。細部は ADR-0113 決定4。走の多い選手で3秒に収まるかは適用前に EXPLAIN で測る（SET ROLE anon で）

## 3. `kb_archive_extra`（K/B に無い過去分の生の値）

- 主キー (race_id, boat_number, source)。boat_number 0 はレースの行。source は 'boatcast_oriten'・'raceresult'・'beforeinfo'
- レースの行だけに置く列: item_labels（項目は会場で違う。桐生は一周の代わりに半周ラップ）・measure_status（1=計測あり・2=計測不可、091 と同じ）・気温・水温・16方位の風向。CHECK で艇の行には入れさせない
- 値は列で持つ。fetched_at を持つ（後日の取得であることを残す）。race_date は 2025-12-02 以前だけ
- 書き手は出所ごと・行の種類（レース・艇）ごとに分けて upsert する（キーの集合の違う行を1回に混ぜない）
- RLS 有効、anon・authenticated の権限なし（kb_archive と同じ）

## 4. `venue_tide_hourly`（潮位、plan.md §5 の検証の後）

- 主キー (venue_code, ts)。tide_cm・station_code・source（'jma_suisan'）
- 干満差の無い会場は行を持たない

## 5. `backfill_progress`（取り込みの進み）

- 主キー (source, unit_id)。unit_id は取得の単位（BOATCAST は race_id＝1ファイル、日の単位の出所は YYYY-MM-DD）。target_date・status（'pending'・'done'・'no_race'・'no_file'・'retry'・'failed'）・attempts・http_status・last_error・last_attempt_at・updated_at
- no_file は遡れる最古の日より前のファイル無し、retry は本来あるはずの範囲の 403（確定にしない。3回で failed）
- その晩の試行の数は last_attempt_at で数える（1つの単位はその晩に1回だけ試す）。済み以外の単位を引く部分索引
- 書き手は service_role だけ。匿名の権限なし

## 6. `facts_coverage`（画面の注記の「いつから」）

- 主キー (item)。item は 'run'・'temperature'・'oriten'・'tide' 等。first_date・last_date・computed_at
- 毎晩、facts から数え直す。anon に SELECT

## 7. 月ごとの件数の表（F、plan.md §7）

- 条件の軸1つずつ別の表（月×会場×進入×条件1つ）。区分は検証済みの線を細かく持つ（風は m ごと、波は 0-2/3-5/6-9/10+）。値は着の分布の件数と払戻の合計・二乗の合計（ADR-0111 と同じ持ち方）。月の何日分を含むかの列を持つ
- 形は V4 とセルの数の実測の後に書く。会場の90日程度は facts を直に数える RPC の方が軽いこともある

## 8. 適用と戻し（案）

- 事前（読み取り）: pg_database_size と契約のディスクの上限、`kb_archive_venue_days.race_grade` の NULL の数、1か月分の組み立てと走の多い選手の読みの EXPLAIN (ANALYZE, BUFFERS)
- 適用: マイグレーション（人）→ db-apply（オーナー）→ kb 層の CLI（オーナー、半月ずつ・夜間・--apply）→ 当日と毎晩の cron の行（人）→ mode を live（オーナー）
- 事後: anon の SELECT が true・INSERT が false、relrowsecurity、era ごとの行の数が kb_archive_boats（〜2025-12-02）と race_entries（2025-12-03〜）と一致、2025-12-02 の行が全て era='kb'、1選手の main の期間の履歴が今の `getRacerRaceHistory` と同じ、今日の結果が30分以内に facts に入る
- 戻し: 画面は今の表を読む形に戻すだけ。facts の表は DROP（元の表は変えないので失われる物は無い）

## 9. SQL（マイグレーションの PR がそのまま写す形）

マイグレーションの PR（人）では、下の塊をそのまま `docs/db-migration/<番号>_race_facts.sql` にする（番号は PR を作るときの origin/master の最大＋1）。同じ PR に verify を2本足す（下書きは同じフォルダの verify-drafts.md、次の PR で足す）。

**未確認の前提（2026-11-27 時点）**: 歯止めの作り（ADR-0113 決定4）は、次の3つが本番で「無い」ことを前提にしている。オーナーに読み取りの SQL を渡して頼んである（窓口）。結果が来るまで、この塊を適用の根拠にしない。1つでも「有る」なら、この節と ADR-0113 を見直す
- `pgrst.db_pre_request`（authenticator・anon・authenticated の rolconfig）。有ると、要求ごとに走る関数が設定を立てうる
- `pg_graphql` の拡張。有ると表の形が匿名に見える（行は RLS で1選手まで）
- anon が EXECUTE できる public・graphql_public の関数で、本文に set_config・SET LOCAL・動的な EXECUTE を含む物、設定に boatai. を含む物（schema-snapshot は 186 時点で、今は 211 まで）

手元の試験（PGlite 18.3、2026-11-27、全部通った）:
- 1つのトランザクションで2回流せる。戻しの SQL（頭の注釈）が通り、戻した後に当て直せる
- 境目の日（2025-12-02 に main、2025-12-03 に kb）・race_id と日付・会場のずれ・条件の出所の無い風は CHECK で拒まれる
- anon で表を直に引くと run_facts・race_facts とも0行。`get_racer_runs` は1選手の行だけ（レースの値つき）を返し、呼んだ後に設定が残らない。p_from で絞れる。NULL は例外
- anon が自分で設定を立てても1選手の行しか見えない。anon は書けない。`BEGIN READ ONLY` の中でも RPC が通る
- kb_archive_extra は艇の行に計測の状態を入れられず、2025-12-03 以降も入れられない。backfill_progress は試した単位に時刻が要る
- `scripts/maintenance/verify-migration-rls.js` の checkMigrationSql（番号 212 として）と `scripts/lib/dbApplySql.js` の inspectMigration は、どちらも誤りが0

```sql
-- 過去データの facts の表と選手ごとの RPC（docs/design/past-data-backfill/db-draft.md、ADR-0113・ADR-0101 の追記 2026-11-27）
-- 審査: system-architect 2026-11-27（db-draft の SQL の審査、直して進める → 反映済み）
-- 適用の手順: この塊をマイグレーションの PR（人）→ オーナーの db-apply → kb 層の CLI（オーナー、--apply）→ cron の行（人）→ mode を live（オーナー）
-- 事前の読み取り（claude_ro。BYPASSRLS なので anon の見え方は SET ROLE anon で見る）:
--   SELECT rolname, rolbypassrls, rolconfig FROM pg_roles WHERE rolname IN ('service_role','anon','authenticated','authenticator');  -- pgrst.db_pre_request の有無
--   SELECT extname FROM pg_extension WHERE extname = 'pg_graphql';
--   anon が EXECUTE できる public・graphql_public の関数で prosrc に set_config・SET LOCAL・動的な EXECUTE を含む物、proconfig に boatai. を含む物（ADR-0113 決定4）
--   走の多い選手で get_racer_runs の EXPLAIN (ANALYZE, BUFFERS)（SET ROLE anon）
-- 事後: 5表の relrowsecurity が true。anon の run_facts・race_facts の SELECT が true・INSERT が false、kb_archive_extra・backfill_progress の SELECT が false。
--   anon の get_racer_runs の EXECUTE が true・PUBLIC が false。pg_proc.proconfig に boatai.facts_racer_id= がある。anon で select count(*) from run_facts が0
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
SET boatai.facts_racer_id = ''
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
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.get_racer_runs(integer, date) IS
  '選手1人の走を jsonb で返す（ADR-0113 決定4）。SECURITY INVOKER。関数の中だけで boatai.facts_racer_id を立て、表の RLS がその選手の行だけを通す';

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
GRANT SELECT ON public.facts_coverage TO anon;
GRANT SELECT ON public.facts_coverage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facts_coverage TO service_role;
```
