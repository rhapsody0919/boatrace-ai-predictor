# Claudeアカウント切替 運用ランブック

現行のClaudeアカウントから別アカウント（個人アカウント）へ切り替える（または週次上限に当たって一時的に切り替える）際に、**claude.ai側にしか存在しない資産**を最短で再構築するための手順書。切替後のセッションでこのファイルを読めば、棚卸しからやり直さずに再構築へ直行できることを目的とする。

ローカルのセットアップ手順そのものは[`claude-code-setup.md`](./claude-code-setup.md)を参照。

## 1. 前提

- 現行アカウントは**個人Max 5xサブスク**（契約メールは業務用アドレス）。Team/Enterpriseの席ではない（`oauthAccount.organizationType = claude_max`、`organizationRateLimitTier = default_claude_max_5x`、`seatTier = null`、`organizationRole = admin`）。`managed-settings.json`は存在せず、組織による設定の強制はゼロ
- **請求経路の都合でusage credits（上限超過後の従量継続）を選択できない**。したがって週次上限に当たった場合の現実的な回避策は「リセットを待つ」か「別アカウントへ切り替える」の二択
- 切替そのものはmacOS Keychainの`Claude Code-credentials`を入れ替える操作（CLIなら`/logout`→`/login`、デスクトップアプリならアプリ本体のログイン切替）

## 2. 何が失われ、何が失われないか

ローカルの`~/.claude/`配下はすべて**ファイルパス基準**で保存されており、アカウントUUIDでキーされたディレクトリ・ファイルは存在しない（`find ~/.claude -name "*<accountUuid>*"`が0件）。

| 引き継がれる（ローカル/Git） | 失われる（claude.aiアカウント側） |
|---|---|
| `~/.claude/CLAUDE.MD`・`settings.json`・permissions | 使用上限の枠そのもの（切替の目的） |
| リポジトリ内の`.claude/`（CLAUDE.md・rules・commands・skills） | claude.ai由来のMCPコネクタ（Linear公式リモートMCP・Claude Docs・Google Drive等）。これらは`~/.claude.json`に定義が無く、アカウント側管理 |
| `~/.claude/projects/<path>/memory/`・全セッションtranscript・`history.jsonl`・`file-history/`・`plans/` | claude.ai側のRoutine（下記インベントリ）とクラウド環境 |
| `.mcp.json`のsupabase/vercel/linear（認証は`SUPABASE_ACCESS_TOKEN`・Vercel OAuth・`LINEAR_API_KEY`でClaudeアカウントと無関係） | 公開済みArtifact（設計モック類、2026-09時点で25件以上） |
| git/gh認証・`.env.local`・direnv・plugins | クラウドセッション・Remote Control・他デバイスとのセッション共有 |

つまり**再構築が必要なのは「Routine」「クラウド環境」「コネクタ」「Artifact」の4種だけ**。

## 3. claude.ai側インベントリ（2026-09-24時点の実測）

### 3-1. Routine

`RemoteTrigger`ツールの`get`で確認した稼働状態。

| Routine名 | trigger ID | cron (UTC) | JST | enabled | 備考 |
|---|---|---|---|---|---|
| `sns-hub-content-generation` | `trig_01WW4Kc6vd7WtV9SXWJcFGis` | `0 0 * * *` | 9:00 | **false**（2026-09-15更新時点で無効） | APIトークン付き（2026-08-28作成、値はclaude.ai側のみ）。sns-hub管理画面の承認/修正指摘/作り直し/手動生成の発火先 |
| `sns-hub-video-compaction` | `trig_01JXV2cDnzEBHxS2zvrCbLLy` | `0 18 * * *` | 3:00 | **true**（2026-09-23実行成功） | APIトークン無し。Storage上の動画を不可逆に上書きする |
| `sns-hub`（旧版） | `trig_01NZZ2ZfA34krpHFHeSz7hhG` | — | — | false（無効化済み残置） | `docs/operation/sns-marketing-strategy.md`に記録あり |

共通設定（両Routineとも同一）:

- `environment_id`: `env_017w737AHTxf72HtiRe99La3`（クラウド環境「**sns-hub-v3**」）
- `model`: `claude-sonnet-5`
- `sources`: `https://github.com/rhapsody0919/boatrace-ai-predictor`
- `environment_variables`: 空（＝シークレットはRoutineではなく環境側に置かれている）
- `mcp_connections`: `Claude_Code_Remote`（`https://api.anthropic.com/v1/code/mcp/meta`、自動付与）
- `persist_session: false`、通知（email/push/slack）すべてoff
- `allowed_tools`: content-generationは`Bash,Read,Write,Edit,Glob,Grep,WebFetch`、video-compactionは`Bash,Read`

**sns-topic-gate体系（現行の本流）のRoutine群**は`docs/operation/`にプロンプト本文が存在するため、本文の再作成は不要（trigger IDだけがアカウント側にある）。対応表:

| 運用ドキュメント | 役割 |
|---|---|
| `docs/operation/sns-topic-proposer-weekly.md` | 週次ネタ提案（要承認、venue-characteristic / feature-intro / trivia） |
| `docs/operation/sns-topic-proposer-daily-auto.md` | 日次ネタ自動提案（承認レス） |
| `docs/operation/sns-pipeline-x.md` | Xチャネル別パイプライン |
| `docs/operation/sns-pipeline-tiktok.md` | TikTokチャネル別パイプライン |
| `docs/operation/sns-pipeline-blog.md` | ブログチャネル別パイプライン |
| `docs/operation/sns-pipeline-note.md` | noteチャネル別パイプライン |
| `docs/operation/sns-pipeline-youtube.md` | YouTubeチャネル別パイプライン |

**リポジトリに本文が無い2本**は本ディレクトリに退避済み:

- [`claude-routines/sns-hub-content-generation.prompt.md`](./claude-routines/sns-hub-content-generation.prompt.md)
- [`claude-routines/sns-hub-video-compaction.prompt.md`](./claude-routines/sns-hub-video-compaction.prompt.md)

### 3-2. クラウド環境「sns-hub-v3」（`env_017w737AHTxf72HtiRe99La3`）

- カスタムネットワーク許可: `*.supabase.co`・`hooks.slack.com`・`*.boat-ai.jp`＋パッケージマネージャーのデフォルト許可リスト
- 環境変数: `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `SLACK_WEBHOOK_URL`
- プリインストール前提: Playwright用Chromium headless shell（`/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell`）。Remotion標準のChromeダウンロードは許可リストでブロックされるため`--browser-executable`指定が必須
- `ffmpeg`はRoutine内で`apt-get install -y ffmpeg`する前提
- 旧環境`sns-hub`・`sns-hub-v2`は未使用（移行不要）

### 3-3. コネクタ・MCP

| 種別 | 対象 | 切替後の扱い |
|---|---|---|
| claude.aiコネクタ | Linear（公式リモートMCP）・Claude Docs・Google Drive・visualize | **再接続・再認証が必要**（claude.aiのコネクタ設定画面から） |
| プロジェクト`.mcp.json` | supabase（`--read-only`、`project-ref=phwgirodvaptywzyibmi`）・vercel（`https://mcp.vercel.com`）・linear（`node_modules/linear-mcp`＋`LINEAR_API_KEY`） | そのまま動く（Claudeアカウント非依存） |
| グローバル`~/.claude.json` | aws-knowledge | そのまま動く |

Linear MCPが未認証の場合は`scripts/linear-cli.js`にフォールバックする既存運用のまま（`.claude/CLAUDE.md`参照）。

### 3-4. Artifact

設計モック・比較案が25件以上、すべて現行アカウントの私物として存在する（`docs/design/`から参照しているものを含む）。**アカウント間の移行手段は無い**。切替後も参照したいものは、切替前に`Artifact`ツールの`read`でHTMLをローカル保存しておく。

## 4. 切替前にやること

- [ ] このランブックが最新か確認（Routineを追加・変更したら3-1の表を更新する）
- [ ] claude.aiのRoutine一覧画面（`claude.ai/code/routines`）を開き、**全Routineの名前とtrigger IDをスクリーンショットまたはコピー**しておく。`RemoteTrigger list`は新しい20件しか返さず、`cursor`パラメータでのページングが効かない（2026-09-24検証済み）ため、ツール経由では全件列挙できない
- [ ] 参照したいArtifactを`Artifact` → `action: read`でローカル保存
- [ ] 稼働中Routine（現状は`sns-hub-video-compaction`のみ）を止めるか、旧アカウント側で動かし続けるかを決める。旧アカウントのサブスクが生きている限りRoutineは動き続ける点に注意（Supabase Storageを不可逆に上書きするRoutineなので、新旧アカウントで二重に動かさない）

## 5. 切替後の再構築手順

1. **ログイン確認**: `/status`でアカウントを確認。ローカルの`~/.claude/`はそのまま引き継がれているので、CLAUDE.md・メモリ・過去セッションは何もしなくても読める
2. **コネクタ再接続**: claude.aiのコネクタ設定でLinear・Claude Docs・Google Driveを再認証。`/mcp`で状態確認。Linearが未認証なら`scripts/linear-cli.js`で代替しつつ後回しにしてよい
3. **クラウド環境を作る**: 名前`sns-hub-v3`で新規作成し、3-2のネットワーク許可リストと環境変数3つを設定。払い出された`env_...` IDを控える
4. **Routineを作る**: `RemoteTrigger`の`create`を使う。本文は3-1の対応表にあるドキュメント、または`claude-routines/*.prompt.md`をそのまま`events[0].data.message.content`に入れる。bodyの形は下記
5. **APIトリガーを追加**（`sns-hub-content-generation`相当のみ）: claude.aiのRoutine画面で「Add trigger」→「API」→トークン生成。**この操作はCLI/API経由ではできない**（`docs/design/sns-marketing-hub/tasks.md`に既知の制約として記録済み）
6. **Vercel環境変数を更新**: 5で得たURL・トークンを`SNS_HUB_ROUTINE_FIRE_URL` / `SNS_HUB_ROUTINE_FIRE_TOKEN`に設定。`vercel env add`は改行混入を避けるため`echo`ではなく`printf`でパイプする
7. **メモリを更新**: `sns_marketing_hub_operational_state.md`のtrigger ID・環境IDを新しい値に置き換える（古いIDが残っていると次のセッションが存在しないRoutineを触ろうとする）

### `RemoteTrigger create` のbody

```json
{
  "name": "sns-hub-video-compaction",
  "cron_expression": "0 18 * * *",
  "enabled": false,
  "job_config": {
    "ccr": {
      "environment_id": "<新しい env_... を入れる>",
      "events": [
        {
          "data": {
            "message": { "content": "<prompt.md の中身をそのまま>", "role": "user" },
            "role": "user",
            "type": "user"
          }
        }
      ],
      "session_context": {
        "allowed_tools": ["Bash", "Read"],
        "model": "claude-sonnet-5",
        "sources": [
          { "git_repository": { "url": "https://github.com/rhapsody0919/boatrace-ai-predictor" } }
        ]
      }
    }
  }
}
```

- `enabled: false`で作り、手動`run`で1回検証してから有効化する（video-compactionはStorageを不可逆に上書きするため必須）
- `update`は部分更新が効かないため`job_config.ccr`全体を送る
- APIトリガーのfireエンドポイント呼び出しには`anthropic-version: 2023-06-01`と`anthropic-beta: experimental-cc-routine-2026-04-01`ヘッダーが必要

## 6. 検証

- `RemoteTrigger` → `action: list`で作成したRoutineが見えるか
- `action: run`で1回実行し、`list_runs`→`get_run_log`で結果を確認
- `sns-hub-video-compaction`: 対象0件の日は「何もしない」が正常。ログに変換前後のファイルサイズが出ているか確認
- sns-hub管理画面（`/admin/sns-hub`）の修正指摘・作り直しボタンを押し、`fireRoutine()`が`{fired: false}`で黙って落ちていないか確認（環境変数未設定時は`{fired: false}`を返して処理継続する設計）

## 7. 未解決事項

- `sns-hub-content-generation`が**2026-09-15時点で無効化されている**。sns-topic-gate体系への移行で生成側の役割は終えているが、管理画面の`translate`/`revise`/`redo`/`generate-daily`/`generate-evergreen`の発火先がこのRoutineのままであれば、それらのボタンが機能していない可能性がある。無効化が意図的なものか、移行時の取り残しかは要確認
