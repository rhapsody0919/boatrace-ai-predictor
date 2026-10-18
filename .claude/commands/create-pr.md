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

### 2. 作業ブランチを確かめる

```bash
git branch --show-current
```

- master にいたら、`git worktree` で最新の `origin/master` から作業ツリーとブランチ（`claude/` + kebab-case。引数があればそれを使う）を用意してから続ける。`codex/` は Codex 専用
- 既に作業ブランチにいる場合はそのまま使う。想定と違うブランチなら、他のセッションの割り込みを疑い `git reflog` で確かめる

### 3. 変更をコミット（未コミットがある場合）

CLAUDE.mdのコミットメッセージ規約に従い、コミットを作成:
- 形式: `<type>: <日本語の説明>`
- type: feat / fix / content / refactor / docs / chore

### 3.5 ビルド確認（push・PR作成前に必須）

```bash
npm run build
```

**エラーがあれば、push・PR作成に進む前にここで直す**。E2E と verify の全件は CI に任せ、手元では変更に関係するもの（`verify:sitemap`・`verify:content-index`・`verify:adr-numbers`・`verify:er-diagram` や対象の spec）だけを実行する（AGENTS.md「検証・テスト」）。

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

PR番号を報告し、`.claude/CLAUDE.md`「実装完了後の自動レビュー」（`/code-review` と Codex の審査）に進む。
