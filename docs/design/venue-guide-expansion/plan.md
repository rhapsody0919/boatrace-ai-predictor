# 会場別ビジターガイド 全会場化・フル拡充 — システム設計

spec.md / screens.md を踏まえた技術設計。重要な技術判断は `docs/adr/0001`〜`0004` を参照。

## データ設計

Supabaseテーブルの追加・変更は不要（会場ガイドのコンテンツは静的JSデータファイルで完結する既存方針を踏襲。`src/data/venueGuidesEn.js` は `scripts/generate-sitemap.js` から node 直実行でも import されるため、Vite専用構文を使わない制約を維持する）。

### `src/data/venueGuidesEn.js` のスキーマ拡張

既存フィールド（`slug, code, name, kanji, region, tagline, intro, access, facts, tip`）に加えて以下を追加する。

```js
{
  // 既存フィールドは変更なし
  regionGroup: "kanto", // 新規: 地域ハブページのグルーピングキー（ADR 0002）
  nearbyAttractions: [ // 新規: 周辺観光・グルメセクション
    { name: "...", description: "..." },
  ],
  schedule: { // 新規: 開催カレンダー詳細セクション
    typicalRaceDays: "...", // 例: 通常開催は年6-8回、各6日間
    seasonalNotes: "...",   // 例: 主要G1/SGレースの開催時期の傾向
  },
  image: { // 新規: 会場写真（ADR 0003）。見つからない場合はnull
    src: "/images/venues/heiwajima.jpg",
    alt: "...",
    credit: "Photo by ..., CC BY-SA 4.0",
    creditUrl: "https://commons.wikimedia.org/...",
  } | null,
}
```

- `regionGroup` の値は `src/data/venueRegions.js`（新規）で定義する地域マスタのキーと対応させる
- 既存5会場（heiwajima/suminoe/edogawa/tamagawa/fukuoka）にも `regionGroup`・`nearbyAttractions`・`schedule`・`image` を追加し、横並びの一貫性を保つ（spec.mdの「既存5会場も適用対象に含める」方針）
- 19会場の `slug` は `src/utils/venueUtils.js` の `VENUE_CODE_TO_BLOG_ID`（24会場分のcode→slug対応が既に存在）のキーをそのまま流用し、サイト内の会場識別子を統一する

### `src/data/venueRegions.js`（新規）

```js
export const VENUE_REGIONS = [
  { slug: "kanto", label: "Kanto (Tokyo Area)" },
  { slug: "kansai", label: "Kansai (Osaka Area)" },
  // 他地域は19会場の内訳確定後、実装時に確定する（未確定事項）
];
```

会場コード→地域の対応は `venueGuidesEn.js` 側の `regionGroup` フィールドに持たせ、本ファイルは地域自体のメタ情報（表示名・スラッグ）のみを持つ。

## コンポーネント構成・データフロー（UI機能）

```
VenueGuideList（既存拡張, /en/venues）
  ├─ VenueCard（新規抽出, 会場カードのレンダリングを共通化）
  └─ VenueStructuredData（新規, ItemList + BreadcrumbList のJSON-LD）

VenueGuideDetail（既存拡張, /en/venues/:slug）
  ├─ 新規セクション: 周辺観光・グルメ（nearbyAttractions）
  ├─ 新規セクション: 開催カレンダー詳細（schedule）
  ├─ 画像表示（image、nullなら非表示）
  └─ VenueStructuredData（TouristAttraction + BreadcrumbList のJSON-LD）

VenueRegionHub（新規, /en/venues/region/:regionSlug）
  ├─ VenueCard（共通、上記と同一コンポーネントを再利用）
  └─ VenueStructuredData（ItemList + BreadcrumbList）
```

- `VenueCard` は `VenueGuideList` から抽出し、一覧・地域ハブの両方から使う（component-reuse.md準拠、ADR 0002）
- `VenueStructuredData` は `lang`・ページ種別（list/detail/region）・対象データを受け取り、適切なJSON-LDを`<script type="application/ld+json">`として出力する共通コンポーネント（ADR 0001）
- `VenueGuide.jsx` の既存の `copy` オブジェクトパターンを維持し、新規セクションの見出し文言等も`copy`経由で渡す（EnglishVenueGuide.jsx/ZhTwVenueGuide.jsxのラッパー方式を維持。ただし本フェーズは英語のみ対象）

### ルーティング（`src/AppRouter.jsx` / `src/config/languages.js`）

- `LANGUAGE_ONLY_PATHS` に `/venues/region` を追加（現状 `{"/venues": ["en", "zh-TW"]}` の並びに `"/venues/region": ["en"]` を追加）
- `VENUE_GUIDE_BY_LANG` と同様のパターンで地域ハブページのコンポーネントマップを追加、またはシンプルに `en` 固定で直接ルート定義するかは実装時に既存コードの読みやすさを見て判断
- **【設計レビューで発見した必須修正、ADR 0002参照】** `getAvailableLanguages`は現状「最初にマッチしたエントリ」を返すため、`/venues`が`/venues/region`より前に登録されていると、プレフィックス一致により`/venues/region/kanto`が誤って`/venues`エントリ（`en`, `zh-TW`）にマッチする。地域ハブはzh-TW非対応のため、この誤マッチはルーティングガード・hreflang双方で誤動作する。実装時（BOA-138）に`getAvailableLanguages`を「最も長く一致するエントリを優先する」ロジックに修正すること

## 既存サービス層・共通ライブラリとの連携

### `scripts/lib/googleServiceAuth.js`（新規）

`i18n-demand-report.js` に内包されているGoogleサービスアカウント認証ロジック（dotenv読み込み・JWTクライアント生成、17-71行目相当）を切り出し、スコープを引数で受け取れる共通関数にする（ADR 0004）。

```js
// scripts/lib/googleServiceAuth.js
export function getGoogleAuthClient(scopes) { /* ... */ }
```

- `i18n-demand-report.js` はこの関数を呼ぶようにリファクタリング（動作は変えない）
- 新規 `scripts/analysis/search-console-report.js` も同じ関数を呼び、スコープに `https://www.googleapis.com/auth/webmasters.readonly` を渡す
- Search Console APIクライアントは `google.searchconsole({ version: "v1", auth })` を使用
- 出力先: `data/analysis/search-console/report-{日付}.json`（`i18n-demand-report.js` の出力パターンを踏襲）

### `scripts/generate-sitemap.js`

- 19会場分のURL + 地域ハブページURL（`/en/venues/region/{slug}`）を `LANGUAGE_ONLY_PAGES.en` に追加

### CSS・デザイントークン

- 新規セクション（周辺観光・グルメ、開催カレンダー）は既存の `eg-section` クラスパターンをそのまま使い、新規CSSは最小限に抑える
- 画像枠は新規クラス（`evg-photo` 等）を追加。色・spacingは `--color-gray-200`（ボーダー）等、既存の design-tokens.css 変数を使用しハードコードしない

## 未確定事項の扱い

`spec.md`に記載の未確定事項（地域区分の粒度、19会場の実装分割単位等）は `/step3` のタスク分解時に確定させる。
