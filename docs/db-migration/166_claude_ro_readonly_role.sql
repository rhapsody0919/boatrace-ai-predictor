-- 166: Claude のセッションが本番を読むための読み取り専用ロール claude_ro（番号は hq が予約、2026-10-19）
-- 設計: ADR-0096。使い方: node --env-file=.env.local scripts/db/ro-query.js "SELECT …"
-- 適用はオーナー（db-apply か SQL Editor でこのファイルを1回実行）。手順は 166-runbook.md。
--
-- 書けないことは権限だけで保証する（ロールの SET は本人が SET で戻せるので守りの本体にしない）
--   * 付けるのは public の USAGE と、表・ビューの SELECT だけ。pg_read_all_data は使わない
--     （auth.users のメールアドレス・vault・storage まで読めるため）
--   * BYPASSRLS を付ける。付けないと RLS の付いた表がエラーでなく0行で返る（ADR-0069 と同じ「失敗がデータなしに化ける」型）。
--     Supabase の postgres は rolbypassrls=true（2026-10-19 本番で確認）。付けられない版なら CREATE ROLE が失敗して全体が戻る
--   * sns_oauth_tokens（X のトークンの暗号文）は読ませない
--   * パスワードはこのファイルに書かない。適用後にオーナーが scripts/db/ro-setup.js の出す ALTER ROLE で設定する
--     （それまではログインできない）
--
-- 末尾の DO ブロックが、書き込み・秘密の読み取りの経路が無いことを確かめ、あれば例外で全体を戻す
--   * claude_ro が USAGE を持つスキーマの表・ビュー・シーケンスに SELECT 以外の権限が無い（PUBLIC 経由・列単位の GRANT を含む）
--   * claude_ro が SECURITY DEFINER の関数を EXECUTE できない（PostgreSQL は既定で EXECUTE を PUBLIC に渡す。
--     113 で postgres の新規関数の既定は外したが、113 より前の関数は残る。STABLE でも中で VOLATILE な関数を呼べば
--     所有者の権限で書け、auth・vault も読めるので volatility を問わない）
--   * どのスキーマにも CREATE できない、他のロールのメンバーでない、superuser でない
--   * データベース・全ロール向けの設定（pg_db_role_setting。誰でも current_setting で読める）に jwt・secret・key・password を含む名前が無い
--   * sns_oauth_tokens はどの列も読めない
-- 検証: npm run verify:ro-query（PGlite 上で適用し、書き込みの経路が無いことと末尾の検査を確かめる）
-- 戻し方: REVOKE ALL ON ALL TABLES IN SCHEMA public FROM claude_ro;
--         ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM claude_ro;
--         REVOKE USAGE ON SCHEMA public FROM claude_ro; DROP ROLE claude_ro;（ラージオブジェクトがあれば先に lo_unlink。166-runbook.md）
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE ROLE claude_ro LOGIN NOINHERIT BYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE claude_ro SET statement_timeout = '30s';
ALTER ROLE claude_ro SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE claude_ro SET default_transaction_read_only = on;

GRANT USAGE ON SCHEMA public TO claude_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO claude_ro;
REVOKE ALL ON public.sns_oauth_tokens FROM claude_ro;

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s(%s)', c.oid::regclass, p.priv), ', ') INTO bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND has_schema_privilege('claude_ro', n.oid, 'USAGE')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND CASE WHEN p.priv IN ('INSERT', 'UPDATE', 'REFERENCES')
      THEN has_any_column_privilege('claude_ro', c.oid, p.priv)
      ELSE has_table_privilege('claude_ro', c.oid, p.priv) END;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '166: claude_ro が表に書き込める: %', bad;
  END IF;

  SELECT string_agg(c.oid::regclass::text, ', ') INTO bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND has_schema_privilege('claude_ro', n.oid, 'USAGE')
    AND c.relkind = 'S'
    AND (has_sequence_privilege('claude_ro', c.oid, 'UPDATE') OR has_sequence_privilege('claude_ro', c.oid, 'USAGE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '166: claude_ro がシーケンスを進められる: %', bad;
  END IF;

  SELECT string_agg(format('%s（所有者 %s）', p.oid::regprocedure, pg_get_userbyid(p.proowner)), ', ') INTO bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND has_schema_privilege('claude_ro', n.oid, 'USAGE')
    AND p.prosecdef
    AND has_function_privilege('claude_ro', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '166: claude_ro が SECURITY DEFINER 関数を呼べる（PUBLIC の EXECUTE を外し、要るロールに GRANT し直す）: %', bad;
  END IF;

  SELECT string_agg(nspname, ', ') INTO bad
  FROM pg_namespace
  WHERE has_schema_privilege('claude_ro', oid, 'CREATE')
    AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '166: claude_ro が CREATE できるスキーマがある: %', bad;
  END IF;

  SELECT string_agg(split_part(cfg, '=', 1), ', ') INTO bad
  FROM pg_db_role_setting s
  CROSS JOIN unnest(s.setconfig) AS cfg
  WHERE (s.setdatabase = 0 OR s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()))
    AND (s.setrole = 0 OR s.setrole = 'claude_ro'::regrole)
    AND split_part(cfg, '=', 1) ~* '(jwt|secret|key|password|token)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '166: claude_ro が current_setting で読める設定に秘密らしい名前がある（名前だけを出す）: %', bad;
  END IF;

  IF has_any_column_privilege('claude_ro', 'public.sns_oauth_tokens', 'SELECT') THEN
    RAISE EXCEPTION '166: claude_ro が sns_oauth_tokens を読める';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'claude_ro'::regrole) THEN
    RAISE EXCEPTION '166: claude_ro が他のロールのメンバーになっている';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'claude_ro' AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION '166: claude_ro の属性が想定と違う';
  END IF;
END $$;

COMMIT;
