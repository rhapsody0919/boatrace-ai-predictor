# 外部 Cron トリガー セットアップガイド

## 概要

GitHub Actions の cron スケジュールはベストエフォートで、高頻度スケジュールほどスキップ率が高い。
外部 cron サービスから `workflow_dispatch` API を叩くことで、確実にワークフローを実行する。

## 構成

```
cron-job.org（確実なスケジュール実行）
  → GitHub API: POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches
    → GitHub Actions（workflow_dispatch として実行）
```

GitHub Actions 側の cron スケジュールはフォールバックとして残す。

## 対象ワークフロー

| ワークフロー | Workflow ID | cron (JST) | 時間帯 (JST) |
|---|---|---|---|
| Scrape Race Data | `211107021` | `0 1,6-23 * * *` | 1:00, 6:00-23:00 |
| Scrape Exhibition Data | `243971527` | `*/15 7-23 * * *` | 7:00-23:00 (15分間隔) |
| Aggregate Racer Stats | `244870991` | `0 23 * * *` | 23:00 |

※ Workflow ID は変更される可能性がある。最新の ID は `gh workflow list` で確認できる。

## セットアップ手順

### 1. GitHub Personal Access Token の発行

1. https://github.com/settings/tokens?type=beta （Fine-grained tokens）
2. **Token name**: `cron-job-org-trigger`
3. **Expiration**: 90日（定期的に更新）
4. **Repository access**: `Only select repositories` → `boatrace-ai-predictor`
5. **Permissions**: `Actions` → `Read and write`（これだけでOK）
6. トークンを控えておく

### 2. cron-job.org のアカウント作成

1. https://cron-job.org/ にアクセス
2. 無料アカウントを作成

### 3. cron ジョブの登録

各ワークフローに対して以下の設定でジョブを作成する。

#### 共通設定

- **URL**: `https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/{WORKFLOW_ID}/dispatches`
- **Request method**: POST
- **Request headers**:
  ```
  Authorization: Bearer {GITHUB_PAT}
  Accept: application/vnd.github.v3+json
  User-Agent: cron-job-org
  ```
- **Request body**:
  ```json
  {"ref": "master"}
  ```

#### ジョブ1: Scrape Race Data

- **URL**: `https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/211107021/dispatches`
- **Schedule**: `0 1,6-23 * * *`
- **Timezone**: Asia/Tokyo

#### ジョブ2: Scrape Exhibition Data

- **URL**: `https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/243971527/dispatches`
- **Schedule**: `*/15 7-23 * * *`
- **Timezone**: Asia/Tokyo

#### ジョブ3: Aggregate Racer Stats

- **URL**: `https://api.github.com/repos/rhapsody0919/boatrace-ai-predictor/actions/workflows/244870991/dispatches`
- **Schedule**: `0 23 * * *`
- **Timezone**: Asia/Tokyo


### 4. 動作確認

```bash
# 手動でAPIを叩いてテスト（Exhibition Data の例）
node scripts/maintenance/test-workflow-dispatch.js
```

## 注意事項

- **GitHub PAT の有効期限**: 90日ごとに更新が必要。期限切れ前に cron-job.org の設定も更新する
- **concurrency 制御**: 各ワークフローの concurrency group により、外部トリガーと GitHub cron が同時に発火しても安全
  - `scrape-exhibition`: `cancel-in-progress: true`（後勝ち）
  - `scrape-pipeline`: `cancel-in-progress: false`（先勝ち、後はキュー待ち）
- **cron-job.org 無料枠**: 最大4ジョブ、最小間隔1分
