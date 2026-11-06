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

master の ruleset（承認1件必須）を入れた後は、承認の無いPRは`BLOCKED`になる。`gh pr view {pr} --json reviewDecision` が`REVIEW_REQUIRED`で、`mergeable`が`MERGEABLE`、`gh pr checks {pr}` が全部緑なら、承認待ちだけが理由なので進めてよい（それ以外の理由の`BLOCKED`は停止する）。

### 2. マージ実行
```bash
gh pr merge {pr} --squash --admin
```

`--admin` は管理者の bypass で、ruleset の承認必須を越えてマージする（オーナーの権限で動く Claude だけが使える）。失敗しているチェックも素通りするので、手順1でCIが全部緑であることを確かめてから実行する。

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
