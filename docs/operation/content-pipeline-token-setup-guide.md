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

## YouTube Analytics（読み取り専用、龍神ソナーの反応の計測）

チャンネルの分析データ（動画ごとの日別の再生数・視聴時間・登録者の増減など）を、hq の週1回のまとめに取り込むためのトークン。上の `YOUTUBE_REFRESH_TOKEN` は投稿用（`youtube.upload`）で、分析データは読めない。投稿用のトークンには触らず、**読み取り専用のトークンを別に1本取る**。読み取り専用なので、万一漏れても動画の投稿・削除はできない。

PC のブラウザで行う（スマホでは Playground の操作が難しい）。所要15分ほど。

### 値を誰にも見せない

- 手順の中で出る「クライアント シークレット」と「Refresh token」は、チャット・Slack・スクリーンショット・画面共有に出さない。Claude にも貼らない
- 置き場所は下の手順 D の `.env.local` だけ。このファイルは git に入らない（`.gitignore` の `.env*.local`）
- 作業中に誤って貼ってしまったら、Google アカウントの「サードパーティ製のアプリとサービス」で該当アプリへのアクセスを削除し、手順 C からやり直す

### A. YouTube Analytics API を有効にする

1. https://console.cloud.google.com/ を開く。右上のアカウントが、投稿用の OAuth クライアントを作ったアカウントか確かめる（違えばアイコンから切り替える）
2. 上部のプロジェクト選択で、投稿用（`YOUTUBE_CLIENT_ID`）と同じプロジェクトを選ぶ
3. 左メニュー「API とサービス」→「ライブラリ」
4. 検索欄に `YouTube Analytics API` と入れ、出てきた「YouTube Analytics API」を押す
5. 青いボタン「有効にする」を押す（すでに「管理」と出ていれば有効なので次へ）

### B. 同意画面を「本番環境」にする

「テスト」のままだと、取ったトークンが7日で切れる。

1. 左メニュー「API とサービス」→「OAuth 同意画面」（新しい画面では「Google Auth Platform」→「対象」）
2. 「公開ステータス」が「テスト」なら、「アプリを公開」→ 確認画面で「確認」を押す
3. 「本番環境」と出れば完了。Google の審査は申請しなくてよい（自分のアカウントだけで使う。認可のときに「このアプリは Google で確認されていません」と出るが、手順 C-6 で進める）

### C. トークンを取る（OAuth 2.0 Playground）

1. https://developers.google.com/oauthplayground/ を開く
2. 右上の歯車を押し、「Use your own OAuth credentials」にチェックを入れる
3. 「OAuth Client ID」と「OAuth Client secret」に、投稿用と同じウェブ アプリケーション型のクライアントの値を入れる（Cloud Console「API とサービス」→「認証情報」で確認。デスクトップ型ではない方。Playground はページを再読み込みするとこの入力が消えるので、再読み込みしたら入れ直す）
4. 左の「Step 1」の一番下の入力欄「Input your own scopes」に、次の2つを半角スペース区切りで入れる
   ```
   https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly
   ```
5. 青いボタン「Authorize APIs」を押す
6. Google のログイン画面で、**YouTube チャンネルを持っているアカウント**を選ぶ。「このアプリは Google で確認されていません」と出たら「詳細」→「（アプリ名）（安全ではないページ）に移動」→ 2つの権限（YouTube Analytics の閲覧・YouTube アカウントの表示）を許可して「続行」
7. Playground に戻ると「Step 2」が開いている。青いボタン「Exchange authorization code for tokens」を押す
8. 「Refresh token」の欄に出た値をコピーする（`1//` で始まる長い文字列）。「Access token」の方ではない

### D. 置き場所

`/Users/terukina/boatrace-ai-predictor/.env.local`（hq の取り込みが読むファイル。worktree の中ではなく、本体のフォルダの方）をテキストエディタで開き、末尾に3行を足して保存する。

```
YOUTUBE_ANALYTICS_CLIENT_ID=（手順 C-3 の Client ID）
YOUTUBE_ANALYTICS_CLIENT_SECRET=（手順 C-3 の Client secret）
YOUTUBE_ANALYTICS_REFRESH_TOKEN=（手順 C-8 の Refresh token）
```

- 投稿用の `YOUTUBE_REFRESH_TOKEN` は Vercel にあるもので、このファイルには書かない（置き換えもしない）
- Vercel には登録しない（取り込みは手元の hq だけで動く）

### E. 終わったら

オーケストレーターに「YouTube Analytics のトークンを置いた」とだけ伝える（値は送らない）。取り込みのスクリプトを作るレーンが、値を表示せずに「読めるか」だけを確かめる。
