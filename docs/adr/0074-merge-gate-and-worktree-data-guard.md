# ADR 0074: マージのゲートはGitHubのブランチ保護ではなくローカルのPreToolUseフックで行う

## ステータス

採用（2026-09-25）

## 背景

「別セッションで実装中のバグが多い。モデルが原因か設計が原因か分からない」という問いを受け、2026-08-15以降のfixコミット169件を全件分類した。

### 実測

| 指標 | 値 |
|---|---|
| 実装完了後に実行時・本番で発覚したfix | 147件（レビューで捕捉したのは18〜24件、ユーザー指摘3件） |
| そのうち「防ぐ仕組みが無かった」 | 142件（96.6%） |
| 「仕組みはあったが動いていなかった」 | 5件（3.4%） |
| **CIで止まった例** | **0件** |
| モデル能力に帰せられるもの | 最大38件（25.9%）、厳しく見て約10件（6.8%） |

再発しているバグはほぼ全てプロセス起因で、再発していないバグにモデル起因が偏る。「取得失敗が『データなし』に化ける」は6週間でフロント・バッチ・監視・CIの4層に再発した（ADR-0069で既定値を反転させて決着）。

ADR-0072でPRごとに `npm run verify:ci`（tier=ci、54本）が走るようになったが、**masterにブランチ保護もrulesetも無いため、赤でもマージできる**。実際に直近100マージPRのうち3件がe2e=failureのままマージされている。

### ブランチ保護が使えない理由（2026-09-25に実測）

まず素直にブランチ保護を設定した。

```
gh api -X PUT .../branches/master/protection
  required_status_checks: { strict: false, contexts: ["verify"] }
  enforce_admins: true
```

設定自体は通るが、**必須ステータスチェックはPRのマージだけでなくブランチへの直接pushにも効く**。このリポジトリでは次の8ワークフローが `GITHUB_TOKEN` で master へ直接 push している（いずれも `scripts/maintenance/push-with-retry.sh` 経由、BOA-360）。

`update-sitemap` / `collect-racer-news` / `scrape-venue-motor-stats` / `scrape-venue-entry-course-stats` / `scrape-racer-season-stats` / `train-sherlock` / `train-poirot` / `train-moriarty`

`GITHUB_TOKEN` は管理者ではないため `enforce_admins` の設定に関わらず対象になり、これらが全部落ちる。

GitHub Actions をバイパス対象に指定できるのは ruleset だが、個人所有のリポジトリでは拒否される。

```
POST .../rulesets
  bypass_actors: [{ actor_id: 15368, actor_type: "Integration" }]
→ 422 "Actor GitHub Actions integration must be part of the ruleset source or owner organization"
```

つまり「PRのマージだけを止めて、ワークフローの直接pushは通す」は、Organizationに移さない限りGitHub側の機能では実現できない。

## 決定

マージを実行する側をローカルで止める。このリポジトリでマージを実行するのは実質すべてClaudeなので、PreToolUseフックで `gh pr merge` を検査する。

`.claude/hooks/guard-pr-merge.sh` → `scripts/maintenance/guard-pr-merge.js`

1. **品質ゲート**: `verify` が SUCCESS 以外なら deny、実行中なら ask、結果がまだ無ければ ask。`e2e` が赤い場合は ask に留める（本番Supabaseに直結していてDBの状態で落ちる既知のフレークがあるため、止めはしない）
2. **worktreeごと消えるデータ**: `--delete-branch` を含む場合、そのブランチのworktreeに `scripts/lib/preciousPaths.js` のパスか未コミット変更があれば deny

判定できない場合（PR番号が読めない、ghが応答しない、nodeが無い）は素通しする。ゲートの不調で作業を止める方が、止めるべきものを見逃すより害が大きいため。

### 併せて決めたこと

- **取り直しの効かないデータの定義を1箇所に置く**（`scripts/lib/preciousPaths.js`）。`.gitignore` との整合は `verify-guard-pr-merge.js` が検査する
- **セッション開始時に作業前提を見せる**（`scripts/maintenance/check-git-hygiene.js`、SessionStartフックから呼ぶ）。origin との乖離、worktree の本数、worktree内の保護対象データ。問題が無ければ何も出さない
- **worktree の棚卸しは分類だけ行い、削除はしない**（`npm run check:worktrees`）。「片付けてよい / 触らない / 作業中」に分け、削除コマンドを提示するだけに留める

## 理由

### なぜ散文のルールを足さないか

`.claude/CLAUDE.md` と `.claude/rules/` は6月の350行から9月の944行へ2.7倍に増え、常時読み込みだけで643行・84.5KBある。ADR-0072が示した通り、「該当する変更をしたら手元で実行する」と7本以上を列挙しても実際には守られず、マイグレーション番号の重複がmasterに入った。

実装セッションからの一次情報も同じことを言っている。`.claude/rules/frontend-data-fetch.md` の「失敗をデータなしに化けさせるな」に違反した実装について、当事者は「読んでいなかったのではなく、実装時に想起できず、自分のcode-reviewで初めて照合された」と報告している。

ルールは増やすほど1件あたりの想起率が下がる。機械的に止められるものはフックに落とす。

### なぜ `gh pr merge --delete-branch` を特別扱いするか

gh のヘルプは「Delete the local and remote branch after merge」としか書かないが、実際には**そのブランチのworktreeディレクトリごと削除する**。しかもworktreeの中から実行した場合は「消せないので手動で」と止まり、外から実行した場合だけ消えるという直感に反する挙動（gh 2.99.0で確認）。

このプロジェクトは「新規タスクは必ずworktreeで隔離する」をルールにしているため、worktree と `--delete-branch` の組み合わせは日常的に起きる。2026-09-25に実際にこれで、公式サイトから数夜かけて取得したK/Bファイル約2,730日分（`data/kb-archive`、gitignore対象）とN19の生HTML 172レース分を失った。本番DBに投入済みのデータは無事だったが、「取り直さなくて済むように置いていた生ファイル」が消えた。

## 結果

### 得られるもの

- verifyが赤いPRのマージが止まる（ADR-0072の品質ゲートが初めて「検知」から「防止」になる）
- worktreeごと消える取り直しの効かないデータが守られる
- セッションが古い前提（23コミット遅れのCLAUDE.mdと古いmaster）で始まっていることに、開始時点で気づける

### 引き受けるトレードオフ

- **ユーザーが手でマージする場合は止まらない**。フックはClaude Codeのツール呼び出しにしか効かない。現状マージは実質すべてClaudeが実行しているため許容する
- **フックが壊れても気づきにくい**。判定を純関数に切り出し、`verify-guard-pr-merge.js` で「素通しする側」と「止める側」の両方を検証する（32件）。ADR-0072のランナーが「1本も実行しないまま全て成功と報告する」穴を持っていたのと同じ失敗を避けるため、素通しの確認だけで済ませない
- **ブランチ保護より弱い**。2つのPRが同じ時点のmasterに対して緑になる経路（063の番号重複が入った経路）は防げない。ADR-0072が入れた `push: master` トリガーによる事後検知が引き続き唯一の手当てになる

### この決定を見直す条件

リポジトリをOrganization所有に移した場合、ruleset の bypass_actors で GitHub Actions を指定できるようになるため、本来の形（GitHub側で必須チェック）に戻せる。そのときフックの品質ゲート部分は不要になるが、worktree保護の部分は引き続き要る（GitHubの機能では防げないため）。

## 関連

- ADR-0072（検証スクリプトの台帳とCI実行）— このADRはその品質ゲートを「止められる」ようにするもの
- ADR-0069（Supabaseクエリの取得エラーを既定で例外にする）— 「毎回書く」を「既定でそうなる」に変える同じ発想
- BOA-360（取得系ワークフローのmaster直接push）— ブランチ保護と両立しない制約の出どころ
