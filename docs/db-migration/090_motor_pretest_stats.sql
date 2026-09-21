-- 090: 前検タイム・節時点のモーター/ボート2連対率の日次スナップショット motor_pretest_stats を新設する
--
-- 対応設計: docs/design/scraping-vercel-consolidation/（plan.md §15、tasks.md T4b-20、data-catalog.md N23、
--   optimal-scraping-design.md §2.7・§4.2 順序5）。取得元は公式の race/rankingmotor（会場×日で1ページ）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でもよい。取得ジョブ motor_pretest は、
-- scrape_job_state に行が無い間は何もしない＝既定は off）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   新規テーブルの作成のみ。既存テーブルには触れない（外部キーも持たない）。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'motor_pretest_stats' AND relkind = 'r';
--   → 1行、relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.motor_pretest_stats', 'SELECT');
--   → false（読み手が無い間は、匿名から読めない。画面・分析が読むときにSELECTポリシーとGRANTを追加する）
--
-- ロールバック（データを書いた後は、全行が消える。他のテーブル・画面は、このテーブルに依存しない）:
--   DROP TABLE IF EXISTS motor_pretest_stats;
--
-- 背景:
--   * 前検タイム（節の初日の前日に計測されるモーターの性能の指標）は、現状、どこにも保存していない。公式の rankingmotor
--     ページにだけある新しい情報（BOA-266、BOA-271 の機力テーマの特徴量）。ページには、モーター・ボートの番号と2連対率も
--     載るが、これらは race_entries.motor_number・motor_2rate・boat_number_id・boat_2rate（出走表 racelist）と同じ値
--     （2連対率は、ページが小数第1位まで、race_entries が小数第2位。2026-09-21の実測（4ページ・183選手）で、モーター番号は
--     100%一致、ボート番号は99%一致（不一致2件はボート交換）、2連対率は、モーターが100%・ボートが99%（外れ2件は、ボートを交換した選手）で、
--     差が0.1以内）
--   * ページの「順位」は、表示中の並び順（既定は、モーター2連対率の降順）の順位で、前検順位ではない。前検順位は、
--     前検タイムから計算する（昇順、同じ値は同順位、次は飛ぶ。前検タイムで並べたページの順位と一致することを検証済み）
--
-- 設計上の要点:
--   * 主キー (race_date, venue_code, racer_id): 日次のスナップショット。その日の朝（JST 05:30〜06:30）の時点の値。
--     節の間、前検タイムは変わらず、2連対率は日々変わる。ページには、節の全選手（約45人。その日に走らない選手を含む）が載る。
--     節・選手ごとの最新の行（race_date の降順）を引けば、as-of 結合ができる
--   * 外部キーは持たない: 節の全選手（その日に走らない選手を含む）が載り、racer_id が racer_profiles に無い新人も載りうるため、
--     行の書き込みを、他テーブルの有無に依存させない
--   * pretest_time・pretest_rank は NULL 可: 前検を受けていない選手（節の途中の代替選手など）
--   * series_title: 開催名（ページの見出し。節を識別する補助。race_series の節との結合は、日付と会場で行う）
--   * created_at・updated_at: race_start_timings（071）と同じ運用。created_at は INSERT時の DEFAULT now()、
--     updated_at は書き込み側が、変更のある行を書くときに設定する（変更の無い行は書かない: WS8(b)）
--   * アクセス制御: RLSを有効にし、ポリシーを作らない。anon・authenticated の全権限を剥奪する（書き込みは service_role のみ。
--     現時点では読み手が無い）。画面・分析が読むようになったら、そのPRで
--     CREATE POLICY ... FOR SELECT TO anon, authenticated USING (true) と GRANT SELECT を追加する（公式データの再表示の範囲は ADR-0067）
--   * 容量・Disk IO の見積り: 1日 約13会場×約45人＝約600行、1行 約100バイト（＋主キー索引）。日次の増加は約60KB、
--     1年で約22万行・約25MB（索引込みで約40MB）。過去分（2025-12-03〜）を全会場×日で入れると約17万行（約25MB）、
--     節の初日のみなら約3万行。書き込みは1日1回の約600行の INSERT（同じ日の再実行は、変更のある行だけ）で、
--     predictions（1回のINSERTが約190KB）より桁違いに小さい

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS motor_pretest_stats (
  race_date    date        NOT NULL,
  venue_code   smallint    NOT NULL,
  racer_id     integer     NOT NULL,
  racer_class  text        NOT NULL,
  motor_number smallint    NOT NULL,
  motor_2rate  numeric(4,1),
  boat_number  smallint    NOT NULL,
  boat_2rate   numeric(4,1),
  pretest_time numeric(4,2),
  pretest_rank smallint,
  series_title text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz,
  PRIMARY KEY (race_date, venue_code, racer_id),
  CONSTRAINT chk_motor_pretest_stats_venue CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT chk_motor_pretest_stats_class CHECK (racer_class IN ('A1', 'A2', 'B1', 'B2')),
  CONSTRAINT chk_motor_pretest_stats_rank CHECK (pretest_rank IS NULL OR pretest_rank >= 1),
  -- 前検タイムと前検順位は、両方あるか、両方無い
  CONSTRAINT chk_motor_pretest_stats_time_rank CHECK ((pretest_time IS NULL) = (pretest_rank IS NULL))
);

REVOKE ALL ON motor_pretest_stats FROM anon, authenticated;
ALTER TABLE motor_pretest_stats ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE motor_pretest_stats IS '前検タイム・前検順位・節時点のモーター/ボートの番号と2連対率の日次スナップショット（公式 race/rankingmotor。その日の朝の時点。節の全選手）。前検タイムのみが、ここにしかない新しい情報（番号・2連対率は race_entries と同じ値）。docs/design/scraping-vercel-consolidation/。読み取りはservice_roleのみ（画面・分析が読むときにSELECTポリシーを追加する）';
COMMENT ON COLUMN motor_pretest_stats.race_date IS 'スナップショットの日付（そのページの hd）。値は、その日の朝（JST 05:30〜06:30）の時点';
COMMENT ON COLUMN motor_pretest_stats.pretest_rank IS '前検順位。前検タイムの昇順（速い順）。同じタイムは同順位で、次の順位は飛ぶ（1・2・2・4）。ページの「順位」（モーター2連対率の順位）ではない';
COMMENT ON COLUMN motor_pretest_stats.motor_2rate IS 'モーターの2連対率（%）。ページの表示（小数第1位まで）のまま。race_entries.motor_2rate（小数第2位）の低精度版';
COMMENT ON COLUMN motor_pretest_stats.boat_2rate IS 'ボートの2連対率（%）。ページの表示（小数第1位まで）のまま。race_entries.boat_2rate の低精度版';
