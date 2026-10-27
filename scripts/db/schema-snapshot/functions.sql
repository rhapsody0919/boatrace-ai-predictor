-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の関数。定義は pg_get_functiondef（SET search_path 等の設定を含む）。
-- 集約（prokind='a'）は pg_get_functiondef が受け付けないので定義を NULL にする。並びは名前、引数の型
SELECT p.proname AS name,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_result(p.oid) AS result,
       l.lanname AS language,
       p.prokind::text AS prokind,
       p.provolatile::text AS volatility,
       p.prosecdef AS security_definer,
       p.proconfig AS config,
       pg_get_userbyid(p.proowner) AS owner,
       md5(p.prosrc) AS prosrc_md5,
       CASE WHEN p.prokind <> 'a' THEN pg_get_functiondef(p.oid) END AS definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
