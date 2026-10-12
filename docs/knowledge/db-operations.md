# ADR と本番 DB の運用

設計の決定（ADR）と番号、本番 DB への書き込みの手順、Supabase の読み方。書き方は [README.md](README.md)。

## ADR と番号
- 決定の正本は docs/adr/。新しい設計は既存の ADR と矛盾しないかを先に確かめ、変えるなら ADR を足すか追記する（docs/adr/、AGENTS.md）
- ADR の番号は並行セッションで重複しやすい。足したら npm run verify:adr-numbers（次の番号も出る）（2026-09-12 に8組15件を振り直し、memory technical_adr_number_collisions）
- マイグレーションの番号は並行するレーンで重なりうる。着手時にオーケストレーターに番号を取ってもらい、PR 作成前に origin/master の最新番号と比べる（2026-10-11、オーケストレーター依頼）

## 本番 DB への書き込み
- Claude 側から本番に書けない。Supabase MCP は --read-only 固定、service key のスクリプトは auto mode が拒否する。迂回しない（2026-09-25、memory technical_supabase_write_blocked_both_routes）
- 書き込み（マイグレーション本体等）はオーナーが Supabase Dashboard の SQL Editor で実行する。チャットに1ブロック=1回の実行で渡し、確認の SELECT は Claude が読み取り MCP で行う（2026-09-30 ユーザー指示、memory feedback_prod_sql_user_runs_writes_only）
- SQL Editor は最後の文の結果しか出さない。BEGIN〜ROLLBACK 型の確認は渡さない（2026-09-30、同 memory）
- 「適用済み」はそのマイグレーションだけが持つ差分で確かめる。他の版も入れるキーを見ても区別できない（063/068 の取り違え、memory migration_applied_check_needs_discriminating_observation）
- CREATE OR REPLACE FUNCTION は古い定義を土台にすると、後のマイグレーションが足したキーを黙って消す。適用後に scripts/maintenance/verify-rpc-output-keys.js を実行する（BOA-363・BOA-431、ADR-0074 で PR 時の検査あり、.claude/CLAUDE.md）
- PostgREST のバルク upsert はキーの集合が違う行を混ぜると、その列を持たない行に NULL を書く。scripts/lib/unchangedRows.js の diffRows で列をそろえる（2026-09-27 に1,729行が NULL、PR #870、memory technical_postgrest_bulk_upsert_nulls_missing_keys）
- 外部キー・制約の確認は pg_constraint で行う。information_schema の多段 JOIN は黙って0行を返す（races を参照する FK は18本、memory technical_pg_constraint_not_information_schema_for_fks）
- PK のリネーム等は全種類の制約（FK・UNIQUE・CHECK 等）を洗い、1件で先に試す（ユーザー指摘、memory feedback_pk_migration_verify_all_constraints_and_single_row_test）

## 画面からの読み取り
- 画面から Supabase を読むのは src/services/supabaseClient.js の1つの入口だけ。.throwOnError() が既定で、失敗を「データなし」に化けさせない（BOA-359、.claude/rules/frontend-data-fetch.md）
- Supabase の上限1000行はエラーにならず切り捨てる。1000行を超えうるクエリは .range() のヘルパを使う（BOA-301・BOA-372、.claude/rules/frontend-data-fetch.md）
