# ブログ英語版本格インフラ化 仕様書

## 種別
UI機能（画面・コンポーネントが関わる）。次工程は `/step1-screens blog-i18n`。

## 対応Linearチケット
なし（本仕様書ベースで `/step2` 実施時にチケット化を検討）。

## 背景
[[foreign_audience_growth_strategy_2026_08]]（メモリ）にて、featured記事1件（`odds-expected-value-guide`）を`ENGLISH_POST_OVERRIDES`によるハック的実装で英語版追加した（PR#273）。この実装は1記事限定を明示的な前提としたコメント付きの暫定対応であり、2記事目以降を継続的に追加していくには耐えない設計だった。今回、featured記事全体を対象にした本格インフラへ作り直す。

## 機能要件

### FR1: 対象言語（優先度: 必須）
英語（en）のみを対象とする。zh-TW/koは今回のスコープ外（将来拡張）。
- 受入基準: `TRANSLATED_PATHS`への登録は`/blog/*`パス全体ではなく、英語版が実在する記事のみが`/en/blog/{id}`でアクセス可能になり、zh-TW/koでは従来通りja版へリダイレクトされる
- **2026-08-11追記**: 英語版25記事完了後、ユーザーからzh-TW/ko版の展開指示があり「やらないこと」を撤回。下記「## 拡張: zh-TW版（2026-08-11）」参照

### FR2: 対象記事（優先度: 必須）
featured記事のうち、定期レポート系（`weekly-report-*`, `monthly-report-*`, `venue-monthly-*`）を除いた25件を対象とする。

対象記事一覧（日付降順）:
```
2026-07-30 winning-technique-analysis-guide
2026-07-30 motor-condition-guide
2026-03-12 ai-prediction-accuracy-review
2026-03-12 odds-expected-value-guide（実装済み・新インフラへ統合）
2026-03-12 night-race-strategy
2026-03-12 sg-race-guide-2026
2026-03-12 how-to-predict-races
2026-03-12 trifecta-betting-guide
2026-03-12 improve-recovery-rate
2026-03-12 beginners-start-guide
2026-03-12 first-mark-prediction-guide
2026-03-02 picks-performance-report
2026-02-21 venue-visit-guide
2026-02-17 picks-guide
2026-02-16 10000-races-analysis
2026-01-30 suji-funaken-guide
2026-01-23 sg-g1-race-strategy
2026-01-23 special-planned-races
2025-12-31 venue-ashiya
2025-12-29 how-we-measure-accuracy
2025-12-23 ai-vs-human
2025-12-22 rough-race-signals
2025-12-22 stadium-strategy-guide
2025-12-21 monthly-50k-roadmap
2025-12-19 why-you-lose
```
- 受入基準: 上記25件全てに`public/blog/{id}-en.md`と英語版メタデータが存在し、`/en/blog/{id}`でアクセスできる

### FR3: 翻訳作業体制（優先度: 必須）
Claudeが記事ごとに翻訳を作成する（機械翻訳API等は導入しない）。既存25件の翻訳着手は新しい記事から順（date降順、上記リストの順）に行う。今後新規に公開するfeatured記事は、ja記事公開と同じPRまたは近接したPRで英訳も作成する運用に切り替える。
- 受入基準: 今後のブログ記事作成フロー（プロジェクトCLAUDE.md該当セクション）に「featured記事は英訳も同時作成する」旨を追記する

### FR4: 関連記事表示（優先度: 必須）
英語版記事同士（英語版が存在する記事間）で関連記事を表示する。未翻訳記事へのリンクは生成しない。
- 受入基準: `/en/blog/{id}`で関連記事セクションに表示されるのは英語版が存在する記事のみ。日本語版のみの記事は候補から除外される

### FR5: FAQPage構造化データの英語対応（優先度: 必須）
`extractFaqItems`（`src/utils/blogFaqSchema.js`）が英語の見出し（`## FAQ`等）も検出できるように拡張する。
- 受入基準: 英語版記事に`## FAQ`セクションがある場合、FAQPage構造化データが出力される（既存の日本語`## よくある質問`検出は引き続き機能する）

### FR6: 既存実装（PR#273）の統合（優先度: 必須）
`ENGLISH_POST_OVERRIDES`ハードコードパターンを廃止し、新インフラに統合する。`odds-expected-value-guide`も新インフラのデータ構造に移行する。
- 受入基準: `BlogPost.jsx`から`ENGLISH_POST_OVERRIDES`オブジェクトが削除され、25件が同一の仕組みで扱われる

### FR7: 英語版ブログ一覧ページ（優先度: 必須）
`/en/blog`で英語版記事一覧を表示する。`Blog.jsx`（現状完全に日本語ハードコード）を多言語対応させる。カテゴリフィルター・featuredセクション・UI文言（見出し・「すべて」ボタン等）も英語化する。
- 受入基準: `/en/blog`で英語版が存在する記事のみ一覧表示される（未翻訳記事は表示しない）。カテゴリフィルターは英語版記事に存在するカテゴリのみ表示。hreflang・言語スイッチャーが`/blog`と連動する
- 発覚経緯: `/step1-screens`実施時、既存PR#273の「戻る」リンクがトップページ固定で英語版記事同士の回遊導線が無いことに気付き、ユーザー確認の上スコープに追加（2026-08-11）

## スコープ

### やること
- featured記事25件の英語版メタデータ・本文データ構造の設計と実装
- 英語版記事のルーティング・hreflang・言語スイッチャー連動
- 関連記事・FAQPage構造化データの英語対応
- sitemap（`scripts/generate-sitemap.js`）への英語版URL登録の汎用化（記事追加時に手動でリストへ1件ずつ追記が発生する現状の運用を、可能なら削減する）
- 今後の新規featured記事公開フローへの「英訳同時作成」の組み込み（CLAUDE.md更新）

### やらないこと
- ~~zh-TW/ko版ブログ（将来検討、今回対象外）~~ → 2026-08-11、英語版完了後にユーザー指示でzh-TW版に着手。下記「## 拡張: zh-TW版」参照
- 定期レポート系記事（weekly/monthly/venue-monthly）の翻訳
- featured以外の非featured記事（約58件）の翻訳
- 機械翻訳APIの導入・自動翻訳パイプライン化
- 既存記事本文（ja版）の内容変更

## 拡張: zh-TW版（2026-08-11）

英語版25記事完了後、ユーザーから「zh-TW/ko版ブログも進めて」と指示。会場ガイド展開時の実績（zh-TW先行→結果を見てko着手判断）を踏襲し、以下のスコープで進める（ユーザー確認済み）。

- **対象言語**: zh-TWを先行。koはzh-TW完了後、需要を見て着手判断（今回のスコープ外）
- **対象記事**: 英語版と同じ25記事全件
- **翻訳体制**: Claudeが記事ごとに翻訳（英語版と同様）
- **既存の英語版インフラとの関係**: `blogPostsEn.js`と同じ「言語別に完全独立したファイル」パターンで`blogPostsZhTw.js`を新設する。ルーティング側（`PARTIALLY_TRANSLATED_PATHS`）は「/blogの記事ごとに提供言語が異なりうる」状態を正しく扱えるよう設計変更が必要（詳細は`docs/adr/0008`）

## 非機能要件
- 既存の翻訳済みページ（`/`, `/guide`, `/venues`, `/winning-technique`）の動作・hreflang・言語スイッチャーに影響を与えない
- モバイル表示崩れなし（320px〜、プロジェクト標準）
- `node scripts/generate-sitemap.js`実行後、ja版sitemapに英語版URL（またはその逆）が誤登録されないこと（PR#273で発見された`-en.md`誤登録バグの再発防止をデータ構造レベルで担保する）
- `npm run build`エラーなし、既存`e2e/smoke.spec.js`が全件成功すること
- 25件の翻訳作業自体（コンテンツの逐次追加）は複数PRに分割してよい（1PRで25件を一括translateする必要はない）。基盤（インフラ）実装と個別記事の翻訳は別工程として扱う

## 制約・前提
- 既存コンポーネント（`BlogPost.jsx`, `Header`, `LanguageSwitcher`, `HreflangTags`）は最大限再利用し、データ構造の見直しに留める（`.claude/rules/component-reuse.md`準拠）
- データ源: 本文は`public/blog/{id}-en.md`（既存パターン踏襲）。メタデータ（title/description/category/tags/readTime）の保存形式は`/step2`で設計する（候補: `blogPosts.js`内の各記事オブジェクトに`translations.en`を持たせる／別ファイル`blogPostsEn.js`に分離、等）
- 用語: 「競艇」使用禁止等の用語ルールを英訳にも適用する
- プロジェクトCLAUDE.mdの「多言語化の3区分」ルールでは翻訳対象パスは「4言語のi18nキーを同じPRで追加」が原則だが、本機能は明示的にユーザー判断で英語のみ先行するスコープ逸脱として扱う（PR#273同様、コード内コメントで理由を明記する）
- ブログ記事本文の翻訳はi18nextの`t()`/JSON方式ではなく、既存パターン通りMarkdownファイル（`-en.md`）として保持する（記事本文は他ページのUI文言と性質が異なり、キー化するメリットが薄いため）

## 未確定事項
- **メタデータのデータ構造詳細**（`blogPosts.js`内統合 vs 別ファイル分離）: `/step2`（システム設計）で決定
- **sitemap登録の汎用化の実現方式**: 現状`LANGUAGE_ONLY_PAGES.en`に記事を1件ずつ手動追記する運用。25件規模になると`public/blog/`ディレクトリを`-en.md`存在チェックで自動列挙する方式に変える方が保守的だが、既存レースページ等の他の自動化パターンとの整合を`/step2`で検討する
- **既存25件の翻訳着手をどのPR単位で分割するか**（1記事1PR、数記事まとめて1PR等）: 基盤実装（`/step3`〜`/step4`）着手時に決定
