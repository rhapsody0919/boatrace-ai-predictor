# Google Sheets連携セットアップガイド

このガイドでは、AI予想の実績データを自動的にGoogleスプレッドシートに記録するための設定方法を説明します。

## 1. Google Cloud Projectの設定

### 1-1. Google Cloud Consoleにアクセス
1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. Googleアカウント（rapsody919@gmail.com）でログイン

### 1-2. 新規プロジェクトを作成
1. 画面上部の「プロジェクトを選択」をクリック
2. 「新しいプロジェクト」をクリック
3. プロジェクト名: `boatrace-ai-predictor` (または任意の名前)
4. 「作成」をクリック

### 1-3. Google Sheets APIを有効化
1. 左側のメニューから「APIとサービス」→「ライブラリ」を選択
2. 検索ボックスで「Google Sheets API」を検索
3. 「Google Sheets API」を選択
4. 「有効にする」をクリック

### 1-4. サービスアカウントを作成
1. 左側のメニューから「APIとサービス」→「認証情報」を選択
2. 「認証情報を作成」→「サービスアカウント」を選択
3. サービスアカウントの詳細:
   - 名前: `boatrace-sheets-updater` (または任意の名前)
   - 説明: `Boatrace AI予想実績をGoogle Sheetsに記録するサービスアカウント`
4. 「作成して続行」をクリック
5. ロールの選択: 「編集者」を選択（または「Google Sheets API」の権限）
6. 「完了」をクリック

### 1-5. サービスアカウントキーを作成
1. 作成したサービスアカウントをクリック
2. 「キー」タブを選択
3. 「鍵を追加」→「新しい鍵を作成」を選択
4. キーのタイプ: `JSON`を選択
5. 「作成」をクリック
6. JSONファイルが自動的にダウンロードされます

### 1-6. サービスアカウントキーを配置
1. ダウンロードしたJSONファイルを `credentials/google-service-account.json` に配置
   ```bash
   mkdir -p credentials
   mv ~/Downloads/boatrace-ai-predictor-*.json credentials/google-service-account.json
   ```
2. `.gitignore`で`credentials/`ディレクトリを除外（既に設定済み）

## 2. Googleスプレッドシートの作成

### 2-1. 新規スプレッドシートを作成
1. [Google Sheets](https://sheets.google.com/)にアクセス
2. 「空白」で新しいスプレッドシートを作成
3. タイトルを「AI予想実績」に変更（任意）

### 2-2. シート名を設定
1. デフォルトの「シート1」を右クリック
2. 「名前を変更」を選択
3. 「AI予想実績」に変更

### 2-3. スプレッドシートIDを取得
- スプレッドシートのURLから取得:
  ```
  https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
  ```
- `{SPREADSHEET_ID}`の部分をコピー

### 2-4. サービスアカウントと共有
1. スプレッドシートの「共有」ボタンをクリック
2. サービスアカウントのメールアドレスを入力
   - 例: `boatrace-sheets-updater@boatrace-ai-predictor.iam.gserviceaccount.com`
   - (サービスアカウントキーのJSONファイル内の`client_email`フィールドに記載)
3. 権限: 「編集者」を選択
4. 「送信」をクリック

## 3. 環境変数の設定

### 3-1. ローカル環境
`.env`ファイルを作成（または既存のファイルに追加）:
```bash
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-service-account.json
GOOGLE_SPREADSHEET_ID=YOUR_SPREADSHEET_ID_HERE
```

### 3-2. GitHub Secrets（GitHub Actionsで使用）
1. GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」を選択
2. 「New repository secret」をクリック
3. 以下の2つのシークレットを追加:

#### GOOGLE_SERVICE_ACCOUNT_KEY
- Name: `GOOGLE_SERVICE_ACCOUNT_KEY`
- Secret: サービスアカウントキーのJSONファイルの**内容全体**をコピー&ペースト

#### GOOGLE_SPREADSHEET_ID
- Name: `GOOGLE_SPREADSHEET_ID`
- Secret: スプレッドシートID（上記2-3で取得）

## 4. スクリプトのテスト

ローカル環境でスクリプトをテスト実行:
```bash
node scripts/update-google-sheets.js
```

成功すると以下のような出力が表示されます:
```
Google Sheets連携スクリプトを開始します...

summary.jsonを読み込みました (7日分のデータ)
Google Sheets APIに接続しました
ヘッダー行を作成しました
7件の新しいデータを追加しました

✅ Google Sheetsの更新が完了しました！
スプレッドシートURL: https://docs.google.com/spreadsheets/d/{YOUR_SPREADSHEET_ID}/edit
```

## 5. トラブルシューティング

### エラー: "GOOGLE_SPREADSHEET_IDが設定されていません"
- 環境変数`GOOGLE_SPREADSHEET_ID`が設定されているか確認
- または、`scripts/update-google-sheets.js`内の`SPREADSHEET_ID`を直接編集

### エラー: "Google Sheets API初期化エラー"
- サービスアカウントキーのパスが正しいか確認
- JSONファイルが正しいフォーマットか確認（テキストエディタで開いて確認）

### エラー: "The caller does not have permission"
- スプレッドシートがサービスアカウントと共有されているか確認
- サービスアカウントのメールアドレスが正しいか確認

### エラー: "Unable to parse range"
- シート名が「AI予想実績」になっているか確認
- または、`scripts/update-google-sheets.js`内の`SHEET_NAME`を変更

## 6. GitHub Actionsでの自動実行

`scripts/update-google-sheets.js`が正常に動作することを確認したら、GitHub Actionsワークフローを設定して自動実行できます。

詳細は次のステップで設定します。

## 参考リンク

- [Google Sheets API Documentation](https://developers.google.com/sheets/api)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Google Sheets](https://sheets.google.com/)
