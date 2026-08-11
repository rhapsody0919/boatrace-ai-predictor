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
- [ ] **Task 11**: trifecta-betting-guide, improve-recovery-rate, beginners-start-guide, first-mark-prediction-guide（2026-03-12公開、4件）— 実装順序を誤りTask12〜16を先に処理したため後回し、次に対応する
- [x] **Task 12**: picks-performance-report（2026-03-02）
- [x] **Task 13**: venue-visit-guide（2026-02-21）
- [x] **Task 14**: picks-guide（2026-02-17）
- [x] **Task 15**: 10000-races-analysis（2026-02-16）
- [x] **Task 16**: suji-funaken-guide（2026-01-30）
- [ ] **Task 17**: sg-g1-race-strategy, special-planned-races（2026-01-23、2件）
- [ ] **Task 18**: venue-ashiya（2025-12-31）
- [ ] **Task 19**: how-we-measure-accuracy（2025-12-29）
- [ ] **Task 20**: ai-vs-human（2025-12-23）
- [ ] **Task 21**: rough-race-signals, stadium-strategy-guide（2025-12-22、2件）
- [ ] **Task 22**: monthly-50k-roadmap（2025-12-21）
- [ ] **Task 23**: why-you-lose（2025-12-19）

## 備考
- フェーズ1完了後、フェーズ2の各タスクは独立して着手可能（基盤が整っているため機械的な作業になる想定）
- `/step4`で1タスクずつ実装する
