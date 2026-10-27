-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の表の RLS のポリシー。roles の oid 0 は PUBLIC。
-- 並びは表の名前、ポリシーの名前（C の照合）
SELECT c.relname AS table_name,
       pol.polname AS name,
       pol.polcmd::text AS cmd,
       pol.polpermissive AS permissive,
       ARRAY(
         SELECT CASE WHEN r.oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r.oid)::text END
         FROM unnest(pol.polroles) AS r(oid)
         ORDER BY (CASE WHEN r.oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r.oid)::text END) COLLATE "C"
       ) AS roles,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  )
ORDER BY c.relname COLLATE "C", pol.polname COLLATE "C"
