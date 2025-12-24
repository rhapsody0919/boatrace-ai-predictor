# Linear統合セットアップガイド

Claude CodeやCursorで実装した機能をLinearのタスクと自動的に連携させるためのセットアップガイドです。

## 目次

1. [概要](#概要)
2. [方法1: Linear GitHub統合（推奨）](#方法1-linear-github統合推奨)
3. [方法2: GitHub Actions + Linear API](#方法2-github-actions--linear-api)
4. [方法3: コミットフック + Linear API](#方法3-コミットフック--linear-api)
5. [使用方法](#使用方法)
6. [トラブルシューティング](#トラブルシューティング)

---

## 概要

Linearのタスクを自動更新する方法は3つあります：

- **方法1**: Linear公式のGitHub統合（最も簡単、推奨）
- **方法2**: GitHub Actions + Linear API（カスタマイズ性が高い）
- **方法3**: Gitフック + Linear API（ローカルで動作）

---

## 方法1: Linear GitHub統合（推奨）

### セットアップ手順

#### 1. LinearでGitHub統合を有効化

1. Linearの設定画面を開く
   - Linearアプリ → Settings → Integrations → GitHub
   - または https://linear.app/settings/integrations/github

2. GitHubアカウントを接続
   - 「Connect GitHub」をクリック
   - GitHubの認証画面で承認

3. リポジトリを選択
   - 連携したいリポジトリ（`boatrace-ai-predictor`）を選択
   - 「Save」をクリック

#### 2. コミットメッセージでタスクを参照

コミットメッセージにLinearのタスクIDを含めると、自動的にタスクが更新されます。

**形式:**
```
fix: バグ修正

Fixes BOAT-123
```

**利用可能なキーワード:**
- `Fixes BOAT-123` - タスクを完了状態に変更
- `Closes BOAT-123` - タスクを完了状態に変更
- `Resolves BOAT-123` - タスクを完了状態に変更
- `Refs BOAT-123` - タスクにコメントを追加（状態は変更しない）
- `Related to BOAT-123` - タスクに関連付け（状態は変更しない）

#### 3. プルリクエストでタスクを参照

PRのタイトルや説明にタスクIDを含めると、自動的にリンクされます。

**例:**
```
[BOAT-123] 予測機能の実装

- AI予測ロジックを追加
- UIコンポーネントを更新
```

---

## 方法2: GitHub Actions + Linear API

より高度な制御が必要な場合に使用します。

### セットアップ手順

#### 1. Linear APIキー（Member API Keys）を取得

Linearの設定画面で「Member API Keys」を使用してAPIキーを取得します。

**手順:**

1. Linearアプリを開く（Web版: https://linear.app またはデスクトップアプリ）
2. **左下のプロフィールアイコン**をクリック
3. **「Settings」**（設定）を選択
4. **「API」** セクションを開く
5. **「Member API Keys」** を選択
6. **「Create API Key」** または **「新しいAPIキーを作成」** をクリック
7. キー名を入力（例: `GitHub Actions`）
8. 生成されたキーをコピー（**一度しか表示されません**）

**設定画面の構成:**

Linearの設定画面には以下のセクションがあります：
- **OAuth Applications** - OAuthアプリケーションの管理
- **Webhooks** - Webhookの設定
- **Member API Keys** - APIキーの作成・管理（**これを使用します**）

**重要:**
- APIキーは `lin_api_` で始まる文字列です
- APIキーは一度しか表示されません。コピーしたら安全な場所に保管してください
- APIキーには自動的に `write` 権限が付与されます

#### 2. GitHub SecretsにAPIキーを設定

1. GitHubリポジトリのページを開く
2. Settings → Secrets and variables → Actions
3. 「New repository secret」をクリック
4. 以下を設定：
   - Name: `LINEAR_API_KEY`
   - Secret: 先ほどコピーしたAPIキー
5. 「Add secret」をクリック

#### 3. Linear Team IDを取得

1. Linearアプリで任意のタスクを開く
2. URLを確認（例: `https://linear.app/your-team/issue/BOAT-123`）
3. `your-team` の部分がTeam ID

#### 4. GitHub SecretsにTeam IDを設定

1. GitHubリポジトリのSettings → Secrets
2. 新しいシークレットを作成：
   - Name: `LINEAR_TEAM_ID`
   - Secret: あなたのTeam ID

#### 5. GitHub Actionsワークフローを作成

`.github/workflows/linear-sync.yml` ファイルを作成：

```yaml
name: Linear Task Sync

on:
  push:
    branches: [ main, develop ]
  pull_request:
    types: [ opened, closed, synchronize ]

jobs:
  sync-linear:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Extract Linear IDs from commits
        id: extract-ids
        run: |
          if [ "${{ github.event_name }}" == "push" ]; then
            COMMITS=$(git log --format=%B ${{ github.event.before }}..${{ github.event.after }})
          else
            COMMITS=$(git log --format=%B ${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }})
          fi
          
          # LinearタスクIDを抽出（BOAT-123形式）
          LINEAR_IDS=$(echo "$COMMITS" | grep -oE '[A-Z]+-[0-9]+' | sort -u | tr '\n' ',' | sed 's/,$//')
          
          if [ -z "$LINEAR_IDS" ]; then
            echo "No Linear IDs found"
            exit 0
          fi
          
          echo "ids=$LINEAR_IDS" >> $GITHUB_OUTPUT
          echo "Found Linear IDs: $LINEAR_IDS"

      - name: Update Linear tasks
        if: steps.extract-ids.outputs.ids != ''
        env:
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          LINEAR_TEAM_ID: ${{ secrets.LINEAR_TEAM_ID }}
        run: |
          IFS=',' read -ra ID_ARRAY <<< "${{ steps.extract-ids.outputs.ids }}"
          
          for ID in "${ID_ARRAY[@]}"; do
            echo "Updating Linear task: $ID"
            
            # タスクの現在の状態を取得
            TASK_DATA=$(curl -s -X POST https://api.linear.app/graphql \
              -H "Authorization: $LINEAR_API_KEY" \
              -H "Content-Type: application/json" \
              -d "{
                \"query\": \"query { issue(id: \\\"$ID\\\") { id state { name } } }\"
              }")
            
            # コミットメッセージから状態を判定
            COMMIT_MSG=$(git log --format=%B -1)
            
            if echo "$COMMIT_MSG" | grep -qiE "(fixes|closes|resolves).*$ID"; then
              # タスクを完了状態に変更
              curl -s -X POST https://api.linear.app/graphql \
                -H "Authorization: $LINEAR_API_KEY" \
                -H "Content-Type: application/json" \
                -d "{
                  \"query\": \"mutation { issueUpdate(id: \\\"$ID\\\", input: { stateId: \\\"Done\\\" }) { success } }\"
                }"
              echo "Marked $ID as done"
            else
              # タスクにコメントを追加
              curl -s -X POST https://api.linear.app/graphql \
                -H "Authorization: $LINEAR_API_KEY" \
                -H "Content-Type: application/json" \
                -d "{
                  \"query\": \"mutation { commentCreate(input: { issueId: \\\"$ID\\\", body: \\\"GitHub commit: ${{ github.event.head_commit.message }}\" }) { success } }\"
                }"
              echo "Added comment to $ID"
            fi
          done
```

#### 6. より高度なワークフロー（GraphQLクエリを使用）

Linear APIはGraphQLを使用しているため、より詳細な制御が可能です。以下のようなワークフローも作成できます：

```yaml
name: Linear Advanced Sync

on:
  pull_request:
    types: [ opened, closed, synchronize ]

jobs:
  sync-linear:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install @linear/sdk

      - name: Update Linear tasks
        env:
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
        run: |
          node .github/scripts/linear-sync.js
```

---

## 方法3: コミットフック + Linear API

ローカルでコミット時に自動的にLinearタスクを更新する方法です。

### セットアップ手順

#### 1. Linear APIキーを取得

方法2の手順1を参照してください。

#### 2. 環境変数を設定

```bash
# ~/.zshrc または ~/.bashrc に追加
export LINEAR_API_KEY="your-api-key-here"
export LINEAR_TEAM_ID="your-team-id"
```

#### 3. Gitフックスクリプトを作成

`.git/hooks/commit-msg` ファイルを作成：

```bash
#!/bin/bash

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# LinearタスクIDを抽出
LINEAR_IDS=$(echo "$COMMIT_MSG" | grep -oE '[A-Z]+-[0-9]+' | sort -u)

if [ -z "$LINEAR_IDS" ]; then
  exit 0
fi

# 各タスクIDに対して処理
for ID in $LINEAR_IDS; do
  echo "Found Linear task: $ID"
  
  # コミットメッセージに "Fixes" や "Closes" が含まれているか確認
  if echo "$COMMIT_MSG" | grep -qiE "(fixes|closes|resolves).*$ID"; then
    echo "Marking $ID as done..."
    # Linear APIを呼び出してタスクを完了状態に変更
    # （実際のAPI呼び出しはcurlやNode.jsスクリプトで実装）
  fi
done
```

#### 4. スクリプトに実行権限を付与

```bash
chmod +x .git/hooks/commit-msg
```

---

## 使用方法

### コミットメッセージの書き方

#### 基本的な使い方

```bash
git commit -m "feat: 予測機能を実装

Fixes BOAT-123"
```

#### 複数のタスクを参照

```bash
git commit -m "fix: 複数のバグを修正

Fixes BOAT-123
Fixes BOAT-124
Refs BOAT-125"
```

#### タスクを完了させずに関連付けのみ

```bash
git commit -m "docs: ドキュメントを更新

Related to BOAT-123"
```

### プルリクエストでの使い方

PRのタイトルや説明にタスクIDを含めます：

```
[BOAT-123] 予測機能の実装

## 変更内容
- AI予測ロジックを追加
- UIコンポーネントを更新

## 関連タスク
- Fixes BOAT-123
- Related to BOAT-124
```

---

## トラブルシューティング

### Linearタスクが更新されない

1. **コミットメッセージの形式を確認**
   - タスクIDが正しい形式か（例: `BOAT-123`）
   - キーワードが正しいか（`Fixes`, `Closes`, `Resolves`など）

2. **Linear統合の設定を確認**
   - GitHub統合が有効になっているか
   - 正しいリポジトリが選択されているか

3. **APIキーの権限を確認**
   - `write`権限があるか
   - キーが有効期限内か

### GitHub Actionsが動作しない

1. **Secretsの設定を確認**
   - `LINEAR_API_KEY`が正しく設定されているか
   - `LINEAR_TEAM_ID`が正しく設定されているか

2. **ワークフローのログを確認**
   - GitHub Actionsのログを確認
   - エラーメッセージを確認

3. **GraphQLクエリの構文を確認**
   - Linear APIのドキュメントを参照
   - クエリが正しい形式か

### 参考リンク

- [Linear API Documentation](https://developers.linear.app/docs)
- [Linear GitHub Integration](https://linear.app/docs/integrations/github)
- [Linear GraphQL API](https://developers.linear.app/docs/graphql/working-with-the-graphql-api)

---

## 推奨設定

### 開発フロー

1. **Linearでタスクを作成**
   - タスクIDをメモ（例: `BOAT-123`）

2. **ブランチを作成**
   ```bash
   git checkout -b feature/BOAT-123-prediction-feature
   ```

3. **実装とコミット**
   ```bash
   git commit -m "feat: 予測機能を実装

   Implements BOAT-123"
   ```

4. **プルリクエストを作成**
   - タイトル: `[BOAT-123] 予測機能の実装`
   - 説明: `Fixes BOAT-123`

5. **マージ時に自動更新**
   - PRがマージされると、Linearタスクが自動的に完了状態になります

---

## 次のステップ

1. 方法1（Linear GitHub統合）を試す
2. 必要に応じて方法2（GitHub Actions）を追加
3. チーム全体でコミットメッセージの規約を統一

質問や問題があれば、LinearのサポートまたはGitHubのIssuesでお知らせください。

