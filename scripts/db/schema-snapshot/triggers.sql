-- 本番スキーマの写し（scripts/db/schema-snapshot.js）: public の表のトリガー（内部のもの（外部キーの実装等）は除く）。
-- 送信・承認のガード（guard_sns_x_approval 等）がどの表のどの操作で動くかを持つ。並びは表の名前、トリガーの名前（C の照合）
SELECT c.relname AS table_name,
       t.tgname AS name,
       t.tgenabled::text AS enabled,
       pn.nspname AS function_schema,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS function_args,
       pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  )
ORDER BY c.relname COLLATE "C", t.tgname COLLATE "C"
