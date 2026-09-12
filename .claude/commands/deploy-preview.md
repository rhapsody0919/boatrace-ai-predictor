---
description: Vercel Preview URL確認
argument-hint: "[PR番号]（省略時は現在のブランチのPRを検索）"
---

# Vercel Preview 確認

PRのVercel Preview URLを確認します。

## 引数
- `$ARGUMENTS`: PR番号（例: 123）。省略時は現在のブランチのPRを検索

## 実行手順

### 1. PR情報の取得

```bash
# 引数指定時
gh pr view $ARGUMENTS --json url,headRefName,statusCheckRollup

# 引数省略時（現在のブランチのPR）
gh pr view --json url,headRefName,statusCheckRollup
```

### 2. デプロイ状況の確認

```bash
gh pr checks $ARGUMENTS
```

### 3. Preview URL の報告

Vercel のデプロイ状況を確認し、Preview URLをユーザーに報告してください。

- デプロイ成功: Preview URLを表示
- デプロイ中: 「デプロイ中です」と報告
- デプロイ失敗: エラー内容を報告

### 4. ビルドエラーがある場合

```bash
npm run build
```

ローカルでビルドを実行し、エラーを特定・修正してください。
