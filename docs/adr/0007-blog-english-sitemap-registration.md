# ADR 0007: ブログ英語版記事のsitemap登録方式

## ステータス
採用

## 背景
`docs/design/blog-i18n/spec.md`の未確定事項2。PR#273では`scripts/generate-sitemap.js`の`LANGUAGE_ONLY_PAGES.en`配列に記事1件を手動で追記する方式を取った。今回25記事に増える。プロジェクトには過去に新規ページのsitemap登録漏れで長期間Google未インデックスだった実績（`/winning-technique`、CLAUDE.md記載）があり、手動追記に依存する運用は記事が増えるほど漏れのリスクが上がる。

## 決定
`scripts/generate-sitemap.js`の`LANGUAGE_ONLY_PAGES.en`配列で、ブログ記事分は`blogPostsEn`（ADR 0006、`src/data/blogPostsEn.js`）から動的に生成する。

```js
import { blogPostsEn } from "../src/data/blogPostsEn.js";
// ...
en: [
  ...VENUE_GUIDES_EN 由来のエントリ（既存）,
  ...blogPostsEn.map((p) => ({
    basePath: `/blog/${p.id}`,
    changefreq: "monthly",
    priority: "0.6",
  })),
],
```

これは既存の`VENUE_GUIDES_EN.map((v) => ...)`パターン（会場ガイド）と同じ設計であり、`generate-sitemap.js`内で一貫した方式になる。

## 却下した選択肢
- **現状通り記事ごとに1件ずつ手動でオブジェクトを追記**: PR#273では1記事だったため許容したが、25記事・今後も増える前提では「新規記事公開時にsitemap更新を忘れる」リスクが構造的に残る。CLAUDE.mdが「新規ページ追加時のsitemap登録必須」ルールを設けている根本理由（過去の登録漏れ事故）と矛盾する運用
- **`public/blog/`ディレクトリを`-en.md`サフィックスでスキャンして動的検出**: メタデータ（category/tags等）を持たないため、結局`blogPostsEn.js`のような構造化データと二重管理になる。すでにADR 0006で`blogPostsEn.js`を正データとして持つ以上、そちらを単一の情報源にする方が一貫する

## 影響
- 記事を新規に英語対応する際、`src/data/blogPostsEn.js`に1件追加するだけでsitemapが自動的に追従する（`generate-sitemap.js`への追記は不要になる）
- `public/sitemap.xml`自体はCI（`.github/workflows/update-sitemap.yml`）が自動反映するため、実装PRには含めない（`i18n_p1_analysis_tools_handoff`メモリの既存運用を踏襲）
