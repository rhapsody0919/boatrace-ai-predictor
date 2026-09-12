---
description: featureブランチ作成 → PR作成
argument-hint: "[ブランチ名のサフィックス]（省略時はコミット内容から自動生成）"
---

# PR 作成

現在の作業内容からfeatureブランチを作成し、PRを作成します。

## 引数
- `$ARGUMENTS`: ブランチ名のサフィックス（例: `add-alert-feature`）
  - 省略時: コミット内容から自動生成

## 実行手順

### 1. 現在の状態を確認

```bash
git status
git diff --stat
git log --oneline -5
```

### 2. featureブランチを作成

```bash
# 引数があればそれを使用、なければコミット内容から命名
git checkout -b feature/$ARGUMENTS
```

- ブランチ名は `feature/` + kebab-case
- 既にfeatureブランチにいる場合はそのまま使用

### 3. 変更をコミット（未コミットがある場合）

CLAUDE.mdのコミットメッセージ規約に従い、コミットを作成:
- 形式: `<type>: <日本語の説明>`
- type: feat / fix / content / refactor / docs / chore

### 4. リモートにpush

```bash
git push -u origin HEAD
```

### 5. PR作成

```bash
gh pr create --base master --fill
```

- タイトル: 70文字以内
- 本文: Summary（変更概要）+ Test plan（確認事項）
- `--fill` で自動入力後、必要に応じて編集

### 6. Preview URL の確認

PRが作成されると Vercel が自動でPreview URLを生成します。

```bash
# PR情報からPreview URLを確認（Vercel botのコメント）
gh pr view --json url --jq '.url'
```

PR URLをユーザーに報告してください。

### 7. 完了後

PR番号を報告し、`/review-pr {番号}` でレビューできることを案内してください。
