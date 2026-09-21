-- 083: 選手×期の成績テーブル racer_period_stats を新設し、racer_profiles に性別・養成期を追加する
--
-- 対応設計: docs/design/racer-period-stats/plan.md（全データ設計 optimal-scraping-design.md §2.5・
--   data-catalog.md の N13・N21・N22、ユーザー承認Q2・Q3）
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認後に、ユーザーが実行する。
--
-- 適用手順（ユーザーが実行する。コードのマージより先でも後でも良い）:
--   Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--   新規テーブルの作成と、racer_profiles への nullable 列の追加（メタデータのみの変更。既存行は書き換わらず、
--   テーブルの書き換え・長いロックは発生しない。racer_profiles は約1,630行）。既存の列・読み手には触れない。
--
-- 適用後の確認（読み取りのみ）:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'racer_period_stats' AND relkind = 'r';
--   → 1行、relrowsecurity = true
--   SELECT has_table_privilege('anon', 'public.racer_period_stats', 'SELECT');
--   → false（読み手が無い間は、匿名から読めない。画面で読むときにSELECTポリシーとGRANTを追加する）
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'racer_profiles' AND column_name IN ('sex', 'training_term');
--   → 2行
--
-- ロールバック（データを書いた後は、racer_period_stats の全行が消える。racer_profiles の既存の列・読み手は影響を受けない）:
--   DROP TABLE IF EXISTS racer_period_stats;
--   ALTER TABLE racer_profiles DROP COLUMN IF EXISTS sex, DROP COLUMN IF EXISTS training_term;
--
-- 背景:
--   * 選手の期別成績・能力指数・コース別成績は、選手別スクレイピング（B6、racer_profiles、1,627人×2ページ）では
--     直近の1期分・5列しか保存できていなかった。公式の期別成績ファイル（fan、全選手×1期=1ファイル、
--     2001年10月〜）で、全項目・全期を取得できる（fan2604と公式の選手ページの値の一致を実確認）
--   * 履歴を持つ設計: 1選手1期1行。レース日から該当期を引く（as-of結合）用
--
-- 設計上の要点:
--   * 主キー (racer_id, period_year, period_no)。period_year・period_no は fan の「年」「期」（fan2604 は 2026年2期、
--     算出期間 2025-11-01〜2026-04-30。fan2510 は 2026年1期、算出期間 2025-05-01〜2025-10-31）
--   * 外部キーは張らない: racer_profiles に未登録の選手（新人。fan2604の1,643人に対し racer_profiles は1,628人のため、少なくとも15人）も保存でき、
--     書き込みが未登録で失敗しない
--   * コース別（進入コース1〜6）の成績は、jsonb ではなく平らな列（c{N}_...）で持つ。jsonb は行ごとにキー名を
--     繰り返して行が数倍になる（概算: 約1.3KB/行 vs 約0.4KB/行。全期間で約100MB vs 約35MB。実測ではない）ため。
--     列名は scripts/lib/fanPeriodRows.js の STATS_COLUMNS と一致させる（verify:fan-period が突き合わせる）
--   * 値なし: 出走0の選手は勝率・2連対率・平均ST・今期能力指数がNULL、進入0のコースは2連対率・平均ST・
--     平均スタート順位がNULL（公式の選手ページで「-」表記。fanでは0が入る）。回数は0を0のまま保持する
--   * 着回数（c{N}_p1〜p6）の合計は、進入回数以下（fan2604で、進入のある9,279コースのうち、一致が7,978、下回るのが
--     1,301、上回るのが0。事故・欠場・失格等の非完走を含まないため）
--   * L0/L1（出遅れ）・K0/K1（欠場）・S0/S1/S2（失格）は、責任区分（選手責任か否か）を示すコード。
--     公式の選手ページ「出遅れ回数（選手責任）」= L1 の合計（実確認: 3448=L0で0、3809=L1で1）
--   * アクセス制御: RLSを有効にし、ポリシーを作らない。anon・authenticated の全権限を剥奪する
--     （書き込みは service_role のみ。現時点では読み手が無い）。画面が読むようになったら、そのPRで
--     CREATE POLICY ... FOR SELECT TO anon, authenticated USING (true) と GRANT SELECT を追加する
--     （公式データの再表示の範囲は ADR-0067）
--   * created_at・updated_at: race_payouts（079）と同じ運用。updated_at は書き込み側が、変更のある行を書くときに設定する
--     （変更の無い行は書かない）
--   * 容量の見積り: 1期約1,650行 × 全50期 ≒ 8.2万行、約35MB＋主キー索引約5MB（2019年以降の15期なら約2.5万行、約11MB）。
--     日次の増加は無い（半期に1回、約1,650行の追加）。半期の書き込みは約1,650行で、Disk IOへの影響は小さい

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS racer_period_stats (
  racer_id          integer NOT NULL,
  period_year       smallint NOT NULL,
  period_no         smallint NOT NULL,
  calc_from         date NOT NULL,
  calc_to           date NOT NULL,
  source_file       text NOT NULL,
  grade             text,
  grade_prev        text,
  grade_prev2       text,
  grade_prev3       text,
  ability_prev      numeric(5,2),
  ability_now       numeric(5,2),
  win_rate          numeric(4,2),
  top2_rate         numeric(4,1),
  first_count       smallint,
  second_count      smallint,
  starts            smallint,
  finals            smallint,
  wins              smallint,
  avg_st            numeric(3,2),
  branch            text,
  height_cm         smallint,
  weight_kg         smallint,
  c1_entries        smallint,
  c1_top2_rate      numeric(4,1),
  c1_avg_st         numeric(3,2),
  c1_avg_start_rank numeric(3,2),
  c1_p1             smallint,
  c1_p2             smallint,
  c1_p3             smallint,
  c1_p4             smallint,
  c1_p5             smallint,
  c1_p6             smallint,
  c1_f              smallint,
  c1_l0             smallint,
  c1_l1             smallint,
  c1_k0             smallint,
  c1_k1             smallint,
  c1_s0             smallint,
  c1_s1             smallint,
  c1_s2             smallint,
  c2_entries        smallint,
  c2_top2_rate      numeric(4,1),
  c2_avg_st         numeric(3,2),
  c2_avg_start_rank numeric(3,2),
  c2_p1             smallint,
  c2_p2             smallint,
  c2_p3             smallint,
  c2_p4             smallint,
  c2_p5             smallint,
  c2_p6             smallint,
  c2_f              smallint,
  c2_l0             smallint,
  c2_l1             smallint,
  c2_k0             smallint,
  c2_k1             smallint,
  c2_s0             smallint,
  c2_s1             smallint,
  c2_s2             smallint,
  c3_entries        smallint,
  c3_top2_rate      numeric(4,1),
  c3_avg_st         numeric(3,2),
  c3_avg_start_rank numeric(3,2),
  c3_p1             smallint,
  c3_p2             smallint,
  c3_p3             smallint,
  c3_p4             smallint,
  c3_p5             smallint,
  c3_p6             smallint,
  c3_f              smallint,
  c3_l0             smallint,
  c3_l1             smallint,
  c3_k0             smallint,
  c3_k1             smallint,
  c3_s0             smallint,
  c3_s1             smallint,
  c3_s2             smallint,
  c4_entries        smallint,
  c4_top2_rate      numeric(4,1),
  c4_avg_st         numeric(3,2),
  c4_avg_start_rank numeric(3,2),
  c4_p1             smallint,
  c4_p2             smallint,
  c4_p3             smallint,
  c4_p4             smallint,
  c4_p5             smallint,
  c4_p6             smallint,
  c4_f              smallint,
  c4_l0             smallint,
  c4_l1             smallint,
  c4_k0             smallint,
  c4_k1             smallint,
  c4_s0             smallint,
  c4_s1             smallint,
  c4_s2             smallint,
  c5_entries        smallint,
  c5_top2_rate      numeric(4,1),
  c5_avg_st         numeric(3,2),
  c5_avg_start_rank numeric(3,2),
  c5_p1             smallint,
  c5_p2             smallint,
  c5_p3             smallint,
  c5_p4             smallint,
  c5_p5             smallint,
  c5_p6             smallint,
  c5_f              smallint,
  c5_l0             smallint,
  c5_l1             smallint,
  c5_k0             smallint,
  c5_k1             smallint,
  c5_s0             smallint,
  c5_s1             smallint,
  c5_s2             smallint,
  c6_entries        smallint,
  c6_top2_rate      numeric(4,1),
  c6_avg_st         numeric(3,2),
  c6_avg_start_rank numeric(3,2),
  c6_p1             smallint,
  c6_p2             smallint,
  c6_p3             smallint,
  c6_p4             smallint,
  c6_p5             smallint,
  c6_p6             smallint,
  c6_f              smallint,
  c6_l0             smallint,
  c6_l1             smallint,
  c6_k0             smallint,
  c6_k1             smallint,
  c6_s0             smallint,
  c6_s1             smallint,
  c6_s2             smallint,
  nc_l0             smallint,
  nc_l1             smallint,
  nc_k0             smallint,
  nc_k1             smallint,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz,
  PRIMARY KEY (racer_id, period_year, period_no),
  CONSTRAINT chk_racer_period_stats_period_no CHECK (period_no IN (1, 2)),
  CONSTRAINT chk_racer_period_stats_calc CHECK (calc_to >= calc_from),
  CONSTRAINT chk_racer_period_stats_grade
    CHECK (grade IS NULL OR grade IN ('A1', 'A2', 'B1', 'B2'))
);

-- 期を指定した全選手の読み出し（as-of結合・期ごとの集計）用。主キーの先頭が racer_id のため、期の絞り込みには別の索引が要る
CREATE INDEX IF NOT EXISTS idx_racer_period_stats_period
  ON racer_period_stats (period_year, period_no);

ALTER TABLE racer_period_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON racer_period_stats FROM anon, authenticated;

COMMENT ON TABLE racer_period_stats IS
  '選手×期の成績（公式の期別成績ファイル fan 由来）。1選手1期1行。設計: docs/design/racer-period-stats/plan.md';
COMMENT ON COLUMN racer_period_stats.period_year IS
  'fanの「年」（算出期間の終了が4月の年。fan2604=2026）。ファイル名の年とは、10月分で1年ずれる';
COMMENT ON COLUMN racer_period_stats.period_no IS
  'fanの「期」。1=算出期間5/1〜10/31、2=算出期間11/1〜4/30';
COMMENT ON COLUMN racer_period_stats.calc_to IS
  '算出期間（至）。as-of結合は、レース日 > calc_to の最新の期を使う';
COMMENT ON COLUMN racer_period_stats.top2_rate IS
  '2連対率（%）。fan layout上の項目名は「複勝率」だが、(1着+2着)/出走回数の2連対率';
COMMENT ON COLUMN racer_period_stats.ability_now IS
  '今期能力指数（公式の選手ページ「期別成績」の能力指数と一致）。出走0はNULL';

-- racer_profiles: fan由来の性別・養成期（fan がプロフィール全項目を持つ。N22）
ALTER TABLE racer_profiles
  ADD COLUMN IF NOT EXISTS sex smallint,
  ADD COLUMN IF NOT EXISTS training_term smallint;

COMMENT ON COLUMN racer_profiles.sex IS '性別（1=男、2=女）。fan由来';
COMMENT ON COLUMN racer_profiles.training_term IS '養成期（fanの養成期。例: 128）。登録期の文字列（registration_period）と同じ数字';
