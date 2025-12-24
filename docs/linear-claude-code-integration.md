# Linear × Claude Code統合ガイド

Claude Code（Cursor）で壁打ちしながらタスクを整理し、実装中にLinearタスクを自動更新する方法です。

## 🎯 概要

この統合により、以下が可能になります：

1. **タスクの自動作成**: Claude Codeでタスクを整理する際に、Linearに自動的にタスクを作成
2. **実装中の自動更新**: 実装の進捗に応じて、Linearタスクの状態やコメントを自動更新
3. **進捗の可視化**: Linearでタスクの進捗を一元管理

## 📋 セットアップ

### ステップ1: Linear APIキー（Member API Keys）を取得

Linearの設定画面で「Member API Keys」を使用してAPIキーを取得します。

#### 手順

1. **Linearアプリを開く**（Web版: https://linear.app またはデスクトップアプリ）
2. **左下のプロフィールアイコン**をクリック
3. **「Settings」**（設定）を選択
4. **「API」** セクションを開く
5. **「Member API Keys」** を選択
6. **「Create API Key」** または **「新しいAPIキーを作成」** をクリック
7. キー名を入力（例: `Claude Code CLI`）
8. 生成されたキーをコピー（**一度しか表示されません**）

**重要:** 生成されたAPIキーは `lin_api_` で始まる文字列です。このキーを安全に保管してください。

#### 設定画面の構成

Linearの設定画面には以下のセクションがあります：
- **OAuth Applications** - OAuthアプリケーションの管理（今回は使用しません）
- **Webhooks** - Webhookの設定（今回は使用しません）
- **Member API Keys** - APIキーの作成・管理（**これを使用します**）

#### 注意事項

- APIキーは一度しか表示されません。コピーしたら安全な場所に保管してください
- APIキーには自動的に `write` 権限が付与されます
- 複数のAPIキーを作成できます（用途別に分けることを推奨）

### ステップ2: 環境変数を設定

#### 方法A: シェル設定ファイルに追加（推奨）

```bash
# ~/.zshrc または ~/.bashrc に追加
export LINEAR_API_KEY="your-api-key-here"
export LINEAR_TEAM_ID="your-team-id"  # オプション（複数チームがある場合）
```

設定を反映：

```bash
source ~/.zshrc  # または source ~/.bashrc
```

#### 方法B: .envファイルを使用

プロジェクトルートに `.env` ファイルを作成：

```bash
LINEAR_API_KEY=your-api-key-here
LINEAR_TEAM_ID=your-team-id  # オプション
```

`.env` ファイルを読み込む（Node.jsスクリプトで使用する場合）：

```bash
# dotenvパッケージが必要
npm install dotenv
```

### ステップ3: 動作確認

```bash
# ヘルプを表示
node scripts/linear-cli.js help

# タスク一覧を表示（APIキーが正しく設定されていれば動作）
node scripts/linear-cli.js list
```

## 🚀 使用方法

### Claude Codeでの使い方

#### 1. タスクを作成する

壁打ちでタスクを整理する際に、Linearにタスクを作成：

```bash
# 基本的なタスク作成
node scripts/linear-cli.js create "予測機能の実装" "AI予測ロジックを追加"

# 詳細な説明付きで作成
node scripts/linear-cli.js create "バグ修正: ログイン機能" "ログイン時にエラーが発生する問題を修正"
```

**出力例:**
```
📋 チーム: My Team (BOAT)
✅ タスクを作成しました:
   ID: BOAT-123
   タイトル: 予測機能の実装
   状態: Todo
   URL: https://linear.app/my-team/issue/BOAT-123
```

#### 2. 実装中にタスクを更新する

実装を開始したら、状態を「進行中」に変更：

```bash
node scripts/linear-cli.js update BOAT-123 "進行中" "実装を開始しました"
```

進捗をコメントで記録：

```bash
node scripts/linear-cli.js comment BOAT-123 "進捗: 50%完了。AI予測ロジックの実装が完了"
```

実装が完了したら、状態を「完了」に変更：

```bash
node scripts/linear-cli.js update BOAT-123 "完了" "実装完了。テストを実施中"
```

#### 3. タスクの状態を確認する

```bash
# タスクの詳細を表示
node scripts/linear-cli.js get BOAT-123

# タスク一覧を表示
node scripts/linear-cli.js list

# 特定の状態のタスクを表示
node scripts/linear-cli.js list "進行中"
```

## 💡 Claude Codeでの実践例

### 例1: 機能実装の流れ

```bash
# 1. タスクを作成
node scripts/linear-cli.js create "予測機能の実装" "AI予測ロジックとUIコンポーネントを追加"

# 2. 実装開始
node scripts/linear-cli.js update BOAT-123 "進行中" "実装を開始。まずはデータ取得部分から"

# 3. 進捗を記録
node scripts/linear-cli.js comment BOAT-123 "データ取得ロジック完了。次は予測アルゴリズムの実装"

# 4. さらに進捗
node scripts/linear-cli.js comment BOAT-123 "予測アルゴリズム実装完了。UIコンポーネントの実装に着手"

# 5. 完了
node scripts/linear-cli.js update BOAT-123 "完了" "実装完了。テストを実施し、問題なし"
```

### 例2: バグ修正の流れ

```bash
# 1. バグを報告するタスクを作成
node scripts/linear-cli.js create "ログイン機能の不具合" "ログイン時にエラーが発生する"

# 2. 原因を調査
node scripts/linear-cli.js update BOAT-124 "進行中" "原因調査中。認証トークンの処理に問題がある可能性"

# 3. 修正を実施
node scripts/linear-cli.js comment BOAT-124 "原因特定: トークンの有効期限チェックが不適切。修正を実施"

# 4. テスト
node scripts/linear-cli.js comment BOAT-124 "修正完了。テストを実施し、問題なく動作することを確認"

# 5. 完了
node scripts/linear-cli.js update BOAT-124 "完了" "修正完了。本番環境にデプロイ済み"
```

## 🔧 利用可能なコマンド

### create - タスクを作成

```bash
node scripts/linear-cli.js create <タイトル> [説明]
```

**例:**
```bash
node scripts/linear-cli.js create "新機能の実装" "詳細な説明"
```

### update - タスクを更新

```bash
node scripts/linear-cli.js update <タスクID> [状態] [コメント]
```

**状態の例:**
- `Todo` / `未着手`
- `進行中` / `In Progress`
- `完了` / `Done`
- `保留` / `Blocked`

**例:**
```bash
node scripts/linear-cli.js update BOAT-123 "進行中" "実装を開始"
```

### comment - コメントを追加

```bash
node scripts/linear-cli.js comment <タスクID> <コメント>
```

**例:**
```bash
node scripts/linear-cli.js comment BOAT-123 "進捗: 50%完了"
```

### list - タスク一覧を表示

```bash
node scripts/linear-cli.js list [状態] [件数]
```

**例:**
```bash
# すべてのタスクを表示（最大20件）
node scripts/linear-cli.js list

# 進行中のタスクを10件表示
node scripts/linear-cli.js list "進行中" 10
```

### get - タスクの詳細を表示

```bash
node scripts/linear-cli.js get <タスクID>
```

**例:**
```bash
node scripts/linear-cli.js get BOAT-123
```

## 🎨 Claude Codeでの自動化のヒント

### 1. エイリアスを作成

`~/.zshrc` または `~/.bashrc` に以下を追加：

```bash
# Linear CLIのエイリアス
alias lc='node scripts/linear-cli.js'
alias lc-create='node scripts/linear-cli.js create'
alias lc-update='node scripts/linear-cli.js update'
alias lc-comment='node scripts/linear-cli.js comment'
alias lc-list='node scripts/linear-cli.js list'
alias lc-get='node scripts/linear-cli.js get'
```

使用例：

```bash
lc-create "新機能" "説明"
lc-update BOAT-123 "進行中" "コメント"
lc-list "進行中"
```

### 2. タスク作成のテンプレート

よく使うタスク作成のパターンを関数化：

```bash
# ~/.zshrc に追加
lc-feature() {
  node scripts/linear-cli.js create "$1" "機能実装: $2"
}

lc-bug() {
  node scripts/linear-cli.js create "バグ修正: $1" "$2"
}

lc-doc() {
  node scripts/linear-cli.js create "ドキュメント: $1" "$2"
}
```

使用例：

```bash
lc-feature "予測機能" "AI予測ロジックを追加"
lc-bug "ログインエラー" "ログイン時にエラーが発生する"
lc-doc "API仕様書" "APIエンドポイントの仕様を記載"
```

### 3. 実装中の自動更新

実装中に定期的に進捗を記録：

```bash
# 実装開始
lc-update BOAT-123 "進行中" "実装を開始"

# 30分後、進捗を記録
lc-comment BOAT-123 "データ取得部分完了"

# 1時間後、さらに進捗
lc-comment BOAT-123 "予測アルゴリズム実装中"

# 完了
lc-update BOAT-123 "完了" "実装完了"
```

## 🔍 トラブルシューティング

### APIキーが設定されていない

**エラー:**
```
❌ LINEAR_API_KEY環境変数が設定されていません
```

**解決方法:**
```bash
export LINEAR_API_KEY="your-api-key"
```

### タスクが見つからない

**エラー:**
```
❌ タスク BOAT-123 が見つかりません
```

**解決方法:**
- タスクIDが正しいか確認
- チームIDが正しいか確認（複数チームがある場合）

### 状態名が認識されない

**エラー:**
状態が更新されない

**解決方法:**
Linearで使用している状態名を確認：

```bash
# タスク一覧で状態名を確認
node scripts/linear-cli.js list
```

状態名は大文字小文字を区別しませんが、正確な名前を使用してください。

## 📚 参考リンク

- [Linear API Documentation](https://developers.linear.app/docs)
- [Linear GraphQL API](https://developers.linear.app/docs/graphql/working-with-the-graphql-api)
- [詳細セットアップガイド](./linear-integration-setup.md)

## 💬 サポート

問題が発生した場合は、以下を確認してください：

1. APIキーが正しく設定されているか
2. APIキーに `write` 権限があるか
3. チームIDが正しいか（複数チームがある場合）

---

これで、Claude Codeで壁打ちしながらタスクを整理し、実装中にLinearタスクを自動更新できるようになりました！🎉

