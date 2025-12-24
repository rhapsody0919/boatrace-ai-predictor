#!/bin/bash

# Linear統合セットアップスクリプト

set -e

echo "🚀 Linear統合セットアップを開始します..."
echo ""

# 1. Linear APIキーの確認
echo "📝 ステップ1: Linear APIキーの設定"
echo "   1. Linearアプリを開く"
echo "   2. Settings → API → Personal API keys"
echo "   3. 「Create new key」をクリック"
echo "   4. キー名を入力（例: GitHub Actions）"
echo "   5. スコープで「write」を選択"
echo "   6. 生成されたキーをコピー"
echo ""
read -p "Linear APIキーを入力してください: " LINEAR_API_KEY

if [ -z "$LINEAR_API_KEY" ]; then
  echo "❌ APIキーが入力されていません"
  exit 1
fi

# 2. Team IDの確認
echo ""
echo "📝 ステップ2: Linear Team IDの設定"
echo "   1. Linearアプリで任意のタスクを開く"
echo "   2. URLを確認（例: https://linear.app/your-team/issue/BOAT-123）"
echo "   3. 'your-team' の部分がTeam IDです"
echo ""
read -p "Linear Team IDを入力してください: " LINEAR_TEAM_ID

if [ -z "$LINEAR_TEAM_ID" ]; then
  echo "❌ Team IDが入力されていません"
  exit 1
fi

# 3. GitHubリポジトリの確認
echo ""
echo "📝 ステップ3: GitHubリポジトリの確認"
REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REPO_URL" ]; then
  read -p "GitHubリポジトリのURLを入力してください（例: https://github.com/username/repo）: " REPO_URL
fi

REPO_NAME=$(echo "$REPO_URL" | sed -E 's/.*github\.com[:/]([^/]+\/[^/]+)(\.git)?$/\1/')
if [ -z "$REPO_NAME" ]; then
  echo "❌ リポジトリ名を取得できませんでした"
  exit 1
fi

echo "   リポジトリ: $REPO_NAME"

# 4. GitHub CLIの確認
if ! command -v gh &> /dev/null; then
  echo ""
  echo "⚠️  GitHub CLIがインストールされていません"
  echo "   インストール方法: https://cli.github.com/"
  echo ""
  read -p "GitHub CLIをインストールして続行しますか？ (y/n): " INSTALL_GH
  
  if [ "$INSTALL_GH" != "y" ]; then
    echo "❌ GitHub CLIが必要です"
    exit 1
  fi
fi

# 5. GitHub認証の確認
echo ""
echo "📝 ステップ4: GitHub認証の確認"
if ! gh auth status &> /dev/null; then
  echo "   GitHubにログインしてください..."
  gh auth login
fi

# 6. GitHub Secretsの設定
echo ""
echo "📝 ステップ5: GitHub Secretsの設定"
echo "   Secretsを設定しています..."

gh secret set LINEAR_API_KEY --body "$LINEAR_API_KEY" --repo "$REPO_NAME"
gh secret set LINEAR_TEAM_ID --body "$LINEAR_TEAM_ID" --repo "$REPO_NAME"

echo "   ✅ LINEAR_API_KEYを設定しました"
echo "   ✅ LINEAR_TEAM_IDを設定しました"

# 7. 完了メッセージ
echo ""
echo "✨ セットアップが完了しました！"
echo ""
echo "📋 次のステップ:"
echo "   1. LinearアプリでGitHub統合を有効化してください"
echo "      Settings → Integrations → GitHub"
echo ""
echo "   2. コミットメッセージにLinearタスクIDを含めてください"
echo "      例: git commit -m \"feat: 機能追加\n\nFixes BOAT-123\""
echo ""
echo "   3. プッシュまたはPRを作成すると、自動的にLinearタスクが更新されます"
echo ""

