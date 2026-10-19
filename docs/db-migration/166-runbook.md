# 166 の適用手順（読み取り専用ロール claude_ro）

設計は [ADR-0096](../adr/0096-claude-ro-readonly-role.md)。オーナーの作業は手順 1・2 の2回。確認（手順 3）は Claude が ro-query.js で行う。

## 1. 適用（オーナー）

`166_claude_ro_readonly_role.sql` を db-apply（1タップ）か SQL Editor でそのまま1回実行する。

- 適用前の確認は SQL の末尾の DO ブロックが行う。書き込みの経路が見つかれば、例外で全体が戻り、何も変わらない。
  そのときはエラーの文（`166: …`）をそのまま Claude に渡す
  - `claude_ro が書き込みうる SECURITY DEFINER 関数を呼べる: …` → 並んだ関数の PUBLIC の EXECUTE を外すマイグレーションを先に作る
  - `CREATE ROLE` が `permission denied to … BYPASSRLS` で失敗 → BYPASSRLS の代わりに表ごとの SELECT のポリシーにする（ADR-0096「付けられない場合」）
- パスワードはまだ無いので、この時点では誰もログインできない

## 2. パスワードと接続文字列（オーナー）

1. Supabase Dashboard の **Connect** > **Session pooler** で、ホスト名（`aws-0-<region>.pooler.supabase.com`）を確かめる
2. 本体の作業ツリーで次を実行する（Node 20.16 以降）

   ```bash
   node --env-file=.env.local scripts/db/ro-setup.js --pooler-host aws-0-<region>.pooler.supabase.com
   ```

   - 乱数のパスワードを作り、`.env.local` に `SUPABASE_RO_DB_URL` を書く（本体と、今の作業ツリーにあればそこ）。パスワードは画面に出ない
   - 最後に `ALTER ROLE claude_ro PASSWORD 'SCRAM-SHA-256$4096:…';` を1行出す。中身は検証子だけで、平文のパスワードは含まない
3. 出た1行を SQL Editor で実行する

パスワードを入れ替えるときは `--force` を付けて 2 をやり直す（古い接続文字列は使えなくなる）。

## 3. 適用後の確認（Claude が ro-query.js で実行）

```bash
node --env-file=.env.local scripts/db/ro-query.js "SELECT current_user, current_setting('transaction_read_only') ro, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) bypassrls, (SELECT rolconnlimit FROM pg_roles WHERE rolname = current_user) connlimit, has_table_privilege('public.sns_oauth_tokens', 'SELECT') tokens, (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') AND NOT has_table_privilege(c.oid, 'SELECT')) unreadable"
```

期待: `claude_ro` / `on` / `true` / `2` / `false` / `1`（読めないのは sns_oauth_tokens の1つだけ）。
`unreadable` が 1 より多ければ、postgres 以外が所有する表がある（166 の GRANT が効かない）。どの表かを出して ADR-0096 に追記する。

RLS が効いていないこと（0行に化けないこと）は、RLS の付いた表の件数を service_role と比べて確かめる。

```bash
node --env-file=.env.local scripts/db/ro-query.js "SELECT (SELECT count(*) FROM races) races, (SELECT count(*) FROM race_entries) race_entries, (SELECT count(*) FROM sns_drafts) sns_drafts"
```

同じ3つを service_role（`SUPABASE_SERVICE_KEY` の PostgREST、`Prefer: count=exact`）で数え、一致すること。確かめたら APPLIED.md の 166 を「適用済み」にする。

## 戻し方

SQL Editor で次を実行する。`.env.local` の `SUPABASE_RO_DB_URL` の行も消す。

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM claude_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM claude_ro;
REVOKE USAGE ON SCHEMA public FROM claude_ro;
DROP ROLE claude_ro;
```
