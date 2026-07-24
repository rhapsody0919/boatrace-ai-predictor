# 会場別ビジターガイド 全会場化・フル拡充 — 画面・コンポーネント一覧

spec.md の機能要件1-8に対応する画面・コンポーネントを洗い出す。

## 既存画面（拡張）

| 画面/コンポーネント | 役割 | 対応要件 | 新規/拡張 |
|---|---|---|---|
| `/en/venues`（`VenueGuideList`, `src/pages/VenueGuide.jsx`） | 会場一覧。24会場カードを表示 | 1, 6 | **既存拡張**。24会場対応 + 地域別グルーピング表示（見出し区切り or フィルタ）を追加。カードのレンダリング自体（`evg-card`）は変更なし |
| `/en/venues/:slug`（`VenueGuideDetail`, `src/pages/VenueGuide.jsx`） | 会場詳細。アクセス・特徴・投注tips等 | 1, 2, 3, 4, 5 | **既存拡張**。新規セクション（周辺観光・グルメ、開催カレンダー詳細）、画像枠、構造化データ出力を追加 |
| `src/data/venueGuidesEn.js` | 会場コンテンツデータ（現行5会場） | 1, 2, 3, 4 | **既存拡張**。19会場追加 + スキーマ拡張（`nearbyAttractions`, `schedule`, `image` 等のフィールド追加）。node直実行制約（Vite非依存）は維持 |
| `EnglishVenueGuide.css` | 会場ガイドの装飾CSS | 3, 4 | **既存拡張**。新規セクション・画像枠用のクラスを追加。デザイントークン（`src/styles/design-tokens.css`）の色・スペーシング変数を使用し、ハードコードしない |
| `scripts/generate-sitemap.js` | sitemap生成 | 1, 6 | **既存拡張**。19会場分URL + 地域ハブページURLを`LANGUAGE_ONLY_PAGES.en`に追加 |
| `ZhTwGuide.jsx` 内の会場ガイド案内セクション | 入門ガイドから会場ガイドへの導線 | - | 変更不要（既に`/zh-TW/venues`への案内文言があり、対象会場数の変化に影響されない） |

## 新規画面・コンポーネント

| 画面/コンポーネント | 役割 | 対応要件 | 新規/拡張 |
|---|---|---|---|
| `/en/venues/region/:regionSlug`（仮、新規コンポーネント名は`/step2`で確定） | 地域別ハブページ（例: 関東エリアの会場一覧） | 6 | **新規**。カードのレンダリングは`VenueGuideList`と共通化し、複製しない（component-reuse.md準拠）。フィルタ済みデータを渡すラッパーとして実装する方針 |
| `VenueStructuredData`（仮、新規小コンポーネント） | schema.orgのJSON-LDを`<script type="application/ld+json">`で出力 | 5 | **新規**。一覧・詳細の両方から呼ばれるため、component-reuse.mdの「同じUIパターンが2箇所以上で使われる場合は共通化必須」ルールに従い最初から共通コンポーネントとして作る |
| `src/data/venueRegions.js`（仮、新規データファイル） | 会場コード→地域（関東/関西/九州等）のマッピング | 6 | **新規**。`src/utils/venueUtils.js`の`VENUE_CODE_TO_BLOG_ID`（24会場分のcode↔slug対応が既にある）と整合するキー設計にする |

## 非画面（参考記載、本コマンドの対象外）

| 項目 | 役割 | 対応要件 |
|---|---|---|
| `scripts/analysis/search-console-report.js`（仮、新規） | Search Console APIから検索順位・CTRを取得しレポート出力 | 7 |

## コンポーネント再利用方針の確認（component-reuse.md準拠）

- `evg-card`（会場カードのレンダリング）: 一覧ページ・地域ハブページの両方で使うため、**共通化必須**。`VenueGuideList`から抽出するか、共通の`VenueCard`サブコンポーネントに切り出すかは`/step2`で決定
- 構造化データ出力: 一覧・詳細の2箇所で必要になるため、最初から`VenueStructuredData`として共通コンポーネント化する（複製しない）
- CSS: 新規セクション（周辺観光・グルメ、開催カレンダー）は既存の`eg-section`パターンを流用できるため新規CSSクラスは最小限。画像枠のみ新規クラス（例: `evg-photo`）が必要と見込む
- デザイントークン: 色・spacingは`src/styles/design-tokens.css`の変数を使用し、ハードコードしない。地域ハブページのバッジ等も既存の`evg-badge`パターンを流用する
