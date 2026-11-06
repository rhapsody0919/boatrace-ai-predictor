---
description: PRをマージし、本番に出る定時（1日3回）を添えて結果を報告する
argument-hint: "<PR番号>"
---

# PRマージ

引数: `$ARGUMENTS`（PR番号）。以降 `{pr}` と表記する。

このコマンドは「ユーザーからマージ承認を得た後」、またはオーケストレーターが段階0でマージするときに使う。マージ承認そのものの取得はこのコマンドの範囲外（`.claude/CLAUDE.md`「実装完了後の自動レビュー」8番、`.claude/skills/orchestrate/SKILL.md` 4節）。マージの手順の正本はこのファイル。

## 手順

### 1. マージ可否の確認
```bash
gh pr view {pr} --json number,state,mergeable,mergeStateStatus
```
`mergeable`が`MERGEABLE`でない、または`mergeStateStatus`が`CLEAN`/`UNSTABLE`以外（`DIRTY`＝コンフリクト等）の場合は、その場でユーザーに状況を報告して停止する（推測でマージを強行しない）。`UNSTABLE`は多くの場合CI項目の一部が本PRと無関係な理由でpending/failureなだけなので、該当チェックの内容を確認した上で進めてよいか一言添える。

master の ruleset（master-guard: 承認1件・最後の push の後の承認・必須の check `verify`・`e2e`・`ml-tests`）を、マージは ryujin-maker の名義で通す。ryujin-maker は bypass に無いので、次が全部そろうまで GitHub が拒む（`BLOCKED`）。そろっていなければマージしない。
- `gh pr view {pr} --json reviewDecision,headRefOid` の `reviewDecision` が `APPROVED`。`CHANGES_REQUESTED`・`REVIEW_REQUIRED` なら止める。承認が今の head に付いているかは `gh api --paginate repos/{owner}/{repo}/pulls/{pr}/reviews --jq '.[] | select(.user.login=="ryujin-reviewer[bot]") | [.state, .commit_id] | @tsv'` の最後の行が `APPROVED` で `commit_id` が `headRefOid` と同じかで見る。審査（review.yml）は作者が ryujin-maker で、枝が `claude/`（OpenAI）か `codex/`（Anthropic）の PR だけに動く
- `gh pr checks {pr}` の必須の3つが緑
- 守る場所（`.github/CODEOWNERS`）に触る PR は、ruleset の require_code_owner_review が ON の間はオーナーの承認も要る。無ければオーナーに頼み、待たずに次へ進む

作者が rhapsody0919 など ryujin-maker 以外の PR は、審査が動かない（#2298 がマージされるまで）ので、admin の bypass を外した後は承認が付かずマージできない。`claude/` の新しい枝で ryujin-maker の名義で出し直す（`/create-pr`）。

### 2. マージ実行
```bash
node scripts/maintenance/ryujin-maker-token.js -- gh pr merge {pr} --squash --match-head-commit <手順1の headRefOid>
```

`--match-head-commit` は、確かめた head の後に push が入っていたらマージしない（hq の codex-pr.py と同じ）。SHA は手順1で読んだ40桁を文字で書く。`.github/workflows/` を変える PR は `--workflows -- gh pr merge …` にする（トークンに workflows の権限を足す）。

`scripts/maintenance/ryujin-maker-token.js` が作成の App（ryujin-maker）の1時間のトークンを作り、`GH_TOKEN` に入れて gh を動かす（鍵の置き場・使い方は script の冒頭）。`--admin` は付けない（ryujin-maker は admin でなく、付けても通らない。オーナーの gh で bypass を使う道を残さないため）。PR 番号は文字で書く（guard-pr-merge.js が `gh pr merge {pr}` を読んで、必須の check・マージ順を先に見る）。鍵がまだ置かれていない間（`秘密鍵が無い` で止まる。`docs/operation/identity-separation-owner-steps.md` の 9-2 の前）は、今までどおり素の gh で `--squash --admin` を付けてマージする（必須の3つの check が全部緑であることを先に確かめる。`--admin` は失敗している check も素通りする）。鍵が置かれた後は、`.claude/hooks/guard-deploy-approval.sh` が `--admin` を止める。名義を変えるのは書き込み（push・PR の作成・マージ）だけで、このコマンドの読み取り（手順1の `gh pr view`・`gh pr checks`、手順3の本番の状態の確認）は今までの `gh` のまま。

続けて、メインの作業ツリーの master を取り込む（SessionStartフックと同じ判定。master・追跡ファイル無変更・独自コミット無しのときだけ fast-forward し、それ以外は警告だけ出す）。
```bash
node scripts/maintenance/check-git-hygiene.js
```

### 3. 本番に出る時刻を確かめる
本番のデプロイはマージごとではなく、1日3回の定時にまとめて出る（ADR-0106。JST 05:45・11:45・17:45 の Vercel Cron が、サイトに関わる差分があり master の検査が通っていれば Deploy Hook を叩く。ビルドに約7分）。マージの直後に本番のビルドを待たない。

ADR-0106 の切り替え（`vercel.json` の `git.deploymentEnabled.master` が false）の前は、今までどおりマージごとに出るので、本番ビルドの完了を待つ:
```bash
gh api repos/{owner}/{repo}/commits/master/status --jq '.state'
```
`pending`の間は15秒程度の間隔でポーリングを続ける（20回、5分程度を上限の目安にする。それ以上かかる場合はVercelのビルドレート制限等の可能性があるためユーザーに報告して判断を仰ぐ）。切り替えの後は、以下に従う。

- 報告には「次の定時（例: 11:45 の約7分後）に本番に出る」と書く
- 出た後に確かめる項目（手順4）がある PR は、次の定時の後にもう一度確かめる。今の本番の版は Vercel の本番のデプロイの sha で見る（`origin/master` の先ではない）
- 障害の修正で次の定時まで待てないときは、オーナーに ADR-0106「手で出す」の操作を頼む（Claude の `gh workflow run` はフックで止まる）。これは1日3回の線の外の起動として報告に書く

### 4. 実機検証（該当する場合のみ）
マージした変更にPRのTest planで「マージ後にX で確認」等の実機検証項目が書かれていれば、本番に出た後に実行する（例: `node scripts/verification/verify-ai-snapshots.js`のような検証スクリプト、GA4データの再取得等）。無ければスキップしてよい。

### 5. 報告
マージ完了・本番に出る定時・（あれば）実機検証結果をユーザーに報告する。本番のビルドが失敗していた場合は、推測で「大丈夫なはず」と判断せず、失敗内容を報告してユーザーの判断を仰ぐ。「ローカルビルド成功」を本番成功の代わりにしない。本番の実際の状態を必ず見る。
