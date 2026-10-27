-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の表の制約（主キー・外部キー・一意・CHECK・除外 等）。
-- 外部キーは参照先の表をスキーマつきで返す（auth.users 等）。NOT NULL（contype='n'、PostgreSQL 18 から pg_constraint に載る）は
-- 列の notNull と重なり、版の上げで写しが膨らむので除く。columns・references_columns は制約の列の名前（定義の順）。
-- 並びは表の名前、制約の名前（C の照合）
SELECT c.relname AS table_name,
       con.conname AS name,
       con.contype::text AS contype,
       pg_get_constraintdef(con.oid, true) AS definition,
       fn.nspname AS references_schema,
       fc.relname AS references_table,
       ARRAY(
         SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
         ORDER BY k.ord
       ) AS columns,
       CASE WHEN con.contype = 'f' THEN ARRAY(
         SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
         ORDER BY k.ord
       ) END AS references_columns
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
WHERE n.nspname = 'public'
  AND con.contype <> 'n'
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  )
ORDER BY c.relname COLLATE "C", con.conname COLLATE "C"
