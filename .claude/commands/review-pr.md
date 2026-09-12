---
description: PRレビュー（ルール準拠チェック）
argument-hint: "[PR番号またはPR URL]（省略時は現在のブランチのPRをレビュー）"
---

# PR レビュー

指定されたPRの内容を確認し、CLAUDE.mdおよびrules/のルールに照らしてレビューを行います。

## 引数
- `$ARGUMENTS`: PR番号（例: 123）またはPR URL。省略時は現在のブランチのPRをレビュー

## 実行手順

### 1. PR情報の取得

```bash
gh pr view $ARGUMENTS --json number,title,body,additions,deletions,changedFiles,headRefName,baseRefName,files
```

### 2. 差分の取得

```bash
gh pr diff $ARGUMENTS
```

### 3. ビルド確認

```bash
npm run build
```

ビルドエラーがある場合はレビュー結果に含めてください。

### 4. レビュー観点

CLAUDE.mdおよび `.claude/rules/` のルールに照らして確認:

#### コーディング規約（rules/code-style.md）
- [ ] 「競艇」という表記が使われていないか（→「ボートレース」）
- [ ] `!important` が不必要に使われていないか
- [ ] `Header` コンポーネントが含まれているか（ページの場合）
- [ ] `design-tokens.css` のCSS変数を使用しているか
- [ ] ES Modules（import/export）が使用されているか
- [ ] async/awaitが使用されているか
- [ ] デバッグ用コード（console.log）が残っていないか

#### ファイル配置・命名（rules/documentation.md）
- [ ] ファイル名が `kebab-case` になっているか
- [ ] 適切なディレクトリに配置されているか
- [ ] ドキュメントに最終更新日・変更履歴・著者が含まれていないか

#### セキュリティ
- [ ] 環境変数やシークレットがハードコードされていないか
- [ ] SQLインジェクション等の脆弱性がないか

#### モバイル対応（該当する場合）
- [ ] タッチイベントが `onClick` のみで実装されているか
- [ ] 余白がモバイル基準に適合しているか

### 5. レビュー結果の出力

以下の形式で出力:

```markdown
## PR #{番号} レビュー結果

### 概要
- **タイトル**: XXX
- **ブランチ**: feature/xxx → master
- **変更ファイル数**: XX
- **追加/削除行数**: +XX / -XX

### 問題点
1. **[重要]** `path/to/file`: 説明
2. **[軽微]** `path/to/file`: 説明

### 良い点
- XXX

### 判定
- [ ] Approve（問題なし）
- [ ] Request Changes（修正必要）
```

### 6. レビューコメントの投稿

ユーザーに確認の上、GitHubにレビューを投稿:

```bash
# 承認の場合
gh pr review $ARGUMENTS --approve --body "LGTM"

# 修正リクエストの場合
gh pr review $ARGUMENTS --request-changes --body "修正をお願いします"
```
