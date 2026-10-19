# ADR-0096: Claude のセッションの本番の読み取りは、専用の読み取り専用ロール claude_ro と scripts/db/ro-query.js で行う

- 状態: 提案中（2026-10-19。マイグレーション 166 の適用と settings.json の allow はオーナーの判断）
- 関連: [ADR-0069](./0069-query-error-propagation.md)（失敗がデータなしに化けない）、docs/operation/db-apply.md（書き込みの適用。Session pooler を使う理由）
- 書き込みの自動化（身元の分け方）は対象外。db-apply・guard-pr-merge は変えない

## 背景

オーナーが本番の SQL を毎回実行していて、ボトルネックになっている（2026-10-19 オーナー）。渡してきた SQL の多くは確認の SELECT だった。
Claude のセッションからの本番の読み取り（Management API の `database/query`、Supabase MCP）は、自動モードの判定（[Production Reads]）でよく止められる。
Management API のトークンも MCP も、権限としては書き込みができる経路で、判定に止められるのはそのためでもある。

## 決定

- Postgres に専用のロール `claude_ro` を作る（マイグレーション 166）
  - 付けるのは `public` の USAGE と、表・ビューの SELECT（今ある表と、postgres が今後作る表の既定権限）だけ
  - `BYPASSRLS` を付ける。付けないと RLS の付いた表がエラーでなく0行で返る（ADR-0069 と同じ型）
  - `sns_oauth_tokens`（X のトークンの暗号文）は読ませない
  - 接続は2本まで。ロールの既定で `statement_timeout=30s`・`default_transaction_read_only=on`。ただしこれらは本人が SET で戻せるので、守りの本体にしない
  - 書けないことは権限だけで保証する。166 の末尾の DO ブロックが、`claude_ro` が USAGE を持つ全スキーマについて、SELECT 以外の表の権限（列単位の GRANT を含む）・シーケンスの権限・`claude_ro` が呼べる SECURITY DEFINER 関数（PostgreSQL は既定で EXECUTE を PUBLIC に渡す。STABLE でも中で VOLATILE な関数を呼べば所有者の権限で書け、auth・vault も読めるので volatility を問わない）・CREATE できるスキーマ・データベース単位の設定の秘密らしい名前（`app.settings.jwt_secret` 等。誰でも `current_setting` で読める）・他のロールのメンバー・想定外の属性を調べ、1つでもあれば全体を戻す
  - パスワードはマイグレーションに書かない。`scripts/db/ro-setup.js` が乱数で作り、`.env.local` に書き、SQL Editor には SCRAM の検証子だけを渡す（平文が SQL Editor の履歴・ログに残らない）
- 鍵の置き場は本体の `.env.local` の `SUPABASE_RO_DB_URL`（Session pooler、ユーザー名 `claude_ro.<project-ref>`）。CI・Vercel には置かない
- 読むのは `scripts/db/ro-query.js` だけにする
  - 1文だけ・先頭は SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW
  - `BEGIN TRANSACTION READ ONLY` で開き、最後は必ず ROLLBACK
  - 接続したロールが `claude_ro` でなければ実行しない（URL のユーザー名も接続の前に確かめる）
  - 行はカーソルで上限（既定 200、最大 5000）＋1行だけ取り、打ち切りを表示する
- `.claude/settings.json` の allow に `Bash(node --env-file=.env.local scripts/db/ro-query.js *)` を足す。安全はロールの権限で担保し、自動モードの判定には頼らない

## 却下した選択肢

| 案 | 不適合 |
|---|---|
| `pg_read_all_data` を付ける | auth.users のメールアドレス・vault・storage まで読める |
| BYPASSRLS を付けず、表ごとに claude_ro 用の SELECT のポリシーを置く | 表を足すたびにポリシーが要り、書き忘れると0行に化ける（黙って間違う）。BYPASSRLS が付けられない版のときだけ使う（下の「付けられない場合」） |
| Management API のトークン・Supabase MCP のまま、判定の allow を広げる | トークン・MCP は書き込みができる経路で、判定の allow を広げると書き込みも通りうる。安全が判定の挙動に依存する |
| ロールの `default_transaction_read_only` だけで守る | 本人が `SET default_transaction_read_only = off` で戻せる |
| PUBLIC の EXECUTE を関数ごとに外して claude_ro を締め出す（166 の中で）。特定のロールからの REVOKE は PUBLIC 経由の EXECUTE を消さない | PUBLIC から外すと anon・authenticated が呼べなくなりうる。166 では検査だけをし、該当があれば止めて別のマイグレーションで影響を確かめて外す |
| psql を使う | 行数の上限が無く、メタコマンド（`\!` でシェル）を通しうる。手元に psql が無い |

## 付けられない場合

Supabase の `postgres` は `rolbypassrls=true`・`rolcreaterole=true`（2026-10-19 本番で確認）。PostgreSQL 16 以降は、BYPASSRLS を持つ CREATEROLE のロールが BYPASSRLS のロールを作れる。15 以前は superuser が要り、166 の CREATE ROLE が失敗して全体が戻る。そのときは、RLS の付いた表ごとに `CREATE POLICY … FOR SELECT TO claude_ro USING (true)` を置くマイグレーションに替え、作った後に service_role と件数を比べる。

## 設定に秘密らしい名前がある

データベース・全ロール向けの設定（`pg_db_role_setting`）は、接続できるロールなら誰でも `current_setting` で値を読める。166 は名前に jwt・secret・key・password・token を含む設定があれば止める（エラーには名前だけを出し、値は出さない）。

- 2026-10-19、オーナーが 166 を SQL Editor で実行したところ、`app.settings.jwt_exp` で止まった（全体が戻り、何も変わっていない）。これは古い Supabase が入れる JWT の有効期限の秒数で、秘密ではない。名前の正規表現による誤検知
- 対処は、秘密でないと確かめた名前だけを**完全一致の許可リスト**で除く形にした（今は `app.settings.jwt_exp` だけ）。正規表現はゆるめない。`app.settings.jwt_secret` や、`jwt_exp` で始まる別の名前は今までどおり止まる（verify-ro-query.js で固定）
- 許可リストに足すのは、値が秘密でないことを確かめた名前だけにする。値を読んで確かめる必要があるときは、オーナーが SQL Editor で確かめる（Claude には値を渡さない）

## 影響

- オーナーに渡す SQL から確認の SELECT が減る。書き込みは今までどおりオーナー（db-apply か SQL Editor）
- postgres が今後 `public` に作る表は、既定権限で自動で claude_ro から読める。秘密の値を入れる表を足すときは、同じマイグレーションで `REVOKE ALL ON <表> FROM claude_ro` を書く
- 113 より前に作られ PUBLIC が EXECUTE できる SECURITY DEFINER の関数は 166 が止める。今後 SECURITY DEFINER の関数は verify-migration-rls（規則7）で PUBLIC に付けられない。Supabase が作った関数（所有者 supabase_admin）が引っかかったときは postgres から REVOKE できないので、その関数のスキーマの USAGE を外せるか等を別に設計する
- `claude_ro` は直接接続なら自分のロールの設定（`ALTER ROLE claude_ro SET …`）とパスワードを変えられる（PostgreSQL の仕様）。アプリのデータは変わらない。ro-query.js は先頭の語で拒否する
- `analogy_feedback` の `comment`（利用者が書いた最大200字）と `client_key`（仮名の ID）は読める。秘密ではないが利用者の入力を含む
- 秘密の表を足すときの `REVOKE ... FROM claude_ro` は、verify-migration-rls（規則8）が 167 番以降のマイグレーションで検査する。`CREATE TABLE` と `ALTER TABLE ... ADD COLUMN`（public）の列名に token・secret・ciphertext・credential・password・passphrase・api_key（apikey）・private_key を含む表は、同じファイルに SELECT か ALL を表単位で外す `REVOKE ... ON <表> FROM claude_ro` か `-- ro-exempt: <表> <理由>` が無いと CI が落ちる。列単位の `REVOKE SELECT (列)` は数えない（表単位で付いた SELECT は外れない）。列名で拾うので、当たらない名前の列と、`CREATE TABLE ... AS`・`LIKE`・`PARTITION OF` で作る表、REVOKE の後の GRANT し直しは検査されない。166 より前の `sns_drafts.external_operation_token`（138、外部送信の排他用の uuid）と `sns_auto_send_items.stop_token_hash`（153、止めるリンクの token の SHA-256）は規則8に当たる名前だが、秘密の値ではないので claude_ro から読めるままにしている
- `claude_ro` は一時表・ラージオブジェクト・advisory lock を作れる（PostgreSQL の既定で PUBLIC に許される）。どれもアプリのデータを変えない。ro-query.js は READ ONLY のトランザクションなのでラージオブジェクトも作らない
- 証明書は検証しない（libpq の `sslmode=require` と同じ）。Supabase の CA は公開の CA でない
