# ADR 0005: ブログ記事の部分翻訳（記事単位）のルーティング判定方式

## ステータス
採用

## 背景
`docs/design/blog-i18n/spec.md`のFR2で、ブログ83記事中25記事（featured、定期レポート除く）のみを英語対応する。既存の`isPathTranslated()`（`src/config/languages.js`）はprefix一致判定で、`TRANSLATED_PATHS`に登録したパスの配下は**全て**翻訳済みとみなす設計（`/venues`配下24会場全て、`/winning-technique`配下15タブ全て、のように「配下丸ごと翻訳済み」を前提にしてきた）。

`/blog`をそのまま`TRANSLATED_PATHS`に追加すると、未翻訳の58記事も含めて`/en/blog/{id}`が全て「翻訳済み」と誤判定され、英語版データの無い記事でja版コンテンツにフォールバックする実装と組み合わさると、CLAUDE.mdが禁止する「lang=enを宣言しながら日本語コンテンツを配信する」状態になる（`docs/design/blog-i18n/screens.md`参照）。「配下の一部記事だけ翻訳済み」という初めてのケースへの対応が必要。

## 決定
`src/config/languages.js`に新しい仕組み`PARTIALLY_TRANSLATED_PATHS`を追加する。

```js
export const PARTIALLY_TRANSLATED_PATHS = {
  "/blog": {
    listPage: true, // /blog自体(一覧)は言語別に提供
    entries: ["odds-expected-value-guide", "winning-technique-analysis-guide", /* ...25記事分 */],
  },
};
```

`isPathTranslated(basePath)`は、既存の`TRANSLATED_PATHS`判定に加えて`PARTIALLY_TRANSLATED_PATHS`もチェックする:
- `basePath === "/blog"` → `listPage: true`なら翻訳済み
- `basePath === "/blog/{id}"` → `entries`に`{id}`が含まれれば翻訳済み
- 上記以外の`/blog/*`（未登録記事） → 翻訳対象外（ja版へリダイレクト）

`entries`の実体は`src/data/blogPostsEn.js`（ADR 0006）のIDリストから動的に導出し、`languages.js`側に静的な配列を二重管理しない。

## 却下した選択肢
- **25記事の個別パスを`TRANSLATED_PATHS`にそのまま列挙し、一覧ページ`/blog`は登録しない**: 最もシンプルだがFR7（英語版一覧ページ）を実現できないため却下（ユーザー確認済み、一覧ページは作る方針）
- **`/blog`を`TRANSLATED_PATHS`に登録し、英語版データが無い記事はja版内容にフォールバックする**: 実装は簡単だが、「lang=enを宣言しながら日本語コンテンツを配信する」というプロジェクトが過去のi18n監査で明確に禁止した状態を意図的に作ることになるため却下
- **`LANGUAGE_ONLY_PATHS`（既存の仕組み）を流用し、記事IDのホワイトリストをそこに追加する**: `LANGUAGE_ONLY_PATHS`は既に「ja不在で特定言語のみ存在する」（venues等）と「ja+en両方存在する単一パス」（PR#273のブログ1記事ハック）という2つの異なる意味で使われており、そこに「配下の一部だけ許可」という3つ目の意味を重ねるとこのマップの解釈がさらに複雑化する。新しい概念は独立した仕組みとして分離した方が可読性が高いと判断

## 影響
- `isPathTranslated()` / `getAvailableLanguages()`の実装変更が必要（`src/config/languages.js`）。この2関数は`LocalizedLayout`のリダイレクトガード・`LanguageSwitcher`・`HreflangTags`の全てが依存しているため、変更後は既存の翻訳済みページ（`/`, `/guide`, `/venues`, `/winning-technique`）で回帰が無いことをPlaywrightで確認する
- 記事を新規に英語対応する際は、`src/data/blogPostsEn.js`に1件追加するだけで`entries`が自動的に増える（`languages.js`への手動追記は不要）
