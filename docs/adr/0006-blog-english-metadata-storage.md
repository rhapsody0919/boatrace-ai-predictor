# ADR 0006: ブログ英語版メタデータの保存形式

## ステータス
採用

## 背景
`docs/design/blog-i18n/spec.md`の未確定事項1。PR#273の暫定実装（`ENGLISH_POST_OVERRIDES`、`BlogPost.jsx`内にハードコードされた1記事分のオブジェクト）を廃止し、25記事分の英語版メタデータ（title/description/category/tags/readTime）を持続可能な形で保存する方式を決定する。`src/data/blogPosts.js`は既存83記事分で17000行超のうちの一部を占める大きなファイル。

## 決定
`src/data/blogPostsEn.js`を新設し、英語版メタデータを日本語版とは別ファイルで管理する。

```js
export const blogPostsEn = [
  {
    id: "odds-expected-value-guide", // src/data/blogPosts.js の id と対応
    title: "How Odds Work in Boat Racing — Choosing Bets by Expected Value",
    description: "...",
    category: "Data Analysis",
    tags: ["Odds", "ExpectedValue", "..."],
    readTime: "9 min",
  },
  // ...
];

export function getEnglishOverride(id) {
  return blogPostsEn.find((p) => p.id === id);
}
```

`date`・`image`等、日本語版と共有できるフィールドは`blogPosts.js`側の値をそのまま使う（`{ ...basePost, ...override }`のマージ方式はPR#273から継続）。本文は既存パターン通り`public/blog/{id}-en.md`。

## 却下した選択肢
- **`blogPosts.js`の各記事オブジェクトに`translations: { en: {...} }`を直接持たせる（1ファイル統合案）**: 記事と翻訳が同一箇所にあり参照は分かりやすいが、ただでさえ大きい`blogPosts.js`（17000行超）がさらに肥大化する。また日本語版のみ参照したい処理（`Blog.jsx`のja版一覧等）で不要な翻訳データを常に読み込むことになる
- **記事ごとに個別ファイル（`src/data/blog/{id}.en.js`等）に分割する**: 25ファイルは管理コストが高く、一覧性が失われる。会場ガイド（`venueGuidesEn.js`のような1言語1ファイル方式）の実績パターンと整合しない

言語別に完全に独立したファイルとして持つ方式は、会場ガイド（`venueGuidesEn.js` / `venueGuidesZhTw.js` / `venueGuidesKo.js`）で採用済みで24会場×3言語の運用実績があり、同じ設計をブログにも横展開する。

## 影響
- `BlogPost.jsx` / `Blog.jsx`は`getPostById(id)`（ja版）に加えて`getEnglishOverride(id)`（en版、存在しなければ`undefined`）を参照し、`isEnglish`判定時にマージする
- `PARTIALLY_TRANSLATED_PATHS.["/blog"].entries`（ADR 0005）は`blogPostsEn.map(p => p.id)`から動的に導出する
- sitemap生成（ADR 0007）も`blogPostsEn`から動的にURLリストを生成する
