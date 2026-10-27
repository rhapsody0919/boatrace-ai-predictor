-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の表の索引。並びは表の名前、索引の名前
SELECT t.relname AS table_name,
       i.relname AS name,
       pg_get_indexdef(ix.indexrelid) AS definition,
       ix.indisunique AS is_unique,
       ix.indisprimary AS is_primary
FROM pg_catalog.pg_index ix
JOIN pg_catalog.pg_class i ON i.oid = ix.indexrelid
JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
ORDER BY t.relname, i.relname
