-- 123: 翌日の番組表（公式 B ファイル）を保存する tomorrow_program を新設する（BOA-223）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 対応設計: docs/design/tomorrow-program/plan.md、ADR-0084
--
-- 背景:
--   トップの「明日」タブで、翌日の出走表を前日の午後から見せる。前日の夕方に選手まで載っている取得元は公式の
--   B ファイル（番組表）だけ（公式サイトの出走表ページは前日17時でも選手が未公開）。races・race_entries に前倒しで
--   入れると、朝の初期化（scripts/lib/racesInit/job.js）が「races に行がある会場＝初期化済み」として会場ごと
--   スキップするため、別のテーブルに置く。
--
-- 設計上の要点:
--   * 1行＝1艇。主キー (race_date, venue_code, race_number, boat_number)。レース・会場の項目（締切予定・節名・日次）は
--     艇の行に重ねて持つ（1日最大 24会場×12R×6艇＝1,728行。正規化して表を分けるほどの量ではない）
--   * 列名は scripts/lib/kbFileParser.js の parseBText の出力に合わせる。名前は B ファイルの表記のまま（4文字で
--     切れる）。正式名は画面が racer_profiles から引く
--   * source_modified_at: 取り込んだ B ファイルの HTTP Last-Modified。公開から取り込みまでの遅れを実測するため
--     （.claude/rules/data-acquisition.md §2-B）
--   * created_at / updated_at: 行の初回保存と値の変更の時刻（updated_at は書き込み側が変更のある行にだけ入れる）
--   * 外部キーは張らない（venues は FK 先として使えるが、取り込みの失敗要因を増やさないため。races とは無関係）
--   * アクセス制御: RLS を有効にし、匿名・authenticated には SELECT のみ（画面が直接読む）。書き込みは service_role
--   * 保持: 対象日を過ぎた行は掃除する（scripts/lib/scrapeJobs の掃除。plan.md §5）
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。新規テーブルの作成のみ。
--   **コードのマージより先に適用する**。適用後に APPLIED.md へ記録し、scrape_job_state の job='tomorrow_program' の
--   mode を shadow → live の順に上げる（mode が off・行なしの間、Cron は何もしない）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'tomorrow_program' AND relkind = 'r';
--   → true
--   SELECT has_table_privilege('anon', 'public.tomorrow_program', 'SELECT'),
--          has_table_privilege('anon', 'public.tomorrow_program', 'INSERT');
--   → true, false
--
-- 元に戻す（全行が消える。他の表には影響しない）:
--   DROP TABLE IF EXISTS tomorrow_program;

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS tomorrow_program (
  race_date           date        NOT NULL,
  venue_code          smallint    NOT NULL,
  race_number         smallint    NOT NULL,
  boat_number         smallint    NOT NULL,
  -- 会場（節）
  series_title        text,
  series_day          smallint,
  is_final_day        boolean,
  -- レース
  stage               text,
  distance_m          smallint,
  deadline_time       time,
  -- 艇
  racer_id            integer,
  racer_name_raw      text,
  age                 smallint,
  branch              text,
  weight              smallint,
  class               text,
  national_win_rate   numeric(4,2),
  national_2rate      numeric(5,2),
  local_win_rate      numeric(4,2),
  local_2rate         numeric(5,2),
  motor_number        smallint,
  motor_2rate         numeric(5,2),
  boat_id             smallint,
  boat_2rate          numeric(5,2),
  series_results_raw  text,
  -- 取得
  source_modified_at  timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz,
  PRIMARY KEY (race_date, venue_code, race_number, boat_number),
  CONSTRAINT chk_tomorrow_program_venue CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT chk_tomorrow_program_race CHECK (race_number BETWEEN 1 AND 12),
  CONSTRAINT chk_tomorrow_program_boat CHECK (boat_number BETWEEN 1 AND 6)
);

ALTER TABLE tomorrow_program ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tomorrow_program FROM anon, authenticated;
DROP POLICY IF EXISTS tomorrow_program_public_read ON tomorrow_program;
CREATE POLICY tomorrow_program_public_read ON tomorrow_program
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON tomorrow_program TO anon, authenticated;

COMMENT ON TABLE tomorrow_program IS
  '翌日の番組表（公式 B ファイル）。前日14時台〜23時台に取り込み、トップの「明日」タブが読む。races とは別（BOA-223、ADR-0084）';
COMMENT ON COLUMN tomorrow_program.racer_name_raw IS
  'B ファイルの名前のまま（4文字で切れる）。正式名は racer_profiles から引く';
COMMENT ON COLUMN tomorrow_program.source_modified_at IS
  '取り込んだ B ファイルの HTTP Last-Modified（公開から取り込みまでの遅れの実測用）';

COMMIT;
