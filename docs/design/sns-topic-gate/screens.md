# SNSコンテンツ ネタ生成ライン: 画面・コンポーネント洗い出し

対象要件: `docs/design/sns-topic-gate/spec.md`の機能要件13〜17（ネタ承認キューUI・チャネルラベル調整・進捗マトリクス・IA調整・既存手動生成パネルの拡張）。要件18・19（プレビューコンポーネント）は2026-09-03のコードレビューで既存実装済みと判明したため、新規UI対象から除外し「ネタ承認カード」でも同水準を踏襲することのみ扱う。要件1〜12・20〜22（DBスキーマ・パイプライン分離・ルーティング修正・テスト）はバックエンド/Routine側の変更でUIを伴わないため対象外。

## 現状のsns-hub UI構造（前提）

`SnsHubAdmin.jsx`は既に`PLATFORM_TABS`（tiktok/x/youtube/note/blog、下書き承認）＋`NON_PLATFORM_TABS`（戦略メモ・フォーマットカタログ）の2区分で構成されている。プレビューは`TEXT_DRAFT_PLATFORMS`により`TextDraftPreview`（blog/note、全文展開トグル・カバー画像・埋め込み動画リンク）と`VideoPreview`（動画系、インライン再生・サムネ）に既に分離済み。手動生成は`manual-generate-panel`（GENERATE_MODES: 当日ネタ/会場攻略型など）と`topic-pipeline-panel`（ネタ駆動パイプライン起動）の2パネルが並存し、`generationLocked`/`topicPipelineLocked`で相互排他制御されている。本specはこの土台の上に「ネタ承認」という新しい単位を追加する。

## 影響する画面・コンポーネント一覧

| # | 画面/コンポーネント | 種別 | 役割 |
|---|---|---|---|
| 1 | `SnsHubAdmin`（`src/pages/admin/SnsHubAdmin.jsx`） | 既存拡張 | `TABS`に新規タブ「ネタ承認」を追加する。`sns_topics`/`sns_topic_targets`/`sns_content_types`用のstate・取得関数（`getTopics()`等）を`snsHubService.js`経由で追加する。既存の`generationLocked`/`topicPipelineLocked`相互排他に、新規チャネル別パイプラインの手動トリガー分も統合するか、独立ロックにするかは`/step2`で判断 |
| 2 | `TopicApprovalTab`（新規） | 新規コンポーネント | 「ネタ承認」タブの中身。`status='proposed'`なネタ（`requires_topic_approval=true`の型のみ、要件13）を`proposed_at`降順で一覧表示する。空状態は既存の`empty-state`パターンを流用。日次・一般/時間制約型（承認不要）はここに出てこない旨を軽く注記する |
| 3 | `TopicCard`（新規） | 新規コンポーネント（3つ目のプレビュー単位） | 個別ネタの表示・操作単位。`topic_text`・`ContentTypeBadge`（#4）・根拠insight（`source_insight_ids`から`sns_strategy_insights`を引いて表示、既存`InsightCard`のscopeバッジ表示パターンを踏襲）・`ChannelTargetToggle`（#5）・承認/却下ボタンを持つ。承認・却下時の承認者選択は既存`ApproverChips`をそのまま流用する。`TextDraftPreview`/`VideoPreview`と役割は違う（動画・本文のプレビューではなくネタ本文＋メタ情報の確認）ため、既存2コンポーネントの流用はせず軽量な新規実装とする |
| 4 | `ContentTypeBadge`（新規、小コンポーネント） | 新規コンポーネント | 型（週次/日次・一般/日次・時間制約）を表す小バッジ。`TopicCard`と`DraftCard`（#7）の両方で使う共通部品として切り出す。表示色は`draft-badge-platform`系の既存の意味トークン運用ルールに従う |
| 5 | `ChannelTargetToggle`（新規） | 新規コンポーネント | `sns_topic_targets`の各アカウント（プラットフォーム）を`pending`⇔`skipped`で切り替えるチップ群。`TopicCard`内、および下書き一覧側でも個別ターゲットの調整に使う（要件14）。見た目は`ApproverChips`のチップUIパターンを踏襲する |
| 6 | `TopicProgressMatrix`（新規） | 新規コンポーネント | 承認済み（または自動生成対象）ネタ×アカウントの生成状況（`pending`/`claimed`/`generated`/`skipped`）をテーブル形式で表示する（要件15）。`generated`セルは対応する下書きへのリンクを持つ。「ネタ承認」タブ内のサブセクションとして配置するか独立タブにするかはネタ件数の実運用規模を見て`/step2`で判断（当面は同タブ内サブセクション想定） |
| 7 | `DraftCard`（既存拡張） | 既存拡張 | `ContentTypeBadge`（#4）を既存の`draft-card-badges`（platform/language/variant）に並べて追加表示する。下書きがどの型のネタから生成されたかを一覧上で分かるようにする |
| 8 | 手動生成パネル（`manual-generate-panel`・`topic-pipeline-panel`） | 既存拡張 | `GENERATE_MODES`または同等のUIに型（`sns_content_types`）選択を追加する（要件17）。日次・時間制約型（例: イン崩れ注意度）の手動トリガーは、既存の「当日ネタを今すぐ生成」ボタン系の延長として統合し、新規の別パネルは作らない |
| 9 | `TextDraftPreview`／`VideoPreview`／`ThumbnailPreview` | 既存流用（変更なし） | 2026-09-03確認済みで要件18・19を既に満たしているため、本specでは変更しない |
| 10 | `RiskWarningBadge` | 既存流用 | TikTok規約NG等でチャネルが自動除外された場合の理由表示に、既存の警告バッジパターンをそのまま使えないか検討する（新規デザイン不要） |
| 11 | `SnsHubAdmin.css` | 既存拡張 | `.topic-card`・`.content-type-badge`・`.channel-target-toggle`・`.topic-progress-matrix`等の新規クラスを追加する。カード・バッジの余白感は既存`.draft-card`系のトーンを踏襲する |

## コンポーネント再利用チェックリスト（`.claude/rules/component-reuse.md`準拠）

- **新規か既存拡張か**: 新規は`TopicApprovalTab`・`TopicCard`・`ContentTypeBadge`・`ChannelTargetToggle`・`TopicProgressMatrix`の5点のみ。既存の`TextDraftPreview`・`VideoPreview`・`ThumbnailPreview`・`ApproverChips`・`RiskWarningBadge`・`DraftCard`・手動生成パネルは拡張または無変更で流用する。プレビューUIを3種類独立実装するという当初のspec要件は、実際には既に2/3が完成済みだったため、新規実装は「ネタ承認カード」1種類に縮小される
- **App.jsx/RaceDetail.jsxとの重複**: 該当なし（管理画面専用）
- **デザイントークン**: 新規デザイントークンの追加は不要。既存の意味トークン・バッジ配色パターンを踏襲する。新規CSSは`TopicCard`・`TopicProgressMatrix`のレイアウトに限定される
- **ダークモード対応**: 新規カード・バッジ・マトリクステーブルは、既存の意味トークン運用ルール（`.claude/rules/code-style.md`）に従う。実装後はライト/ダーク両方でPlaywright確認する
- **ファイル構成**: 既存`SnsHubAdmin.jsx`の単一ファイル構成（内部関数コンポーネント）の慣習に従い、新規コンポーネントも同ファイル内に追加する
- **既存排他ロックとの整合**: `generationLocked`/`topicPipelineLocked`という既存の相互排他パターンに、チャネル別パイプライン分離後の新規ロックをどう統合するかは`/step2`でAPI・状態設計とあわせて確定する

## モバイル対応

「ネタ承認」タブ・`TopicCard`・`TopicProgressMatrix`は、既存の下書き承認UI同様スマホの通常ブラウザから操作できる必要がある（`.claude/CLAUDE.md`のモバイル対応ルール準拠）。`ChannelTargetToggle`のチップ操作は`onClick`のみのシンプル実装とし、`overflow: hidden/auto`によるタッチイベント阻害を避ける。`TopicProgressMatrix`はセル数（ネタ×アカウント）が増えると横幅があふれやすいため、`overflow-x: auto`を持つラッパーで対応する（既存ルール上の情報削除ではなくスクロール対応で吸収する）。
