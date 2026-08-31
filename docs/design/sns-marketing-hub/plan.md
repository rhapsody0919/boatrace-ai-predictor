# SNSマーケティングハブ Phase 1: システム設計

`spec.md`（機能要件）・`screens.md`（画面・コンポーネント）を実現するためのシステム設計。重要な技術判断はADR 0019〜0022に切り出した。

## 全体構成

```
[Claude Code Routine群]                [Supabase]                    [boatAI Webアプリ]
 ・生成Routine(週次/日次) ──書込──▶ sns_drafts 等 ◀──読書込── /api/admin/sns-hub/* ◀──▶ SnsHubAdmin(管理画面)
 ・修正対応Routine(APIトリガー起動)                    ▲                    (Vercel Functions,        (middleware.tsでBasic認証)
 ・動画軽量化Routine(定期実行)                          │                     service role key使用)
                                                Storage(動画/カバー画像)
```

- Routine群はSupabaseに**直接**読み書きする（service role keyをRoutine環境変数に設定、ADR 0021）
- 管理画面（ブラウザ）はSupabaseに直接アクセスせず、必ず`/api/admin/sns-hub/*`を経由する（ADR 0021）
- 承認操作 → 後続Routine起動は、`/api/admin/sns-hub/*`がSupabase更新後にRoutineの`/fire`エンドポイントを叩く形で連携する（ADR 0020）

## データ設計

マイグレーション: [`docs/db-migration/035_sns_marketing_hub_schema.sql`](../../db-migration/035_sns_marketing_hub_schema.sql)

### Storageバケット

`sns-hub-media`（非公開バケット、2026-08-27作成済み）。`sns_drafts.video_storage_path`/`cover_image_path`はこのバケット内の相対パスを指す。フロントエンドへは`/api/admin/sns-hub/drafts`が都度署名付きURL（有効期限1時間）を発行して返す（ADR 0021、直接公開URLにはしない）。

### テーブル概要

| テーブル | 役割 |
|---|---|
| `sns_drafts` | 下書き本体。1レコード=1コンテンツ×1言語×1プラットフォーム |
| `sns_draft_metrics` | エンゲージメント指標（手動/API共通フォーマット） |
| `sns_template_variants` | 型ごとのデザインバリアント・レジストリ |
| `sns_approvers` | 承認者マスタ（タップ選択式、自由入力不可） |

### `sns_drafts`のステータス遷移

```
pending_review ──✅承認──▶ approved ──(投稿完了操作)──▶ posted
      │                       ▲                            │
      │                       └(英語版自動生成、2026-08-31停止中)─ ready_to_post
      │                                                     │
      ├──📝一部修正──▶ revision_requested ──(Routine再生成、新レコード)──▶ pending_review
      │                                                     │
      ├──❌全部作り直し──▶ archived(このレコード) + 新規content_group_idで新レコード生成
      │                                                     │
      └──🗂️非表示にする（status='posted'以外の任意ステータスから可能、2026-08-31追加）──▶ archived
                                                             │
posted ──(30日経過)──▶ video_tier: original → compressed（ステータスはpostedのまま、ADR 0022）
archived ──(7日経過)──▶ video_tier: original → compressed
```

- 「一部修正」は同じ`content_group_id`のまま`parent_draft_id`で旧レコードと紐付け、旧レコードは`archived`にする（要件13・14）
- 「全部作り直し」は新しい`content_group_id`で全く別のアイデアとして生成し直す（旧レコードは`archived`）
- 日本語版（`language='ja'`）のみが`pending_review`〜`revision_requested`のレビューサイクルを通る。英語版（`language='en'`）は日本語版承認と同時に`ready_to_post`で新規作成される設計だったが、**2026-08-31時点で承認時の英語版自動生成Routine起動を停止した**（spec.md要件6参照、英語アカウント未開設のため）。そのため現状`ready_to_post`に遷移する経路は無く、下書きは`approved`のまま投稿完了操作を待つ。`mark-posted`・UI表示（`PostingActionLinks`等）は元々`approved`/`ready_to_post`を同列に扱う実装のため、コード変更なしでこの状態に対応できている
- 「非表示にする」（アーカイブ）は元は却下（全部作り直し）フローの内部遷移だったが、2026-08-31にどのステータスからも手動で使える汎用機能として追加した。ただし`status='posted'`の下書きは対象外（archivedにすると動画保持期間がADR 0022の30日ルールから7日ルールに短縮されてしまうため、UI側で制限）

## Routine設計

### 1. 生成Routine（週次バッチ・当日ネタ、新規）
- トリガー: スケジュール（月曜9時 週次バッチ、毎日朝 当日ネタ用）
- 処理: 型選定ロジック（`sns-video-producer-prompt.md`踏襲）→ Remotionレンダリング（`--browser-executable`指定必須、`spec.md`制約参照）→ リスクチェック（後述）→ `sns_drafts`にINSERT（`status: pending_review`）→ 動画をSupabase Storageにアップロード → 実行完了後、その回で生成した件数をまとめてSlack Webhookに1通通知（要件10、バッチ化）
- 環境セットアップスクリプトに`apt-get install -y ffmpeg`を含める（`spec.md`制約、2026-08-27検証済み）

### 2. 修正対応Routine（APIトリガーで起動、新規）
- トリガー: `/api/admin/sns-hub/drafts/:id/revise`からの`/fire`呼び出し
- 処理: `text`パラメータで受け取ったdraft_id・修正理由・自由記述を読み、対象の`sns_drafts`レコードを参照して修正版を再生成。新レコードをINSERTし、旧レコードを`archived`に更新
- 生成Routineと同一のプロンプト/型選定ロジックを土台にするため、共通部分は同じRoutineの別トリガー（スケジュール+APIの併用、`claude.ai/code/routines`の仕様上1つのRoutineに複数トリガーを持たせられる）として実装することを検討する（実装時に確定）

### 3. 動画軽量化Routine（定期実行、新規、ADR 0022）
- トリガー: スケジュール（日次）
- 処理: `sns_drafts`から`video_tier='original'`かつ（`status='posted' AND posted_at < now() - 30日` または `status='archived' AND archived_at < now() - 7日`）を満たす行を検索し、ffmpegで低ビットレート版に変換してStorageの同一パスを上書き、`video_tier`を`compressed`に更新

## APIレイヤー（`/api/admin/sns-hub/*`、新規）

既存の`api/accuracy/index.js`等とは異なり、書き込みを伴い機密性もあるため、**service role key**を使いBasic認証配下に置く（ADR 0021）。

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/api/admin/sns-hub/drafts` | GET | ステータス別の下書き一覧取得（タブごとのフィルタ） |
| `/api/admin/sns-hub/drafts/:id/approve` | POST | 承認処理。`approver_id`必須。英語版生成Routineの`/fire`を呼ぶ |
| `/api/admin/sns-hub/drafts/:id/revise` | POST | 一部修正。理由コード・自由記述・`approver_id`を受け取り、修正対応Routineの`/fire`を呼ぶ |
| `/api/admin/sns-hub/drafts/:id/redo` | POST | 全部作り直し。上記と同様だが新規`content_group_id`で生成し直す指示を渡す |
| `/api/admin/sns-hub/drafts/:id/mark-posted` | POST | 投稿済みへのステータス更新 |
| `/api/admin/sns-hub/drafts/:id/metrics` | POST | TikTok等の手動指標入力 |
| `/api/admin/sns-hub/approvers` | GET | 承認者マスタ一覧（タップ選択の選択肢） |

## リスクチェックルールの一元管理（要件5）

`sns-video-studio/remotion/risk-rules.json`（新規、git管理下、実装済み）に禁止パターンを配列で持つ。生成Routineのプロンプトと自動チェックロジックの両方が、リポジトリからcloneした同じファイルを参照する（ドリフト防止）。更新は通常のコードPRを経る（ルール変更も一種のコード変更として扱う）。

各ルールは`platforms`（`"all"`または`["tiktok", "youtube"]`等の配列）を持ち、**プラットフォームによって適用範囲を分ける**（2026-08-27追加）。「競艇」表記・廃止済みモデル名・射幸心煽り表現は全プラットフォーム共通のbrand-policyだが、「本命」「対決」「VS」等のギャンブル連想表現はTikTok（実際のガイドライン違反インシデントあり）・YouTube限定とし、Xは対象外とする（Xで同種の実例が無いため）。自動チェックロジックは対象下書きの`platform`列と各ルールの`platforms`を照合してから警告を出す。

## フロントエンド構成

`screens.md`参照。`SnsHubAdmin.jsx`・`snsHubService.js`（`/api/admin/sns-hub/*`を呼ぶ薄いラッパー）・`webShare.js`を新設。`middleware.ts`（プロジェクトルート）で`/admin/sns-hub`と`/api/admin/sns-hub/*`の両方をBasic認証で保護する（`config.matcher`に両パスを含める）。

## ADR一覧

- [ADR 0019: SNSマーケティングハブの運用データ保存先](../../adr/0019-sns-hub-operational-data-storage.md)（Supabase採用、git管理は却下）
- [ADR 0020: 承認操作から自動処理への引き継ぎ方式](../../adr/0020-sns-hub-approval-automation-handoff.md)（RoutineのAPIトリガー採用）
- [ADR 0021: SNSマーケティングハブのデータアクセス方式](../../adr/0021-sns-hub-data-access-pattern.md)（Vercel Functions+service role key採用、anon key直接アクセスは却下）
- [ADR 0022: 動画バイナリの長期保持戦略](../../adr/0022-sns-hub-video-retention-strategy.md)（圧縮保持を採用、完全削除・無期限オリジナル保持は却下）

## `/step3`への未確定事項の持ち越し

spec.mdの未確定事項に加え、本設計で新たに残ったもの:

| # | 項目 | いつ・誰が決めるか |
|---|---|---|
| 1 | Routineからの直接書き込み用service role keyの安全な設定方法 | `/step3`タスク分解時、または実装時 |
| 2 | 生成Routineと修正対応Routineを1つのRoutine（複数トリガー）にするか、2つに分けるか | 実装時、Routines UIでの実際の設定を見て判断 |
| 3 | `/api/admin/sns-hub/*`のVercel Functionsのruntime（edge/Node.js） | 実装時、書き込み処理の複雑さに応じて確定 |
| 4 | Routineの1日あたり実行回数上限の実際の値（spec.md未確定事項から継続） | ユーザーが`claude.ai/settings/usage`で確認 |
