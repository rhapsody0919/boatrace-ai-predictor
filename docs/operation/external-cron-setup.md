# 外部 Cron トリガー セットアップガイド

## 概要

GitHub Actions の cron スケジュールはベストエフォートで、高頻度スケジュールほどスキップ率が高い。
外部 cron サービス（cron-job.org）から確実にスケジュール実行するために使う。トリガー先には2パターンある。

- **パターンA**: cron-job.org → GitHub API（`workflow_dispatch`）→ GitHub Actions
- **パターンB**: cron-job.org → Vercel Serverless Function（`/api/cron/*`）を直接呼び出し

パターンBは[スクレイピング基盤のサーバーレス移行](../design/scraping-serverless-migration/spec.md)でPhase 1（展示データ）から導入した、より新しい方式。GitHub Actionsの`concurrency`直列化・チェックアウト等の固定コストが構造的に存在しないため、今後の移行対象（結果取得・オッズ）もこちらに寄せていく想定。

cron-job.orgの無料枠には**ジョブ数の上限は無い**（2026-09-14、cron-job.org公式サイトで確認済み。「最大4ジョブ」という記述が過去にあったが誤りだった）。最小間隔は1分、リクエストタイムアウトは30秒。

## パターンA: GitHub Actions workflow_dispatch

```
cron-job.org（確実なスケジュール実行）
  → GitHub API: POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches
    → GitHub Actions（workflow_dispatch として実行）
```

GitHub Actions 側の cron スケジュールはフォールバックとして残す。

### 対象ワークフロー（現行、2026-09-14時点）

| ワークフロー | Workflow ID | cron-job.org ジョブ名 | 間隔 | 時間帯 (JST) |
|---|---|---|---|---|
| Scrape Scheduled（`scrape-scheduled.yml`） | `257679942` | `scrape-scheduled.yml` | 5分間隔 | 終日 |
| Aggregate Racer Stats | `244870991` | `Aggregate Racer Stats` | 1日1回 | 23:00 |

※ Workflow ID は変更される可能性がある。最新の ID は `gh workflow list` で確認できる。

**旧ワークフローについて**: `Scrape Race Data`（旧 `.github/workflows/scrape.yml`, ID `211107021`）と `Scrape Exhibition Data`（旧 `.github/workflows/scrape-exhibition.yml`, ID `243971527`）は2026-04-09に`scrape-scheduled.yml`へ統合され、両ワークフローファイル自体が削除済み（`gh api repos/{owner}/{repo}/actions/workflows/{id}`で`"state":"deleted"`と確認できる）。cron-job.org側にも同名の古いジョブが残っているが、**Inactive（無効化済み）になっており実際には発火していない**（2026-09-14確認）。削除済みワークフローへの参照だが実害は無いため、履歴として残すか削除するかは任意。

### セットアップ手順

#### 1. GitHub Personal Access Token の発行

1. https://github.com/settings/tokens?type=beta （Fine-grained tokens）
2. **Token name**: `cron-job-org-trigger`
3. **Expiration**: 90日（定期的に更新）
4. **Repository access**: `Only select repositories` → `boatrace-ai-predictor`
5. **Permissions**: `Actions` → `Read and write`（これだけでOK）
6. トークンを控えておく

#### 2. cron ジョブの登録

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

#### 3. 動作確認

```bash
# 手動でAPIを叩いてテスト
node scripts/maintenance/test-workflow-dispatch.js
```

### 注意事項

- **GitHub PAT の有効期限**: 90日ごとに更新が必要。期限切れ前に cron-job.org の設定も更新する
- **concurrency 制御**: `scrape-scheduled`グループは`cancel-in-progress: false`（先勝ち、後はキュー待ち）。高頻度トリガー時にキューが詰まりデータ欠落を起こした実績があり（[investigation.md](../proposal/scraping-serverless-migration/investigation.md)参照）、これが時間に厳しい処理をパターンBへ移行する動機になっている

## パターンB: Vercel Function直接呼び出し

```
cron-job.org（1〜2分間隔等の高頻度スケジュール）
  → Vercel Serverless Function（/api/cron/{name}）を直接HTTPで呼び出し
    → 既存のrun(schedule, date)関数を呼び出し、レスポンスは即座に返す（waitUntilでバックグラウンド継続）
```

GitHub Actionsを経由しないため、`concurrency`直列化やチェックアウト等の固定コストが無い。設計判断の詳細は[スクレイピング基盤のサーバーレス移行 spec](../design/scraping-serverless-migration/spec.md)を参照。

### 対象エンドポイント（現行、2026-09-16時点）

| エンドポイント | cron-job.org ジョブ名 | 間隔 | 時間帯 (JST) | 対応Phase |
|---|---|---|---|---|
| `/api/cron/exhibition` | `Vercel Exhibition Cron` | 2分間隔 | 7:00-23:00 | Phase 1（展示データ）。**2026-09-16、BOA-313 Step 3によりGitHub Actions側を無効化（マージ後に有効化）**（`scrape-scheduled.yml`のリポジトリ変数`SKIP_EXHIBITION_ON_GHA`、詳細は[spec.md](../design/scraping-serverless-migration/spec.md)参照）。マージ後はこちらのVercel版が展示データ取得の唯一の経路になる |

### セットアップ手順

1. cron-job.orgで「CREATE CRONJOB」から新規ジョブを作成
2. **URL**: 対象エンドポイントのフルURL（例: `https://www.boat-ai.jp/api/cron/exhibition`）
3. **Request method**: GET（ハンドラーはメソッドを見ないため、POSTでも動作する）
4. **Request headers**: `Authorization: Bearer {CRON_SECRET}`（値はVercel環境変数`CRON_SECRET`と同一のものを設定する。`vercel env pull`等で確認可能）
5. **Advanced → Timeout**: デフォルトの30秒のままでよい（レスポンスは実処理時間に関わらず数秒で返る設計のため）
6. Schedule / Timezone を設定（Asia/Tokyo）

### 動作確認

```bash
curl -H "Authorization: Bearer {CRON_SECRET}" https://www.boat-ai.jp/api/cron/{name}
```

`202 Accepted`が数秒で返れば正常。cron-job.orgのExecution historyでも`Successful / 202 Accepted`が記録される。実際にSupabaseへ書き込まれたかは、Vercelの関数ログ（`mcp__vercel__get_runtime_logs`等）で確認する。

### 注意事項

- cron-job.orgのタイムアウト（30秒）と実際のスクレイピング所要時間は別の関心事（`waitUntil`でレスポンスを即座に返すため常に余裕がある）。「スクレイピング自体が成功したか」はcron-job.orgの実行履歴では判断できないため、日次の欠落率チェック等、別の監視手段が必要（spec.md参照）
- 実行間隔は、バックグラウンド処理の実測完了時間に対して十分な余裕を持たせること。間隔が短すぎると、前回invocationの完了前に次のinvocationが同じ対象を重複処理する（spec.mdの「未確定事項」参照）
