# SNSマーケティングハブ Phase 2: 画面・コンポーネント洗い出し

対象要件: 機能要件4・10（週次デフォルト採用・拒否権レビュー、およびPDCA履歴の閲覧。`docs/design/sns-hub-phase2-pdca-loop/spec.md`参照）。Phase 2の他要件（insight永続化・生成Routine注入・新規コンポジション自律生成等）はバックエンド/Routine側の変更でUIを伴わないため、本ドキュメントの対象外。

**「戦略メモ」タブは2つのビューを持つ**: (a) 要判断（`status=proposed`、却下操作あり）、(b) 履歴（`active`/`retired`、時系列・閲覧のみ）。ユーザー指摘（2026-08-29）により、日時と経緯（いつ提案・採用・却下されたか、なぜ却下/供替されたか）を追える設計にすることを明記する。

## 影響する画面・コンポーネント一覧

| # | 画面/コンポーネント | 種別 | 役割 |
|---|---|---|---|
| 1 | `SnsHubAdmin`（`src/pages/admin/SnsHubAdmin.jsx`） | 既存拡張 | タブナビゲーション（`TABS`配列）に新規タブ「戦略メモ」を追加する。既存タブは`drafts`状態を`status`でフィルタする設計だが、insightは別データソース（`sns_strategy_insights`）のため、`insights`用のstate・取得関数（`getInsights()`）を追加する必要がある |
| 2 | `InsightTab`（新規、同ファイル内に関数コンポーネントとして追加） | 新規コンポーネント | 「戦略メモ」タブの中身。内部に「要判断」（`status=proposed`、`created_at`降順）と「履歴」（`active`/`retired`、時系列）の2区分をサブタブまたはセクション分けで表示する。空状態は既存の`empty-state`パターンを流用 |
| 3 | `InsightCard`（新規、同ファイル内） | 新規コンポーネント | 個別insightの表示単位。scope（platform/format/language、null可）バッジ・insight本文・根拠（source/research_method）・**提案日時（`created_at`）**を表示する。`status=proposed`の場合のみ却下ボタンを表示する。`DraftCard`と役割は似るが、動画プレビュー・承認者選択・修正指摘等の下書き特有の要素は不要なため、`DraftCard`を流用せず軽量な新規コンポーネントとする |
| 4 | `InsightHistoryEntry`（新規、`InsightCard`の履歴表示バリエーションとして実装、別コンポーネントに分けるかは`/step2`で判断） | 新規コンポーネント | 履歴ビュー用の表示。`activated_at`/`retired_at`・却下/supersededの理由（`decision_note`、入力が無ければ非表示）・`superseded_by`がある場合は「→ 後継: [リンク]」形式のテキストリンク・**そのinsightを参照して生成された下書きの件数（反映本数）**を表示する。日時降順の単純リストで十分（タイムライン風のグラフィカルな表現は情報量に対して過剰、8人パネルでYAGNI判断）。ステータス別に色分けバッジ（`active`=緑系・`retired`=グレー系・`proposed`=強調色）を付け一覧性を上げる |
| 5 | 却下操作のUI | 新規（最小限） | ワンタップの却下ボタン＋**任意入力の一言理由欄**（必須ではない、空欄でも却下可能）。`RevisionPanel`のような定型理由選択は不要（spec要件4準拠）。理由欄の入力があれば`decision_note`に保存し、履歴ビューでの経緯把握に使う |
| 6 | バッジ表示（platform/language/format） | 既存流用 | 既存の`draft-badge-platform`・`draft-badge-language`相当のCSSクラス・表示パターンをそのまま流用する（`PLATFORM_LABELS`・`LANGUAGE_LABELS`定数も共用） |
| 7 | ローディング/エラー状態 | 既存流用 | `SnsHubAdmin`の既存の`loading-state`・`error-state`パターンをそのまま踏襲する（insight取得も同じ`loadDrafts`相当の並行フェッチに統合するか、タブ切り替え時に個別フェッチするかは`/step2`で決定） |

## コンポーネント再利用チェックリスト（`.claude/rules/component-reuse.md`準拠）

- **新規か既存拡張か**: タブナビゲーション自体（`SnsHubAdmin`）は既存拡張。タブの中身（`InsightTab`/`InsightCard`）は新規コンポーネントとする。`DraftCard`は動画・承認・修正機能を多数抱える下書き専用コンポーネントのため、insight表示に流用すると不要な複雑化を招く（YAGNI）。ただし見た目のトーン（バッジ・カードの余白感）は既存`DraftCard`のCSS（`SnsHubAdmin.css`）を踏襲し、視覚的な一貫性を保つ
- **App.jsx/RaceDetail.jsxとの重複**: 該当なし（本機能は管理画面専用、ユーザー向け画面とは無関係）
- **デザイントークン**: 新規デザイントークンの追加は不要。既存の意味トークン（`--text-primary`/`--text-secondary`等）・生パレット値（バッジの固定背景色等）をそのまま使う。新規CSSは主に`InsightCard`のレイアウト（`.insight-card`等の新規クラス）程度に限定される
- **ダークモード対応**: 新規カード・バッジはページ背景に直接乗るテキストと自前背景を持つ要素を区別し、`.claude/rules/code-style.md`の意味トークン運用ルールに従う。実装後はライト/ダーク両方でPlaywright確認する
- **ファイル構成**: 既存の`SnsHubAdmin.jsx`が単一ファイル構成（コンポーネントを内部関数として複数定義）のため、新規コンポーネントも同じ慣習に従い同ファイル内に追加する。別ファイルへの分割は行わない（既存パターンとの一貫性を優先）
- **将来のフィルタ拡張性**: MVPではフィルタ・ページネーションは実装しないが（insight数が週数件規模の間は不要、8人パネルでYAGNI判断）、`/step2`のテーブル・API設計時点でplatform/format等によるフィルタが後から追加可能な形にしておく（クエリパラメータ設計等で先回りする）

## モバイル対応

spec.mdの非機能要件により、本タブはスマホの通常ブラウザから閲覧・却下操作ができる必要がある。既存の`DraftCard`同様、`onClick`のみのシンプルな操作にし、`overflow: hidden/auto`によるタッチイベント阻害を避ける（`.claude/CLAUDE.md`のモバイル対応ルール準拠）。
