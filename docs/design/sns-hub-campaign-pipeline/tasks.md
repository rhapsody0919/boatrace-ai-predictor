# 企画型SNS投稿パイプライン タスク分解

依存順に並べる。各タスクは目安として1コミット〜1PRで完結する粒度。

- [ ] **1. マイグレーション適用**: `docs/db-migration/054_sns_campaigns_schema.sql`を本番Supabaseに適用する（`sns_campaigns`/`sns_campaign_entries`新設、`sns_topics.campaign_id`追加）。適用後、既存の型ベースパイプライン（豆知識型等）が回帰しないことを確認する

- [ ] **2. `scripts/lib/snsCampaigns.js`新設**: `getActiveCampaigns()`・`getCampaignById()`・`createCampaign()`・`recordCampaignEntry()`・`updateCampaignEntryResult()`・`getCampaignEntries(campaignId)`を実装する。`scripts/lib/snsTopics.js`と同じパターン（Supabaseクライアント直叩き、JSDoc）

- [ ] **3. `useAiCopyText.js`の`buildRows()`をexportする**: 既存の非公開関数を`export`に変更するのみ（ロジック変更なし）。既存UI動作に影響が無いことをPlaywrightで確認する

- [ ] **4. `scripts/lib/campaignPromptBuilder.js`新設**（ADR 0043）: `scripts/lib/supabaseClient.js`（service role）で対象レースの出走表データを取得し、タスク3でexportした`buildRows()`と`src/utils/aiCopyPrompts.js`のプロンプト文言を使って、`useAiCopyText.js`と同一形式のプロンプトを組み立てる関数を実装する。実データのレースで実際にUIのコピー結果と一致することを確認する

- [ ] **5. `scripts/maintenance/create-campaign.js`新設**: 要件10のCLIスクリプト。JSON引数（企画名・期間・対象チャネル・頻度・ペルソナ・トーン・選定条件・購入額・TikTok可否メモ）を受け取り`sns_campaigns`にINSERTする

- [ ] **6. `docs/operation/sns-campaign-entry-detection.md`新設**（フェーズA運用手順書）: アクティブな企画の`selection_criteria`と本日のレースの`predictions.feature_contributions`を照合し、該当レースについて`campaignPromptBuilder.js`でプロンプトを組み立て、Routine自身が三連単3点を提案し、`sns_campaign_entries`・`campaign_id`付き`sns_topics`を作成する手順を記載する

- [ ] **7. `docs/operation/sns-campaign-result-backfill.md`新設**（フェーズB運用手順書）: `actual_result`未確定の`sns_campaign_entries`を`race_results`と突き合わせ、的中判定・払戻額・累計収支を計算してUPDATEする手順を記載する

- [ ] **8. チャネル別パイプライン文書へのcampaign_id分岐追記**: `docs/operation/sns-pipeline-{x,tiktok,youtube,note,blog}.md`の「ネタ本文の確認」章に、`campaign_id`がある場合は`getCampaignEntries()`で過去エントリを取得し継続性のある本文を書く旨、および対応する`sns_campaign_entries.hit`が未確定の間は生成を待つ旨を追記する

- [ ] **9. `finalize-blog-draft.js`に企画ガードを追加**: `campaign_id`を持つ下書きは機械チェックによる自動マージの対象外とし、常に`pending_review`のまま人間承認に回るようにする（要件8）

- [ ] **10. パイロット企画の作成**: タスク5のCLIで「龍神レーダーのAIに900円を託してみた——イン崩れ99%レースだけ1週間」を実際に作成する（`selection_criteria`: volatilityPercentile≥0.99、`purchase_amount_yen`: 900、対象チャネル・TikTok可否は`spec.md`の通り）

- [ ] **11. フェーズAの初回実行・動作確認**: 実際に本日の対象レースを検知し、プロンプト生成・AI提案・`sns_campaign_entries`作成・`sns_topics`作成までが正しく動くことを確認する

- [ ] **12. フェーズBの初回実行・動作確認**: タスク11で作成したエントリについて、レース終了後に結果確定が正しく動くことを確認する

- [ ] **13. チャネル別下書き生成の初回確認**: タスク8の分岐が実際に機能し、2件目以降のエントリで前回の結果を踏まえた本文が生成されることを確認する（1件目のみでは検証できないため、最低2エントリ分の実行後に確認する）
