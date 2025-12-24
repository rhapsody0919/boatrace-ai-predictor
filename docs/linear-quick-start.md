# Linear統合 クイックスタートガイド

5分でLinearとGitHubを連携させる手順です。

## 🎯 Claude Codeでのタスク管理（最も便利）

Claude Codeで壁打ちしながらタスクを整理し、実装中にLinearタスクを自動更新できます。

### セットアップ（1分）

```bash
# Linear APIキーを設定
export LINEAR_API_KEY="your-api-key"
```

### 使い方

```bash
# タスクを作成
npm run linear:create "予測機能の実装" "AI予測ロジックを追加"

# 実装中に更新
npm run linear:update BOAT-123 "進行中" "実装を開始"

# 進捗を記録
npm run linear:comment BOAT-123 "進捗: 50%完了"

# タスク一覧を表示
npm run linear:list
```

詳細は [Claude Code統合ガイド](./linear-claude-code-integration.md) を参照してください。

---

## 🚀 GitHub統合（最も簡単）

### ステップ1: LinearでGitHub統合を有効化

1. Linearアプリを開く
2. **Settings** → **Integrations** → **GitHub** を開く
3. **Connect GitHub** をクリック
4. GitHubの認証画面で承認
5. リポジトリ `boatrace-ai-predictor` を選択
6. **Save** をクリック

**これだけで完了です！** 🎉

### ステップ2: コミットメッセージでタスクを参照

コミットメッセージにLinearタスクIDを含めるだけです：

```bash
git commit -m "feat: 予測機能を実装

Fixes BOAT-123"
```

**利用可能なキーワード:**
- `Fixes BOAT-123` → タスクを完了
- `Closes BOAT-123` → タスクを完了
- `Resolves BOAT-123` → タスクを完了
- `Refs BOAT-123` → コメントを追加（完了しない）
- `Related to BOAT-123` → 関連付け（完了しない）

### ステップ3: プルリクエストでタスクを参照

PRのタイトルや説明にタスクIDを含めます：

```
[BOAT-123] 予測機能の実装

Fixes BOAT-123
```

---

## 🔧 高度な設定（GitHub Actions使用）

より詳細な制御が必要な場合は、GitHub Actionsを使用します。

### ステップ1: Linear APIキー（Member API Keys）を取得

1. Linearアプリを開く（Web版: https://linear.app またはデスクトップアプリ）
2. **左下のプロフィールアイコン**をクリック
3. **「Settings」**（設定）を選択
4. **「API」** セクションを開く
5. **「Member API Keys」** を選択
6. **「Create API Key」** をクリック
7. キー名: `GitHub Actions`（または任意の名前）
8. 生成されたキーをコピー（**一度しか表示されません**）

**重要:** APIキーは `lin_api_` で始まる文字列です。安全に保管してください。

### ステップ2: GitHub Secretsを設定

#### 方法A: GitHub CLIを使用（推奨）

```bash
# セットアップスクリプトを実行
./.github/scripts/setup-linear.sh
```

#### 方法B: GitHub Web UIを使用

1. リポジトリの **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret** をクリック
3. 以下を設定：
   - Name: `LINEAR_API_KEY`
   - Secret: 先ほどコピーしたAPIキー
4. **Add secret** をクリック

### ステップ3: 動作確認

1. コミットメッセージにLinearタスクIDを含めてコミット：

```bash
git commit -m "feat: 機能追加

Fixes BOAT-123"
```

2. プッシュ：

```bash
git push origin main
```

3. GitHub Actionsのログを確認：
   - リポジトリの **Actions** タブを開く
   - 「Linear Task Sync」ワークフローを確認

4. Linearアプリでタスクを確認：
   - タスクが完了状態になっているか確認
   - コメントが追加されているか確認

---

## 📝 コミットメッセージの例

### タスクを完了させる

```bash
git commit -m "fix: バグを修正

Fixes BOAT-123"
```

### 複数のタスクを完了させる

```bash
git commit -m "fix: 複数のバグを修正

Fixes BOAT-123
Fixes BOAT-124"
```

### タスクに関連付けのみ（完了しない）

```bash
git commit -m "docs: ドキュメントを更新

Related to BOAT-123"
```

### 実装中（完了しない）

```bash
git commit -m "feat: 予測機能を実装中

Refs BOAT-123"
```

---

## 🎯 開発フローの例

### 1. Linearでタスクを作成

- タスクIDをメモ（例: `BOAT-123`）

### 2. ブランチを作成

```bash
git checkout -b feature/BOAT-123-prediction-feature
```

### 3. 実装とコミット

```bash
git add .
git commit -m "feat: 予測機能を実装

Implements BOAT-123"
```

### 4. プルリクエストを作成

**タイトル:**
```
[BOAT-123] 予測機能の実装
```

**説明:**
```
## 変更内容
- AI予測ロジックを追加
- UIコンポーネントを更新

## 関連タスク
Fixes BOAT-123
```

### 5. マージ時に自動更新

PRがマージされると、Linearタスクが自動的に完了状態になります。

---

## ❓ よくある質問

### Q: タスクが更新されない

**A:** 以下を確認してください：

1. **コミットメッセージの形式**
   - タスクIDが正しい形式か（例: `BOAT-123`）
   - キーワードが正しいか（`Fixes`, `Closes`など）

2. **Linear統合の設定**
   - GitHub統合が有効になっているか
   - 正しいリポジトリが選択されているか

3. **GitHub Actionsのログ**
   - Actionsタブでエラーがないか確認

### Q: タスクIDの形式は？

**A:** `[チーム名]-[番号]` の形式です。

- 例: `BOAT-123`, `FEAT-456`, `BUG-789`

チーム名は大文字小文字を区別します。

### Q: 複数のタスクを一度に完了させたい

**A:** コミットメッセージに複数のタスクIDを含めます：

```bash
git commit -m "fix: 複数のバグを修正

Fixes BOAT-123
Fixes BOAT-124
Fixes BOAT-125"
```

### Q: タスクを完了させずに関連付けだけしたい

**A:** `Refs` または `Related to` を使用します：

```bash
git commit -m "docs: ドキュメントを更新

Refs BOAT-123"
```

---

## 🔗 参考リンク

- [詳細セットアップガイド](./linear-integration-setup.md)
- [Linear API Documentation](https://developers.linear.app/docs)
- [Linear GitHub Integration](https://linear.app/docs/integrations/github)

---

## 💡 ヒント

- **コミットメッセージの規約を統一**すると、チーム全体で使いやすくなります
- **PRのタイトルにタスクIDを含める**と、LinearでPRを追跡しやすくなります
- **小さなコミットを頻繁に行う**と、進捗を細かく追跡できます

