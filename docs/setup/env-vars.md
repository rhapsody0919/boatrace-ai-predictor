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
| `INTERNAL_API_KEY` | 自分の処理が `/api` を呼ぶときの合言葉（ヘッダ `x-ryujin-internal-key`、BOA-1110・ADR-0103）。値は1つで、Vercel の Production・Preview と GitHub の environment `prod-jobs` の secret に同じ値を置く（2026-11-03 オーナー決定）。Mac の龍神のスクリプト（全貌動画の `daily.mjs`・`fetch-materials.mjs`、`scripts/analysis/*`）は `.env.local` から読む。hq は hq の置き場。付ける側は `api/_lib/internalApiHeaders.js`、付け忘れは `verify-internal-api-callers.js`（CI）が止める。無いときは合言葉を付けないだけ（関門が enforce になると 403） |
| `INTERNAL_API_KEY_NEXT` | 合言葉の回し替えのときだけ置く次の値（関門は `INTERNAL_API_KEY` と両方を受け付ける。手順は `docs/design/public-api-lockdown/plan.md` §2.2）。ふだんは置かない |
| `API_GATE_MODE` | `/api` の関門の段階。`observe`（既定。拒む候補をログに出すだけ）／`enforce`（403）。Vercel の環境変数で、変えたら Redeploy が要る（ADR-0103、plan §2.2・§4 の段階3・4）。段階3（middleware の matcher に `/api/:path*`）から読まれる。値の前後の空白・改行は落とす（`enforce` 以外は観測）。`INTERNAL_API_KEY`・`INTERNAL_API_KEY_NEXT` も関門の側で前後の空白・改行を落として比べる |

ローカルは `.env.local`、本番は Vercel環境変数で管理。
