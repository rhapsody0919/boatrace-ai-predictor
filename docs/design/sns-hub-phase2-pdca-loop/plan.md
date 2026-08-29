# SNSマーケティングハブ Phase 2: システム設計

`spec.md`（機能要件）・`screens.md`（画面・コンポーネント）を実現するためのシステム設計。重要な技術判断はADR 0027〜0030に切り出した。

## 全体構成

```
[対話セッション]                          [Supabase]                        [Claude Code Routine]
 /x-growth-report ──┐                                                       sns-hub-content-generation
 /tiktok-growth-report┤─新規ステップ─▶ sns_strategy_insights          ┌──▶ (月曜=週次バッチ実行時、
   （既存スキル拡張、    insight抽出       (status=proposed)            │     生成前に下記2ステップを追加)
    ADR 0027）                                  │                       │      (a) 1週間経過したproposedを
                                                 │ 却下操作(却下理由任意)│          risk-rules.jsonと照合し
[boatAI Webアプリ]                              ▼                       │          active/retiredへ更新
 SnsHubAdmin「戦略メモ」タブ ◀──/api/admin/sns-hub/insights──┘         │      (b) 対象platform/format/
   (要判断ビュー・履歴ビュー)                                            │          languageのactiveな
                                                                          │          insightをプロンプトに注入
                                                                          │
                                                                          ▼
                                                                    sns_drafts生成
                                                                 (referenced_insight_ids記録)
                                                                          │
                                                              新規コンポジション試作時のみ
                                                                          ▼
                                                          sns_template_variants に新規行
                                                          (created_by='routine') → Gitコミット
                                                                          │
                                                              通常の下書き承認フロー（既存）へ合流
```

## データ設計

マイグレーション: [`docs/db-migration/039_sns_strategy_insights.sql`](../../db-migration/039_sns_strategy_insights.sql)

### 新規テーブル: `sns_strategy_insights`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | UUID | 主キー |
| `platform` | VARCHAR(20) | null=全プラットフォーム対象。ENUM制約なし |
| `language` | VARCHAR(10) | null=全言語対象 |
| `format` | VARCHAR(50) | null=全フォーマット対象 |
| `insight_text` | TEXT | 改善案本文（次回生成プロンプトへ注入される内容） |
| `evidence` | TEXT | 根拠・確信度の自由記述（数値スコアは今回導入しない） |
| `source` | VARCHAR(20) | `own-metrics` \| `external-research` |
| `research_method` | VARCHAR(50) | `x-growth-report-skill` \| `tiktok-growth-report-skill` \| `manual`等、ENUM制約なし |
| `status` | VARCHAR(20) | `proposed` \| `active` \| `retired` |
| `decision_note` | TEXT | 却下理由 or supersededの経緯（任意入力） |
| `superseded_by` | UUID (FK) | 後継insightへの参照 |
| `created_at` | TIMESTAMPTZ | 提案日時 |
| `activated_at` | TIMESTAMPTZ | active昇格日時 |
| `retired_at` | TIMESTAMPTZ | 却下/失効日時 |

### 既存テーブルへの列追加

- `sns_drafts.referenced_insight_ids UUID[]`: 生成時に参照したinsightのID配列。`background_text`（人間可読の生成メモ）とは別に、履歴ビューの「反映本数」をSQLで確実に集計するための機械可読カラム（`SELECT count(*) FROM sns_drafts WHERE :insight_id = ANY(referenced_insight_ids)`）
- `sns_template_variants.created_by VARCHAR(10) DEFAULT 'human'`: `'human'`\|`'routine'`。新規コンポジション試作の作成者を記録（ADR 0029）

## API設計（`/api/admin/sns-hub/insights/*`）

既存の`api/admin/sns-hub/drafts/*`と同じくVercel Edge Function・service role key使用（ADR 0021の役割分担を踏襲、フロントエンドはSupabaseに直接アクセスしない）。

| エンドポイント | メソッド | 役割 |
|---|---|---|
| `/api/admin/sns-hub/insights` | GET | クエリパラメータ`status`（`proposed`\|`active`\|`retired`、省略時は全件）で一覧取得。将来のフィルタ拡張（platform/format）を見据え、クエリパラメータ方式にする（spec.md「拡張性の考慮」） |
| `/api/admin/sns-hub/insights/[id]/reject` | POST | body: `{ reason?: string }`（任意）。`status='retired'`・`retired_at`・入力があれば`decision_note`を更新 |

実装は既存の`api/_lib/snsHubHelpers.js`のパターン（`isValidDraftId`相当のUUID検証、`jsonResponse`、`isConfigured`）を共通利用する。`getDraftById`と同様の`getInsightById`をhelpers.jsに追加する。

## サービス層・スクリプト構成

### `src/services/snsHubService.js`（既存拡張）
- `getInsights(status)`: `getDrafts(status)`と同じ薄いラッパーパターンで追加
- `rejectInsight(insightId, reason)`: 却下操作

### `scripts/lib/riskRules.js`（新設、ADR 0028）
`risk-rules.json`を読み込み、`platforms`スコープを考慮した決定的パターンマッチ（`patterns.some(p => text.includes(p))`）を行う共通関数`checkRiskRules(text, platform)`。insight昇格処理から呼び出す。将来的に動画生成側のチェックからも共通利用できるよう、Routine専用ではなく`scripts/lib/`配下の汎用ユーティリティとして置く

### Routine側の変更（ADR 0030）
`sns-hub-content-generation`Routineのjob_config（`RemoteTrigger update`で更新）に以下を追加:
1. 週次バッチ生成フロー（月曜）の冒頭に、insight昇格処理ステップを追加: `status=proposed`かつ`created_at`が1週間以上前のレコードを取得 → `scripts/lib/riskRules.js`相当のロジックで照合 → 問題なければ`active`(`activated_at`記録)、抵触すれば`retired`(`decision_note`に理由記録)
2. 生成対象のplatform/format/languageに一致する`active`なinsight（scopeがnullのものも含む）を取得し、生成プロンプトへ追加コンテキストとして注入
3. 生成した`sns_drafts`レコードの`referenced_insight_ids`に、参照したinsightのIDを記録
4. 新規コンポジション試作を行った場合、`sns_template_variants`に`created_by='routine'`で新規行をINSERTし、対応するJSXファイルをコミットする（コミット・PR作成は行わないという既存制約とは別に、試作コード自体はGit管理対象に含める運用のため、Routineのプロンプトでこの点を明記する。既存の「コードの変更・コミット・PR作成は行わない」制約はドラフト生成時のコード変更を指しており、`sns-video-studio/remotion/src/`配下の新規コンポジションファイルはこの制約の例外として扱う）

### `/x-growth-report`・`/tiktok-growth-report`スキルの変更（ADR 0027）
`.claude/commands/x-growth-report.md`・`.claude/commands/tiktok-growth-report.md`それぞれの最終ステップ（「統合分析・次の施策」）の後に新規ステップを追加: 提案した「小施策（即実行）」をinsight候補として構造化し、`sns_strategy_insights`へ`status='proposed'`で登録する。既存の静的ファイル保存（`data/analysis/x-growth/report-*.json`）は維持したまま追加する

### `.claude/CLAUDE.md`の更新（spec.md要件8）
「セッション開始時のXツイート下書き投稿確認」等と同じ節構成で、「セッション開始時の集客調査スキル実行確認」を追加: `data/analysis/x-growth/`・`data/analysis/tiktok-growth/`（TikTok版の保存先、要確認）の最新ファイルの日付が1週間以上前なら、`/x-growth-report`・`/tiktok-growth-report`の実行を提案する

## 画面実装（`screens.md`参照）

`SnsHubAdmin.jsx`に以下を追加（既存の単一ファイル構成を踏襲）:
- `TABS`配列に`{ id: "insights", label: "戦略メモ" }`を追加（既存タブと異なり`sns_drafts`の`status`フィルタではなく、専用の`insights` stateを持つ）
- `InsightTab`: 内部で「要判断」（`status=proposed`）と「履歴」（`active`/`retired`、`created_at`降順）の2セクションを表示
- `InsightCard`: scope バッジ・insight本文・evidence・提案日時。`proposed`の場合のみ却下ボタン＋任意理由欄
- `InsightHistoryEntry`: `activated_at`/`retired_at`・`decision_note`・`superseded_by`リンク・反映本数（`referenced_insight_ids`を持つ`sns_drafts`件数、`/api/admin/sns-hub/insights`のGETレスポンスに含める）
- CSS: `SnsHubAdmin.css`に`.insight-card`等を追加。ステータス別バッジ色は既存の`draft-badge-*`パターンを流用しつつ`active`=緑系・`retired`=グレー系の新規クラスを追加

## ブランドガードライン文書（spec.md要件7）

`docs/reference/sns-brand-guideline.md`を新設。内容: `BOAT_COLORS`定数の参照先（`src/utils/colors.js`）、金の龍ロゴ・GOLD統一のトーンの説明、`risk-rules.json`への参照。生成Routineが新規コンポジション試作前に必ず読む前提のドキュメントとして、既存の`sns-video-producer-prompt.md`と同じ`docs/operation/`ではなく`docs/reference/`に置く（ブランド資産のリファレンスという性質が既存の`docs/reference/design-system.md`等と近いため）

## 既知の制約との整合性確認

- 外部調査はクラウドRoutineでは実行不可という確定事項（`sns_marketing_hub_operational_state.md`メモリ参照）に沿い、insight抽出処理はRoutineではなく対話セッション側の既存スキル内で完結させる設計にした
- `sns_drafts`・`sns_template_variants`と同様、`sns_strategy_insights`もENUM制約を避けVARCHARで運用する（2026-08-27合意の既存方針を踏襲）
