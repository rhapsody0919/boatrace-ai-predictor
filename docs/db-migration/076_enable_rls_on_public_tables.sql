-- 076_enable_rls_on_public_tables.sql
-- BOA-370: RLS無効の16テーブルが、匿名キーで書き込み・削除できる状態の是正
--
-- 背景（2026-09-20の本番読み取り調査）
--   1. 公開スキーマの16テーブルでRLSが無効。anon/authenticatedにINSERT/UPDATE/DELETE権限がある
--      （Supabaseの既定GRANT）。anonキーはフロントエンドのバンドルに含まれる公開値のため、
--      誰でもREST APIから書き換え・削除できる
--   2. RLS有効の他テーブル（40本。sns_* 13本を含む）も、anon/authenticatedに書き込み権限が残っている
--      （RLSのポリシーが無いため拒否されているだけ。ポリシーの追加ミス1つで書き込みが開く）
--   3. 【追加発見】ビュー4本（v_production_models・v_performance_comparison・
--      v_prediction_performance・v_todays_recommendations）にもanonの書き込み権限がある。
--      うち v_production_models(models) と v_performance_comparison(user_visible_summary) は
--      単純ビューで自動更新可能（information_schema.views.is_updatable=YES）。ビューは所有者
--      (postgres, BYPASSRLS)の権限で基底テーブルにアクセスするため、基底テーブルのRLSを迂回して
--      anonから書き換えられる。security_invoker未設定のため、shadow予測(is_shadow=true)等の
--      RLSで隠している行も、ビュー経由では読める
--
-- 方針
--   * 書き込みは、フロントエンド・Vercel Functions（anonキー）に一切存在しない
--     （src/ の insert/update/upsert/delete は0件。api/ のanon利用はRPC・SELECTのみ）。
--     書き込みは全て scripts/・Vercel Cron（service_role、BYPASSRLS）のため、REVOKEの影響を受けない
--   * 読み取りが必要なテーブルにだけ SELECT ポリシー（TO anon, authenticated USING (true)）を付与
--   * 読み取りが不要なテーブルは、RLS有効＋ポリシー無し＋anon/authenticatedの全権限REVOKE
--     （PostgREST経由で存在自体が見えなくなる）
--   * 「テーブルのSELECT権限は、SELECTポリシーを持つテーブルにだけ付与する」を全テーブルに適用
--
-- 読み取り経路の監査結果（anon/authenticatedが対象16テーブルを読む経路）
--   テーブル                     直接(src/)  埋込select  RPC(SECURITY INVOKER)                 判定
--   exhibition_data              有          有(races)   get_predictions_by_date(_light)、       SELECTポリシー要
--                                                        get_race_exhibition_trend、
--                                                        get_race_st_predictability
--   race_conditions              有          有(races)   get_today_races、                       SELECTポリシー要
--                                                        get_predictions_by_date(_light)
--   race_odds                    有          -           -                                       SELECTポリシー要
--   race_start_timings           有          -           get_race_st_predictability              SELECTポリシー要
--   racer_aggregated_stats       有          -           -                                       SELECTポリシー要
--   racer_series_points          有          -           -                                       SELECTポリシー要
--   venue_motor_stats            有          -           -                                       SELECTポリシー要
--   model_performance_daily      有(Holmes)  -           -                                       SELECTポリシー要
--   venue_rules                  無(*)       -           -                                       不要（不可視）
--   rule_applications            無(*)       -           -                                       不要（不可視）
--   bet_filters                  無          -           -                                       不要（不可視）
--   daily_bet_summary            無          -           -                                       不要（不可視）
--   model_experiments            無          -           -                                       不要（不可視）
--   race_notices_health          無          -           -                                       不要（不可視）
--   race_special_notes           無(**)      -           -                                       不要（不可視）
--   venue_entry_course_stats     無          -           -                                       不要（不可視）
--   (*)  読むのは src/components/RulePerformance.jsx のみで、どこからもimportされていない未使用コンポーネント
--   (**) 「レース特記事項ページ」(docs/design/scraping-full-coverage FR-1)で将来表示する設計だが、
--        画面は未実装。画面を実装するPRで、SELECTポリシーとGRANT SELECTを追加すること
--   RPCは全て SECURITY INVOKER のため、呼び出し元(anon)の権限とRLSで基底テーブルを読む。
--   つまり exhibition_data・race_conditions・race_start_timings にSELECTポリシーが無いと、
--   トップ・レース詳細・分析タブのRPCが空を返す（この3本を落とすと画面が壊れる）
--
-- 適用時の注意
--   * ALTER TABLE ... ENABLE ROW LEVEL SECURITY は一瞬 ACCESS EXCLUSIVE ロックを取る。
--     スクレイパーの書き込みと衝突して待たされないよう lock_timeout を設定してある。
--     ロック取得に失敗した場合はトランザクション全体がロールバックされるので、時間をおいて再実行する
--   * 本番適用は、開催時間帯（JST 8:00〜21:30頃）を避けると、ロック競合の可能性が下がる
--   * PostgRESTのスキーマキャッシュは、DDL後に自動で再読み込みされる（末尾のNOTIFYは念のため）
--
-- 実行: BEGIN〜COMMITで1トランザクション。失敗したら全体がロールバックされる
-- 検証: 末尾の「確認SQL」と scripts/maintenance/verify-rls-migration.js（npm run verify:rls-migration）
-- ロールバック: 末尾の「ロールバックSQL」（脆弱な状態に戻る。緊急時のみ）

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ============================================================
-- 1. RLS有効化（対象16テーブル）
-- ============================================================
ALTER TABLE public.bet_filters              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_bet_summary        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exhibition_data          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_experiments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_performance_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_conditions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_notices_health      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_odds                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_special_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_start_timings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.racer_aggregated_stats   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.racer_series_points      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_applications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_entry_course_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_motor_stats        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_rules              ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. 公開SELECTポリシー（読み取り経路がある8テーブルのみ）
--    上記の監査表の「SELECTポリシー要」。それ以外の8テーブルはポリシー無し（anonから不可視）
-- ============================================================
DROP POLICY IF EXISTS exhibition_data_public_read ON public.exhibition_data;
CREATE POLICY exhibition_data_public_read ON public.exhibition_data
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS race_conditions_public_read ON public.race_conditions;
CREATE POLICY race_conditions_public_read ON public.race_conditions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS race_odds_public_read ON public.race_odds;
CREATE POLICY race_odds_public_read ON public.race_odds
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS race_start_timings_public_read ON public.race_start_timings;
CREATE POLICY race_start_timings_public_read ON public.race_start_timings
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS racer_aggregated_stats_public_read ON public.racer_aggregated_stats;
CREATE POLICY racer_aggregated_stats_public_read ON public.racer_aggregated_stats
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS racer_series_points_public_read ON public.racer_series_points;
CREATE POLICY racer_series_points_public_read ON public.racer_series_points
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS venue_motor_stats_public_read ON public.venue_motor_stats;
CREATE POLICY venue_motor_stats_public_read ON public.venue_motor_stats
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS model_performance_daily_public_read ON public.model_performance_daily;
CREATE POLICY model_performance_daily_public_read ON public.model_performance_daily
  FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 3. テーブル権限の是正（公開スキーマの全テーブル。対象16本＋RLS有効済みの40本）
--    anon/authenticatedの権限を全て剥がし、SELECT系ポリシー（SELECT/ALL）を持つテーブルにだけ
--    SELECTを付与し直す。INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAINは付与しない
--    （service_roleは別のGRANTで、BYPASSRLSのため影響なし）
--    RLS有効済みテーブルへの適用は「RLSが拒否しているだけ」の状態を「権限も無い」状態にする
--    多層防御で、ポリシーの追加ミス（FOR ALL USING (true) 等）で書き込みが開く事故を防ぐ
-- ============================================================
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t.relname);
    IF EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = t.relname
        AND p.cmd IN ('SELECT', 'ALL')
        AND p.roles && ARRAY['public', 'anon', 'authenticated']::name[]
    ) THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', t.relname);
    END IF;
  END LOOP;
END
$$;

-- ============================================================
-- 4. ビューの是正
--    (a) 書き込み権限を剥がし、SELECTのみ残す（自動更新可能なビュー経由の書き込みでRLSが迂回されていた）
--    (b) security_invoker = true: 呼び出し元の権限・RLSで基底テーブルを読む
--        （shadow予測等、RLSで隠している行がビュー経由で見える問題を塞ぐ）
--    4本ともsrc/・api/・scripts/から参照されていない（docsのAPI仕様書に記載があるのみ）ため、
--    画面への影響は無い
-- ============================================================
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v.relname);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', v.relname);
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
  END LOOP;
END
$$;

-- ============================================================
-- 5. 匿名から呼べる書き込み系RPCの遮断
--    update_venue_stats(): venuesをUPDATEするvoid関数。SECURITY INVOKERのため今は
--    RLS・権限で無害だが、公開RPCとして呼べる必要が無い（src/api/scriptsから未使用、pg_cron無し）
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.update_venue_stats() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 6. 今後作られるテーブル/ビューの既定権限
--    Supabaseの既定では、postgresロールが作る新規テーブルにanon/authenticatedの全権限が付く
--    （pg_default_acl）。これを剥がし、新規テーブルは明示的な GRANT SELECT + RLS + ポリシーが
--    揃って初めて読めるようにする（既存の 020/021/023 等は元から明示GRANTしており、同じ流儀）
--    注意: 対象は postgres が作成するオブジェクト。supabase_admin が作成するもの
--    （拡張・ダッシュボード内部）の既定権限は、権限上変更できないため対象外
-- ============================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- 確認SQL（適用後に実行。読み取りのみ）
-- ============================================================
-- (1) 対象16テーブル: rls_on=true、anonの書き込み権限が全てfalse
--     SELECT c.relname, c.relrowsecurity AS rls_on,
--            has_table_privilege('anon', c.oid, 'INSERT') AS anon_ins,
--            has_table_privilege('anon', c.oid, 'UPDATE') AS anon_upd,
--            has_table_privilege('anon', c.oid, 'DELETE') AS anon_del,
--            has_table_privilege('anon', c.oid, 'TRUNCATE') AS anon_trunc,
--            has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
--            (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policies
--     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--     WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relrowsecurity, c.relname;
--     期待: 全テーブルで anon_ins/anon_upd/anon_del/anon_trunc=false、rls_on=true。
--           anon_sel=true は policies>=1 のテーブルだけ（sns_*・不可視8本は false）
-- (2) 書き込み権限を持つanon/authenticatedが、public内に残っていないこと（0行）
--     SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_schema='public' AND grantee IN ('anon','authenticated')
--       AND privilege_type <> 'SELECT';
-- (3) ビュー: security_invoker=true、anonの書き込み権限なし
--     SELECT relname, reloptions FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='v';
-- (4) 既定権限: anon/authenticatedが含まれないこと（postgres作成分）
--     SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl
--     WHERE defaclnamespace='public'::regnamespace;
-- (5) 画面が壊れていないこと（SECURITY INVOKERのRPCをanonの権限で呼ぶ。読み取りのみ）
--     BEGIN;
--     SET LOCAL ROLE anon;
--     SELECT count(*) FROM public.exhibition_data;                       -- 0より大きい
--     SELECT count(*) FROM public.race_conditions;                       -- 0より大きい
--     SELECT count(*) FROM public.race_start_timings;                    -- 0より大きい
--     SELECT length(get_today_races()::text);                            -- 開催日の午前中以降は2('[]')より大きい
--     SELECT length(get_predictions_by_date_light(CURRENT_DATE)::text);  -- 同上
--     ROLLBACK;
--     anonで読めなくなった（permission denied / 0行）場合は、そのテーブルにSELECTポリシーとGRANT SELECTを
--     追加して再適用する。anonキーでの書き込み試験はしないこと
-- (6) 匿名ユーザーの画面確認: 本番のトップ・レース詳細（展示・気象・ST）・分析ツール・Holmes（Moriarty）・
--     会場のモーター（venue_motor_stats）・選手ページ（racer_aggregated_stats）を開き、データが表示されること
--     （npm run test:e2e のスモークテストでも確認できる）

-- ============================================================
-- ロールバックSQL（脆弱な状態に戻る。緊急時のみ。verify-rls-migration.jsが実際に実行して検証する）
-- ============================================================
-- ROLLBACK-BEGIN
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE public.bet_filters              DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.daily_bet_summary        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.exhibition_data          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.model_experiments        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.model_performance_daily  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.race_conditions          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.race_notices_health      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.race_odds                DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.race_special_notes       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.race_start_timings       DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.racer_aggregated_stats   DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.racer_series_points      DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.rule_applications        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.venue_entry_course_stats DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.venue_motor_stats        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.venue_rules              DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS exhibition_data_public_read ON public.exhibition_data;
-- DROP POLICY IF EXISTS race_conditions_public_read ON public.race_conditions;
-- DROP POLICY IF EXISTS race_odds_public_read ON public.race_odds;
-- DROP POLICY IF EXISTS race_start_timings_public_read ON public.race_start_timings;
-- DROP POLICY IF EXISTS racer_aggregated_stats_public_read ON public.racer_aggregated_stats;
-- DROP POLICY IF EXISTS racer_series_points_public_read ON public.racer_series_points;
-- DROP POLICY IF EXISTS venue_motor_stats_public_read ON public.venue_motor_stats;
-- DROP POLICY IF EXISTS model_performance_daily_public_read ON public.model_performance_daily;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
-- DO $$
-- DECLARE v record;
-- BEGIN
--   FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--            WHERE n.nspname = 'public' AND c.relkind = 'v'
--   LOOP
--     EXECUTE format('ALTER VIEW public.%I SET (security_invoker = false)', v.relname);
--   END LOOP;
-- END
-- $$;
-- GRANT EXECUTE ON FUNCTION public.update_venue_stats() TO PUBLIC, anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
-- ROLLBACK-END
