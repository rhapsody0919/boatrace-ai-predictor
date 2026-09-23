-- 094: コース別ベースラインの事前集計テーブル2つ（phase a / FR-1・FR-6）
--
-- 対応設計: docs/design/analysis-visualization-upgrade/plan.md §2 / spec.md FR-1・FR-6 / docs/adr/0068-course-baseline-precomputation.md
-- 対応Linearチケット: BOA-305（レース詳細のUI/UX改善）配下
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認のもとで行う（docs/db-migration/APPLIED.md）。
--
-- 適用手順: Supabase Dashboard > SQL Editor、またはManagement API で、次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- 適用後の確認（読み取りのみ）:
--   SELECT has_table_privilege('anon','public.st_course_baseline','SELECT'),
--          has_table_privilege('anon','public.st_course_baseline','INSERT');
--   → true, false（nige_second_by_course も同じ）
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
--     ('st_course_baseline','nige_second_by_course'); → 2行とも true
--
-- ロールバック:
--   DROP TABLE IF EXISTS public.nige_second_by_course;
--   DROP TABLE IF EXISTS public.st_course_baseline;
--
-- 設計上の要点:
--   * どちらも「レース詳細を開くたびに集計すると重い」指標の事前集計。日次バッチ
--     （scripts/daily/update-course-baseline-stats.js）が upsert する。画面は単純な SELECT で読む
--   * 匿名（画面）が読むテーブルなので SELECT ポリシーと GRANT SELECT を付ける。書き込みは
--     service_role のみ（BOA-370 のRLS規律。076以降は新規テーブルの既定権限を剥奪しているため GRANT を明示する）
--   * 既存の nige_outcome_distribution（027、艇番基準・90日・3連単粒度）は BOA-158 の
--     「逃げ成功時分布」タブが使用中のため変更しない。本テーブルはコース基準・直近1年・2着粒度で別物
--   * 行数は極小（st_course_baseline 6行、nige_second_by_course 最大120行）。Disk IO への影響は無視できる

SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. ST考察の「同コース平均」ベースライン（全国・直近1年）
-- ---------------------------------------------------------------------------
-- 画面は、選手個人の安定率・抜出率・出遅率とこの値の差を併記する。
-- 生の値だけでは順位が逆転する（例: 出遅率 5コース34.3% と 6コース22.9% は、
-- コース平均 19.9% / 30.8% との差では +14.4pt と -7.9pt で逆になる）。
CREATE TABLE IF NOT EXISTS st_course_baseline (
  course        SMALLINT     PRIMARY KEY,          -- 実進入コース（1〜6。race_results.actual_course_N 由来）
  window_days   SMALLINT     NOT NULL,             -- 集計窓の日数（365）
  runs          INTEGER      NOT NULL,             -- 母数（走数）
  avg_st        NUMERIC(5,3) NOT NULL,             -- 平均ST（Fは負値に正規化した値の平均）
  stable_rate   NUMERIC(5,2) NOT NULL,             -- 安定率(%) ST順1位との差が0.05以内
  breakout_rate NUMERIC(5,2),                      -- 抜出率(%) すべての内側艇より0.07以上早い。1コースはNULL
  late_rate     NUMERIC(5,2) NOT NULL,             -- 出遅率(%) ST順1位より0.1以上遅い
  st_histogram  JSONB        NOT NULL,             -- STの分布（0.05刻みのビン。{"0.00":n,"0.05":n,...}）
  last_updated  DATE         NOT NULL,             -- 集計日（JST）
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  CONSTRAINT st_course_baseline_course_range CHECK (course BETWEEN 1 AND 6)
);

ALTER TABLE st_course_baseline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS st_course_baseline_public_read ON public.st_course_baseline;
CREATE POLICY st_course_baseline_public_read ON public.st_course_baseline
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.st_course_baseline TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 逃げシミュレーション（会場別・直近1年）
-- ---------------------------------------------------------------------------
-- 「1コースが逃げた」= race_results.winning_technique = '逃げ' かつ 1着艇の実進入コースが1。
-- 直近1年・全国で23,056レース、2着率は2コース34.4%〜6コース5.4%で合計100%（検算済み）。
-- 会場別で出す（フォールバックはしない。母数は画面に明記する）。
CREATE TABLE IF NOT EXISTS nige_second_by_course (
  venue_code    SMALLINT     NOT NULL,             -- 会場コード（1〜24）
  second_course SMALLINT     NOT NULL,             -- 2着に来た実進入コース（2〜6）
  window_days   SMALLINT     NOT NULL,             -- 集計窓の日数（365）
  nige_races    INTEGER      NOT NULL,             -- その会場の「1コース逃げ」レース数（second_rate の分母）
  total_races   INTEGER      NOT NULL,             -- その会場の結果確定レース数（exacta_rate の P(逃げ) の分母）
  second_count  INTEGER      NOT NULL,             -- そのコースが2着だった回数
  second_rate   NUMERIC(5,2) NOT NULL,             -- 逃し時2着率(%) = second_count / nige_races
  exacta_rate   NUMERIC(5,2) NOT NULL,             -- 2連単確率(%) = (nige_races / total_races) * second_rate
  last_updated  DATE         NOT NULL,             -- 集計日（JST）
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  PRIMARY KEY (venue_code, second_course),
  CONSTRAINT nige_second_by_course_venue_range CHECK (venue_code BETWEEN 1 AND 24),
  CONSTRAINT nige_second_by_course_course_range CHECK (second_course BETWEEN 2 AND 6)
);

ALTER TABLE nige_second_by_course ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nige_second_by_course_public_read ON public.nige_second_by_course;
CREATE POLICY nige_second_by_course_public_read ON public.nige_second_by_course
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.nige_second_by_course TO anon, authenticated;
