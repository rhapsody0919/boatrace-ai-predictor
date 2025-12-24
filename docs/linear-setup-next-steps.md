# Linear統合 次のステップ

Linear APIキーを取得した後のセットアップ手順です。

## 📋 ステップ1: 環境変数に設定

### 方法A: シェル設定ファイルに追加（推奨・永続的）

```bash
# ~/.zshrc または ~/.bashrc を編集
nano ~/.zshrc  # または nano ~/.bashrc

# 以下を追加
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"

# 設定を反映
source ~/.zshrc  # または source ~/.bashrc
```

### 方法B: 現在のセッションのみ（一時的）

```bash
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"
```

### 方法C: .envファイルを使用（プロジェクト単位）

プロジェクトルートに `.env` ファイルを作成：

```bash
echo "LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx" >> .env
```

## ✅ ステップ2: 動作確認

環境変数が正しく設定されているか確認：

```bash
echo $LINEAR_API_KEY
```

設定されていれば、APIキーが表示されます。

次に、Linear CLIが動作するか確認：

```bash
# ヘルプを表示
npm run linear

# タスク一覧を表示（APIキーが正しく設定されていれば動作）
npm run linear:list
```

## 🚀 ステップ3: 実際に使ってみる

### テスト: タスクを作成

```bash
npm run linear:create "テストタスク" "これは動作確認用のタスクです"
```

成功すると、以下のように表示されます：

```
📋 チーム: My Team (BOAT)
✅ タスクを作成しました:
   ID: BOAT-123
   タイトル: テストタスク
   状態: Todo
   URL: https://linear.app/my-team/issue/BOAT-123
```

### テスト: タスク一覧を表示

```bash
npm run linear:list
```

作成したタスクが表示されれば成功です。

## 🎯 ステップ4: Claude Codeで使う準備完了

これで、会話の中で以下のように動作します：

1. **気づきやメモ** → 「これをLinearに記録しますか？」と確認
2. **AI提案** → 「この提案をLinearチケットにしますか？」と確認
3. **実装タスク** → 自動的にチケットを作成・更新

## 💡 使い方の例

### 例1: 気づきを記録

```
あなた: 「予測アルゴリズムが遅いことに気づいた」

私: この気づきをLinearチケットとして記録しますか？
    - タイトル: 予測アルゴリズムのパフォーマンス改善
    - 説明: 計算が遅い問題を改善する

[Linearに追加しますか？]
```

### 例2: 実装タスク

```
あなた: 「ログイン機能を実装したい」

私: 実装タスクをLinearチケットとして作成しますか？
    → 作成後、実装中は自動的に「進行中」に更新
    → 完了時に自動的に「完了」に更新
```

## ❓ トラブルシューティング

### APIキーが認識されない

```bash
# 環境変数を確認
echo $LINEAR_API_KEY

# 設定されていない場合、再度設定
export LINEAR_API_KEY="lin_api_xxxxxxxxxxxxx"
```

### エラーが発生する

- APIキーが正しい形式か確認（`lin_api_` で始まる）
- APIキーに余分なスペースや改行が含まれていないか確認
- LinearアプリでAPIキーが有効か確認

## 📚 参考ドキュメント

- [Claude Code統合ガイド](./linear-claude-code-integration.md)
- [自動統合ガイド](./linear-auto-integration.md)
- [トラブルシューティング](./linear-api-key-troubleshooting.md)

---

準備ができたら、会話の中で自然にLinearチケットの作成・更新を試してみてください！

