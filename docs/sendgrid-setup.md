# SendGridメール通知セットアップガイド

このガイドでは、AI予想の実績データを毎日メールで受信するための設定方法を説明します。

## 1. SendGridアカウントの作成

### 1-1. SendGridに登録
1. [SendGrid公式サイト](https://sendgrid.com/)にアクセス
2. 「Start for Free」または「Sign Up」をクリック
3. メールアドレス（rapsody919@gmail.com推奨）でアカウントを作成
4. メール認証を完了

### 1-2. Sender Identity（送信元）の設定
SendGridでメールを送信するには、送信元メールアドレスを認証する必要があります。

#### オプション1: Single Sender Verification（簡単・推奨）
1. SendGridダッシュボードで「Settings」→「Sender Authentication」を選択
2. 「Verify a Single Sender」をクリック
3. 以下の情報を入力:
   - **From Name**: `Boatrace AI Predictor` (または任意)
   - **From Email Address**: `rapsody919@gmail.com` (実際に受信できるアドレス)
   - **Reply To**: `rapsody919@gmail.com`
   - **Company Address**: 住所情報を入力（必須）
4. 「Create」をクリック
5. 入力したメールアドレスに送られた認証メールのリンクをクリック

#### オプション2: Domain Authentication（高度）
独自ドメインを使用する場合は、Domain Authenticationを設定できます（オプション）。

## 2. API Keyの作成

### 2-1. API Keyを生成
1. SendGridダッシュボードで「Settings」→「API Keys」を選択
2. 「Create API Key」をクリック
3. 以下の情報を入力:
   - **API Key Name**: `boatrace-ai-predictor` (または任意)
   - **API Key Permissions**: `Full Access` または `Restricted Access` (Mail Send権限のみ)
4. 「Create & View」をクリック
5. **表示されたAPI Keyをコピー** (後から確認できないため注意！)

### 2-2. API Keyを保存
コピーしたAPI Keyは以下の場所に保存します:

#### ローカル環境
`.env`ファイルに追加:
```bash
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=rapsody919@gmail.com
TO_EMAIL=rapsody919@gmail.com
```

#### GitHub Secrets（GitHub Actionsで使用）
1. GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」を選択
2. 「New repository secret」をクリック
3. 以下のシークレットを追加:

**SENDGRID_API_KEY**
- Name: `SENDGRID_API_KEY`
- Secret: SendGridで作成したAPI Key

**FROM_EMAIL**
- Name: `FROM_EMAIL`
- Secret: `rapsody919@gmail.com` (認証済みの送信元アドレス)

**TO_EMAIL**
- Name: `TO_EMAIL`
- Secret: `rapsody919@gmail.com` (送信先アドレス)

## 3. スクリプトのテスト

ローカル環境でスクリプトをテスト実行:
```bash
node scripts/send-email-notification.js
```

成功すると以下のような出力が表示されます:
```
メール通知スクリプトを開始します...

SendGridを初期化しました
summary.jsonを読み込みました
前日のデータ: 2025-12-10 (144レース)
✅ メール送信成功: rapsody919@gmail.com

✅ メール通知が完了しました！
```

数分以内に指定したメールアドレスにメールが届きます。

## 4. メール内容のカスタマイズ

`scripts/send-email-notification.js`の以下の設定を変更できます:

### 通知条件のカスタマイズ
```javascript
const NOTIFICATION_THRESHOLDS = {
  // 回収率がこの値以上の場合は特別に通知
  highRecoveryRate: 1.5, // 150%以上

  // 3連単的中があった場合は特別に通知
  trioHitNotification: true,
};
```

### メール件名の変更
`sendEmail()`関数内の`subject`を編集:
```javascript
const subject = `📊 AI予想実績レポート - ${yesterdayData.date}`;
```

## 5. SendGridの無料プラン制限

SendGridの無料プランには以下の制限があります:
- **1日100通まで** のメール送信が可能
- 現在の設定では1日1通のみ送信するため、無料プランで十分です

## 6. トラブルシューティング

### エラー: "SENDGRID_API_KEYが設定されていません"
- 環境変数`SENDGRID_API_KEY`が設定されているか確認
- `.env`ファイルが正しい場所にあるか確認

### エラー: "The from email does not contain a valid address"
- `FROM_EMAIL`がSendGridで認証済みか確認
- Sender Authenticationの設定を確認

### エラー: "Forbidden"
- API Keyが正しいか確認
- API Keyの権限に「Mail Send」が含まれているか確認

### メールが届かない
1. スパムフォルダを確認
2. SendGridダッシュボードの「Activity」→「Email Activity」でメールの送信状況を確認
3. 送信元アドレスが認証済みか確認

### エラー: "前日のデータがありません"
- これはエラーではなく、前日のレース結果がまだ集計されていない場合の正常な動作です
- レース結果が集計された後に再度実行してください

## 7. GitHub Actionsでの自動実行

`scripts/send-email-notification.js`が正常に動作することを確認したら、GitHub Actionsワークフローを設定して自動実行できます。

詳細は次のステップで設定します。

## 参考リンク

- [SendGrid公式ドキュメント](https://docs.sendgrid.com/)
- [SendGrid API Documentation](https://docs.sendgrid.com/api-reference/mail-send/mail-send)
- [SendGrid Node.js Library](https://github.com/sendgrid/sendgrid-nodejs)
