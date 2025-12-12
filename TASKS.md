# タスク管理

## 🔴 優先度: 高（手動設定が必要）

### 1. Googleフォーム作成とContact.jsxへの埋め込む
- [ ] Googleフォームを作成
- [ ] フォームのURLを取得
- [ ] `src/components/Contact.jsx` にiframeを埋め込む
- **目的:** AdSense審査のお問い合わせページ

### 2. Google Cloud Project設定
- [ ] Google Cloud Consoleでプロジェクト作成
- [ ] Google Sheets APIを有効化
- [ ] サービスアカウント作成
- [ ] サービスアカウントキー（JSON）をダウンロード
- **ガイド:** `docs/google-sheets-setup.md`

### 3. Googleスプレッドシート作成・共有設定
- [ ] 新規スプレッドシートを作成
- [ ] シート名を「AI予想実績」に変更
- [ ] スプレッドシートIDを取得
- [ ] サービスアカウントと共有（編集権限）
- **ガイド:** `docs/google-sheets-setup.md`

### 4. GitHub Secrets設定（Google Sheets）
- [ ] `GOOGLE_SERVICE_ACCOUNT_KEY` を追加
- [ ] `GOOGLE_SPREADSHEET_ID` を追加
- **場所:** Settings → Secrets and variables → Actions

### 5. SendGrid設定
- [ ] SendGridアカウント作成（無料プラン）
- [ ] Sender Authentication完了
- [ ] API Key作成
- **ガイド:** `docs/sendgrid-setup.md`

### 6. GitHub Secrets設定（メール通知）
- [ ] `SENDGRID_API_KEY` を追加
- [ ] `FROM_EMAIL` を追加（rapsody919@gmail.com）
- [ ] `TO_EMAIL` を追加（rapsody919@gmail.com）

### 7. 動作確認
- [ ] Google Sheetsワークフローを手動実行してテスト
- [ ] メール通知ワークフローを手動実行してテスト
- [ ] スプレッドシートにデータが記録されることを確認
- [ ] メールが届くことを確認

---

## ✅ 完了済み

### UI機能
- [x] プライバシーポリシーページ作成（`src/components/PrivacyPolicy.jsx`）
- [x] お問い合わせページ作成（`src/components/Contact.jsx`）
- [x] 「直近のパフォーマンス」に回収率を追加
  - [x] `scripts/calculate-accuracy.js` を修正
  - [x] `AccuracyDashboard.jsx` に表示実装

### 自動化機能
- [x] Google Sheets連携スクリプト作成（`scripts/update-google-sheets.js`）
- [x] GitHub ActionsでSheets自動更新設定（`.github/workflows/update-google-sheets.yml`）
- [x] メール送信スクリプト作成（`scripts/send-email-notification.js`）
- [x] GitHub Actionsでメール自動送信設定（`.github/workflows/send-email-notification.yml`）

### ドキュメント
- [x] Google Sheetsセットアップガイド（`docs/google-sheets-setup.md`）
- [x] SendGridセットアップガイド（`docs/sendgrid-setup.md`）
- [x] 統合自動化ガイド（`docs/automation-setup.md`）

---

## 📝 メモ

### 実装済みの自動化フロー
```
毎時（GitHub Actions）
  ↓
レースデータ取得 → 予想生成 → 結果取得 → 的中率計算
  ↓
Google Sheetsに自動記録（スクレイピング完了後）
  ↓
毎朝8時（JST）にメール送信
```

### 依存関係
- タスク4は、タスク2と3が完了している必要がある
- タスク6は、タスク5が完了している必要がある
- タスク7は、タスク4と6が完了している必要がある

### 無料プランの制限
- **Google Sheets API:** 1日500リクエスト（現在約24回/日使用）→ 問題なし
- **SendGrid:** 1日100通（現在1通/日使用）→ 問題なし
- **GitHub Actions:** パブリックリポジトリは無料

---

最終更新: 2025-12-12
