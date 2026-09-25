-- 095: 数値・事実データ3表を匿名（画面）から読めるようにする（phase a / FR-4a・FR-4c・FR-4d）
--
-- 対応設計: docs/design/analysis-visualization-upgrade/plan.md §2.3 / spec.md FR-4
-- 対応Linearチケット: BOA-305 配下
--
-- ⚠️ この案は「本番へ未適用」。適用はユーザーの承認のもとで行う（docs/db-migration/APPLIED.md）。
--
-- 対象と用途:
--   motor_pretest_stats  前検タイム・節時点のモーター/ボート2連対率（N23、公式 race/rankingmotor 由来）
--                        → モータ情報タブ（FR-4a）
--   racer_period_stats   期別成績・能力指数・コース別成績（N21、公式 期別成績ファイル fan 由来）
--                        → 基本情報タブの「条件別」タブの「前期」行（FR-4c）
--   race_series          節メタ（節名・グレード・種別・日程。N16、公式 race/monthlyschedule 由来）
--                        → 「初日」「最終日」の判定に使う（FR-4d）
--
-- ADR-0067（公式サイトのコンテンツの再表示）との関係:
--   3表はいずれも**数値・事実データ**で、ADR-0067の「現状維持」が扱っている範囲（出走表・オッズ・
--   結果・展示などの数値を、集計・加工して、または取得値のまま表示する）と同種である。
--   ピットレポート（第三者の自由記述の文章）やオリジン展示（BOATCAST）とは性質が違うため、
--   ADR-0067への追記は要さないと整理した。ただし**匿名への公開そのものはユーザーの承認が要る**
--   （086と同じ手続き）。オリジナル展示は別ファイル（096）に分けてある。
--
-- 適用手順: 次の全体を1つのトランザクションとして実行する。
--     BEGIN;
--     （このファイルの全文）
--     COMMIT;
--
-- 適用後の確認（読み取りのみ）:
--   SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT') AS sel,
--          has_table_privilege('anon', c.oid, 'INSERT') AS ins
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname='public' AND c.relname IN
--     ('motor_pretest_stats','racer_period_stats','race_series');
--   → 3行とも sel=true, ins=false
--
-- ロールバック（匿名の読み取りを止める。データは消えない）:
--   DROP POLICY IF EXISTS motor_pretest_stats_public_read ON public.motor_pretest_stats;
--   DROP POLICY IF EXISTS racer_period_stats_public_read  ON public.racer_period_stats;
--   DROP POLICY IF EXISTS race_series_public_read         ON public.race_series;
--   REVOKE SELECT ON public.motor_pretest_stats, public.racer_period_stats, public.race_series
--     FROM anon, authenticated;
--
-- 設計上の要点:
--   * 公開するのは SELECT のみ。書き込みは service_role（RLS迂回）でのみ行う（BOA-370のRLS規律）
--   * 076 で新規テーブルの既定権限を剥奪しているため、ポリシーだけでなく GRANT SELECT も明示する
--   * 3表は 083・090 で作成済み・RLS有効・匿名の権限なしの状態（2026-09-23実測）

SET LOCAL lock_timeout = '10s';

DROP POLICY IF EXISTS motor_pretest_stats_public_read ON public.motor_pretest_stats;
CREATE POLICY motor_pretest_stats_public_read ON public.motor_pretest_stats
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS racer_period_stats_public_read ON public.racer_period_stats;
CREATE POLICY racer_period_stats_public_read ON public.racer_period_stats
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS race_series_public_read ON public.race_series;
CREATE POLICY race_series_public_read ON public.race_series
  FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.motor_pretest_stats TO anon, authenticated;
GRANT SELECT ON public.racer_period_stats  TO anon, authenticated;
GRANT SELECT ON public.race_series         TO anon, authenticated;
