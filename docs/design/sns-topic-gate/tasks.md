# SNSコンテンツ ネタ生成ライン: タスク分解

`spec.md`・`plan.md`・`screens.md`を実現するための実装タスク。依存順に並べる。各タスクは目安1コミット〜1PR。

チャネル別パイプライン（ADR 0037）は5本を一度に作らず、まず**X**を最初の1本として通しで実装し、claim〜生成〜承認〜revise/redoまでのループ全体を検証する。note/blog/tiktok/youtubeへの展開は本タスクリスト完了後の別イテレーションとする（タスク16に候補の切り出し方針のみ記載）。

## DB基盤

- [x] **1. マイグレーション043適用**
  `docs/db-migration/043_sns_topic_gate_schema.sql`をSupabase Dashboardで実行する（**ユーザー手動作業**）。`sns_content_types`・`sns_target_accounts`・`sns_topics`・`sns_topic_targets`新設、初期データ投入。他タスクの前提。実行後、`information_schema.columns`等で反映を確認する。

## 共通ライブラリ・API基盤

- [x] **2. `scripts/lib/snsTopics.js`新設**
  `sns_topics`/`sns_topic_targets`のCRUD・スコープ一致検索を行う共通関数。`scripts/lib/snsStrategyInsights.js`と同じパターンに従う。タスク1に依存。

- [x] **3. `api/_lib/snsHubHelpers.js`拡張**
  `getTopicById`・`updateTopic`・`getTopicTargets`・`claimTopicTarget`（ADR 0036のアトミックPATCH）・`PLATFORM_ROUTINE_ENV_PREFIX`マッピング（ADR 0038）を追加。タスク1に依存。

- [x] **4. `api/admin/sns-hub/topics/*`エンドポイント新設**
  `GET /api/admin/sns-hub/topics`（status絞り込み、紐づくsns_topic_targetsを埋め込み）、`POST /api/admin/sns-hub/topics/[id]/approve`、`POST /api/admin/sns-hub/topics/[id]/reject`、`PATCH /api/admin/sns-hub/topics/[id]/targets/[targetId]`（pending⇔skipped切り替え）。タスク3に依存。

- [x] **5. `api/admin/sns-hub/content-types/index.js`新設**
  `GET`のみ、手動生成パネルの型選択ドロップダウン用。タスク1に依存。

- [x] **6. `src/services/snsHubService.js`拡張**
  `getTopics(status)`・`approveTopic(id, approverId)`・`rejectTopic(id, approverId)`・`updateTopicTarget(topicId, targetId, status)`・`getContentTypes()`を既存の薄いラッパーパターンで追加。タスク4・5に依存。

## 既存バグ修正（新設計に組み込む形で解消）

- [x] **7. revise/redoルーティング修正＋回帰テスト**
  `api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`の`fireRoutine("SNS_HUB_ROUTINE",...)`を`PLATFORM_ROUTINE_ENV_PREFIX`ベースに変更（ADR 0038）。spec.md要件21のテストケース（各platform×下書きソースの組み合わせで正しい発火先が選ばれること）を自動テストとして追加。タスク3に依存。

- [x] **8. `format`列語彙統一＋移行整合性検証**
  `content-multi-channel-pipeline-prompt.md`の`format`列格納ルールを修正（ネタ種別でなくビジュアルテンプレート名のみを格納、要件12）。既存データに対する整合性検証スクリプト（要件22）を`scripts/maintenance/`に追加し、実行結果を記録する。タスク2に依存。

- [x] **9. `risk-rules.json`パス不整合の修正**
  `content-multi-channel-pipeline-prompt.md`の`sns-video-studio/risk-rules.json`参照を実際のパス`sns-video-studio/remotion/risk-rules.json`に修正する（1行修正）。依存なし、他タスクと並行可能。

## claim機構のテスト

- [x] **10. claim機構の並行実行テスト**
  spec.md要件20。同一`sns_topic_targets`行に対する並行PATCH呼び出しをシミュレートし、claim成功が1件のみであることを検証する自動テスト。タスク3に依存。

## UI実装

- [x] **11. `ContentTypeBadge`・`ChannelTargetToggle`コンポーネント新設**
  `SnsHubAdmin.jsx`に追加。型バッジ（週次/日次・一般/日次・時間制約）とチャネルラベルのトグルチップ。タスク6に依存。

- [x] **12. `TopicCard`新設**
  `topic_text`・`ContentTypeBadge`・根拠insight表示（既存`InsightCard`のscopeバッジパターン踏襲）・`ChannelTargetToggle`・`ApproverChips`流用の承認/却下ボタン。タスク11に依存。

- [x] **13. `TopicApprovalTab`新設＋`TABS`統合**
  `TABS`に「ネタ承認」を追加。`status='proposed'`（`requires_topic_approval=true`の型のみ）を`proposed_at`降順表示。タスク12に依存。

- [x] **14. `TopicProgressMatrix`新設**
  承認済みネタ×アカウントの生成状況テーブル（`pending`/`claimed`/`generated`/`skipped`）。`generated`セルは下書きへのリンク。「ネタ承認」タブ内サブセクションとして配置。タスク13に依存。

- [x] **15. `DraftCard`に`ContentTypeBadge`統合**
  下書きの`content_group_id`から`sns_topics.content_type_id`を解決してバッジ表示（紐づくネタが無い既存の単発投稿は非表示）。タスク8・11に依存。

- [x] **16. 手動生成パネルの型選択拡張**
  既存`manual-generate-panel`/`GENERATE_MODES`に型（`sns_content_types`）選択を追加。日次・時間制約型の手動起動はこの延長で実装（要件17）。タスク5・6に依存。

- [x] **17. `SnsHubAdmin.css`スタイル追加＋動作確認**
  `.topic-card`・`.content-type-badge`・`.channel-target-toggle`・`.topic-progress-matrix`を追加。ライト/ダークモード・モバイル幅でPlaywright確認する。タスク11〜16に依存。

## 恒久ルール共有

- [x] **18. `.claude/rules/sns-content-generation.md`新設・master直マージ**
  フロントマターなし。`getRecentRevisions()`/`getActiveInsights()`の使い方、`fitHeadline()`、ストレージパス署名規約等、本セッション中に伝播漏れが発覚した技術ルールを集約する（spec.md要件9）。**このタスクのみ本feature branchでなくmasterへの直接PRとする**（Routineセッションのブートストラップがデフォルトブランチ基準のため、featureブランチに置いても新規Routineに反映されない、2026-09-03検証済み）。依存なし、最優先で着手可能。

## チャネル別パイプライン（Xを最初の1本として実装）

- [x] **19. 週次提案Routine・日次自動提案Routineのプロンプト新設**
  `docs/operation/sns-topic-proposer-weekly.md`・`sns-topic-proposer-daily-auto.md`を作成済み。既存のネタ供給モジュール（`venueCharacteristicSource.js`/`dailyResultSource.js`）・`channelMatrix.js`を再利用する設計にした。

- [x] **20. X向けチャネル別パイプラインのプロンプト新設**
  `docs/operation/sns-pipeline-x.md`を作成済み。claim（`claimTopicTarget`）→生成→`sns_drafts` INSERT→`markTopicTargetGenerated`の一連の手順を記述、`sns-video-producer-prompt.md`（技術手順）・`x-operations-playbook.md`（キャプション設計）を再利用する構成。

- [x] **21. Routine発火トークンの登録（ユーザー手動作業）**
  週次提案・日次自動提案・Xパイプラインの3 Routineを`RemoteTrigger`で作成し、発火トークンをClaude Code RoutinesのWeb UI（API経由では生成不可、2026-09-03検証済み）で発行、Vercel環境変数（`SNS_X_ROUTINE_FIRE_URL`/`_TOKEN`等）に登録済み（ユーザー作業、2026-09-03完了）。

- [x] **22. end-to-end検証**
  2026-09-03、実際にRoutineを発火し検証した。ネタ提案（daily-auto）→承認→claim→生成（X/Blog/YouTube）→下書き作成までは実データ・実PRで成功を確認。Noteは「blog本文未生成なら`pending`に戻す」設計通りにスキップ動作することを確認。検証中に実際のバグ2件を発見・修正した:
  - `updateTopicTargetLabel`がpending復帰時に`claimed_by`/`claimed_at`をクリアしていなかった不整合（`scripts/lib/snsTopics.js`・`api/_lib/snsHubHelpers.js`修正）
  - `renderCoverCard.js`のcwd依存バグでChromiumサンドボックスレンダリングが失敗（`sns-pipeline-youtube`Routineが自律的に発見・修正、コミット`3dc45768`）
  - Blogパイプラインが同一セッション内で下書き・PRを2件作ってしまう不具合（誤った方のPR #490はクローズ済み、`sns-pipeline-blog.md`等の制約に「claim済みターゲットにつき生成は1件のみ」を明記して再発防止）
  revise/redo操作自体のライブ発火は本検証では行っていない（ルーティングのコード的な正しさはタスク7の回帰テストで別途検証済み）。

## 残チャネルの展開

- [x] **23. note/blog/youtube向けパイプラインの切り出し**
  `docs/operation/sns-pipeline-blog.md`・`sns-pipeline-note.md`・`sns-pipeline-youtube.md`を作成し、タスク22でX/Blog/YouTubeは実データでの生成成功、Noteは依存関係チェックによる正常スキップを確認済み。**TikTokは対象外として意図的に見送り**: 現在ネタ提案モジュール（`venueCharacteristicSource.js`/`dailyResultSource.js`）が生成する型（`venue-feature`/`daily-auto`）はいずれも`channelMatrix.js`の`CHANNEL_MATRIX`でTikTokを含まない設計のため、TikTok向けのclaim対象ネタが現状存在しない。TikTok向けパイプラインが必要になるのは`competition-trivia`/`overseas-intro`/`service-trust`等の新しい型のネタ提案モジュールを追加する時点であり、その時に合わせて着手する。

## 経路統合・カテゴリ修正（2026-09-04追記、spec.md追記節に対応）

- [ ] **24. daily-auto Routineの対象カテゴリ修正**
  `docs/operation/sns-topic-proposer-daily-auto.md`の型一覧表から回収率型・出目分布型を除外し（TikTokポリシー上どのみち新規制作停止中）、イン崩れ注意度・予想数値フック型・的中/答え合わせ型を対象に追加する。`sns_topic_categories`側の該当カテゴリが`active=true`であることも確認する。依存なし。

- [ ] **25. `generate.js`/`SNS_HUB_ROUTINE`・手動生成パネルの全廃止**
  `api/admin/sns-hub/generate.js`・`triggerGeneration`（`snsHubService.js`）・`GENERATE_MODES`/`manual-generate-panel`関連のJSX・CSSを削除する。既存の週次/日次ネタ提案ボタンに完全統合済みであることを確認してから削除する。タスク24に依存（daily-autoの対象拡大が先）。

- [x] **26. 「⚡今すぐ生成」ボタンの追加**
  `sns_topic_targets`の各行（`status='pending'`）に対し、対象チャネルパイプラインを即時発火するAPIエンドポイント（`api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js`）・UIボタン（進捗マトリクスのpendingチップ）を追加した。`fireRoutine`の既存パターンを再利用し、`{action: 'generate_now', targetId}`ペイロードを渡す。5チャネル別パイプラインドキュメント（blog/note/tiktok/x/youtube）に対応する即時生成フローを追記済み。

- [x] **27. sns-hub UI再設計（🌅当日の運用／📦ストック管理の2ブロック化）**
  `requires_topic_approval`で2ブロックに分割した（承認済みワイヤーフレーム: https://claude.ai/code/artifact/64dd749b-d1fe-4b20-88a3-560d69545ed9 のv2に準拠）。両ブロックとも「ネタ本文＋チャネル別チップ」の共通カード構造（`TopicFanoutCard`/`TargetChip`）。承認待ちカード（📦ブロックのみ）は既存`TopicCard`をそのまま再利用し承認/却下ボタンを表示。旧`TopicProgressMatrix`・「📋ネタ承認」の開閉ヘッダーは廃止し、常時両ブロック表示に変更。⚙️チャネル設定パネルは両ブロック共通の単一パネルのまま。タスク25・26に依存。

- [ ] **28. evergreen残り4型のネタ提案Routine新設（別イテレーション）**
  一覧アピール型・豆知識型・新機能紹介型・レース考察型それぞれの候補選定ロジックを個別に設計する。型ごとに編集判断が必要なため、本タスクリストでは着手順・詳細設計を確定しない。着手時に型ごとのサブタスクとして分解する。
