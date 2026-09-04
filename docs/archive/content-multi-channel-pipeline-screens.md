# 画面・コンポーネント洗い出し

対象: `docs/design/content-multi-channel-pipeline/spec.md` FR6（sns-hub管理画面拡張）。他のFR（1〜5, 7〜8）は画面変更を伴わないRoutine/スクリプト側の変更のため対象外。

既存実装: `src/pages/admin/SnsHubAdmin.jsx`（1433行）・`SnsHubAdmin.css`（990行）・`src/services/snsHubService.js`（145行）・`api/admin/sns-hub/generate.js`。`.claude/rules/component-reuse.md`に従い、既存パターンの再利用を優先する。

## ナビゲーション構造の変更（既存の破壊的変更）

現状のTABSはステータス軸（承認待ち/投稿準備完了/投稿済み/戦略メモ/フォーマットカタログ）。ユーザー要望（「note/blogもタブで分けたい」「TikTok/X/YouTubeもタブで分けたい」）に応えるには、**プラットフォーム軸を主タブに、ステータスを副フィルタに**という2軸構造への変更が必要——ステータス軸を単純併記するのではなく、既存の主タブをプラットフォーム軸に置き換える構造変更になる。この変更方針自体、実装前にユーザー確認を挟みたい（既存の実運用中の画面を触るため）。

- **新規**: 主タブを7つに変更: `TikTok` / `X` / `YouTube`（新規） / `Note`（新規） / `Blog`（新規） / `戦略メモ`（既存維持） / `フォーマットカタログ`（既存維持）
- **既存流用**: 各プラットフォームタブ内のステータス副フィルタ（承認待ち/投稿準備完了/投稿済み）は既存の`TABS`配列のstatuses絞り込みロジックをそのまま使う
- **既存流用**: タブ切り替えの見た目（`tab-btn`、件数バッジ）は既存CSS・パターンをそのまま使う。デザイントークンの新規追加は不要

## 主要コンポーネント

| コンポーネント | 新規/既存拡張 | 役割 |
|---|---|---|
| `SnsHubAdmin`（メイン） | 既存拡張 | タブ状態管理をプラットフォーム軸+ステータス副フィルタの2軸に変更 |
| `DraftCard` | 既存拡張 | 現状`<VideoPreview>`を無条件描画しており動画前提。`draft.platform`が`blog`/`note`の場合は`<TextDraftPreview>`（新規）を出し分ける分岐を追加 |
| `TextDraftPreview`（新規） | 新規 | ブログ/note下書きのプレビュー。タイトル・本文（折りたたみ可）・タグ一覧・画像orYouTubeリンクのサムネ表示。VideoPreviewと役割は対応するが中身は別物のため新規コンポーネント化 |
| `CopyToClipboardButton`（新規） | 新規 | note下書きの本文・タグをワンタップでコピー。「コピペボタン」要件（FR6）に対応。汎用的な小コンポーネントとして新規実装し、他画面でも再利用可能にする |
| `BlogApproveAction`（新規） | 新規 | Blogタブの承認ボタン。押下で新設APIエンドポイント（`/api/admin/sns-hub/merge-blog-pr`等）を叩き、対応PRをGitHub API経由でマージする。確認ダイアログ必須（不可逆操作のため） |
| `YouTubeApproveAction`（新規） | 新規 | YouTubeタブの承認ボタン。押下で新設APIエンドポイント（`/api/admin/sns-hub/publish-youtube`等）を叩き、YouTube Data API v3経由で動画+サムネ+メタデータを投稿する。既存の「承認」と「投稿」が別ステップだったTikTok/Xと異なり、YouTubeは承認＝投稿になる点をUI上も明示する（ボタン文言を「承認」ではなく「承認して公開」等にする） |
| `ThumbnailPreview`（新規） | 新規 | YouTube下書きのサムネイル画像プレビュー。`VideoPreview`の画像版として近い構造だが、YouTube固有（1280x720固定）のため新規コンポーネント |
| `RevisionPanel` | 既存拡張 | `REVISION_REASONS`定数にブログ/note向けの理由コードを追加（例: `search-intent-mismatch`検索意図とズレている、`data-accuracy-error`数値・データの誤り、`too-similar-to-existing`既存記事と似すぎている）。プラットフォームに応じて表示する理由リストを出し分ける |
| `PostingActionLinks` | 既存拡張 | YouTubeは承認時点で投稿完了するため、このコンポーネントの対象外（TikTok/Xのみ引き続き使用） |

## 未使用・変更不要

- `InsightTab`／`InsightCard`／`InsightScopeBadges`／`InsightHistoryEntry`（戦略メモタブ）: FR8でinsightsストアの`platform`スコープにblog/noteを追加するのみで、UIコンポーネント自体の変更は不要（既存の汎用表示で足りる）
- `CatalogTab`／`TemplateVariantList`／`DocReferenceSection`（フォーマットカタログタブ）: 変更不要
- `TikTokMetricsForm`／`ApproverChips`／`ProcessingStatusBadge`／`RiskWarningBadge`: 変更不要、既存のまま流用

## デザイントークン

新規の色・サイズ定義は不要。既存の`src/styles/design-tokens.css`のプラットフォームバッジ色（`draft-badge-platform-*`パターン）に`blog`/`note`用のクラスを追加するのみ（トークン自体は既存の意味トークンを流用、`.claude/rules/code-style.md`のダークモード対応ルールに従う）。

## 未確定（ユーザー確認が必要、自律進行モードのためブロックせず記録）

- ナビゲーション構造の変更（ステータス軸→プラットフォーム軸）は、既存の実運用中の管理画面に対する破壊的変更。この方針で進めてよいか実装前に確認したい
- YouTube「承認して公開」ボタンの文言・確認ダイアログの具体的な表現
