# ブログ英語版本格インフラ化 実装計画

`docs/design/blog-i18n/spec.md`・`screens.md`、および`docs/adr/0005〜0007`の決定に基づく実装計画。

## データ設計

### `src/data/blogPostsEn.js`（新規）
ADR 0006の構造。英語版が存在する記事のみを配列で持つ。

```js
export const blogPostsEn = [
  {
    id: "odds-expected-value-guide",
    title: "...",
    description: "...",
    category: "Data Analysis",
    tags: ["Odds", "ExpectedValue", "..."],
    readTime: "9 min",
  },
  // 25記事分。新しい記事から順に追加（spec.md FR3）
];

export function getEnglishOverride(id) {
  return blogPostsEn.find((p) => p.id === id);
}

export function isEnglishAvailable(id) {
  return blogPostsEn.some((p) => p.id === id);
}
```

`date`・`image`・`tags`のうち翻訳不要なフィールドは`getPostById(id)`（ja版、`blogPosts.js`）の値をそのまま使う。`category`は英語では別文字列になるため必ず上書きする。

### `public/blog/{id}-en.md`（新規×25、段階的に追加）
既存パターン（`odds-expected-value-guide-en.md`）を踏襲。1記事= 1ファイル。

### Supabaseマイグレーション
不要。ブログはフロントエンド静的データ（`src/data/`配下のJS配列 + `public/blog/`配下のMarkdown）のみで完結しており、DBテーブルを持たない。

## ルーティング・ロジック設計（`src/config/languages.js`）

ADR 0005の`PARTIALLY_TRANSLATED_PATHS`を追加する。

```js
import { blogPostsEn } from "../data/blogPostsEn.js";

export const PARTIALLY_TRANSLATED_PATHS = {
  "/blog": {
    listPage: true,
    entries: blogPostsEn.map((p) => p.id),
  },
};
```

`isPathTranslated`の変更（既存ロジックへの追加、置き換えではない）:

```js
export function isPathTranslated(basePath) {
  if (
    TRANSLATED_PATHS.some(
      (p) => basePath === p || (p !== "/" && basePath.startsWith(`${p}/`)),
    )
  ) {
    return true;
  }
  for (const [prefix, config] of Object.entries(PARTIALLY_TRANSLATED_PATHS)) {
    if (basePath === prefix) return config.listPage;
    if (basePath.startsWith(`${prefix}/`)) {
      const rest = basePath.slice(prefix.length + 1);
      return config.entries.includes(rest);
    }
  }
  return false;
}
```

`getAvailableLanguages`も同様に、`PARTIALLY_TRANSLATED_PATHS`にマッチした場合は`["ja", "en"]`相当（`SUPPORTED_LANGUAGES`からja/enのみ）を返すよう分岐を追加する。**注意**: `languages.js`はNode.js（`generate-sitemap.js`）からもimportされる純粋JSモジュール。`blogPostsEn.js`の循環import等が発生しないか実装時に確認する（現状`blogPosts.js`・`venueGuidesEn.js`等も同様にNode/Reactの両方からimportされており前例通りのはず）。

## コンポーネント構成・データフロー

### `src/pages/BlogPost.jsx`
- `ENGLISH_POST_OVERRIDES`オブジェクトを削除
- `isEnglish`判定: `lng === "en" && isEnglishAvailable(id)`
- `post`のマージ: `isEnglish && basePost ? { ...basePost, ...getEnglishOverride(id) } : basePost`
- `mdPath`: `isEnglish ? `/blog/${id}-en.md` : `/blog/${id}.md``（命名規則を固定化し、`ENGLISH_POST_OVERRIDES`個別指定だったmdPathフィールドを廃止）
- `relatedPosts`: `isEnglish`時は`getRelatedPosts(id, 3)`相当のロジックを、`blogPostsEn`に存在する記事のみでフィルタする専用関数（`getRelatedPosts`に`langFilter`引数を追加、または`blogPosts.js`側に`getRelatedPostsEn`を新設）
- `useEffect`依存配列（`basePost`使用）・`localizePath()`によるURL生成はPR#273の実装をそのまま維持

### `src/pages/Blog.jsx`
- `isEnglish`判定を`BlogPost.jsx`と同様に追加（`useLocation` + `parseLangFromPath`）
- `filteredPosts`のベースを、`isEnglish`なら`blogPosts.filter(p => isEnglishAvailable(p.id)).map(p => ({ ...p, ...getEnglishOverride(p.id) }))`に置き換え
- `categories`（カテゴリフィルターの選択肢）も英語版記事のカテゴリのみから動的に生成
- 見出し・説明文・「すべて」ボタン・空状態メッセージは`BlogPost.jsx`の`UI_TEXT`と同様のパターンで言語別に定義（コンポーネント間で共有する場合は`src/pages/blogI18nText.js`のような小さい共通ファイルに切り出すことを検討。実装時に重複度合いを見て判断）
- BreadcrumbListのitem URLを`localizePath()`で生成

### `src/utils/blogFaqSchema.js`
`extractFaqItems`の見出し検出を拡張:
```js
const headingMatch = markdown.match(/^##\s*(よくある質問|FAQ)\s*$/m);
```

## sitemap設計（`scripts/generate-sitemap.js`）
ADR 0007の通り、`blogPostsEn`から動的に生成する。`LANGUAGE_ONLY_PAGES.en`に以下を追加:
```js
...blogPostsEn.map((p) => ({
  basePath: `/blog/${p.id}`,
  changefreq: "monthly",
  priority: "0.6",
})),
```
既存の`odds-expected-value-guide`個別ハードコードエントリは削除する。`getBlogPosts()`の`-en.md`除外ロジック（PR#273で追加済み）はそのまま維持。

## 実装順序（複数PRに分割、spec.mdの非機能要件に基づく）
1. **基盤PR**: `blogPostsEn.js`（`odds-expected-value-guide`のみで開始）+ `languages.js`の`PARTIALLY_TRANSLATED_PATHS`導入 + `BlogPost.jsx`/`Blog.jsx`の新方式移行 + `blogFaqSchema.js`拡張 + sitemap動的化。既存1記事分のデータを新方式に移行するだけなので、動作確認がしやすい
2. **記事追加PR（複数、新しい記事から順）**: `-en.md`翻訳 + `blogPostsEn.js`へのエントリ追加を1〜数記事ずつ。基盤が整っているため各PRは小さく機械的な作業になる

## CLAUDE.md更新
「新機能リリース時のブログ記事ルール」セクションに、featured記事公開時は英訳（`-en.md` + `blogPostsEn.js`エントリ）も同一PRまたは近接PRで作成する旨を追記する（spec.md FR3）。
