# DB の読取専用ロールと権限検査

DB運用全般は [db-operations.md](db-operations.md)。書き方は [README.md](README.md)。

## 既存知見（db-operations.md から本文を変えず移動）
- Claude のセッションからの本番の読み取りは scripts/db/ro-query.js（ロール claude_ro、SELECT のみ・BYPASSRLS・READ ONLY で ROLLBACK）。Management API の database/query は自動モードの判定（[Production Reads]）で止まる（2026-10-19、ADR-0096、マイグレーション 166）
- ロールに付けた default_transaction_read_only は本人が SET で戻せるので守りにならない。書けないことは権限で保証する。PostgreSQL は関数の EXECUTE を既定で PUBLIC に渡すので、特定のロールから REVOKE しても PUBLIC 経由で呼べる（2026-10-19、ADR-0096）
- BYPASSRLS の無い読み取りロールは、RLS の付いた表をエラーでなく0行で返す。読み取り専用のロールを作ったら service_role と件数を比べる（2026-10-19、ADR-0096、166-runbook.md）
- Supabase の postgres は rolbypassrls=true・rolcreaterole=true・rolsuper=false（2026-10-19 本番の pg_roles）
- STABLE な SECURITY DEFINER の関数でも、中で VOLATILE な関数を呼べば所有者の権限で書ける。権限の検査で volatility を条件にしない（2026-10-19、system-architect、PGlite 18.3 で実証、166 の末尾の検査）
- has_table_privilege は列単位の GRANT を見ない。INSERT・UPDATE・REFERENCES・SELECT の権限の検査は has_any_column_privilege で行う（2026-10-19、PGlite で GRANT UPDATE (b) ... TO PUBLIC が見逃されるのを実証）
- PUBLIC に付いた権限は、擬似ロール名 'public' を has_*_privilege に渡すと、ロールを作る前に読み取りで確かめられる（2026-10-19、system-architect）
- pg-connection-string は接続文字列のクエリ（?user= や options=-c role=…）を URL のユーザー名より優先する。接続の前の URL の確認ではクエリも検査する（2026-10-19、pg 8.23.1、roQuery.js の checkRoUrl）
- ALTER DATABASE … SET で入れた設定（古い Supabase の app.settings.jwt_secret 等）は、接続できるロールなら誰でも current_setting で読める。読み取りのロールを足す前に確かめる（2026-10-19、system-architect、166 の検査）
- pg_db_role_setting の名前で秘密を判定すると、古い Supabase の app.settings.jwt_exp（JWT の有効期限の秒数）で誤検知する。正規表現はゆるめず、秘密でないと確かめた名前だけを完全一致の許可リストで除く（2026-10-19、本番で 166 を実行して検出、ADR-0096）

## 点検での見落としを防ぐ知見
- 読取CLIの行数上限は受信行数と表示行数を分け、SELECTのカーソル経路だけでなくEXPLAIN・SHOW等の直接実行経路も照合する。（2026-10-19、2026-10-19-review-20261019-07.md）
- 権限の事前検査を強化したらSQL・ADR・verifyとAPPLIEDの説明をそろえ、volatility限定などの古い検査条件を説明に残さない。（2026-10-19、2026-10-19-review-20261019-07.md）
- SQL権限ゲートはREVOKEの文字列の存在と実文を区別し、ドル引用内の文字列だけで権限取消し済みと扱わない。（2026-10-19、2026-10-19-review-20261019-09.md）
- SQLの表・ロールの照合は引用識別子の大小文字を保持し、ロール名を単語境界の部分一致で判定しない。別表・別ロールへのREVOKEを対象の取消しと誤認しない。（2026-10-19、2026-10-19-review-20261019-09.md）
- 控え除外マーカーはSQL全文の部分一致ではなく実際のコメントから読み、文字列内のマーカーで控え不足の停止を解除しない。（2026-10-19、2026-10-19-review-20261019-13.md）
