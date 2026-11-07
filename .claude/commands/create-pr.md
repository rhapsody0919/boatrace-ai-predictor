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

**エラーがあれば、push・PR作成に進む前にここで直す**。E2E と verify の全件は CI に任せ、手元では変更に関係するもの（`verify:sitemap`・`verify:content-index`・`verify:adr-numbers`・`verify:er-diagram` や対象の spec）だけを実行する（AGENTS.md「コマンド」「PR の決まり」）。

### 4. リモートにpush

push と PR の作成は作成の App（ryujin-maker）の名義で行う（オーナー決定 2026-11-06、ADR-0097）。LLM の審査（review.yml）は v3.3（2026-11-06）でやめた。マージの線は `/merge-pr` の手順1（pr-lane.js）。枝が `claude/` でなければ、ここで `git branch -m claude/<名前>` に直してから push する。

```bash
node scripts/maintenance/ryujin-maker-token.js -- git push -u origin HEAD
```

- `.github/workflows/` を変える枝は `--workflows` を付ける（`node scripts/maintenance/ryujin-maker-token.js --workflows -- git push -u origin HEAD`。マージのときも同じ）。付けないトークンには workflows の権限が無く、GitHub が push を拒む
- 鍵がまだ置かれていない（`秘密鍵が無い` で止まる）間は、今までどおり素の `git push`・`gh pr create` で出してよい。その PR は admin の bypass を外した後はマージできないので、鍵が置かれたら ryujin-maker の名義で出し直す

### 5. PR作成

```bash
node scripts/maintenance/ryujin-maker-token.js -- gh pr create --base master --fill
```

- タイトル: 70文字以内
- 本文: Summary（変更概要）+ Test plan（確認事項）
- `--fill` で自動入力後、必要に応じて編集

### 6. 画面の確認

`claude/*` の枝には Vercel Preview が作られない（`vercel.json` の `git.deploymentEnabled`。Preview に本番 DB の管理者キーが載るため、2026-11-06 オーナー決定）。画面の変更は、Claude が手元の dev サーバーを（`run_in_background` で）起動し、Playwright で確かめる（`.claude/CLAUDE.md`「フロントエンド変更の確認は自己完結させる」）。ユーザーに見せるときは、起動したサーバーの URL と確認項目を箇条書きで添える。

PR の URL（`gh pr view --json url --jq '.url'`）をユーザーに報告する。

### 7. 完了後

PR番号を報告し、マージは `/merge-pr` の手順（pr-lane.js の判定・必須の check、heavy はオーナーの承認）に従う。LLM の審査（Codex・review.yml）は v3.3（2026-11-06）でやめた。
