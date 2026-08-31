# SNSハブ管理画面 UX改善 — 画面・コンポーネント洗い出し

対象画面は`/admin/sns-hub`（`src/pages/admin/SnsHubAdmin.jsx`）1画面のみ。App.jsx / RaceDetail.jsx等、他ページへの影響は無い。既存コンポーネント構成（`.claude/rules/component-reuse.md`準拠、`docs/design/sns-marketing-hub/screens.md`のパターンを踏襲）を確認した上で、拡張と新規を仕分けた。

## 影響コンポーネント一覧

| コンポーネント | 現状 | 対応課題 | 種別 | 役割 |
|---|---|---|---|---|
| `RevisionPanel` | 既存(`SnsHubAdmin.jsx:703`) | 1, 4 | **拡張** | 一部修正・作り直しの入力パネル。`canSubmit`条件を修正し、「今後の生成方針に反映する」チェックボックスを追加 |
| `DraftCard` | 既存(`SnsHubAdmin.jsx:405`) | 2 | **拡張** | 下書き1件のカード。`status==='revision_requested'`時に処理中/警告バッジを表示する分岐を追加 |
| `ProcessingStatusBadge` | ー | 2 | **新規（小）** | 「処理中」「時間がかかっています」を出し分けるバッジ。`updated_at`からの経過時間で判定。既存`RiskWarningBadge`(`SnsHubAdmin.jsx:784`)と同じ「アイコン＋テキストの小バッジ」パターンを踏襲し、色は`--color-warning`系トークンを再利用（新規CSSはほぼ不要） |
| `SnsHubAdmin`（トップレベル） | 既存(`SnsHubAdmin.jsx:82`) | 2 | **拡張** | 手動更新ボタンを`tab-navigation`付近に追加し、押下で`loadDrafts()`を明示的に再実行する |
| `TABS`定数 | 既存(`SnsHubAdmin.jsx:67`) | 3 | **拡張** | `{id:"catalog", label:"フォーマットカタログ"}`を追加。既存の`insights`タブと同じ「専用タブ・件数バッジ無し」パターンを踏襲 |
| `CatalogTab` | ー | 3 | **新規** | フォーマットカタログタブ本体。`InsightTab`(`SnsHubAdmin.jsx:232`)と対になる新規トップレベルタブコンポーネント。「型一覧セクション」＋「ドキュメント参照セクション」の2区画構成 |
| `TemplateVariantList` | ー | 3 | **新規** | `sns_template_variants`の一覧表示（型名・フォーマット・作成者human/routine・稼働状態）。既存`insight-list`のカード羅列パターンを踏襲したテーブルまたはカード一覧 |
| `DocReferenceSection` | ー | 3 | **新規** | `docs/operation/sns-video-producer-prompt.md`・`x-operations-playbook.md`・`docs/reference/sns-brand-guideline.md`へのリンクと関連セクション引用を表示。データ取得方式（ビルド時埋め込み or API経由）は`/step2`で決定 |
| `snsHubService.js` | 既存 | 3, 4 | **拡張** | `getTemplateVariants()`（新規、課題3用）を追加。`reviseDraft`/`redoDraft`の呼び出しペイロードに`saveAsInsight`フラグを追加（課題4） |
| `api/admin/sns-hub/template-variants/index.js` | ー | 3 | **新規API** | `sns_template_variants`一覧を返すEdge Function。既存`api/admin/sns-hub/insights/index.js`と同じ薄いGETラッパーパターン |
| `api/admin/sns-hub/drafts/[id]/revise.js` | 既存 | 1, 4 | **拡張（バックエンド）** | `reasonCodes`必須バリデーションを`reasonCodes`または`freeText`いずれか必須に緩和。`saveAsInsight`受け取り時に`sns_strategy_insights`へのINSERT処理を追加 |
| `api/admin/sns-hub/drafts/[id]/redo.js` | 既存 | 4 | **拡張（バックエンド）** | 同上（`saveAsInsight`対応） |
| `PostingActionLinks` | 既存(`SnsHubAdmin.jsx:538`) | 5 | **拡張** | 「投稿準備完了」タブのダウンロード導線。既存の`<a href download>`をfetch+blob方式のダウンロード処理に置き換える。iOS Safari向け「共有して投稿」の分岐（`shareState.canShare`）はそのまま維持し、フォールバック側のみ変更 |
| `webShare.js` | 既存(`src/utils/webShare.js`) | 5 | **拡張** | `canShareVideo`と同じfetch+blobパターンで、`downloadVideoBlob(videoUrl, fileName)`（仮称）を新規追加。同一オリジンのblob URLを生成し、一時的な`<a download>`要素をクリックしてダウンロードをトリガーする |

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

- **トークンで足りる**: `ProcessingStatusBadge`は既存`.risk-warning-badge`と同じ`var(--color-warning)`/`var(--color-warning-text)`系トークンをそのまま流用できる（`SnsHubAdmin.css:206-209`参照）。手動更新ボタンも既存の`.tab-btn`相当のスタイルパターンを流用可能。ダウンロードボタンのローディング表示（課題5）も既存`.spinner`（`SnsHubAdmin.jsx`のloading-state）と同系統のインジケーターで表現でき、新規デザインは不要
- **新規CSSが必要**: `CatalogTab`内の型一覧表示（テーブルまたはカードグリッド）と`DocReferenceSection`のレイアウトは、既存の`insight-card`/`insight-list`パターンを一部踏襲しつつ、新規クラスの追加が必要（`SnsHubAdmin.css`に追記する形、新規CSSファイルは作らない）

## 未確定事項（spec.mdからの引き継ぎ、この時点でも未解決）

- `DocReferenceSection`のデータ取得方式（ビルド時に静的インポートするか、Edge Functionでファイルを読んで返すか）→ `/step2`
- `sns_strategy_insights.source`の実DB型（ネイティブENUM/CHECK制約）→ `/step2`
- 「処理中」バッジの具体的な文言・閾値（30分は目安）の最終確定 → `/step2`実装時に確定でよい（UI文言レベルのため`/step1-screens`ではブロッカーにしない）
