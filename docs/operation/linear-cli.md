# Linear CLI（scripts/linear-cli.js）の運用

Linear MCP の認証が切れたときのフォールバックとして使う CLI（`.claude/CLAUDE.md`「Linear MCPが認証切れの場合」）。

```bash
node --env-file=.env.local scripts/linear-cli.js get BOA-123
node --env-file=.env.local scripts/linear-cli.js update BOA-123 "Done" "PR #999 でマージ済み"
node --env-file=.env.local scripts/linear-cli.js create "タイトル" "説明"
node --env-file=.env.local scripts/linear-cli.js comment BOA-123 "コメント"
node --env-file=.env.local scripts/linear-cli.js list "" 250
```

## 完了したチケットはアーカイブする（2026-10-02〜）

Linear の無料枠の上限は**アーカイブしていないチケットの数**で数えられる（約250件）。上限に当たると新規起票が `USAGE_LIMIT_EXCEEDED` で止まる（2026-09-28・10-02 に発生）。そのため、完了したチケットはアーカイブする運用にした（ユーザー決定）。

- `update` で状態を変え、変更後の**状態の種類（`state.type`）が `completed`・`canceled`** なら、コメントを付けた後に続けて `issueArchive` を呼ぶ。Done・Canceled・Duplicate（Duplicate の種類は canceled）が当たる
- 状態の**名前では判定しない**（名前はチームで変えられる）
- アーカイブ済みのチケットも `get` で引ける。`list` は既定でアーカイブ済みを含めない

## 失敗は終了コード1で返る

`create`・`update`（状態変更・コメント・アーカイブ）・`comment` の失敗は、すべて終了コード1で返し、標準エラーに Linear のエラーコード（例 `USAGE_LIMIT_EXCEEDED`）を出す。

**パイプに通すと終了コードが隠れる。** `... | tail -3` や `... 2>&1 | grep ID` の終了コードは最後のコマンドのもので、CLI が失敗しても 0 になる。起票の成否を判断するときは、パイプを通さずに終了コードを見るか、作成後に `get`・`list` で実在を確かめる（2026-09-28 に「起票できた」と思いかけたのはこの見え方による）。

## 注意: 状態名が一致しないとき

`update` の状態名は完全一致（大文字小文字は無視）で引く。一致しないと「進行中」相当（種類 `started` の最初の状態）に変わる既存の挙動がある。状態名を推測で決め打ちしない。

## 検査

`scripts/maintenance/verify-linear-cli.js`（CI の `npm run verify:ci` に含まれる）が、ローカルの模擬サーバーに向けて CLI を起動し、終了コードとアーカイブの呼び出しを確かめる。CLI の接続先は環境変数 `LINEAR_API_URL` で差し替えられる（既定は本番の `https://api.linear.app/graphql`）。
