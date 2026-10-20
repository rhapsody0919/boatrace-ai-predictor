# 環境変数一覧

| 変数 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase接続 |
| `SUPABASE_SERVICE_KEY` | Supabase管理者操作（`SUPABASE_SERVICE_ROLE_KEY`ではない。2026-09-12訂正、`scripts/lib/supabaseClient.js`が正） |
| `SUPABASE_RO_DB_URL` | 本番を読み取り専用ロール `claude_ro` で読む（`scripts/db/ro-query.js`、ADR-0096）。Session pooler・ユーザー名 `claude_ro.<project-ref>`。`.env.local` だけに置き、CI・Vercel には置かない。作り方は `docs/db-migration/166-runbook.md` |
| `VITE_SUPABASE_URL` | フロントエンド用Supabase |
| `VITE_SUPABASE_ANON_KEY` | フロントエンド用Supabaseキー |
| `VITE_GA_MEASUREMENT_ID` | Google Analytics |
| `LINEAR_API_KEY` | Linear連携 |
| `LINEAR_TEAM_ID` | LinearチームID |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Google のサービスアカウントの鍵ファイルのパス（GA4・Search Console のレポート。既定は `credentials/google-service-account.json`。`scripts/lib/googleServiceAuth.js`） |
| `GITHUB_MERGE_TOKEN` | **廃止（2026-10-20、ADR-0097）**。以前はブログ記事 Draft PR の自動マージ（sns-hub admin、Fine-grained PAT、ADR 0034）。失効と削除はオーナー（ADR-0034 の追記） |
| `YOUTUBE_CLIENT_ID` | YouTube Data API v3連携（ADR 0035） |
| `YOUTUBE_CLIENT_SECRET` | YouTube Data API v3連携（ADR 0035） |
| `YOUTUBE_REFRESH_TOKEN` | YouTube Data API v3連携、ユーザー自身のOAuth同意で取得（ADR 0035）。自動送信の公開の切り替え（`videos.update`）に `youtube` の scope が要る（sns-pdca-loop tasks 26） |
| `X_OAUTH_CLIENT_ID` | X の OAuth 2.0（PKCE）の Client ID。Production のみ（sns-pdca-loop、ADR 0093） |
| `X_OAUTH_CLIENT_SECRET` | X の OAuth 2.0 の Client Secret（confidential client）。Production のみ・Sensitive（ADR 0093） |
| `SNS_TOKEN_ENC_KEY` | X のトークンを DB（`sns_oauth_tokens`）に AES-256-GCM で暗号化する鍵（32バイトの base64）。Production のみ・Sensitive（ADR 0093） |

ローカルは `.env.local`、本番は Vercel環境変数で管理。
