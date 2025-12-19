# タスク管理

## 🔴 優先度: 高（次にやること）
### モデル導入
- モデルを5つに増やして欲しい (以前の会話で出ていたけど忘れた)
- AI予想のページだけでなく、的中レースページ、的中率統計もモデル導入することで最適化する必要がある
- 予想データと結果データはdata/predictions/yyyy-mm-dd.jsonに毎日のにデータを置いてると思うけど、今後モデルが増えるかもしれないことを考慮した上での作りにしてほしい。data/predictions/summary.jsonやraces .jsonでデータを保持するのはどの程度の期間可能か？(1ヶ月？6ヶ月？1年？いつまでにDBに移行した方が良いか？)
- いずれは、各競艇場ごとの統計も出したい
    - 例 : Aモデル/Bモデル/Cモデルの場合、単勝/複勝/3連複/3連単の的中率、回収率はどの程度かを算出したい
    - おそらく競艇場ごとに得意なモデルがあるはず。回収率アップのためには苦手な競艇場は手を出さないという方法もある
- 荒れ度の根拠を説明を記載したい
- どのモデルがおすすめなのかも表示したい


### 1. DNS反映の確認 ⏳
- [ ] 定期的に`nslookup boat-ai.jp 8.8.8.8`を実行
- [ ] `216.198.79.1`が表示されたら完了
- [ ] `https://boat-ai.jp`にアクセスして動作確認
- [ ] Vercel DomainsページでInvalid → Valid になることを確認
- **予想時間:** 2～24時間

### 2. Google Analytics設置（DNS反映後）
- [ ] Google Analyticsアカウント作成
- [ ] プロパティ作成（boat-ai.jp）
- [ ] 測定IDを取得
- [ ] `index.html`にトラッキングコードを追加
- [ ] 動作確認（リアルタイムレポート）
- **目的:** トラフィック分析、AdSense審査でもプラス

### 3. Google AdSense申請（DNS反映後）
- [ ] Google AdSenseアカウント作成
- [ ] サイト情報を登録（boat-ai.jp）
- [ ] AdSenseコードを`index.html`に追加
- [ ] 審査申請
- [ ] 審査完了を待つ（1～2週間）
- **目的:** 広告収入の獲得

### 4. noteコンテンツ販売
- [ ] 記事1本目を執筆「競艇AI予測を708レースで検証した結果」
  - データ分析結果をまとめる
  - 的中率と回収率の推移
  - 有効な使い方のアドバイス
- [ ] 価格設定: 980円
- [ ] noteに投稿
- **目的:** コンテンツ販売収益

---

## ⏸️ 保留中（優先度: 低）

### SendGrid設定
- [ ] SendGridアカウント作成（無料プラン）
- [ ] Sender Authentication完了
- [ ] API Key作成
- [ ] GitHub Secretsに設定
  - `SENDGRID_API_KEY`
  - `FROM_EMAIL`（rapsody919@gmail.com）
  - `TO_EMAIL`（rapsody919@gmail.com）
- [ ] メール通知ワークフローを手動実行してテスト
- **備考:** 必須ではないため保留中

---

## ✅ 完了済み

### 収益化・ドメイン設定（2025-12-12完了）
- [x] サービス名を「BoatAI」に変更
  - [x] index.html（title、meta description）
  - [x] package.json
  - [x] README.md
  - [x] src/App.jsx（ヘッダー、フッター）
- [x] boat-ai.jpドメインを取得（お名前.com）
- [x] Vercelでカスタムドメイン設定
- [x] お名前.comでDNS設定
  - [x] A Record: @ → 216.198.79.1
  - [x] CNAME Record: www → vercel-dns

### デプロイ環境の最適化（2025-12-12完了）
- [x] Vercelへの一本化
  - [x] vite.config.jsのbaseパスを'/'に変更
  - [x] GitHub Pagesワークフローを無効化
- [x] データファイル問題の解決
  - [x] data/をpublic/data/にコピー
  - [x] スクレイピングワークフローを更新（自動同期）
  - [x] Vercelビルドにデータファイルが含まれることを確認
  - [x] 回収率が正常に表示されることを確認

### Google Cloud連携（2025-12-12完了）
- [x] Googleフォーム作成とContact.jsxへの埋め込み
  - [x] Googleフォームを作成
  - [x] フォームのURLを取得
  - [x] `src/components/Contact.jsx` にiframeを埋め込む
- [x] Google Cloud Project設定
  - [x] Google Cloud Consoleでプロジェクト作成（boatrace-ai-predictor）
  - [x] Google Sheets APIを有効化
  - [x] サービスアカウント作成（boatrace-sheets-updater）
  - [x] サービスアカウントキー（JSON）をダウンロード
- [x] Googleスプレッドシート作成・共有設定
  - [x] 新規スプレッドシートを作成
  - [x] シート名を「AI予想実績」に変更
  - [x] スプレッドシートIDを取得
  - [x] サービスアカウントと共有（編集権限）
- [x] GitHub Secrets設定（Google Sheets）
  - [x] `GOOGLE_SERVICE_ACCOUNT_KEY` を追加
  - [x] `GOOGLE_SPREADSHEET_ID` を追加
- [x] Google Sheets動作確認
  - [x] ローカルでテスト実行成功
  - [x] GitHub Actionsで自動実行成功

### バグ修正（2025-12-12完了）
- [x] 複勝ロジックの修正
  - [x] README.mdの定義修正（3位以内 → 2位以内）
  - [x] docs/recovery-rate-design.mdの修正
  - [x] docs/implementation-plan.mdの修正
  - [x] src/App.jsxのUI表示ロジック修正（rank3チェックを削除）

### UI機能（以前に完了）
- [x] プライバシーポリシーページ作成（`src/components/PrivacyPolicy.jsx`）
- [x] お問い合わせページ作成（`src/components/Contact.jsx`）
- [x] 的中率統計ページを表形式にリニューアル
  - [x] 「今月」セクションを表形式で表示（単勝/複勝/3連複/3連単の的中率と回収率）
  - [x] 「直近のパフォーマンス」を10列の詳細な表形式に変更（2段ヘッダー構造）
  - [x] 「回収率について」の説明をページ上部に移動
  - [x] 旧「前日の的中率と回収率」テーブルを削除
  - [x] `scripts/calculate-accuracy.js` で今月・先月の回収率を計算
  - [x] `summary.json` を再生成
  - [x] レスポンシブデザイン対応（1024px/768px/480pxブレークポイント）
- [x] 「直近のパフォーマンス」に回収率を追加
  - [x] `scripts/calculate-accuracy.js` を修正
  - [x] `AccuracyDashboard.jsx` に表示実装
- [x] モバイル対応の大幅改善
  - [x] レスポンシブデザインの強化（1024px/768px/480pxブレークポイント）
  - [x] タッチターゲットのサイズ最適化（最小44x44px）
  - [x] フォントサイズの調整（モバイルで読みやすく）
  - [x] テーブルの横スクロール対応
  - [x] 直近のパフォーマンスセクションのモバイルレイアウト改善
  - [x] パディング・マージンの最適化

### 自動化機能（以前に完了）
- [x] Google Sheets連携スクリプト作成（`scripts/update-google-sheets.js`）
- [x] GitHub ActionsでSheets自動更新設定（`.github/workflows/update-google-sheets.yml`）
- [x] メール送信スクリプト作成（`scripts/send-email-notification.js`）
- [x] GitHub Actionsでメール自動送信設定（`.github/workflows/send-email-notification.yml`）

### ドキュメント（以前に完了）
- [x] Google Sheetsセットアップガイド（`docs/google-sheets-setup.md`）
- [x] SendGridセットアップガイド（`docs/sendgrid-setup.md`）
- [x] 統合自動化ガイド（`docs/automation-setup.md`）

---

## 📝 メモ

### 現在のデプロイフロー
```
毎時（GitHub Actions）
  ↓
レースデータ取得 → 予想生成 → 結果取得 → 的中率計算
  ↓
data/ と public/data/ を同期
  ↓
GitHubにコミット
  ↓
Vercelが自動デプロイ（1～2分）
  ↓
https://boat-ai.jp に反映（DNS反映後）
```

### DNS反映状況
- **設定完了**: 2025-12-12 15:30
- **現在の状態**: 反映待ち（2～24時間）
- **確認コマンド**: `nslookup boat-ai.jp 8.8.8.8`
- **正しいIP**: 216.198.79.1

### Vercelプロジェクト情報
- **プロジェクト名**: boatrace-ai-predictor
- **本番URL**: https://boatrace-ai-predictor-21zjyoyck-rhapsody0919s-projects.vercel.app
- **カスタムドメイン**: boat-ai.jp（DNS反映後有効化）
- **ダッシュボード**: https://vercel.com/rhapsody0919s-projects/boatrace-ai-predictor

### Google Cloud情報
- **プロジェクトID**: boatrace-ai-predictor
- **サービスアカウント**: boatrace-sheets-updater@boatrace-ai-predictor.iam.gserviceaccount.com
- **スプレッドシートID**: 13B7LkNjpwau1SNt1vAL9zXFeEuyeFXpRmBzqpzlnDbU

### 無料プランの制限
- **Google Sheets API:** 1日500リクエスト（現在約24回/日使用）→ 問題なし
- **SendGrid:** 1日100通（現在1通/日使用）→ 問題なし
- **GitHub Actions:** パブリックリポジトリは無料
- **Vercel:** 個人プランは無料（帯域100GB/月、ビルド6000分/月）

---

## 💡 将来的な改善案

### SNS自動運用
- Xアカウント運用
  - 毎日の的中率レポート自動投稿
  - 高的中時の自動ツイート
- note 自動投稿運用
  - 週次レポートの自動生成・投稿

### 機能追加
- ユーザー登録・ログイン機能
- マイページ（お気に入りレース、予想履歴）
- プッシュ通知（レース開始前）
- LINE Bot連携

### データ分析強化
- AIモデルの改善（機械学習）
- 過去データからのパターン分析
- 競艇場ごとの傾向分析

## todo
- noteのリアクション設定
- 本日の日付も入れて欲しい
- 的中率統計ページはAI予想実績という名前にしてほしい
- 的中率をグラフ化したい
- 解説根拠の充実をしたい
- 更新時間や更新状況をどこかに表示したい
- 初心者でもわかるように使い方の説明を入れたい
- 不要なファイルが多いと思うので整理したい
  - 既に完了したdocで内容が重複してるものは削除して良い。残すべきものは一箇所にまとめて欲しい
  - システム動作仕様.mdのような有用なdocは残して欲しい

---

最終更新: 2025-12-12 17:00
