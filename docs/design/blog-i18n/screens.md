# ブログ英語版本格インフラ化 画面・コンポーネント洗い出し

`docs/design/blog-i18n/spec.md`の機能要件（FR1〜FR7）を実現するために変更が必要な画面・コンポーネント・ロジック一覧。`.claude/rules/component-reuse.md`に基づき、新規/既存拡張の別を明記する。

## 画面

### 1. `src/pages/Blog.jsx`（ブログ一覧ページ）— 既存拡張
現状: タイトル・説明文・カテゴリラベル・「すべて」ボタン・「このカテゴリの記事はまだありません」等がすべて日本語ハードコード。フィルタは全記事（`blogPosts`全件）を対象。
変更内容:
- `/en/blog`アクセス時、英語版が存在する25記事のみを一覧・featuredセクションに表示
- カテゴリフィルターは英語版記事に実在するカテゴリのみ表示（英語カテゴリ名で）
- 見出し・説明文・「すべて」ボタン・空状態メッセージを言語別に出し分け（`BlogPost.jsx`の`UI_TEXT`パターンを踏襲、i18nextの`t()`は導入しない方針を継続。理由: 記事メタデータ自体が言語別データとして保持されるため、周辺UI文言も同じ場所で完結させた方がシンプル）
- BreadcrumbList構造化データのitem URLを`localizePath()`で言語別に生成（`BlogPost.jsx`と同じ修正をここにも適用）
- 既存CSS（`Blog.css`）・レイアウト構造はそのまま流用。新規CSSは不要

### 2. `src/pages/BlogPost.jsx`（ブログ詳細ページ）— 既存拡張
PR#273で英語対応の土台（`isEnglish`判定、`localizePath()`によるURL生成、`UI_TEXT`パターン）は実装済み。今回の変更内容:
- `ENGLISH_POST_OVERRIDES`ハードコードオブジェクトを廃止し、`/step2`で決定する新データ構造から英語版メタデータを取得する形に置き換え
- `relatedPosts`のフィルタリングを「英語版が存在する記事同士」に変更（現状は`isEnglish`なら常に空配列）
- 変更不要な部分: `useEffect`の依存配列修正（PR#273で対応済み）、`localizePath()`によるURL生成（同）

## ロジック・データ

### 3. `src/config/languages.js` — 既存拡張（コアロジック変更、影響範囲注意）
**設計上の制約（screens洗い出し時に発見）**: `isPathTranslated()`はprefix一致判定のため、`/blog`を`TRANSLATED_PATHS`にそのまま追加すると、英語版が存在しない58記事の`/en/blog/{id}`もすべて「翻訳済み」と誤判定されてしまう（未翻訳記事がja版へリダイレクトされず、`isEnglish=false`のフォールバック経由でlang=en配下に日本語コンテンツが出る、または記事が見つからない扱いになる)。
これは`TRANSLATED_PATHS`が前提としてきた「配下パス全体が翻訳済み」というモデル（`/venues`等）と、ブログの「配下の一部記事のみ翻訳済み」というモデルの差異によるもの。`/step2`で以下いずれかの方式を選定する必要がある:
- (a) `isPathTranslated`/`getAvailableLanguages`に「部分翻訳セクション」の概念を追加し、ブログ記事は個別記事IDの翻訳有無で判定するロジックを新設する
- (b) 25記事の個別パスを`TRANSLATED_PATHS`に1件ずつ列挙する運用を続ける（一覧ページ`/blog`自体の翻訳対応とは別に、一覧ページ側は専用の緩和ルールが必要になり、結局(a)寄りの対応になる可能性が高い）
`LanguageSwitcher.jsx` / `HreflangTags.jsx`は`getAvailableLanguages()`経由で自動連動するため、このファイル自体の変更は不要（`languages.js`のロジックが正しくなれば自動的に正しく動く）

### 4. `src/data/blogPosts.js` — 既存拡張（データ構造変更、詳細は`/step2`）
英語版メタデータ（title/description/category/tags/readTime）の保持方式を決定し実装する。spec.mdの未確定事項1。

### 5. `src/utils/blogFaqSchema.js` — 既存拡張
`extractFaqItems()`が日本語見出し`## よくある質問`のみを検出する実装。英語見出し（`## FAQ`）も検出できるよう正規表現/文字列マッチを拡張する。

### 6. `scripts/generate-sitemap.js` — 既存拡張
英語版記事URLのsitemap登録方式を見直す（現状`LANGUAGE_ONLY_PAGES.en`への1件ずつの手動追記）。spec.mdの未確定事項2。あわせて`getBlogPosts()`の`-en.md`除外ロジック（PR#273で追加済み）は維持する。

## 変更不要（自動連動・既存のまま機能する想定）
- `src/components/Header.jsx` — 既存の多言語対応をそのまま利用
- `src/components/LanguageSwitcher.jsx` — `languages.js`のロジック修正後は自動連動
- `src/components/HreflangTags.jsx` — 同上
- `src/AppRouter.jsx`のルート定義自体（`blog` / `blog/:id`） — `LocalizedRoutes`内の相対パスルートは既に言語プレフィックス配下で共通利用される構造になっており、ルート追加は不要

## デザイントークン
新規UIパターンを追加するわけではなく、既存の一覧・詳細ページの構造をそのまま多言語化するため、`src/styles/design-tokens.css`で新規に定義すべきトークンは無い見込み。
