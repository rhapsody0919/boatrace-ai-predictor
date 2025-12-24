# Linear APIキー取得トラブルシューティング

LinearのAPIキーが見つからない場合の対処法です。

## 🔍 APIキーの場所を探す

### ステップ1: 設定画面を確認

1. **Linearアプリを開く**（Web版: https://linear.app またはデスクトップアプリ）
2. **左下のプロフィールアイコン**（アバター）をクリック
3. **「Settings」**（設定）を選択

### ステップ2: 以下のセクションを確認

設定画面で **「API」** セクションを開くと、以下の3つのオプションが表示されます：

- **OAuth Applications** - OAuthアプリケーションの管理
- **Webhooks** - Webhookの設定
- ✅ **Member API Keys** - APIキーの作成・管理（**これを使用します**）

**Member API Keys** を選択して、**「Create API Key」** をクリックしてください。

### ステップ3: 直接URLからアクセス

以下のURLに直接アクセスしてみてください：

```
https://linear.app/settings/api
```

または

```
https://linear.app/settings/integrations/api
```

## ❓ よくある問題と解決方法

### 問題1: 「API」セクションが見つからない

**原因:**
- LinearのプランによってはAPIキー機能が利用できない場合があります
- アプリのバージョンが古い可能性があります

**解決方法:**

1. **Linearのプランを確認**
   - Linearの無料プランではAPIキーが作成できない場合があります
   - 有料プラン（Standard以上）にアップグレードが必要な場合があります

2. **アプリを最新版に更新**
   - Web版を使用している場合: ブラウザのキャッシュをクリア
   - デスクトップアプリを使用している場合: 最新版に更新

3. **ブラウザを変更**
   - 別のブラウザ（Chrome、Firefox、Safari）で試してみる

### 問題2: 「Create new key」ボタンが見つからない

**原因:**
- 権限が不足している可能性があります
- チームの設定でAPIキー作成が制限されている可能性があります

**解決方法:**

1. **チームの管理者に確認**
   - チームの管理者権限が必要な場合があります
   - 管理者にAPIキー作成の権限があるか確認してください

2. **個人アカウントで確認**
   - チームではなく、個人アカウントの設定を確認してください

### 問題3: APIキーを作成してもエラーが発生する

**原因:**
- APIキーの形式が正しくない可能性があります
- 権限が不足している可能性があります

**解決方法:**

1. **APIキーの形式を確認**
   - LinearのAPIキーは通常、`lin_api_` で始まります
   - キーに余分なスペースや改行が含まれていないか確認してください

2. **権限を確認**
   - APIキー作成時に `write` 権限を選択してください

## 🔄 代替方法

### 方法1: Linearの公式ドキュメントを確認

最新の情報を確認するため、Linearの公式ドキュメントを参照してください：

- **Linear API Documentation**: https://developers.linear.app/docs
- **Authentication**: https://developers.linear.app/docs/authentication

### 方法2: Linearサポートに問い合わせ

上記の方法で解決しない場合は、Linearのサポートに問い合わせてください：

- **Linear Support**: https://linear.app/support
- **Linear Community**: https://linear.app/community

### 方法3: OAuth認証を使用

APIキーが取得できない場合は、OAuth認証を使用する方法もあります。詳細は [Linear API Documentation](https://developers.linear.app/docs/authentication) を参照してください。

## 📝 確認チェックリスト

APIキーを取得する前に、以下を確認してください：

- [ ] Linearアプリにログインしている
- [ ] 最新版のアプリを使用している
- [ ] 有料プラン（Standard以上）を使用している（必要な場合）
- [ ] チームの管理者権限がある（必要な場合）
- [ ] 設定画面の各セクションを確認した
- [ ] 直接URLからアクセスを試した

## 💡 ヒント

### ブラウザの検索機能を使用

Linearアプリ内で `Cmd+F`（Mac）または `Ctrl+F`（Windows）を押して、「API」や「key」で検索すると、該当するセクションが見つかりやすくなります。

### スクリーンショットを撮る

設定画面のスクリーンショットを撮って、どのセクションがあるか確認すると便利です。

## 🔗 参考リンク

- [Linear API Documentation](https://developers.linear.app/docs)
- [Linear Authentication Guide](https://developers.linear.app/docs/authentication)
- [Linear Support](https://linear.app/support)

---

問題が解決しない場合は、Linearのサポートに問い合わせるか、プロジェクトのIssuesで質問してください。

