# ADR 0034: Blog承認→PRマージの認証方式

## ステータス
採用

## 背景
管理画面の「承認」ボタン押下で、Routineが作成したブログ記事のDraft PRを実際にGitHub API経由でマージする（spec.md FR6）。GitHubへの書き込み権限を持つトークンをVercel側のサーバー関数（`api/admin/sns-hub/merge-blog-pr.js`）に持たせる必要がある。

## 決定
Personal Access Token（Fine-grained PAT）を使う。対象リポジトリ（`rhapsody0919/boatrace-ai-predictor`）のみに限定し、権限は`Contents: Read/Write`・`Pull requests: Read/Write`のみに絞る。Vercel環境変数`GITHUB_MERGE_TOKEN`として設定する。

エンドポイント自体は`middleware.js`の既存matcher（`/api/admin/sns-hub/:path*`）でBasic認証済みのため、追加の認証実装は不要（既存インフラの再利用）。

## 却下した選択肢
**GitHub Appを新規作成する案**: 権限をより細かく制御でき、監査ログも取りやすいという利点はあるが、Appの作成・インストール・秘密鍵管理・JWT署名によるトークン取得というセットアップコストが、今回の用途（1リポジトリ・1操作のみ）に対して過剰。将来的に複数リポジトリ・複数操作に広がる見込みが立った時点で再検討する。

**GitHub Actions経由でマージする案**（管理画面からGitHub Actionsをworkflow_dispatchで起動し、Actions側でマージ）: 承認操作からマージ完了までのフィードバック（成功/失敗）が非同期になり、管理画面のUXとして「承認したのに反映されているか分からない」状態が発生しやすい。直接API呼び出しの方が同期的でシンプル。

## 影響
- Fine-grained PATは有効期限を設定できるため、定期的なローテーションが運用上必要になる（`docs/operation/`に手順を残す）
- トークン漏洩時の影響範囲は当該リポジトリのcontents/pull requests権限に限定される（fine-grainedのため、他リポジトリやアカウント全体には影響しない）
- 既存の環境変数管理表（`.claude/CLAUDE.md`）に`GITHUB_MERGE_TOKEN`を追記する
