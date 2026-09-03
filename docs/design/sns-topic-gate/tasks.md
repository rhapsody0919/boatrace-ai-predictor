# SNSコンテンツ ネタ生成ライン: タスク分解

`spec.md`・`plan.md`・`screens.md`を実現するための実装タスク。依存順に並べる。各タスクは目安1コミット〜1PR。

チャネル別パイプライン（ADR 0037）は5本を一度に作らず、まず**X**を最初の1本として通しで実装し、claim〜生成〜承認〜revise/redoまでのループ全体を検証する。note/blog/tiktok/youtubeへの展開は本タスクリスト完了後の別イテレーションとする（タスク16に候補の切り出し方針のみ記載）。

## DB基盤

- [ ] **1. マイグレーション043適用**
  `docs/db-migration/043_sns_topic_gate_schema.sql`をSupabase Dashboardで実行する（**ユーザー手動作業**）。`sns_content_types`・`sns_target_accounts`・`sns_topics`・`sns_topic_targets`新設、初期データ投入。他タスクの前提。実行後、`information_schema.columns`等で反映を確認する。

## 共通ライブラリ・API基盤

- [ ] **2. `scripts/lib/snsTopics.js`新設**
  `sns_topics`/`sns_topic_targets`のCRUD・スコープ一致検索を行う共通関数。`scripts/lib/snsStrategyInsights.js`と同じパターンに従う。タスク1に依存。

- [ ] **3. `api/_lib/snsHubHelpers.js`拡張**
  `getTopicById`・`updateTopic`・`getTopicTargets`・`claimTopicTarget`（ADR 0036のアトミックPATCH）・`PLATFORM_ROUTINE_ENV_PREFIX`マッピング（ADR 0038）を追加。タスク1に依存。

- [ ] **4. `api/admin/sns-hub/topics/*`エンドポイント新設**
  `GET /api/admin/sns-hub/topics`（status絞り込み、紐づくsns_topic_targetsを埋め込み）、`POST /api/admin/sns-hub/topics/[id]/approve`、`POST /api/admin/sns-hub/topics/[id]/reject`、`PATCH /api/admin/sns-hub/topics/[id]/targets/[targetId]`（pending⇔skipped切り替え）。タスク3に依存。

- [ ] **5. `api/admin/sns-hub/content-types/index.js`新設**
  `GET`のみ、手動生成パネルの型選択ドロップダウン用。タスク1に依存。

- [ ] **6. `src/services/snsHubService.js`拡張**
  `getTopics(status)`・`approveTopic(id, approverId)`・`rejectTopic(id, approverId)`・`updateTopicTarget(topicId, targetId, status)`・`getContentTypes()`を既存の薄いラッパーパターンで追加。タスク4・5に依存。

## 既存バグ修正（新設計に組み込む形で解消）

- [ ] **7. revise/redoルーティング修正＋回帰テスト**
  `api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`の`fireRoutine("SNS_HUB_ROUTINE",...)`を`PLATFORM_ROUTINE_ENV_PREFIX`ベースに変更（ADR 0038）。spec.md要件21のテストケース（各platform×下書きソースの組み合わせで正しい発火先が選ばれること）を自動テストとして追加。タスク3に依存。

- [ ] **8. `format`列語彙統一＋移行整合性検証**
  `content-multi-channel-pipeline-prompt.md`の`format`列格納ルールを修正（ネタ種別でなくビジュアルテンプレート名のみを格納、要件12）。既存データに対する整合性検証スクリプト（要件22）を`scripts/maintenance/`に追加し、実行結果を記録する。タスク2に依存。

- [ ] **9. `risk-rules.json`パス不整合の修正**
  `content-multi-channel-pipeline-prompt.md`の`sns-video-studio/risk-rules.json`参照を実際のパス`sns-video-studio/remotion/risk-rules.json`に修正する（1行修正）。依存なし、他タスクと並行可能。

## claim機構のテスト

- [ ] **10. claim機構の並行実行テスト**
  spec.md要件20。同一`sns_topic_targets`行に対する並行PATCH呼び出しをシミュレートし、claim成功が1件のみであることを検証する自動テスト。タスク3に依存。

## UI実装

- [ ] **11. `ContentTypeBadge`・`ChannelTargetToggle`コンポーネント新設**
  `SnsHubAdmin.jsx`に追加。型バッジ（週次/日次・一般/日次・時間制約）とチャネルラベルのトグルチップ。タスク6に依存。

- [ ] **12. `TopicCard`新設**
  `topic_text`・`ContentTypeBadge`・根拠insight表示（既存`InsightCard`のscopeバッジパターン踏襲）・`ChannelTargetToggle`・`ApproverChips`流用の承認/却下ボタン。タスク11に依存。

- [ ] **13. `TopicApprovalTab`新設＋`TABS`統合**
  `TABS`に「ネタ承認」を追加。`status='proposed'`（`requires_topic_approval=true`の型のみ）を`proposed_at`降順表示。タスク12に依存。

- [ ] **14. `TopicProgressMatrix`新設**
  承認済みネタ×アカウントの生成状況テーブル（`pending`/`claimed`/`generated`/`skipped`）。`generated`セルは下書きへのリンク。「ネタ承認」タブ内サブセクションとして配置。タスク13に依存。

- [ ] **15. `DraftCard`に`ContentTypeBadge`統合**
  下書きの`content_group_id`から`sns_topics.content_type_id`を解決してバッジ表示（紐づくネタが無い既存の単発投稿は非表示）。タスク8・11に依存。

- [ ] **16. 手動生成パネルの型選択拡張**
  既存`manual-generate-panel`/`GENERATE_MODES`に型（`sns_content_types`）選択を追加。日次・時間制約型の手動起動はこの延長で実装（要件17）。タスク5・6に依存。

- [ ] **17. `SnsHubAdmin.css`スタイル追加＋動作確認**
  `.topic-card`・`.content-type-badge`・`.channel-target-toggle`・`.topic-progress-matrix`を追加。ライト/ダークモード・モバイル幅でPlaywright確認する。タスク11〜16に依存。

## 恒久ルール共有

- [ ] **18. `.claude/rules/sns-content-generation.md`新設・master直マージ**
  フロントマターなし。`getRecentRevisions()`/`getActiveInsights()`の使い方、`fitHeadline()`、ストレージパス署名規約等、本セッション中に伝播漏れが発覚した技術ルールを集約する（spec.md要件9）。**このタスクのみ本feature branchでなくmasterへの直接PRとする**（Routineセッションのブートストラップがデフォルトブランチ基準のため、featureブランチに置いても新規Routineに反映されない、2026-09-03検証済み）。依存なし、最優先で着手可能。

## チャネル別パイプライン（Xを最初の1本として実装）

- [x] **19. 週次提案Routine・日次自動提案Routineのプロンプト新設**
  `docs/operation/sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`を作成済み。既存のネタ供給モジュール（`venueCharacteristicSource.js`/`dailyResultSource.js`）・`channelMatrix.js`を再利用する設計にした。

- [x] **20. X向けチャネル別パイプラインのプロンプト新設**
  `docs/operation/sns-pipeline-x.md`を作成済み。claim（`claimTopicTarget`）→生成→`sns_drafts` INSERT→`markTopicTargetGenerated`の一連の手順を記述、`sns-video-producer-prompt.md`（技術手順）・`x-operations-playbook.md`（キャプション設計）を再利用する構成。

- [ ] **21. Routine発火トークンの登録（ユーザー手動作業）**
  週次提案・日次自動提案・Xパイプラインの3 Routineを`RemoteTrigger`等で作成し、発火トークンをVercel環境変数に登録する。Claude Codeからは自動化不可（2026-09-03検証済み）。タスク19・20完了後。

- [ ] **22. end-to-end検証**
  タスク21完了後、実際にRoutineを発火し、ネタ提案→承認→claim→生成→下書き承認→revise/redoの一連の流れを検証する。結果を記録し、note/blog/tiktok/youtubeへの展開方針（タスク20と同様の切り出し）を次イテレーションのタスクとして起票する。

## 残チャネルの展開（次イテレーション、本タスクリストでは詳細化しない）

- [ ] **23. note/blog/tiktok/youtube向けパイプラインの切り出し**
  タスク20と同じ手順をチャネル数分繰り返す。TikTok向けは既存`sns-video-producer-prompt.md`のガンブル規制ルール（rule 13）を引き継ぐことを忘れない（spec.md要件10）。
