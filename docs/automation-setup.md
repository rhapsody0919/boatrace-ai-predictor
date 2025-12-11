# 自動化セットアップ完全ガイド

このガイドでは、AI予想実績の自動記録とメール通知を設定する手順を説明します。

## 📋 概要

以下の自動化機能を実装します:

1. **Google Sheets連携** - 予想実績を自動的にスプレッドシートに記録
2. **メール通知** - 毎朝、前日の実績サマリーをメールで受信
3. **GitHub Actions** - 上記を自動実行

## 🎯 最終的な自動化フロー

```
毎時（GitHub Actions）
  ↓
レースデータ取得 → 予想生成 → 結果取得 → 的中率計算
  ↓
Google Sheetsに自動記録
  ↓
毎朝8時（JST）にメール送信
```

## 🚀 セットアップ手順

### フェーズ1: Google Sheets連携

#### ステップ1: Google Cloud Projectの設定
詳細は [Google Sheets Setup Guide](./google-sheets-setup.md) を参照してください。

**概要:**
1. Google Cloud Consoleで新規プロジェクトを作成
2. Google Sheets APIを有効化
3. サービスアカウントを作成
4. サービスアカウントキー（JSON）をダウンロード

#### ステップ2: Googleスプレッドシートの作成
1. 新規スプレッドシートを作成
2. シート名を「AI予想実績」に変更
3. スプレッドシートIDをURLから取得
4. サービスアカウントと共有（編集権限）

#### ステップ3: GitHub Secretsの設定
GitHubリポジトリの Settings → Secrets and variables → Actions で以下を追加:

**GOOGLE_SERVICE_ACCOUNT_KEY**
- Name: `GOOGLE_SERVICE_ACCOUNT_KEY`
- Secret: サービスアカウントキーのJSONファイルの内容全体

**GOOGLE_SPREADSHEET_ID**
- Name: `GOOGLE_SPREADSHEET_ID`
- Secret: スプレッドシートID（URLから取得）

#### ステップ4: ローカルテスト（オプション）
```bash
# .envファイルを作成
echo "GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/google-service-account.json" >> .env
echo "GOOGLE_SPREADSHEET_ID=YOUR_SPREADSHEET_ID" >> .env

# 認証情報を配置
mkdir -p credentials
cp ~/Downloads/service-account-key.json credentials/google-service-account.json

# テスト実行
node scripts/update-google-sheets.js
```

### フェーズ2: メール通知

#### ステップ1: SendGridアカウントの作成
詳細は [SendGrid Setup Guide](./sendgrid-setup.md) を参照してください。

**概要:**
1. SendGridアカウントを作成（無料プラン）
2. Sender Authentication（送信元認証）を完了
3. API Keyを作成

#### ステップ2: GitHub Secretsの設定
以下のシークレットを追加:

**SENDGRID_API_KEY**
- Name: `SENDGRID_API_KEY`
- Secret: SendGridで作成したAPI Key

**FROM_EMAIL**
- Name: `FROM_EMAIL`
- Secret: 認証済みの送信元メールアドレス（例: rapsody919@gmail.com）

**TO_EMAIL**
- Name: `TO_EMAIL`
- Secret: 送信先メールアドレス（例: rapsody919@gmail.com）

#### ステップ3: ローカルテスト（オプション）
```bash
# .envファイルに追加
echo "SENDGRID_API_KEY=SG.xxxxxx" >> .env
echo "FROM_EMAIL=rapsody919@gmail.com" >> .env
echo "TO_EMAIL=rapsody919@gmail.com" >> .env

# テスト実行
node scripts/send-email-notification.js
```

### フェーズ3: GitHub Actionsの有効化

#### 変更をプッシュ
すべてのスクリプトとワークフローファイルが既にリポジトリに含まれています。変更をプッシュするだけで自動的に有効化されます。

```bash
git add .
git commit -m "Add Google Sheets and Email notification automation"
git push
```

#### ワークフローの確認
1. GitHubリポジトリの「Actions」タブを開く
2. 以下のワークフローが表示されることを確認:
   - **Scrape Race Data** (既存)
   - **Update Google Sheets** (新規)
   - **Send Email Notification** (新規)

#### 手動実行でテスト
1. 「Update Google Sheets」ワークフローを選択
2. 「Run workflow」ボタンをクリック
3. 成功したらスプレッドシートにデータが追加されていることを確認

同様に「Send Email Notification」もテスト実行してメールが届くことを確認してください。

## 📊 実装済みファイル

### スクリプト
- ✅ `scripts/update-google-sheets.js` - Google Sheets更新スクリプト
- ✅ `scripts/send-email-notification.js` - メール送信スクリプト

### GitHub Actions ワークフロー
- ✅ `.github/workflows/update-google-sheets.yml` - Sheets自動更新
- ✅ `.github/workflows/send-email-notification.yml` - メール自動送信

### ドキュメント
- ✅ `docs/google-sheets-setup.md` - Google Sheets詳細セットアップ
- ✅ `docs/sendgrid-setup.md` - SendGrid詳細セットアップ
- ✅ `docs/automation-setup.md` - 本ファイル

### 依存パッケージ
- ✅ `googleapis` - Google Sheets API
- ✅ `@sendgrid/mail` - SendGrid メール送信

## 🔧 カスタマイズ

### メール送信の頻度を変更
`.github/workflows/send-email-notification.yml`の`cron`設定を変更:
```yaml
schedule:
  # 毎日朝8時（JST）= 前日23時（UTC）
  - cron: '0 23 * * *'
```

### メール内容のカスタマイズ
`scripts/send-email-notification.js`の以下を編集:
- `NOTIFICATION_THRESHOLDS` - 通知条件
- `generateEmailHTML()` - HTMLメールテンプレート
- `generateEmailText()` - テキストメールテンプレート

### Google Sheetsの列を変更
`scripts/update-google-sheets.js`の以下を編集:
- `createHeaderRow()` - ヘッダー列
- `updateSpreadsheet()` - データ行の内容

## 📈 運用後の確認

### Google Sheetsの確認
- スプレッドシートを開いて、データが毎時更新されているか確認
- ヘッダー行と各日付のデータが正しく記録されているか確認

### メール通知の確認
- 毎朝8時頃にメールが届くことを確認
- スパムフォルダもチェック
- メールの内容が正しく表示されているか確認

### GitHub Actionsログの確認
- 「Actions」タブで各ワークフローの実行履歴を確認
- エラーがある場合はログを確認して対処

## 🐛 トラブルシューティング

### Google Sheets関連
- **エラー: "The caller does not have permission"**
  → サービスアカウントとスプレッドシートが共有されているか確認

- **エラー: "Unable to parse range"**
  → シート名が「AI予想実績」になっているか確認

### メール送信関連
- **エラー: "The from email does not contain a valid address"**
  → FROM_EMAILがSendGridで認証済みか確認

- **メールが届かない**
  → スパムフォルダを確認
  → SendGridの「Email Activity」で送信状況を確認

### GitHub Actions関連
- **ワークフローが実行されない**
  → GitHub Secretsがすべて設定されているか確認
  → ワークフローファイルの構文エラーがないか確認

## 💰 コスト

### Google Sheets API
- **無料枠:** 1日あたり500リクエスト
- **現在の使用量:** 1日約24回（毎時更新）
- **結論:** 無料枠で十分

### SendGrid
- **無料プラン:** 1日100通まで
- **現在の使用量:** 1日1通
- **結論:** 無料プランで十分

### GitHub Actions
- **無料枠:** パブリックリポジトリは無料
- **結論:** 完全無料

## 📚 参考リンク

- [Google Sheets API Documentation](https://developers.google.com/sheets/api)
- [SendGrid Documentation](https://docs.sendgrid.com/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

## ✅ セットアップチェックリスト

### Google Sheets
- [ ] Google Cloud Projectを作成
- [ ] Google Sheets APIを有効化
- [ ] サービスアカウントを作成
- [ ] サービスアカウントキーをダウンロード
- [ ] Googleスプレッドシートを作成
- [ ] サービスアカウントと共有
- [ ] GitHub Secretsを設定
- [ ] ローカルでテスト実行
- [ ] GitHub Actionsで動作確認

### SendGrid
- [ ] SendGridアカウントを作成
- [ ] Sender Authenticationを完了
- [ ] API Keyを作成
- [ ] GitHub Secretsを設定
- [ ] ローカルでテスト実行
- [ ] GitHub Actionsで動作確認
- [ ] メール受信を確認

---

セットアップが完了したら、毎日自動的にデータが記録され、朝にはメールで前日の実績が届きます！
