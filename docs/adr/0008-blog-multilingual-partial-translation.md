# ADR 0008: ブログ部分翻訳の多言語対応方式（zh-TW追加に伴う設計変更）

## ステータス
採用

## 背景
`docs/adr/0005-blog-partial-translation-routing.md`で導入した`PARTIALLY_TRANSLATED_PATHS`は、`/blog`に対して単一の`entries`（記事IDリスト）と単一の`langs`（`["ja", "en"]`固定）を持つ設計だった。これは英語のみを対象にしていた前提が成り立っていたため機能していた。

`docs/design/blog-i18n/spec.md`の「拡張: zh-TW版」で、zh-TW版をfeatured記事25件に展開することになった。会場ガイドの実績同様、zh-TW版は英語版と別スケジュールで段階的に追加されるため、**記事ごとに「どの言語で提供されているか」が非対称になる**（例: ある記事はja+en+zh-TWの3言語、別の記事はまだja+enの2言語のみ、という状態が展開途中は常に発生する）。既存の`langs: ["ja", "en"]`という固定配列では、この非対称性を表現できない。

## 決定
`PARTIALLY_TRANSLATED_PATHS`の`langs`/`entries`という静的フィールドを廃止し、`matchPartiallyTranslated`が**記事IDごとに動的に提供言語を算出する**方式に変更する。

```js
import { blogPostsEn } from "../data/blogPostsEn.js";
import { blogPostsZhTw } from "../data/blogPostsZhTw.js";

// /blog配下の記事翻訳データソース。新言語追加時はここに1行足すだけで良い
const BLOG_TRANSLATION_SOURCES = {
  en: blogPostsEn,
  "zh-TW": blogPostsZhTw,
};

export const PARTIALLY_TRANSLATED_PATHS = {
  "/blog": { listPage: true },
};

function blogLangsFor(id) {
  return Object.entries(BLOG_TRANSLATION_SOURCES)
    .filter(([, posts]) => posts.some((p) => p.id === id))
    .map(([lang]) => lang);
}

function matchPartiallyTranslated(basePath) {
  const matches = Object.entries(PARTIALLY_TRANSLATED_PATHS).filter(
    ([prefix]) => basePath === prefix || basePath.startsWith(`${prefix}/`),
  );
  if (matches.length === 0) return null;
  const [prefix, config] = matches.reduce((longest, current) =>
    current[0].length > longest[0].length ? current : longest,
  );

  if (basePath === prefix) {
    if (!config.listPage) return null;
    const langs = new Set(["ja"]);
    Object.entries(BLOG_TRANSLATION_SOURCES).forEach(([lang, posts]) => {
      if (posts.length > 0) langs.add(lang);
    });
    return { langs: [...langs] };
  }

  const rest = basePath.slice(prefix.length + 1);
  const langs = ["ja", ...blogLangsFor(rest)];
  return langs.length > 1 ? { langs } : null;
}
```

一覧ページ（`/blog`自体）は「1件でも翻訳記事がある言語」なら提供扱いにする（記事が0件の言語では一覧ページ自体を出さない）。個別記事は、その記事IDが`BLOG_TRANSLATION_SOURCES`のどの言語に存在するかで動的に決まる。

## 却下した選択肢
- **`langs`配列に`"zh-TW"`を単純に追加する（`["ja", "en", "zh-TW"]`固定）**: 展開途中、zh-TW版がまだ無い記事にアクセスした場合でも`isPathTranslated`がtrueを返し続けてしまい、`docs/adr/0005`で修正した「対応外言語なのにリダイレクトされない」バグが別形で再発する（en版は存在するがzh-TW版はまだ無い記事に`/zh-TW/blog/{id}`でアクセスすると、日本語コンテンツがlang=zh-TWで配信されてしまう）
- **記事ごとに`PARTIALLY_TRANSLATED_PATHS`にエントリを追加する（`/blog/{id}`を個別キーとして25件×提供言語を静的記述）**: 記事追加のたびに`languages.js`への手動更新が必要になり、`blogPostsEn.js`/`blogPostsZhTw.js`への追加だけで完結する現在の運用性を損なう

## 影響
- `src/config/languages.js`の`matchPartiallyTranslated`実装を変更する（`docs/design/blog-i18n/tasks.md`の新タスクとして実施）
- `Blog.jsx`/`BlogPost.jsx`の`isEnglish`判定パターンを、`isLangAvailable(id, lang)`のような汎用関数に置き換える必要がある（現状`isEnglishAvailable`という英語専用関数になっている）
- zh-TW版記事を1件ずつ追加していく過程で、`/en/blog`は25件、`/zh-TW/blog`は追加した件数分のみ表示される非対称な状態が続く。これはFR4（関連記事は同言語内でのみ表示）と同じ考え方で正しい挙動
