# ADR 0034: Blog承認→PRマージの認証方式

## ステータス
置き換え済み（ADR-0097 で置き換え、2026-10-20）

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

## 追記（2026-10-20）: ADR-0097 で置き換え、PAT の道を止めた

BOA-908（オーナー yes 10/20 夕）で、ADR-0097（書き込みの身元を分ける方針）に合わせて、記事の PR も他の PR と同じ道（CI・4つのレビュー・マージの承認、`.claude/skills/orchestrate/SKILL.md` 段階0 F）でマージすることにした。強い書き込みの鍵（PAT）を Vercel の関数に置き、管理画面の操作でマージする道は使わない。

止めたもの:
- `api/admin/sns-hub/drafts/[id]/merge-blog-pr.js`: `GITHUB_MERGE_TOKEN` を読まず、GitHub にも DB にも触れずに 410 を返す（検査: `scripts/maintenance/verify-sns-existing-fixes.js`）
- `scripts/maintenance/finalize-blog-draft.js`（機械チェック合格で記事の PR を自動マージしていた）: 削除。`docs/operation/sns-pipeline-blog.md` の 6.5 を停止と書き換えた

残っているもの（2026-10-20 に名前だけ確認、値は読んでいない）:
- Vercel の Production に `GITHUB_MERGE_TOKEN` がある（48日前に設定）。Preview・Development には無い
- GitHub Actions の secret（リポジトリ・Environment）には、この PAT に当たる名前は無い
- `api/admin/sns-hub/drafts/[id]/blog-pr-preview.js`（管理画面の記事の PR のプレビュー、読み取り）が同じ鍵を読む。PAT を失効すると、このプレビューは「接続設定がありません」等のエラーになる。管理画面の記事の承認まわりの片付けは別の作業

オーナーの操作（この順で）:
1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens で、このリポジトリ用に作った PAT（`docs/operation/content-pipeline-token-setup-guide.md` の手順で作ったもの）を Revoke する
2. Vercel のプロジェクト boatrace-ai-predictor → Settings → Environment Variables で、`GITHUB_MERGE_TOKEN`（Production）を削除する
3. 次の本番デプロイの後、`POST /api/admin/sns-hub/drafts/<id>/merge-blog-pr` が管理画面の認証つきで 410 を返すことを確かめる（`scripts/maintenance/verify-sns-existing-fixes.js` でも固定している）。管理画面では、410 の文言は出ず「マージに失敗しました」になる。また、プレビュー（同じ鍵を読む）が失敗するので承認のボタンは押せなくなる。画面の片付けは BOA-918

PAT の見分け方: Fine-grained tokens の一覧で、Repository access が boatrace-ai-predictor だけ、権限が Contents と Pull requests の書き込みのもの。
