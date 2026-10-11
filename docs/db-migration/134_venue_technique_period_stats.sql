-- 134: 会場の決まり手を期間ごとに数えた表 venue_technique_period_stats（BOA-430 思考アシスト）
-- 対応spec/plan: docs/design/thinking-assist/plan.md「未決 P-2」、docs/adr/0088-venue-winning-technique-counts-by-period.md
--
-- 背景: 思考アシストの会場の特徴のシートで、会場の決まり手を「直近1年」を主に「直近90日」と並べる（2026-10-07
--   ユーザー決定）。既存の winning_technique_stats は会場×1着の枠番×決まり手の直近90日だけで、直近1年は無い。
--   直近1年は新しい表（races×race_results、2025-12-03〜）と長期の表（kb_archive_races、〜2025-12-02）をつなぐ
--   必要があり、kb_archive_races は匿名に読ませていない。SECURITY DEFINER の関数を匿名に公開するのは規則で禁じて
--   いる（verify-migration-rls 7）ので、毎日のスクリプト（service_role）が会場ごとに数えてこの表に書き、画面は
--   この表を読む。既存の winning_technique_stats と、それを読む分析ページには触れない。
--
-- 列:
--   venue_code         会場（1〜24）
--   period_days        数えた期間の日数（90 か 365）。期間は「集計日の前日から遡って N 日」
--   winning_technique  決まり手（逃げ／差し／まくり／まくり差し／抜き／恵まれ）
--   race_count         その期間・その会場で、この決まり手で決まったレースの数
--   total_races        その期間・その会場の、決まり手のあるレースの数（割合の分母。決まり手ごとに同じ値）
--   period_from        期間の初日（JST）
--   period_to          期間の最終日（JST、集計日の前日）
--   last_updated       集計日（JST）
-- 主キー (venue_code, period_days, winning_technique)。毎日のスクリプトが会場ごとに全行を書き直す。
-- 数えるレース: 中止・不成立・1着なし・決まり手なしを除く（winning_technique_stats と同じ除外。長期の表は
--   has_result かつ technique あり）。
--
-- 書き込み: service_role のみ（GitHub Actions の毎日のスクリプト）。読み取り: anon・authenticated は SELECT のみ。
-- 行数: 24会場 × 2期間 × 約6決まり手 ＝ 約290行。
--
-- ⚠️ 本番へ未適用。適用はユーザーが行う。
-- 適用手順: Supabase Dashboard > SQL Editor で、このファイルの全文を実行する（BEGIN〜COMMIT を含む）。
--   新しい表を作るだけで、既存の表・読み手には触れない。書き手（毎日のスクリプト）の PR のマージより前に適用する。
--   適用の直後は0行。書き手のマージ後、ワークフローを1回手動で動かすと埋まる（それまで画面は決まり手の節を出さない）。
-- 適用後の確認（読み取りのみ）:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_technique_period_stats'::regclass;  → true
--   SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'venue_technique_period_stats';
--     → venue_technique_period_stats_select | SELECT | {anon,authenticated}
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_name = 'venue_technique_period_stats' AND grantee IN ('anon', 'authenticated');
--     → anon・authenticated の SELECT だけ
--
-- 検証: npm run verify:migration-rls（076 以降の RLS・権限の機械検査）

BEGIN;

CREATE TABLE IF NOT EXISTS public.venue_technique_period_stats (
  venue_code         smallint NOT NULL CHECK (venue_code BETWEEN 1 AND 24),
  period_days        smallint NOT NULL CHECK (period_days IN (90, 365)),
  winning_technique  text NOT NULL CHECK (winning_technique <> ''),
  race_count         integer NOT NULL CHECK (race_count >= 0),
  total_races        integer NOT NULL CHECK (total_races > 0 AND total_races >= race_count),
  period_from        date NOT NULL,
  period_to          date NOT NULL CHECK (period_to >= period_from),
  last_updated       date NOT NULL,
  PRIMARY KEY (venue_code, period_days, winning_technique)
);

ALTER TABLE public.venue_technique_period_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS venue_technique_period_stats_select ON public.venue_technique_period_stats;
CREATE POLICY venue_technique_period_stats_select ON public.venue_technique_period_stats
  FOR SELECT TO anon, authenticated USING (true);

-- 076 で新規テーブルの既定権限を剥奪しているので、読ませる権限を明示する（書き込みは付けない）
REVOKE ALL ON public.venue_technique_period_stats FROM anon, authenticated;
GRANT SELECT ON public.venue_technique_period_stats TO anon, authenticated;
GRANT ALL ON public.venue_technique_period_stats TO service_role;

COMMIT;

-- ROLLBACK-BEGIN
-- DROP TABLE IF EXISTS public.venue_technique_period_stats;
-- ROLLBACK-END
