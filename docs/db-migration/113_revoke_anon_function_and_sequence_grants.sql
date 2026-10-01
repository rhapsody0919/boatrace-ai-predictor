-- 113_revoke_anon_function_and_sequence_grants.sql
-- BOA-575: 書き込み用の関数・使われていない関数の EXECUTE が匿名(anon)に残っている問題の是正
-- BOA-228: 076（BOA-370）で解消済みであることを本番の読み取りで再確認（下記「背景」1）
--
-- 背景（2026-10-01 本番の読み取り調査。Management API の read-only エンドポイント）
--   1. BOA-228 の11テーブルを含む public の全78テーブルで RLS 有効。anon / authenticated の
--      INSERT/UPDATE/DELETE/TRUNCATE は0件。公開ポリシー51本はすべて FOR SELECT。
--      ビュー4本は security_invoker=true。SECURITY DEFINER の関数は public に0本
--      （＝BOA-228 は 076 で解消済み。このマイグレーションでテーブルは触らない）
--   2. public の関数のうち anon が EXECUTE できるのは13本。うち6本は匿名から呼ぶ経路が無い
--        トリガー関数（3本）   update_prediction_results / trg_external_predictions_updated_at /
--                              update_updated_at_column
--        バッチ専用（1本）     get_latest_racer_grades（scripts/daily/update-racer-grade-cache.js、service key）
--        呼び出し元なし（2本） get_accuracy_summary（api/accuracy は accuracy_cache の読み取りに置換済み）/
--                              get_race_history_summary(days_back)
--      トリガー関数は直接呼ぶと「trigger functions can only be called as triggers」で失敗し、
--      anon は基底テーブルの書き込み権限も無いため実害は無い。ただ、書き込み用の関数を匿名に
--      公開しているのは REVOKE 漏れ。get_race_history_summary・get_accuracy_summary は
--      引数次第で重い集計を匿名から何度でも走らせられる（負荷の踏み台）
--   3. 【根本原因】postgres の既定権限（pg_default_acl）が、public に作る新規関数へ
--      anon / authenticated / PUBLIC の EXECUTE を付ける。076 はテーブルの既定権限だけを剥奪したため、
--      関数は作るたびに REVOKE を書かないと匿名から呼べる（BOA-575 はこの書き忘れ）
--   4. シーケンス16本で anon / authenticated に USAGE・SELECT・UPDATE が残っている（既定権限も同じ）。
--      PostgREST から nextval/setval は呼べないため実害は無いが、076 の「匿名は SELECT のみ」の方針から外れる
--
-- 匿名(anon)が呼ぶ RPC（EXECUTE を残す7本。src/・api/ の呼び出しを全件確認）
--   get_today_races                 api/races/today.js（anon key）
--   get_predictions_by_date(_light) api/predictions/[date].js（anon key）
--   get_race_st_predictability      src/services/supabaseDataService.js
--   get_race_exhibition_trend       src/services/supabaseDataService.js
--   get_race_return_rate            src/services/supabaseDataService.js
--   get_race_technique_profile      src/services/supabaseDataService.js
--
-- 方針
--   * 上記2の6本: PUBLIC / anon / authenticated から EXECUTE を剥奪し、service_role にだけ付ける
--     （107・111 と同じ流儀）。トリガーの発火は関数の EXECUTE 権限を確かめない（確かめるのは
--     CREATE TRIGGER の時だけ）ため、スクレイパーの書き込みで動くトリガーは影響を受けない
--     （scripts/maintenance/verify-function-grants-migration.js が PGlite 上で実証する）
--   * シーケンス: anon / authenticated の全権限を剥奪（書き込みは service_role のみのため不要）
--   * 既定権限: postgres が今後作る関数・シーケンスに anon / authenticated / PUBLIC の権限を付けない。
--     以後、匿名に呼ばせたい RPC は同じマイグレーション内で
--       GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO anon, authenticated;
--     を明示する（テーブルの GRANT SELECT と同じ流儀）。付け忘れは「呼べない」側に倒れる。
--     npm run verify:migration-rls が114番以降で、関数ごとに GRANT/REVOKE の明示を機械検査する
--   * PUBLIC の既定 EXECUTE は PostgreSQL 全体の既定でスキーマ単位では外せないため、
--     FOR ROLE postgres の全スキーマに対して剥奪する（postgres が public 以外に作る関数も、
--     postgres 以外が呼ぶには GRANT が要る。supabase_admin が作る拡張の関数は対象外）
--   * CREATE OR REPLACE FUNCTION は既存の権限を保つため、既存の7本の RPC の置き換えには影響しない
--   * supabase_admin が所有者の既定権限は、postgres から変更できないため対象外（076 と同じ）
--
-- 適用時の注意
--   * REVOKE / GRANT / ALTER DEFAULT PRIVILEGES のみ。テーブル・データは読み書きしない。
--     関数のメタデータ更新のロックのみで、開催時間帯に適用してよい
--   * 末尾の DO ブロックが適用後の状態を検査し、想定と違えば例外でトランザクション全体を戻す
--   * 2回実行しても同じ状態になる（冪等）
--
-- 実行: BEGIN〜COMMITで1トランザクション
-- 検証: npm run verify:function-grants-migration（PGlite上で適用・ロールバックまで再現）
--       本番適用後は node --env-file=.env.local scripts/maintenance/check-anon-access.js --expect-applied
-- ロールバック: 末尾の「ロールバックSQL」（剥奪前の状態に戻る。緊急時のみ）

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ============================================================
-- 1. 匿名から呼ぶ経路が無い関数6本の EXECUTE を剥奪
-- ============================================================
REVOKE ALL ON FUNCTION public.update_prediction_results() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_external_predictions_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_latest_racer_grades() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_accuracy_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_race_history_summary(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_prediction_results() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_external_predictions_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_racer_grades() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_accuracy_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_race_history_summary(integer) TO service_role;

-- ============================================================
-- 2. シーケンスの匿名権限を剥奪
-- ============================================================
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- ============================================================
-- 3. 既定権限: postgres が今後作る関数・シーケンスに匿名の権限を付けない
-- ============================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ============================================================
-- 4. 適用後の状態を検査（想定と違えば例外で全体を戻す）
-- ============================================================
DO $$
DECLARE
  anon_funcs text[];
  expected text[] := ARRAY[
    'get_predictions_by_date', 'get_predictions_by_date_light',
    'get_race_exhibition_trend', 'get_race_return_rate',
    'get_race_st_predictability', 'get_race_technique_profile',
    'get_today_races'
  ];
  seq_grants int;
  missing_svc int;
BEGIN
  SELECT array_agg(p.proname::text ORDER BY p.proname COLLATE "C") INTO anon_funcs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF anon_funcs IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'anon が EXECUTE できる関数が想定と違う: % （想定: %）', anon_funcs, expected;
  END IF;

  -- relkind の絞り込みより先に has_sequence_privilege が評価されると、シーケンス以外で失敗するため CASE で守る
  SELECT count(*) INTO seq_grants
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'S'
    AND CASE WHEN c.relkind = 'S' THEN
          has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
          OR has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE')
        ELSE false END;
  IF seq_grants <> 0 THEN
    RAISE EXCEPTION 'anon/authenticated のシーケンス権限が % 件残っている', seq_grants;
  END IF;

  SELECT count(*) INTO missing_svc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF missing_svc <> 0 THEN
    RAISE EXCEPTION 'service_role が EXECUTE できない関数が % 本ある', missing_svc;
  END IF;
END $$;

COMMIT;

-- ============================================================
-- 確認SQL（適用後に実行。読み取りのみ）
-- ============================================================
-- 期待: 7行（上の「匿名(anon)が呼ぶ RPC」の7本だけ）
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1;
--
-- 期待: public の 'f' と 'S' の行に anon / authenticated が含まれない。
--       postgres の全スキーマ（nspname が NULL）の 'f' 行が {postgres=X/postgres}
-- SELECT pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype, d.defaclacl
-- FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
-- WHERE pg_get_userbyid(d.defaclrole) = 'postgres';

-- ============================================================
-- ロールバックSQL（剥奪前の状態に戻す。緊急時のみ。コメントを外して実行）
-- ============================================================
-- ROLLBACK-BEGIN
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION public.update_prediction_results() TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.trg_external_predictions_updated_at() TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_latest_racer_grades() TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_accuracy_summary() TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.get_race_history_summary(integer) TO PUBLIC, anon, authenticated;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
-- COMMIT;
-- ROLLBACK-END
