-- 084: 節（開催）テーブル race_series を新設する（節名・グレード・種別・開始日・終了日・総日数）
--
-- 対応設計: docs/design/racer-period-stats/plan.md（全データ設計 optimal-scraping-design.md §2.5・
--   data-catalog.md の N16、ユーザー承認Q3）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   新規テーブルの作成のみ。既存テーブルには触れない（races・race_conditions への列追加も外部キーも無い）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'race_series' AND relkind = 'r';
--   → 1行、relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.race_series', 'SELECT');
--   → false（読み手が無い間は、匿名から読めない。画面で読むときにSELECTポリシーとGRANTを追加する）
--
-- ロールバック（データを書いた後は、全行が消える。既存の列・読み手は影響を受けない）:
--   DROP TABLE IF EXISTS race_series;
--
-- 背景:
--   * races.race_grade は、racelistの見出しの色分けから作るレース単位の値で、約77%しか埋まっていない
--     （2025-12・2026-01は欠落）。race_conditions.series_day（何日目）は約2.4%しか埋まっていない
--   * 公式の月間スケジュール（race/monthlyschedule）は、全24会場の節（節名・色分け・開始日〜終了日）を
--     1か月1リクエストで返し、2019-04まで遡って取得できる。節の開始日・終了日から、日目を導出できる
--
-- 設計上の要点:
--   * 主キー (venue_code, start_date)。同じ会場の節は日付が重ならない
--   * 外部キー・races への列追加は行わない（races は別の担当が列を追加中で、競合を避ける。読み手が現れたら別途）。
--     結合は SQL で:  races.venue_code = race_series.venue_code
--                     AND races.race_date BETWEEN race_series.start_date AND race_series.end_date
--     日目 = races.race_date - race_series.start_date + 1（月間スケジュールは予定のため、順延で日がずれた節は、
--     実開催日とずれる。ずれの大きさは未計測）
--   * class_code: 月間スケジュールの色分けの原文（SG・G1・G2・G3・Ippan・Lady=オールレディース・Venus=ヴィーナス
--     シリーズ・Rookie=ルーキーシリーズ・Takumi=マスターズリーグ）。原文を保持する
--   * grade: SG・G1・G2・G3・ippan（races.race_grade と同じ語彙）。色分けが SG・G1・G2・G3・Ippan の節のみ確定し、
--     Lady・Venus・Rookie・Takumi は NULL（色分けが1色で、G3相当か一般かが分からない）。
--     優先順位: レース単位の races.race_grade があればそれを優先し、NULL の行を COALESCE(races.race_grade, race_series.grade)
--     で補う。両方が食い違う場合の件数は、取り込み後に実測する
--   * kind: sg・g1・g2・g3・ippan・lady・venus・rookie・masters（class_code の正規化）
--   * title: 節名（月間スケジュールのリンクの文字。全角のまま）。節名のリンクが無い節は、表の端に接する断片で、
--     隣の月のページと突き合わせて確定するため、確定した節では通常 NOT NULL。将来、リンクが無い節が現れたら NULL を許す
--   * source_ym: この節を全体として最初に観測した月のページ（YYYYMM）。追跡用
--   * アクセス制御: RLSを有効にし、ポリシーを作らない。anon・authenticated の全権限を剥奪する
--     （書き込みは service_role のみ。現時点では読み手が無い）。画面が読むようになったら、そのPRで
--     CREATE POLICY ... FOR SELECT TO anon, authenticated USING (true) と GRANT SELECT を追加する
--   * 容量の見積り: 1か月約100節（2019-04の実ページで101断片、2026-09で96断片）× 約90か月 ≒ 約9千行、約1MB。
--     日次の増加は無い（月1回、当月・翌月の更新で数十行）

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS race_series (
  venue_code  smallint    NOT NULL,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  total_days  smallint    NOT NULL,
  title       text,
  class_code  text        NOT NULL,
  grade       text,
  kind        text        NOT NULL,
  source_ym   text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz,
  PRIMARY KEY (venue_code, start_date),
  CONSTRAINT chk_race_series_venue CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT chk_race_series_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_race_series_total_days CHECK (total_days = end_date - start_date + 1),
  CONSTRAINT chk_race_series_class
    CHECK (class_code IN ('SG', 'G1', 'G2', 'G3', 'Ippan', 'Lady', 'Venus', 'Rookie', 'Takumi')),
  CONSTRAINT chk_race_series_grade
    CHECK (grade IS NULL OR grade IN ('SG', 'G1', 'G2', 'G3', 'ippan')),
  CONSTRAINT chk_race_series_kind
    CHECK (kind IN ('sg', 'g1', 'g2', 'g3', 'ippan', 'lady', 'venus', 'rookie', 'masters'))
);

-- 日付から節を引く（races.race_date の結合・期間の絞り込み）用
CREATE INDEX IF NOT EXISTS idx_race_series_dates
  ON race_series (start_date, end_date);

ALTER TABLE race_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON race_series FROM anon, authenticated;

COMMENT ON TABLE race_series IS
  '節（開催）。公式の月間スケジュール由来。主キー (venue_code, start_date)。設計: docs/design/racer-period-stats/plan.md';
COMMENT ON COLUMN race_series.class_code IS
  '月間スケジュールの色分けの原文（SG・G1・G2・G3・Ippan・Lady=オールレディース・Venus=ヴィーナスシリーズ・Rookie=ルーキーシリーズ・Takumi=マスターズリーグ）';
COMMENT ON COLUMN race_series.grade IS
  'SG・G1・G2・G3・ippan（races.race_grade と同じ語彙）。Lady・Venus・Rookie・Takumi は色分けからは確定しないためNULL。races.race_grade を優先し、欠落を補う';
COMMENT ON COLUMN race_series.total_days IS
  '予定の開催日数（end_date - start_date + 1）。順延・中止は反映されない';
