# アナロジー・ファインダーの週次の学習の自動起動（BOA-271 T10-7）

Vercel Cron（`/api/cron/analogy-dispatch-train`、UTC 土曜 19:00 = **日曜 JST 4:00**）が、GitHub Actions の Train Analogy Finder（`train-analogy.yml`）を master で起動する。本体は `scripts/lib/analogyDispatch.js`、ジョブ名は `analogy_dispatch_train`（`scrape_job_state` の1行でモードを持つ）。

| モード | 動き |
|---|---|
| 行なし・`off` | 何もしない（応答 `skipped: "mode_off"`） |
| `shadow` | 起動しない。起動するはずだったことだけを `last_report` に残す |
| `live` | `workflow_dispatch` を送る。失敗（トークン未設定・HTTP 失敗）は1回目から Slack（`failureAlertAfter: 1`） |

## 1. shadow にする（ユーザー、SQL Editor）

```sql
insert into scrape_job_state (job, mode) values ('analogy_dispatch_train', 'shadow')
on conflict (job) do update set mode = excluded.mode;
```

## 2. 日曜（JST 4:00 の後）に shadow の記録を確かめる

### 2-1. ジョブの状態（読み取り）

```sql
select mode, last_tick_at, last_success_at, consecutive_failures, last_error, last_rows_written, last_report
from scrape_job_state where job = 'analogy_dispatch_train';
```

live にしてよい条件（全部）:
- `mode` が `shadow`
- `last_tick_at` と `last_success_at` が、その日曜の JST 4:00 から数分以内（UTC では土曜 19:00 台）。Vercel Cron は遅れることがあるので、4:00〜4:10 なら可
- `consecutive_failures` が 0、`last_error` が null
- `last_report` に `"target": "train"`・`"workflow": "train-analogy.yml"`・`"dispatched": false`・`"wouldDispatch": true` がある

どれかが満たされないとき:
- `last_tick_at` が空・古い: Cron が呼ばれていない。Vercel の Cron Jobs 画面と、下の 2-2 のログを見る
- `consecutive_failures` が1以上: `last_error` の内容を学習側レーンに渡す（shadow では外部に送らないので、ここで失敗するのは DB・リースの不具合）

### 2-2. Vercel のログ（任意）
Vercel → Project → Logs で、パス `/api/cron/analogy-dispatch-train`、日曜 JST 4:00 前後。応答の本文に `"mode":"shadow"`・`"wouldDispatch":true` があること。

### 2-3. 起動されていないこと
GitHub → Actions → Train Analogy Finder に、その日曜 4:00 前後の実行が**無い**こと（shadow は起動しない）。

## 3. live にする（ユーザー、SQL Editor）

```sql
update scrape_job_state set mode = 'live' where job = 'analogy_dispatch_train';
```

- PAT `GITHUB_ACTIONS_DISPATCH_TOKEN`（Vercel の Production の環境変数、Actions: Read and write のみ）は登録済み（T0-5）。期限が切れると live の起動が HTTP 401 で失敗し、1回目から Slack に出る
- 次の日曜 4:00 の後に確かめること: GitHub Actions に Train Analogy Finder の実行があり（起動は workflow_dispatch、branch は master）、`last_report.dispatched` が `true`。学習は約2.5時間で、成功すれば表示に使う版が切り替わる（`analogy_models.is_active`）

## 失敗したときのやり直し（学習の段ごと）
- 品質ゲートで止まった: 何も書かれず、前の版の表示が続く。理由は実行の Step Summary
- profiles の計算で止まった: Train Analogy Finder を `profiles_only_version` にその版名（例 `2026-10-11`）を入れて手動実行（学習はしない、約15分）
- DB への書き込みで止まった: `write_only_version` に版名を入れて手動実行

## 止める
```sql
update scrape_job_state set mode = 'off' where job = 'analogy_dispatch_train';
```
