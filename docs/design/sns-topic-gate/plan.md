# SNSコンテンツ ネタ生成ライン: システム設計

`spec.md`（機能要件）・`screens.md`（画面・コンポーネント）を実現するためのシステム設計。重要な技術判断はADR 0036〜0038に切り出した。

## 全体構成

```
[ネタ提案（型ごとに別トリガー、いずれもsns_topics/sns_topic_targetsへ書き込む）]

週次提案Routine（cron、月曜等）          日次自動提案Routine（cron、深夜）      手動生成ボタン拡張
 sns_strategy_insightsのactiveな          データ検知（選手調子等）で             （既存「当日ネタを今すぐ生成」系、
 insightを根拠に候補を作成                 topic_text自動生成                     型選択UIを追加）
      │ status='proposed'                     │ status='approved'                    │ status='approved'（即時）
      ▼ （人間承認待ち）                       ▼ （承認不要、直接approved）            ▼
 sns_topics 1行 + sns_topic_targets（active な sns_target_accounts 全件分、status='pending'）

      │
      ▼（週次のみ）
[sns-hub「ネタ承認」タブ] ── 承認/却下 ──▶ sns_topics.status='approved' / 'rejected'
（ApproverChips流用）

──────────────────────────────────────────────────────────────────
[チャネル別パイプライン（5本、ADR 0037で段階展開）]

blog / note / x / tiktok / youtube それぞれ独立Routine
  型がpoll（週次）: 1時間おきcronでポーリング（2026-09-05、12時間おきから変更）
  型がauto（日次一般）: 日次自動提案Routineの完了を受けて生成
  型がmanual（日次時間制約）: 手動生成ボタンからその場でfire

  各パイプライン:
   1. 自分のtarget_account_idかつstatus='pending'なsns_topic_targetsを取得
      （紐づくsns_topics.status='approved'のもののみ、ADR 0036のアトミックPATCHでclaim）
   2. TikTok等チャネル固有の規約チェックで不適合ならstatus='skipped'+skip_reason（要件14）
   3. 生成 → sns_drafts INSERT（content_group_id = sns_topics.id、format=ビジュアルテンプレート名のみ、要件12）
   4. sns_topic_targets.status='generated' + draft_id更新

──────────────────────────────────────────────────────────────────
[既存の下書き承認フロー（変更なし）]
 SnsHubAdmin プラットフォーム別タブ → DraftCard（ContentTypeBadge追加表示） → 承認/修正/作り直し
  revise/redo は ADR 0038 のplatformマッピングで正しいチャネル別パイプラインへ発火
```

## データ設計

マイグレーション: [`docs/db-migration/043_sns_topic_gate_schema.sql`](../../db-migration/043_sns_topic_gate_schema.sql)

### 新規テーブル

| テーブル | 役割 | 主な列 |
|---|---|---|
| `sns_content_types` | 型定義（週次/日次・一般/日次・時間制約）をデータとして保持 | `type_key`・`cadence`・`requires_topic_approval`・`trigger_mode`・`active` |
| `sns_target_accounts` | 配信先アカウント/ペルソナのレジストリ（今回は現行5チャネル×1アカウントのみ投入） | `platform`・`account_label`・`brand_kit_ref`・`credential_ref`（未使用）・`active` |
| `sns_topics` | ネタ本体 | `topic_text`・`content_type_id`・`status`・`source_insight_ids`（`sns_strategy_insights.id`配列）・`approver_id` |
| `sns_topic_targets` | ネタ×アカウントの中間テーブル。ラベル付け・claim/lock・進捗マトリクスを兼ねる（ADR 0036） | `topic_id`・`target_account_id`・`status`・`claimed_by`・`draft_id` |

詳細な列定義・初期データ投入は上記マイグレーションファイル参照。

### 既存テーブルとの連携（新規列追加なし）

- `sns_drafts.content_group_id` を `sns_topics.id` としてそのまま使う（`content-multi-channel-pipeline`が既に確立している規約を踏襲、新規列は不要）
- `sns_drafts.routine_run_id`（既存列、今まで未使用）を`sns_topic_targets.claimed_by`と同じ値で実際に記録する（spec.md要件5関連、トレーサビリティ確立）
- `sns_strategy_insights` はスキーマ変更なし。`sns_topics.source_insight_ids`から参照するのみ

## API設計（`/api/admin/sns-hub/topics/*`）

既存の`api/admin/sns-hub/drafts/*`・`insights/*`と同じくVercel Edge Function・service role key使用（ADR 0021の役割分担を踏襲）。

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/api/admin/sns-hub/topics` | GET | クエリパラメータ`status`で一覧取得。レスポンスに紐づく`sns_topic_targets`（進捗マトリクス用）を`select`で埋め込む |
| `/api/admin/sns-hub/topics/[id]/approve` | POST | body: `{ approverId }`。`status='approved'`・`approved_at`更新（要件13） |
| `/api/admin/sns-hub/topics/[id]/reject` | POST | body: `{ approverId }`。`status='rejected'`更新 |
| `/api/admin/sns-hub/topics/[id]/targets/[targetId]` | PATCH | body: `{ status: 'pending'\|'skipped' }`。チャネルラベルの手動調整（要件14） |
| `/api/admin/sns-hub/content-types` | GET | 手動生成パネルの型選択ドロップダウン用（要件17） |

`api/_lib/snsHubHelpers.js`に`getTopicById`・`updateTopic`・`getTopicTargets`等、既存の`getDraftById`/`updateDraft`と同じ薄いラッパーパターンで追加する。

## claim機構の実装（ADR 0036）

`api/_lib/snsHubHelpers.js`に共通関数`claimTopicTarget(targetId, routineRunId)`を追加する。

```js
export async function claimTopicTarget(targetId, routineRunId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topic_targets?id=eq.${targetId}&status=eq.pending`,
    {
      method: "PATCH",
      headers: { ...serviceRoleHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        status: "claimed",
        claimed_by: routineRunId,
        claimed_at: new Date().toISOString(),
      }),
    },
  );
  const rows = await response.json();
  return rows[0] || null; // null = 他パイプラインが先にclaim済み
}
```

各チャネル別パイプラインのRoutineプロンプトから、このロジックに相当する手順（Supabase REST APIへの直接PATCH、または将来的にこの関数を薄くラップしたAPIエンドポイント経由）を呼び出す。Routine環境からのSupabase書き込み方法は`docs/design/sns-marketing-hub/spec.md`未確定事項#1の既存方針（service role key直接使用）を踏襲する。

## revise/redoルーティング修正（ADR 0038）

`api/_lib/snsHubHelpers.js`に`PLATFORM_ROUTINE_ENV_PREFIX`マッピングを追加し、`api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`の`fireRoutine("SNS_HUB_ROUTINE", ...)`呼び出しを`fireRoutine(PLATFORM_ROUTINE_ENV_PREFIX[draft.platform] || "SNS_HUB_ROUTINE", ...)`に変更する（フォールバックは段階展開中の未展開チャネル向け、ADR 0037参照）。

## `format`列語彙統一（spec.md要件12）

`content-multi-channel-pipeline-prompt.md`側の実装を修正し、`sns_drafts.format`にはビジュアルテンプレート名（`sns_template_variants.format`と同じ語彙）のみを格納するよう変更する。ネタ種別は`sns_topics.content_type_id`経由（`sns_drafts.content_group_id` → `sns_topics.content_type_id`）で取得する。`DraftCard`の`ContentTypeBadge`はこの経路でcontent_typeを解決し、紐づく`sns_topics`が無い下書き（既存の単発投稿、Pipeline A産）は非表示にする。

## 画面実装（`screens.md`参照）

`SnsHubAdmin.jsx`に以下を追加（既存の単一ファイル構成を踏襲）:
- `TABS`に`{ id: "topics", label: "ネタ承認" }`を追加
- `TopicApprovalTab`: `status='proposed'`なネタ一覧（`requires_topic_approval=true`の型のみ、他は表示しない）
- `TopicCard`: `topic_text`・`ContentTypeBadge`・根拠insight・`ChannelTargetToggle`・承認/却下（`ApproverChips`流用）
- `ContentTypeBadge`: `TopicCard`・`DraftCard`共通の型バッジ
- `ChannelTargetToggle`: `sns_topic_targets`の`pending`⇔`skipped`切り替えチップ
- `TopicProgressMatrix`: 承認済みネタ×アカウントの生成状況テーブル
- 手動生成パネル（`manual-generate-panel`）に型（`sns_content_types`）選択を追加、日次・時間制約型の起動はこの延長で実装
- CSS: `SnsHubAdmin.css`に`.topic-card`・`.content-type-badge`・`.channel-target-toggle`・`.topic-progress-matrix`を追加

## スクリプト構成

- `scripts/lib/snsTopics.js`（新設）: `sns_topics`/`sns_topic_targets`のCRUD・スコープ一致検索。既存`scripts/lib/snsStrategyInsights.js`と同じパターンに従う
- 週次提案Routine・日次自動提案Routine（各`docs/operation/`配下に新規プロンプトファイル）: `.claude/rules/sns-content-generation.md`（spec.md要件9）を前提知識として持つ
- チャネル別5パイプライン（`docs/operation/`配下、ADR 0037）: 既存の`sns-video-producer-prompt.md`（TikTokガンブル規制含む）・`note-video-producer-prompt.md`・`content-multi-channel-pipeline-prompt.md`を土台に分割・整理する

## 既知の制約との整合性確認

- Routine間のプロンプト相互参照は不可という確定事項（2026-09-03実地検証）に沿い、`.claude/rules/sns-content-generation.md`（フロントマターなし）で共通ルールを配布する設計にした
- claimはADR 0036の通りPostgRESTの条件付きPATCHのみで実現し、素のPostgres接続を要する方式は採らない
- 新規Routine発火トークンの登録は人間の手動作業であり自動化できない（`spec.md`制約・前提）。`/step3`のタスク分解で、この手動作業が必要になるタイミングを明示する
