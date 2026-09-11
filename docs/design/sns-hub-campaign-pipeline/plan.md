# 企画型SNS投稿パイプライン システム設計

`spec.md`の機能要件を実現するための、データ設計・処理フロー・スクリプト構成をまとめる。

## 1. データ設計

`docs/db-migration/054_sns_campaigns_schema.sql`に実装案あり。要点のみ再掲する。

- **`sns_campaigns`**: 企画のメタデータ（企画名・目的・ペルソナ・トーン仕様・期間・対象チャネル・TikTok可否メモ・対象レース選定条件`selection_criteria`（JSONB）・購入シミュレーション額）
- **`sns_campaign_entries`**: 企画内の1エントリ（対象レース1件）の実績。AIプロンプト全文・使用モデル名・AI提案3点・実際の結果・的中可否・払戻額・時点の累計収支
- **`sns_topics.campaign_id`**（nullable列追加）: 企画由来のネタを既存トピックゲートに紐づける。既存の型ベースのネタは常にnullのまま

`content_type_id`は既存の3種（`daily-auto`/`race-time-critical`/`venue-feature`）のいずれかを流用する（`sns_topics.content_type_id`はNOT NULL制約のため新規作成不可、`spec.md`のスコープ外）。**`venue-feature`（`trigger_mode='poll'`・`requires_topic_approval=true`）を流用する**方針とする。理由: 企画のネタは人間承認を必須にすべき内容（要件・制約参照）であり、`trigger_mode='poll'`という性質（Routineが自発的に対象を探しにいく）も対象レース検知の実態と合う。`cadence='weekly'`というラベルは実際の検知頻度を拘束するものではなく、企画自体の頻度は`sns_campaigns.selection_criteria`と後述のRoutine実行頻度で決まる。

## 2. 処理フロー（2フェーズ構成）

対象レースの「AI予想」はレース開始前に確定させる必要があり、「結果」はレース終了後にしか分からない。この時間差を、既存の`prediction-hook`（予想）／`prediction-accuracy`（答え合わせ）が別フェーズになっているのと同じ考え方で2段階に分ける。

### フェーズA: エントリ作成（レース開始前）
1. アクティブな`sns_campaigns`（`status='active'`かつ期間内）を取得
2. 各企画の`selection_criteria`（例: `volatilityPercentile >= 0.99`）を、本日のまだ発走していないレースの`predictions.feature_contributions`と照合する
3. 該当レースが見つかったら、`campaignPromptBuilder.js`（ADR 0043）でプロンプトを組み立て、Routine自身（Claude）がその場で三連単3点を提案する
4. `sns_campaign_entries`にINSERT（`actual_result`/`hit`/`payout_yen`はまだnull）
5. `createTopicWithTargets()`（`scripts/lib/snsTopics.js`、既存関数をそのまま呼ぶ）で`campaign_id`付きの`sns_topics`を作成し、企画の`target_channels`に対応する`sns_topic_targets`を`pending`にする

### フェーズB: 結果確定（レース終了後）
1. `actual_result`が未確定の`sns_campaign_entries`を、対応レースの`race_results`と突き合わせて確認する
2. 結果が出ていれば、的中判定・払戻額・累計収支を計算し、UPDATEする
3. **この結果更新はチャネル別下書き生成より前に完了している必要がある**（本文に的中結果を書くため）。フェーズAで作った`sns_topics`の承認・下書き生成は、対応する`sns_campaign_entries.hit`がnullでない状態になるまで待つ

### 実行タイミングの設計判断
対象レースは日中に分散して発生する（開催中の全24会場でレースが随時発走する）ため、既存の「早朝cron1回」（daily-auto-proposer）や「月曜1回」（weekly-proposer）とは異なり、**日中複数回のポーリングが必要**。運用当初は`docs/operation/sns-video-producer-prompt.md`系の「🌅ボタン」と同じ考え方で、**対話セッション内で1日に数回、手動でRoutineを発火する運用**から始める（`race-time-critical`型の既存運用実態と同じ）。GitHub Actionsでの自動intraday cron化は、手動運用で実際の頻度感が分かってから検討する（今回のspec.mdでは明示的にスコープ外とはしていないが、YAGNIとして最小構成から始める）。

## 3. スクリプト構成

| ファイル | 役割 |
|---|---|
| `scripts/lib/snsCampaigns.js`（新設） | `getActiveCampaigns()`・`getCampaignById()`・`createCampaign()`・`recordCampaignEntry()`・`updateCampaignEntryResult()`・`getCampaignEntries(campaignId)`。`scripts/lib/snsTopics.js`と同じパターン（Supabaseクライアント直叩き、JSDoc付きexport関数） |
| `scripts/lib/campaignPromptBuilder.js`（新設） | ADR 0043の通り、対象レースのAI用プロンプトを組み立てる。`src/hooks/useAiCopyText.js`から`buildRows()`をexportして再利用、`src/utils/aiCopyPrompts.js`のプロンプト文言もそのまま使う |
| `scripts/maintenance/create-campaign.js`（新設） | 要件10のCLIスクリプト。対話的にプロンプトを出す形ではなく、`node scripts/maintenance/create-campaign.js '{"name": "...", ...}'`のようにJSON引数を受け取り`sns_campaigns`にINSERTする最小実装（インタラクティブUIは作らない、YAGNI） |
| `docs/operation/sns-campaign-entry-detection.md`（新設） | フェーズAの実行手順書。既存の`sns-topic-proposer-daily-auto.md`と同じ構成（実行トリガー・手順・制約） |
| `docs/operation/sns-campaign-result-backfill.md`（新設） | フェーズBの実行手順書 |

## 4. 既存基盤との連携

- **`sns_topics`/`sns_topic_targets`**: `scripts/lib/snsTopics.js`の`createTopicWithTargets()`をそのまま呼ぶ（`contentTypeId`は`venue-feature`固定、`targetAccountIds`は企画の`target_channels`から解決）。新規関数の追加は不要
- **チャネル別パイプライン（`sns-pipeline-{x,tiktok,youtube,note,blog}.md`）**: 各ドキュメントの「2. ネタ本文の確認」相当の章に、「`sns_topics.campaign_id`がある場合は`getCampaignEntries(campaignId)`で過去エントリを取得し、前回までの結果・累計収支を踏まえて本文を書く」という分岐を追記する（機能要件6）
- **`finalize-blog-draft.js`**: 冒頭に`campaign_id IS NOT NULL`なら即座に終了するガードを追加し、この企画由来のブログ下書きが機械チェックで自動マージされないようにする（機能要件8）
- **`sns_approvers`/承認フロー**: 既存の`ChannelTargetToggle`・承認UIをそのまま使う（`venue-feature`型を流用しているため、既存の「ネタ承認」画面にそのまま出現する）

## 5. ADR

- [ADR 0043: 企画型パイプラインでのAI用プロンプト再現方法](../../adr/0043-campaign-ai-prompt-data-source.md)
