-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の表の RLS のポリシー。roles の oid 0 は PUBLIC。
-- 並びは表の名前、ポリシーの名前
SELECT c.relname AS table_name,
       pol.polname AS name,
       pol.polcmd::text AS cmd,
       pol.polpermissive AS permissive,
       ARRAY(
         SELECT CASE WHEN r.oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r.oid)::text END
         FROM unnest(pol.polroles) AS r(oid)
         ORDER BY 1
       ) AS roles,
       pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
FROM pg_catalog.pg_policy pol
JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, pol.polname
