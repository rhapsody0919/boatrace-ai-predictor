/**
 * verify-migration-rls.js の検査器の自己テストの入力（SQL と期待する errors・warnings の数）。verify ではない。
 */
export const MIGRATION_RLS_CASES = [
  {
    name: "RLS無しのCREATE TABLE",
    sql: "CREATE TABLE IF NOT EXISTS public.foo (id int);",
    errors: 1,
  },
  {
    name: "RLS有効＋SELECTポリシー＋GRANT SELECT",
    sql: `CREATE TABLE public.foo (id int);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
CREATE POLICY foo_read ON public.foo FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.foo TO anon, authenticated;`,
    errors: 0,
    warnings: 0,
  },
  {
    name: "anonへの書き込みGRANT",
    sql: `CREATE TABLE foo (id int); ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
GRANT ALL ON foo TO anon;`,
    errors: 1,
  },
  {
    name: "FOR ALL ポリシー（TO省略=public）",
    sql: `CREATE TABLE foo (id int); ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON foo FOR ALL USING (true);`,
    errors: 1,
  },
  {
    name: "GRANT SELECT の付け忘れは警告のみ",
    sql: `CREATE TABLE foo (id int); ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON foo FOR SELECT USING (true);`,
    errors: 0,
    warnings: 1,
  },
  {
    name: "security_invokerの無いビュー",
    sql: "CREATE OR REPLACE VIEW v_x AS SELECT 1;",
    errors: 1,
  },
  {
    name: "security_invoker付きビュー",
    sql: "CREATE VIEW v_x WITH (security_invoker = true) AS SELECT 1;",
    errors: 0,
  },
  {
    name: "除外マーカー付きのRLSなしテーブル",
    sql: "-- rls-exempt: foo 内部の一時集計。anon権限なし\nCREATE TABLE foo (id int);",
    errors: 0,
  },
  {
    name: "コメント内のCREATE TABLEは無視",
    sql: "-- CREATE TABLE foo (id int);\nSELECT 1;",
    errors: 0,
  },
  {
    name: "public以外のスキーマは対象外",
    sql: "CREATE TABLE internal.foo (id int);",
    errors: 0,
  },
  {
    name: "EXECUTEのGRANTは対象外",
    sql: "GRANT EXECUTE ON FUNCTION f() TO anon, authenticated;",
    errors: 0,
  },
  {
    name: "114番以降: GRANT/REVOKEの無い関数",
    sql: "CREATE OR REPLACE FUNCTION public.f(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    number: 114,
    errors: 1,
  },
  {
    name: "113番以前は関数の権限を検査しない",
    sql: "CREATE OR REPLACE FUNCTION public.f(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    number: 113,
    errors: 0,
  },
  {
    name: "114番以降: 匿名へのGRANT EXECUTEあり",
    sql: `CREATE FUNCTION f(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.f(int) TO anon, authenticated;`,
    number: 114,
    errors: 0,
  },
  {
    name: "114番以降: service_role限定（REVOKE＋GRANT）",
    sql: `CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.f() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.f() TO service_role;`,
    number: 114,
    errors: 0,
  },
  {
    name: "114番以降: SECURITY DEFINERを匿名に公開",
    sql: `CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.f() TO anon;`,
    number: 114,
    errors: 1,
  },
  {
    name: "114番以降: 本文の後ろに書いたSECURITY DEFINERも拾う",
    sql: `CREATE FUNCTION public.f() RETURNS int AS $fn$ SELECT 1 $fn$ LANGUAGE sql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.f() TO authenticated;`,
    number: 114,
    errors: 1,
  },
  {
    name: "114番以降: 単一引用の本文に ; があっても後ろのSECURITY DEFINERを拾う",
    sql: `CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS 'SELECT 1; SELECT 2' SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.f() TO anon;`,
    number: 114,
    errors: 1,
  },
  {
    name: "114番以降: 本文中の文字列 ON FUNCTION は数えない（ドル引用の中）",
    sql: `CREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $$ SELECT 'CREATE FUNCTION g()' $$;
GRANT EXECUTE ON FUNCTION public.f() TO anon;`,
    number: 114,
    errors: 0,
  },
  {
    name: "114番以降: 除外マーカー付き",
    sql: `-- function-exempt: f 既存関数の本文だけの差し替え。権限は既存のまま
CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`,
    number: 114,
    errors: 0,
  },
  {
    name: "167番以降: 秘密の列があり claude_ro からの REVOKE が無い",
    sql: `CREATE TABLE public.foo (id int, ciphertext text NOT NULL);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;`,
    number: 167,
    errors: 1,
  },
  {
    name: "166番以前は claude_ro の REVOKE を検査しない",
    sql: `CREATE TABLE public.foo (id int, ciphertext text NOT NULL);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;`,
    number: 166,
    errors: 0,
  },
  {
    name: "167番以降: REVOKE ALL ... FROM claude_ro あり",
    sql: `CREATE TABLE public.foo (id int, refresh_token text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.foo FROM claude_ro;`,
    number: 167,
    errors: 0,
  },
  {
    name: "167番以降: 複数の表をまとめた REVOKE（154 と同じ形）",
    sql: `CREATE TABLE public.foo (id int, api_key text);
CREATE TABLE public.bar (id int, "Password" text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.foo, public.bar FROM anon, authenticated, claude_ro;`,
    number: 167,
    errors: 0,
  },
  {
    name: "167番以降: anon からの REVOKE だけでは足りない",
    sql: `CREATE TABLE public.foo (id int, client_secret text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.foo FROM anon, authenticated;`,
    number: 167,
    errors: 1,
  },
  {
    name: "167番以降: SELECT を外さない REVOKE（INSERT のみ）では足りない",
    sql: `CREATE TABLE public.foo (id int, api_key text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
REVOKE INSERT ON public.foo FROM claude_ro;`,
    number: 167,
    errors: 1,
  },
  {
    name: "167番以降: REVOKE GRANT OPTION FOR SELECT では足りない",
    sql: `CREATE TABLE public.foo (id int, api_key text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
REVOKE GRANT OPTION FOR SELECT ON public.foo FROM claude_ro;`,
    number: 167,
    errors: 1,
  },
  {
    name: "167番以降: 列単位の REVOKE SELECT (列) では足りない",
    sql: `CREATE TABLE public.foo (id int, api_key text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
REVOKE SELECT (api_key) ON public.foo FROM claude_ro;`,
    number: 167,
    errors: 1,
  },
  {
    name: "167番以降: 既存の表に ADD COLUMN で足す秘密の列",
    sql: `ALTER TABLE public.foo ADD COLUMN IF NOT EXISTS note text, ADD COLUMN apikey text;`,
    number: 167,
    errors: 1,
  },
  {
    name: "167番以降: ADD CONSTRAINT は列として数えない",
    sql: `ALTER TABLE public.foo ADD CONSTRAINT foo_token_uq UNIQUE (id);`,
    number: 167,
    errors: 0,
  },
  {
    name: '167番以降: 引用符付きの "public"."foo" への REVOKE も一致する',
    sql: `CREATE TABLE public.foo (id int, private_key text);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."foo" FROM claude_ro;`,
    number: 167,
    errors: 0,
  },
  {
    name: "167番以降: 秘密の列が無い表は対象外（制約名・既定値の文字列は列名として数えない）",
    sql: `CREATE TABLE public.foo (id int, note text DEFAULT 'token(', CONSTRAINT foo_secret_ck CHECK (id > 0));
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;`,
    number: 167,
    errors: 0,
  },
  {
    name: "167番以降: 除外の印付き",
    sql: `-- ro-exempt: foo token_count は件数で、秘密の値ではない
CREATE TABLE public.foo (id int, token_count int);
ALTER TABLE public.foo ENABLE ROW LEVEL SECURITY;`,
    number: 167,
    errors: 0,
  },
];
