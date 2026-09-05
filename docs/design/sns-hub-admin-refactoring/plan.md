# SnsHubAdmin.jsx リファクタリング設計（BOA-242）

## 背景

`src/pages/admin/SnsHubAdmin.jsx`が2917行まで肥大化している（2026-09-05時点）。sns-topic-gate移行・戦略メモ承認機能等、この数週間の機能追加のたびに同じファイルへ関数コンポーネントを追記し続けた結果。

## 現状分析（分割の実現可能性）

ファイル内には43個のトップレベル関数（うち大半が独立した`function ComponentName({ props }) {...}`形式のプレゼンテーショナルコンポーネント）が存在する。全体を俯瞰すると、**既に機能単位でよく分離されている**（1つの巨大なJSXの塊ではなく、小さいコンポーネントが多数並んでいるだけ）。したがって分割自体は低リスクな「ファイル移動＋import/export追加」作業で完結し、ロジックの書き換えは基本的に不要。

例外的に確認が必要な箇所:
- 各コンポーネントが`SnsHubAdmin`本体のローカル state・handlerをpropsとして受け取っているか（クロージャで直接参照していないか）を1つずつ確認する。目視した範囲では全てprops経由だが、分割時に`export`漏れ・`import`パスミスが起きやすいポイントなので、分割後に`npm run build`で機械的に検出する
- `SnsHubAdmin.css`は1ファイルのまま維持する（クラス名の対応関係を崩さない）

## 分割方針

`src/pages/admin/sns-hub/`ディレクトリを新設し、以下の単位でファイルを分ける。tabキーごとの機能まとまりに沿わせる（`component-reuse.md`の「同じUIパターンは切り出す」原則とも整合、ただしこちらは「既存の切り出し済みコンポーネントをファイルとして整理する」話であり新規抽象化ではない）。

| 新ファイル | 移動するコンポーネント | 行数目安 |
|---|---|---|
| `sns-hub/utils.js` | `buildXIntentUrl`・`buildPostText`・`isIOSSafari`・`formatDateTime`・`isTodayJST`・`buildTopicRejectionReason`・`getDefaultDraftCardExpanded` | 〜60行 |
| `sns-hub/CatalogTab.jsx` | `CatalogTab`・`TopicCategorySettingsTab`・`TemplateVariantList`・`RulesReferenceSection`・`DocReferenceSection` | 〜300行 |
| `sns-hub/InsightTab.jsx` | `RecentRevisionsSection`・`InsightScopeGroup`・`InsightTab`・`InsightScopeBadges`・`InsightCard`・`InsightHistoryEntry` | 〜250行 |
| `sns-hub/DraftCard.jsx` | `DraftCard`・`PostingActionLinks`・`TikTokMetricsForm`・`ApproverChips`・`RevisionPanel`・`TextDraftPreview`・`CopyToClipboardButton`・`DownloadImageButton`・`NoteCopyActionLinks`・`ThumbnailPreview`・`BlogApproveAction`・`YouTubeApproveAction`・`VideoPreview`・`ProcessingStatusBadge`・`RiskWarningBadge`・`ContentTypeBadge`・`ChannelTargetToggle` | 〜900行（最大の塊、下書き承認UI一式） |
| `sns-hub/TopicCards.jsx` | `TopicCard`・`TargetChip`・`TopicFanoutCard`・`useTopicProposerTrigger`・`TopicApprovalSection` | 〜660行 |
| `sns-hub/Header.jsx` | `Header`（sns-hub専用の見出し、サイト共通`Header`コンポーネントとは別物） | 〜10行 |
| `SnsHubAdmin.jsx`（本体） | `SnsHubAdmin`本体のみ（state管理・データフェッチ・タブ切り替え） | 〜430行 |

分割後、本体は`430行`程度まで縮小する見込み。各ファイルは対応する機能の`export`をまとめ、`SnsHubAdmin.jsx`側で`import { DraftCard, PostingActionLinks, ... } from "./sns-hub/DraftCard.jsx"`のように読み込む。

## 実行手順（提案、次回の実装タスクの目安）

1. `sns-hub/utils.js`から着手（依存が無く最も安全）
2. `sns-hub/CatalogTab.jsx`・`sns-hub/InsightTab.jsx`（中規模、依存が少ない）
3. `sns-hub/TopicCards.jsx`（`useTopicProposerTrigger`カスタムフックを含むため、フック呼び出し規約に注意）
4. `sns-hub/DraftCard.jsx`（最大の塊、最後に着手）
5. 各ステップ後に`npm run build`・Playwrightで`/admin/sns-hub`の全タブ（ネタ承認・下書き承認・戦略メモ・フォーマットカタログ）を目視確認する

**1ステップ＝1PR**を推奨（`component-reuse.md`のApp.jsx分割方針と同じ考え方）。1回のPRで全体を移動すると、万一のミスの切り分けが難しくなる。

## やらないこと

- コンポーネントの新規抽象化・共通化（今回はファイル分割のみ、ロジックの見直しはしない）
- `SnsHubAdmin.css`の分割（クラス名の対応関係が複雑なため、別タスクとして扱う）
- Cypress/Playwrightの自動テスト新設（既存の目視確認フローを踏襲。テスト新設は別途要望があれば検討）
