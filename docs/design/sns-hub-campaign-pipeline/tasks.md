# 企画型SNS投稿パイプライン タスク分解

依存順に並べる。各タスクは目安として1コミット〜1PRで完結する粒度。

**2026-09-08追記（方針変更）**: パイロット企画のバックテスト（`scripts/analysis/campaign-backtest-*.js`、
463レース・3週間分の実データ検証）の結果、当初想定していた「AI用コピペプロンプトを人間がAIに貼り付けて
回答を得る」運用は、実際のAI都度判断の回収率が決定的な計算式モデルより明確に劣ることが判明した
（27.2% vs 94.3%〜130.5%）。そのためタスク3・4（`buildRows()`のexport・`campaignPromptBuilder.js`）は
実施せず、代わりに`scripts/lib/campaignVolatilityModel.js`（出走表×展開予測・1号艇除外の決定的モデル）で
買い目生成を自動化する方針に変更した。詳細はPR #594参照。

- [x] **1. マイグレーション適用**: `docs/db-migration/054_sns_campaigns_schema.sql`をSupabase Dashboardで適用済み（2026-09-08）。既存の型ベースパイプラインへの影響なしを確認

- [x] **2. `scripts/lib/snsCampaigns.js`新設**: `getActiveCampaigns()`・`getCampaign()`・`createCampaign()`・`findQualifyingRaces()`・`createCampaignEntryWithTopic()`・`getCampaignEntries()`・`backfillEntryResult()`を実装（PR #594）

- [x] ~~3. `useAiCopyText.js`の`buildRows()`をexportする~~: 実施せず（方針変更）。ただしUI機能としての「イン崩れ狙い」プロンプト種別は別途PR #594で追加済み（企画の買い目生成には使わない、ユーザー向け機能として独立）

- [x] ~~4. `scripts/lib/campaignPromptBuilder.js`新設~~: 実施せず（方針変更）。代わりに`scripts/lib/campaignVolatilityModel.js`を実装（PR #594）

- [x] **5. `scripts/maintenance/create-campaign.js`新設**: 実装・実行済み（PR #594）。パイロット企画は引数無しCLIとして実装（JSON引数化はせず、決め打ちの値を直接記述。将来2つ目の企画を作る際にパラメータ化を検討）

- [x] **6. `docs/operation/sns-campaign-entry-detection.md`新設**（フェーズA運用手順書）: 本ファイルで作成（実装は`campaignVolatilityModel.js`ベースに変更済み）

- [x] **7. `docs/operation/sns-campaign-result-backfill.md`新設**（フェーズB運用手順書）: 本ファイルで作成

- [x] **8. チャネル別パイプライン文書へのcampaign_id分岐追記**: `sns-pipeline-x.md`の「2. ネタ本文・根拠insightの確認」に追記済み。tiktok/youtube/blogの同節は元々「x.mdの2.と同じ」参照のため自動的に反映される。noteは本文をブログから変換する構成のため、ブログ側で反映済みである旨を明記した

- [x] **8.5. Phase Bで結果発表・最終まとめ投稿のネタも作成する**（tasks.md新設、実装中に判明した設計漏れ）: 当初のPhase B実装は`sns_campaign_entries`のDB更新のみで、運用フロー③（結果発表）④（企画終了まとめ）用の`sns_topics`を作っていなかった。`scripts/lib/snsCampaigns.js`に`createResultAnnouncementTopic()`を追加し、`campaign-backfill-results.js`が結果確定時に③のネタを、企画期間経過・全エントリ確定時に④のネタを作成し企画を`completed`にするよう実装した

- [x] **9. `finalize-blog-draft.js`に企画ガードを追加**: `campaign_id`を持つ下書きは機械チェックによる自動マージの対象外とし、常に`pending_review`のまま人間承認に回るようにした（PR #594）

- [x] **10. パイロット企画の作成**: 実行済み（2026-09-08、企画ID `00263d28-3856-4bf9-b375-bb71f3d0889e`、`status='active'`）。`selection_criteria`: volatilityPercentile≥0.99、`purchase_amount_yen`: 900、対象チャネル: x/blog、TikTok対象外

- [x] **11. フェーズAの初回実行・動作確認**: 実施済み（2026-09-08）。試験実行で「結果確定済みレースを誤って登録しかける」不具合を発見・修正（`getRaceIdsWithResults()`必須チェック追加）。**本物の初回エントリはまだ無い**（次回のcron/朝実行で作成される想定）

- [ ] **12. フェーズBの初回実行・動作確認**: タスク11で本物のエントリが作成された後、レース終了後に結果確定が正しく動くことを確認する

- [ ] **13. チャネル別下書き生成の初回確認**: タスク8の分岐が実際に機能し、2件目以降のエントリで前回の結果を踏まえた本文が生成されることを確認する（1件目のみでは検証できないため、最低2エントリ分の実行後に確認する）

- [x] **14. X向け投稿カードの実装**（2026-09-09新設）: 「各チャネルの動画・投稿仕様」のうちXを実装。ユーザーとモックアップで合意した仕様（テキスト+静止画像2枚、内部スコアは見せず分析ツールの実データのみ提示）に基づき`sns-video-studio/remotion/src/CampaignEntryCard.jsx`（買い目・収支カード）・`CampaignDataExcerptCard.jsx`（データ出走表・展開予測抜粋カード）・`scripts/lib/contentChannels/renderCampaignCard.js`（レンダリングラッパー）を実装。`sns-pipeline-x.md`に「3'. 企画由来ネタの画像生成」を追加し、`docs/reference/brand-kit.md`に採用実例を追記した。実際のバックテストデータでの静止画レンダリングを確認済み

- [ ] **15. ブログ向け「日記型記事・逐次更新」の実装**: ユーザーと合意済み（1件の日記型記事を作り、日次でエントリを追記していく構成）。既存の`sns-pipeline-blog.md`は「新規Draft PR作成」フロー前提のため、「既存記事への追記PR」フローの手順化が必要（未着手）
