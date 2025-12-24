# Linear自動統合の実現方法

会話の中で自動的にLinearチケットを作成・更新する機能がどのように実現されているかを説明します。

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────┐
│  Claude Code (Cursor) での会話           │
│                                          │
│  ユーザー: 「予測機能を実装したい」        │
│         ↓                                │
│  AI: 会話の文脈を分析                     │
│         ↓                                │
│  AI: Linearチケット作成を提案             │
│         ↓                                │
│  AI: run_terminal_cmd で実行              │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  scripts/linear-cli.js                  │
│                                          │
│  - GraphQL APIでLinearと通信             │
│  - タスクの作成・更新・取得               │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  Linear API (GraphQL)                  │
│                                          │
│  https://api.linear.app/graphql         │
│  Authorization: LINEAR_API_KEY          │
└─────────────────────────────────────────┘
```

## 🔧 実現方法の詳細

### 1. CLIツール (`scripts/linear-cli.js`)

Linear APIと通信するためのCLIツールです。

**主な機能:**
- GraphQL APIを使用してLinearと通信
- タスクの作成 (`create`)
- タスクの更新 (`update`)
- コメントの追加 (`comment`)
- タスク一覧の取得 (`list`)
- タスク詳細の取得 (`get`)

**技術スタック:**
- Node.js (ES Modules)
- HTTPS (Linear APIとの通信)
- GraphQL (Linear APIの形式)

### 2. AIによる自動判断

会話の中で、AIが以下のように判断します：

#### 判断基準

1. **タスク作成のタイミング**
   - 「実装したい」「追加したい」などの表現
   - 「メモしておきたい」「記録したい」などの表現
   - AIが提案した内容

2. **タスク更新のタイミング**
   - 「実装を開始した」
   - 「実装が完了した」
   - 「進捗を記録したい」

3. **確認モード**
   - デフォルトでは「これをLinearに追加しますか？」と確認
   - ユーザーが承認してから実行

### 3. 実行フロー

```
1. 会話の文脈を分析
   ↓
2. Linearチケット化すべき内容か判断
   ↓
3. ユーザーに確認（確認モードの場合）
   ↓
4. run_terminal_cmd で linear-cli.js を実行
   ↓
5. 結果をユーザーに報告
```

## 💻 コード例

### CLIツールの実行例

```bash
# タスクを作成
node scripts/linear-cli.js create "予測機能の実装" "AI予測ロジックを追加"

# タスクを更新
node scripts/linear-cli.js update BIZ-123 "進行中" "実装を開始"

# コメントを追加
node scripts/linear-cli.js comment BIZ-123 "進捗: 50%完了"
```

### AIが実行する例

会話の中で、AIが以下のように実行します：

```javascript
// AIが会話の文脈から判断
if (会話に「実装したい」が含まれる) {
  // ユーザーに確認
  "この内容をLinearチケットとして作成しますか？"
  
  // ユーザーが承認したら
  run_terminal_cmd("node scripts/linear-cli.js create '...' '...'")
}
```

## 🔐 認証の仕組み

### Linear APIキー

1. **取得方法**
   - Linearアプリ → Settings → API → Member API Keys
   - 「Create API Key」で作成
   - `lin_api_` で始まる文字列

2. **使用方法**
   - 環境変数 `LINEAR_API_KEY` に設定
   - GraphQLリクエストの `Authorization` ヘッダーに設定

3. **権限**
   - 自動的に `write` 権限が付与される
   - タスクの作成・更新・コメント追加が可能

## 📊 GraphQL APIの使用

Linear APIはGraphQLを使用しています。

### 例: タスク作成

```graphql
mutation CreateIssue($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      title
      state {
        name
      }
    }
  }
}
```

### 例: タスク更新

```graphql
mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue {
      id
      identifier
      state {
        name
      }
    }
  }
}
```

## 🎯 実際の動作例

### シナリオ1: 気づきを記録

```
ユーザー: 「予測アルゴリズムが遅いことに気づいた」

AI: [会話を分析]
    → 「気づき」「メモすべき内容」と判断
    → 「この気づきをLinearチケットとして記録しますか？」と確認
    → ユーザーが承認
    → run_terminal_cmd("node scripts/linear-cli.js create '予測アルゴリズムのパフォーマンス改善' '計算が遅い問題を改善する'")
    → 「✅ Linearチケットを作成しました: BIZ-123」
```

### シナリオ2: 実装タスクの管理

```
ユーザー: 「ログイン機能を実装したい」

AI: [会話を分析]
    → 「実装タスク」と判断
    → 「実装タスクをLinearチケットとして作成しますか？」と確認
    → ユーザーが承認
    → run_terminal_cmd("node scripts/linear-cli.js create 'ログイン機能の実装' 'ユーザー認証機能の実装'")
    → 「✅ Linearチケットを作成しました: BIZ-124」
    
    [実装開始時]
    → run_terminal_cmd("node scripts/linear-cli.js update BIZ-124 '進行中' '実装を開始'")
    → 「✅ Linearチケット BIZ-124 を「進行中」に更新しました」
    
    [実装完了時]
    → run_terminal_cmd("node scripts/linear-cli.js update BIZ-124 '完了' '実装完了'")
    → 「✅ Linearチケット BIZ-124 を「完了」に更新しました」
```

## 🔄 自動化のレベル

### 現在の実装

- ✅ CLIツール (`linear-cli.js`) は実装済み
- ✅ AIが会話の文脈から判断して実行
- ✅ 確認モードでユーザーの承認を得てから実行

### 今後の改善案

1. **完全自動モード**
   - ユーザーの承認なしで自動実行
   - 設定で有効/無効を切り替え

2. **会話履歴の追跡**
   - 会話の文脈を保持
   - 関連するチケットを自動的にリンク

3. **インテリジェントな分類**
   - バグ、機能追加、改善などを自動分類
   - 適切なラベルを自動付与

## 📝 まとめ

会話の中で自動的にLinearチケットを作成・更新する機能は、以下のように実現されています：

1. **CLIツール**: Linear APIと通信するためのツール
2. **AIの判断**: 会話の文脈から適切なタイミングを判断
3. **実行**: `run_terminal_cmd` を使ってCLIツールを実行
4. **確認**: ユーザーの承認を得てから実行（確認モード）

これにより、会話の中で自然にLinearチケットを管理できるようになっています。

