# ブログ英語版本格インフラ化 タスク分解

`docs/design/blog-i18n/spec.md`・`screens.md`・`plan.md`、`docs/adr/0005〜0007`に基づく。依存順。各タスクは目安として1コミット〜1PRで完結する粒度。

## フェーズ1: 基盤実装

- [x] **Task 1**: `src/data/blogPostsEn.js`を新設する。既存`odds-expected-value-guide`のメタデータをPR#273の`ENGLISH_POST_OVERRIDES`から移行し、`getEnglishOverride(id)` / `isEnglishAvailable(id)`関数を実装する（`docs/adr/0006`）
- [x] **Task 2**: `src/config/languages.js`に`PARTIALLY_TRANSLATED_PATHS`を追加し、`isPathTranslated` / `getAvailableLanguages`を拡張する（`docs/adr/0005`）。既存の翻訳済みページ（`/`, `/guide`, `/venues`, `/winning-technique`）のリダイレクト・hreflang・言語スイッチャー動作に回帰が無いことをPlaywrightで確認する
- [x] **Task 3**: `src/pages/BlogPost.jsx`を新方式に移行する。`ENGLISH_POST_OVERRIDES`を削除し、`blogPostsEn.js`参照に置き換える。`relatedPosts`を英語版記事同士でフィルタするロジックに変更する（副次的に、関連記事リンクが言語プレフィックス無し固定パスだったバグも修正）
- [x] **Task 4**: `src/utils/blogFaqSchema.js`の`extractFaqItems`が英語見出し（`## FAQ`）も検出できるよう拡張する
- [x] **Task 5**: `src/pages/Blog.jsx`を多言語対応させる。`/en/blog`で英語版記事のみの一覧・featuredセクション・カテゴリフィルターを表示し、見出し・空状態メッセージ等のUI文言を言語別に出し分ける
- [x] **Task 6**: `scripts/generate-sitemap.js`を`blogPostsEn`からの動的生成に変更し、既存の`odds-expected-value-guide`ハードコードエントリを削除する（`docs/adr/0007`）。あわせて`/en/blog`一覧ページもsitemapに登録した
- [x] **Task 7**: 基盤PRの検証・PR作成（マージはユーザー承認待ち、PR#274）。検証項目: `npm run build`、`npx playwright test e2e/smoke.spec.js`（回帰1件発見・修正、専用テスト3件追加）、`npx playwright test e2e/venue-guide-data.spec.js`（792件、languages.jsコアロジック変更の回帰確認）、Playwright目視確認（`/en/blog`一覧、`/en/blog/odds-expected-value-guide`詳細、hreflang、言語スイッチャー往復、未翻訳記事のリダイレクト、FAQPage構造化データ、`node scripts/generate-sitemap.js`実行結果）。`/code-review`で重大バグ（zh-TW/koの言語不整合）含む6件検出・修正済み
- [x] **Task 8**: `.claude/CLAUDE.md`の「新機能リリース時のブログ記事ルール」に、featured記事公開時は英訳（`-en.md` + `blogPostsEn.js`エントリ）も同一/近接PRで作成する運用を追記する。あわせて「多言語化の3区分」のja専用の説明も更新した

## フェーズ2: 既存24記事の翻訳（新しい記事から順、spec.md FR3）

`odds-expected-value-guide`はTask 1で移行済みのため対象外。各タスクは`public/blog/{id}-en.md`作成 + `blogPostsEn.js`へのエントリ追加 + 該当記事のPlaywright目視確認。

- [x] **Task 9**: winning-technique-analysis-guide, motor-condition-guide（2026-07-30公開、2件）
- [x] **Task 10**: ai-prediction-accuracy-review, night-race-strategy, sg-race-guide-2026, how-to-predict-races（2026-03-12公開、4件）
- [x] **Task 11**: trifecta-betting-guide, improve-recovery-rate, beginners-start-guide, first-mark-prediction-guide（2026-03-12公開、4件）
- [x] **Task 12**: picks-performance-report（2026-03-02）
- [x] **Task 13**: venue-visit-guide（2026-02-21）
- [x] **Task 14**: picks-guide（2026-02-17）
- [x] **Task 15**: 10000-races-analysis（2026-02-16）
- [x] **Task 16**: suji-funaken-guide（2026-01-30）
- [x] **Task 17**: sg-g1-race-strategy, special-planned-races（2026-01-23、2件）
- [x] **Task 18**: venue-ashiya（2025-12-31）
- [x] **Task 19**: how-we-measure-accuracy（2025-12-29）
- [x] **Task 20**: ai-vs-human（2025-12-23）
- [x] **Task 21**: rough-race-signals, stadium-strategy-guide（2025-12-22、2件）
- [x] **Task 22**: monthly-50k-roadmap（2025-12-21）
- [x] **Task 23**: why-you-lose（2025-12-19）

**フェーズ2完了（2026-08-11）**: featured記事25件全ての英語版が完成。

## フェーズ3: zh-TW版基盤実装（2026-08-11追加、`docs/adr/0008`）

英語版完了後、ユーザー指示によりzh-TW版に着手（`docs/design/blog-i18n/spec.md`「拡張: zh-TW版」参照）。

- [x] **Task 24**: `src/data/blogPostsZhTw.js`を新設する（`blogPostsEn.js`と同じ構造、`getZhTwOverride(id)` / `isZhTwAvailable(id)`関数、現時点は空配列）。`src/config/languages.js`の`matchPartiallyTranslated`を、記事IDごとに動的に提供言語を算出する方式に変更する（`docs/adr/0008`）。既存の英語版動作（`/en/blog`25記事、hreflang、言語スイッチャー）に回帰が無いことをPlaywrightで確認
- [x] **Task 25**: `src/data/blogPosts.js`に`isBlogLangAvailable(id, lang)` / `getBlogOverride(id, lang)` / `getBlogMdSuffix(lang)` / `getRelatedPostsForLang(id, lang, limit)`という言語非依存の汎用関数を追加（`BLOG_LANG_CONFIG`マップ経由）。`BlogPost.jsx` / `Blog.jsx`の`isEnglish`判定をこれらの汎用関数ベースの`isTranslated`/`lng`に置き換え、`UI_TEXT`にzh-TWの文言も追加
- [x] **Task 26**: `scripts/generate-sitemap.js`を`blogPostsZhTw`からの動的生成にも対応。zh-TW記事が0件の間は`/zh-TW/blog`一覧ページ自体もsitemapに含めない条件分岐を追加（`getAvailableLanguages`のロジックと整合させるため）。`-en.md`/`-zh-tw.md`欠落検知の警告ロジックも汎用化
- [ ] **Task 27**: 基盤PRの検証・PR作成。検証項目: `npm run build`、`npx playwright test e2e/smoke.spec.js`、`/code-review`実施（Task2実施時にzh-TW/koの言語不整合バグが見つかった実績があるため、ルーティングガード周りは特に重点確認）

## フェーズ4: zh-TW版25記事の翻訳（新しい記事から順、英語版と同じグルーピング）

各タスクは`public/blog/{id}-zh-tw.md`作成 + `blogPostsZhTw.js`へのエントリ追加 + 該当記事のPlaywright目視確認。ファイル名サフィックスは`-zh-tw`（`-zh-TW`ではなくケバブケース、実装時に確定させる）。

- [x] **Task 28**: winning-technique-analysis-guide, motor-condition-guide（2026-07-30公開、2件）
- [x] **Task 29**: ai-prediction-accuracy-review, night-race-strategy, sg-race-guide-2026, how-to-predict-races（2026-03-12公開、4件）
- [x] **Task 30**: trifecta-betting-guide, improve-recovery-rate, beginners-start-guide, first-mark-prediction-guide（2026-03-12公開、4件）
- [x] **Task 31**: picks-performance-report, venue-visit-guide, picks-guide, 10000-races-analysis, suji-funaken-guide（2026-02-16〜03-02、5件）
- [x] **Task 32**: sg-g1-race-strategy, special-planned-races（2026-01-23、2件）
- [x] **Task 33**: venue-ashiya, how-we-measure-accuracy（2025-12-29〜31、2件）
- [x] **Task 34**: ai-vs-human, rough-race-signals, stadium-strategy-guide（2025-12-22〜23、3件）
- [x] **Task 35**: monthly-50k-roadmap, why-you-lose（2025-12-19〜21、2件）
- [x] **Task 36**: odds-expected-value-guide（英語版がTask1で最初に移行した記事。zh-TW版はここで新規追加）

**zh-TWフェーズ4完了（2026-08-11）**: featured記事25件全ての繁體中文版が完成。zh-TW版blog-i18nは完了。koはこの後の需要確認を経て着手判断（spec.md「拡張: zh-TW版」参照）。

## 備考
- フェーズ1完了後、フェーズ2の各タスクは独立して着手可能（基盤が整っているため機械的な作業になる想定）
- `/step4`で1タスクずつ実装する
- ko版は英語版・zh-TW版と同じ基盤（`PARTIALLY_TRANSLATED_PATHS`の動的算出方式）にそのまま乗せられる設計のため、着手判断時は新たなSDDサイクルは不要（`blogPostsKo.js`を追加するだけで済む見込み）。ただし着手前にzh-TW版の需要（Search Console等）を確認すること（spec.md「拡張: zh-TW版」参照）
