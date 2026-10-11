# 龍神レーダー 設計・本番DBの知見ノート（アーキテクト役が最初に読む）
1行1知見、出典つき。アーキテクト役（.claude/agents/system-architect.md）が最初に読み、答えの最後に出した「足す行」を依頼元が書き足す。古くなった行は消さずに「（廃止 日付 理由）」を付ける

## ADR
- 決定の正本は docs/adr/。新しい設計は既存の ADR と矛盾しないかを先に確かめ、変えるなら ADR を足すか追記する（docs/adr/、AGENTS.md）
- ADR の番号は並行セッションで重複しやすい。足したら npm run verify:adr-numbers（次の番号も出る）（memory technical_adr_number_collisions、2026-09-12 に8組15件を振り直し）

## 本番DB の操作
- Claude 側から本番に書けない。Supabase MCP は --read-only 固定、service key のスクリプトは auto mode が拒否する。迂回しない（memory technical_supabase_write_blocked_both_routes、2026-09-25）
- 書き込み（マイグレーション本体等）はオーナーが Supabase Dashboard の SQL Editor で実行する。チャットに1ブロック=1回の実行で渡し、確認の SELECT は Claude が読み取り MCP で行う（memory feedback_prod_sql_user_runs_writes_only、2026-09-30）
- SQL Editor は最後の文の結果しか出さない。BEGIN〜ROLLBACK 型の確認は渡さない（同上）
- 「適用済み」はそのマイグレーションだけが持つ差分で確かめる。他の版も入れるキーを見ても区別できない（memory migration_applied_check_needs_discriminating_observation、063/068 の取り違え）
- CREATE OR REPLACE FUNCTION は古い定義を土台にすると、後のマイグレーションが足したキーを黙って消す。適用後に scripts/maintenance/verify-rpc-output-keys.js を実行する（.claude/CLAUDE.md、BOA-363・BOA-431、ADR-0074 で PR 時の検査あり）
- PostgREST のバルク upsert はキーの集合が違う行を混ぜると、その列を持たない行に NULL を書く。scripts/lib/unchangedRows.js の diffRows で列をそろえる（memory technical_postgrest_bulk_upsert_nulls_missing_keys、2026-09-27 に1,729行が NULL、PR #870）
- 外部キー・制約の確認は pg_constraint で行う。information_schema の多段 JOIN は黙って0行を返す（memory technical_pg_constraint_not_information_schema_for_fks、races を参照する FK は18本）
- PK のリネーム等は全種類の制約を洗い、1件で先に試す（memory feedback_pk_migration_verify_all_constraints_and_single_row_test）
- 画面から Supabase を読むのは src/services/supabaseClient.js の1つの入口だけ。.throwOnError() が既定で、失敗を「データなし」に化けさせない（.claude/rules/frontend-data-fetch.md、BOA-359）
- Supabase の上限1000行はエラーにならず切り捨てる。1000行を超えうるクエリは .range() のヘルパを使う（.claude/rules/frontend-data-fetch.md、BOA-301・BOA-372）

## マイグレーション番号
- マイグレーションの番号は並行するレーンで重なりうる。着手時にオーケストレーターに番号を取ってもらい、PR 作成前に origin/master の最新番号と比べる（Orchestrate 2026-10-11 依頼）
