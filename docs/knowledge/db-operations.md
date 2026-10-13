# ADR と本番 DB の運用

設計の決定（ADR）と番号、本番 DB への書き込みの手順、Supabase の読み方。書き方は [README.md](README.md)。

## ADR と番号
- 決定の正本は docs/adr/。新しい設計は既存の ADR と矛盾しないかを先に確かめ、変えるなら ADR を足すか追記する（docs/adr/、AGENTS.md）
- ADR の番号は並行セッションで重複しやすい。足したら npm run verify:adr-numbers（次の番号も出る）（2026-09-12 に8組15件を振り直し、memory technical_adr_number_collisions）
- マイグレーションの番号は並行するレーンで重なりうる。着手時にオーケストレーターに番号を取ってもらい、PR 作成前に origin/master の最新番号と比べる（2026-10-11、オーケストレーター依頼）
- 新しいマイグレーションの番号は origin/master の最大番号より大きくないと verify-migration-numbers が CI で落とす。予約した番号でも、master が先に進んでいたら使えない（2026-10-13、BOA-822 の 149〜151 を 155〜157 に付け替え）

## 本番 DB への書き込み
- Claude 側から本番に書けない。Supabase MCP は --read-only 固定、service key のスクリプトは auto mode が拒否する。迂回しない（2026-09-25、memory technical_supabase_write_blocked_both_routes）
- 書き込み（マイグレーション本体等）はオーナーが Supabase Dashboard の SQL Editor で実行する。チャットに1ブロック=1回の実行で渡し、確認の SELECT は Claude が読み取り MCP で行う（2026-09-30 ユーザー指示、memory feedback_prod_sql_user_runs_writes_only）
- SQL Editor は最後の文の結果しか出さない。BEGIN〜ROLLBACK 型の確認は渡さない（2026-09-30、同 memory）
- 「適用済み」はそのマイグレーションだけが持つ差分で確かめる。他の版も入れるキーを見ても区別できない（063/068 の取り違え、memory migration_applied_check_needs_discriminating_observation）
- CREATE OR REPLACE FUNCTION は古い定義を土台にすると、後のマイグレーションが足したキーを黙って消す。適用後に scripts/maintenance/verify-rpc-output-keys.js を実行する（BOA-363・BOA-431、ADR-0074 で PR 時の検査あり、.claude/CLAUDE.md）
- PostgREST のバルク upsert はキーの集合が違う行を混ぜると、その列を持たない行に NULL を書く。scripts/lib/unchangedRows.js の diffRows で列をそろえる（2026-09-27 に1,729行が NULL、PR #870、memory technical_postgrest_bulk_upsert_nulls_missing_keys）
- 外部キー・制約の確認は pg_constraint で行う。information_schema の多段 JOIN は黙って0行を返す（races を参照する FK は18本、memory technical_pg_constraint_not_information_schema_for_fks）
- PK のリネーム等は全種類の制約（FK・UNIQUE・CHECK 等）を洗い、1件で先に試す（ユーザー指摘、memory feedback_pk_migration_verify_all_constraints_and_single_row_test）
- 既存の RPC の本文だけを差し替えるマイグレーションも、114番以降は関数ごとに GRANT/REVOKE か `-- function-exempt` を書かないと verify:migration-rls で CI が落ちる（2026-10-13、BOA-822 の 157、scripts/maintenance/verify-migration-rls.js:340）
- RPC の本文の md5（`AS $$`〜`$$;` の間）は、ファイルから計算した値と本番の md5(prosrc) が一致する。109 の2関数 5d0ff6d8…・a5c39f55…、110 は 8f6cf80c…（2026-10-13 本番で確認、157 の適用前の確認用）
- 日ごとの集計表を「直近N日の upsert」で直すと、件数が0になったセルが残る（CHECK n>0 で0の行を書けず、upsert は行を消さない）。computed_at を全行の payload に入れて upsert し、窓の中の古い computed_at の行を後で消す（更新では DEFAULT が効かない）（2026-10-13、system-architect、BOA-822 の 155）
- races-init の後始末が unified を作り直すのは「unified の行が無いレース」があるときだけ。朝の生成で値を null にして続行すると、一時的な失敗でもその日は戻らない（2026-10-13、scripts/lib/racesInit/job.js:139-150）

## 画面からの読み取り
- 画面から Supabase を読むのは src/services/supabaseClient.js の1つの入口だけ。.throwOnError() が既定で、失敗を「データなし」に化けさせない（BOA-359、.claude/rules/frontend-data-fetch.md）
- Supabase の上限1000行はエラーにならず切り捨てる。1000行を超えうるクエリは .range() のヘルパを使う（BOA-301・BOA-372、.claude/rules/frontend-data-fetch.md）
- PostgREST は GROUP BY が使えないので、日ごとの小さな表を JS で合計すると、エラーにならないまま1000行で切れる。合計は RPC で行う（2026-10-12、BOA-822、docs/design/in-collapse-caution/architecture-y.md）
- 既存のキーの意味を変えて使い回すと verify-rpc-key-regression は通ってしまう（値の変化は検知しない）。意味が変わるなら新しいキーを足し、古いキーは NULL になるに任せる（2026-10-12、ADR-0074「限界」、同 architecture-y.md）
- 小数2桁の値（勝率など）の差で帯を切るときは 1/100 の整数で計算する。浮動小数では 6.10−5.60 が 0.4999… で帯が1つずれる（2026-10-12、同 architecture-y.md）
- 朝の unified の予想は、欠けたレースがあると日全体を作り直すことがある（scripts/lib/racesInit/job.js:25）。予想が読む入力の表は開催時間外に更新する（2026-10-12、同 architecture-y.md）
- 予想を作るときの「前日まで」はレースの日付で読む（race_date < 対象日）。「最新まで」で読むと過去の日を作り直したときに結果が混ざる（2026-10-12、BOA-628 と同じ系統、同 architecture-y.md）

## SNS の送信
- SNS の送信を止めるのは許可のリスト（自動送信の job は item が notified かつ mode が自動のときだけ進める）にし、claim・check・begin_post・youtube_publish_begin の全部で見る。拒否のリストや下書きの状態の変更だけでは、送信中・要照合で 148 のガードが RAISE し止まらない（2026-10-12、system-architect、docs/design/sns-pdca-loop/plan.md §3）
- v0 素材の公開保留は5か所にある: sns_bundle_imports の CHECK、取り込みの関数、版×媒体×言語の一意索引、approve の bundle_import_id、transition_sns_send_139・youtube_call_guard の bundle_import_id。外すなら全部を変える（2026-10-12、135:8,26,89・139:137・146:174）
- 送信の契約は、毎日 daily_baseline_date（JST）と YouTube の baseline_day（PT）を当日にしないと claim できない（2026-10-12、139:144・146:143）
- PostgREST の upsert は式の一意索引（COALESCE）を on_conflict に使えない。NULL を含むキーは UNIQUE NULLS NOT DISTINCT の制約にする（本番は PG 17.6、2026-10-12）
- findQualifyingRaces は standard と unified のうち predicted_at の新しい方の1行を使う。unified にしか無いキーを条件にすると黙って0件になる（2026-10-13、system-architect、scripts/lib/snsCampaigns.js:141-158）
