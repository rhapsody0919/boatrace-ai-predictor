-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の表・ビュー・シーケンス・列・関数の権限と、
-- 既定の権限（ALTER DEFAULT PRIVILEGES）。aclexplode で開き、(対象, 受け手) ごとに権限をまとめる。
-- ACL が NULL のときは acldefault（所有者の既定。関数は PUBLIC の EXECUTE を含む）を開く。受け手の oid 0 は PUBLIC。
-- 付与者（grantor）は落とし、同じ権限は DISTINCT で1つにする。並びは対象の種類、名前、引数の型、受け手（C の照合）
WITH rel AS (
  SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    )
),
items AS (
  SELECT CASE WHEN r.relkind = 'S' THEN 'sequence' ELSE 'relation' END AS object_type,
         r.relname::text AS name,
         NULL::text AS identity_args,
         a.grantee,
         a.privilege_type,
         a.is_grantable
  FROM rel r,
       LATERAL aclexplode(COALESCE(r.relacl, acldefault((CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END)::"char", r.relowner))) a
  UNION ALL
  SELECT 'column', r.relname::text || '.' || att.attname::text, NULL, a.grantee, a.privilege_type, a.is_grantable
  FROM rel r
  JOIN pg_catalog.pg_attribute att
    ON att.attrelid = r.oid AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL,
       LATERAL aclexplode(att.attacl) a
  UNION ALL
  SELECT 'function', p.proname::text, pg_get_function_identity_arguments(p.oid), a.grantee, a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
       LATERAL aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) a
  WHERE n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend d
      WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    )
  UNION ALL
  -- 既定の権限: スキーマ public のもの（足すだけ）と、IN SCHEMA なしの全体のもの（作りつけの既定を置き換える）
  SELECT 'default:' || CASE WHEN da.defaclnamespace = 0 THEN 'global' ELSE 'public' END || ':' || da.defaclobjtype::text,
         pg_get_userbyid(da.defaclrole)::text, NULL, a.grantee, a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_default_acl da
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid = da.defaclnamespace,
       LATERAL aclexplode(da.defaclacl) a
  WHERE da.defaclnamespace = 0 OR n.nspname = 'public'
)
SELECT object_type,
       name,
       identity_args,
       CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee)::text END AS grantee,
       array_agg(DISTINCT privilege_type ORDER BY privilege_type) AS privileges,
       array_agg(DISTINCT privilege_type ORDER BY privilege_type) FILTER (WHERE is_grantable) AS grantable
FROM items
GROUP BY object_type, name, identity_args, grantee
ORDER BY object_type COLLATE "C", name COLLATE "C", identity_args COLLATE "C" NULLS FIRST,
         (CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee)::text END) COLLATE "C"
