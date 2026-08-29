# SNSマーケティングハブ Phase 2: タスク分解

`spec.md`・`plan.md`・`screens.md`を実現するための実装タスク。依存順に並べる。各タスクは目安1コミット〜1PR。

- [x] **1. マイグレーション適用**
  `docs/db-migration/039_sns_strategy_insights.sql`をSupabase Dashboardで実行する。`sns_strategy_insights`テーブル新設、`sns_drafts.referenced_insight_ids`・`sns_template_variants.created_by`列追加。他タスクの前提。
  → ユーザーが実行済み、`information_schema.columns`で全カラムの反映を確認済み（2026-08-29）。

- [x] **2. `scripts/lib/riskRules.js`・`scripts/lib/snsStrategyInsights.js`新設**
  `riskRules.js`: `sns-video-studio/remotion/risk-rules.json`を読み込み、`platforms`スコープを考慮した決定的パターンマッチ（`checkRiskRules(text, platform)`）を行う共通関数（ADR 0028）。
  `snsStrategyInsights.js`: `sns_strategy_insights`のCRUD・スコープ一致検索（`getActiveInsights({platform, format, language})`、`platform`等がnullのinsightも含めて取得）を行う共通関数。`scripts/lib/supabaseClient.js`の既存パターンに従う。

- [ ] **3. `scripts/maintenance/promote-strategy-insights.js`新設**
  週次昇格処理のCLIスクリプト（ADR 0030）。`status='proposed'`かつ`created_at`が1週間以上前のレコードを取得 → タスク2の`checkRiskRules`で照合 → 問題なければ`active`(`activated_at`記録)、抵触すれば`retired`(`decision_note`に理由記録)に更新。実行結果（何件昇格・却下したか）を標準出力に出す。

- [ ] **4. `api/admin/sns-hub/insights/*`エンドポイント新設**
  `api/_lib/snsHubHelpers.js`に`getInsightById`等を追加。`GET /api/admin/sns-hub/insights`（`status`クエリパラメータ対応、`active`/`retired`の場合は`referenced_insight_ids`から反映本数を計算して含める）、`POST /api/admin/sns-hub/insights/[id]/reject`（body: `{ reason?: string }`、`status='retired'`・`retired_at`・`decision_note`更新）を実装。

- [ ] **5. `src/services/snsHubService.js`拡張**
  `getInsights(status)`・`rejectInsight(insightId, reason)`を既存の`getDrafts`/`approveDraft`と同じ薄いラッパーパターンで追加。

- [ ] **6. 「戦略メモ」タブUI実装**
  `SnsHubAdmin.jsx`の`TABS`に`insights`タブを追加。`InsightTab`（要判断/履歴の2セクション）・`InsightCard`（scope バッジ・本文・evidence・却下ボタン＋任意理由欄）・`InsightHistoryEntry`（日時・decision_note・superseded_byリンク・反映本数）を実装。`SnsHubAdmin.css`にスタイル追加（ステータス別バッジ色、既存の意味トークン運用ルールに従う）。実装後、ライト/ダークモード・モバイル幅でPlaywright確認する。

- [ ] **7. `docs/reference/sns-brand-guideline.md`新設**
  `BOAT_COLORS`（`src/utils/colors.js`参照）・金の龍ロゴ・GOLD統一トーンの説明、`risk-rules.json`への参照をまとめる（spec.md要件7）。

- [ ] **8. `/x-growth-report`・`/tiktok-growth-report`スキル拡張**
  `.claude/commands/x-growth-report.md`・`.claude/commands/tiktok-growth-report.md`の最終ステップ後に、提案した「小施策（即実行）」を`sns_strategy_insights`へ`status='proposed'`で登録する新規ステップを追加（ADR 0027）。既存の静的ファイル保存は維持。

- [ ] **9. `sns-hub-content-generation`Routineのjob_config更新**
  `RemoteTrigger update`でRoutineのプロンプトに以下を追加: (a) 月曜の週次バッチ実行時、タスク3のスクリプトを呼び出してinsight昇格処理を行う、(b) 生成対象のplatform/format/languageに一致する`active`なinsightを取得しプロンプトへ注入、生成した`sns_drafts`の`referenced_insight_ids`に記録、(c) 新規コンポジション試作時は`sns_template_variants`に`created_by='routine'`で登録しJSXファイルをコミットする指示を追加（既存の「コードの変更・コミット・PR作成は行わない」制約の例外として明記）。タスク7のブランドガードラインも試作前に参照する指示を含める。

- [ ] **10. `.claude/CLAUDE.md`更新**
  「セッション開始時のXツイート下書き投稿確認」等と同じ節構成で、「セッション開始時の集客調査スキル実行確認」を追加（spec.md要件8）。`data/analysis/x-growth/`・TikTok版保存先の最新ファイル日付が1週間以上前なら`/x-growth-report`・`/tiktok-growth-report`の実行を提案する。
