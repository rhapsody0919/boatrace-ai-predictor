# ネタ駆動マルチチャネルパイプライン 環境変数セットアップ手順

Blog承認→PR自動マージ（ADR 0034）とYouTube承認→自動投稿（ADR 0035）に必要な環境変数の取得手順。いずれもユーザー自身のアカウント操作が必要なため、Claudeが代行できない。実際の値はこのファイルには記載しない（Vercel環境変数側で管理する）。

## GITHUB_MERGE_TOKEN（Blog承認用）

1. GitHubの [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new) を開く
2. Resource owner: `rhapsody0919`
3. Repository access: `Only select repositories` → `boatrace-ai-predictor` のみ選択
4. Permissions:
   - `Contents`: Read and write
   - `Pull requests`: Read and write
5. 有効期限を設定（推奨: 90日、期限が来たら再発行して環境変数を更新する運用）
6. 発行された値をVercelの環境変数 `GITHUB_MERGE_TOKEN` に設定する（Production/Preview両方）

## YouTube Data API v3（YouTube承認用）

1. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクト（または既存プロジェクト）を開く
2. 「APIとサービス」→「ライブラリ」から「YouTube Data API v3」を有効化する
3. 「APIとサービス」→「認証情報」→「OAuth同意画面」を設定する（外部、テストユーザーに投稿先チャンネルのGoogleアカウントを追加）
4. 「認証情報を作成」→「OAuthクライアントID」→アプリケーションの種類「デスクトップアプリ」で作成し、クライアントIDと発行された値を控える
5. リフレッシュ用の値を取得する（一度きりの手動フロー）:
   - [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) を開く
   - 右上の歯車アイコン→「Use your own OAuth credentials」にチェックし、4.で控えた値を入力
   - Step 1でスコープ `https://www.googleapis.com/auth/youtube.upload` を選択し認可（投稿先チャンネルのGoogleアカウントでログイン）
   - Step 2で「Exchange authorization code for tokens」を実行し、発行された値を控える
6. Vercelの環境変数に以下3つを設定する（Production/Preview両方）:
   - `YOUTUBE_CLIENT_ID`
   - `YOUTUBE_CLIENT_SECRET`
   - `YOUTUBE_REFRESH_TOKEN`

## 注意事項

- 5.で取得する値は同意を取り消す・長期間未使用等の理由で失効する場合がある。`publish-youtube.js`が取得エラーを返したら、手順5を再度実施する
- YouTube Data API v3にはクォータ制限がある（デフォルト1日10,000ユニット、動画アップロード1回あたり約1,600ユニット）。本パイプラインの想定頻度（1晩1本程度）なら十分な余裕がある
- ここで扱う値はいずれも管理画面の承認ボタンから直接実行される強い権限（PRマージ・動画公開）を持つため、`.env.local`にコミットしない、Vercelダッシュボード以外で共有しない
