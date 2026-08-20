# 龍神レーダー ブランドビジュアル刷新 タスク分解

spec.md / screens.md / plan.mdに基づく実装タスク。フェーズ順・依存順に並んでいる。各タスクは1コミット〜1PRを目安に分割している。UI変更を伴うタスクは`.claude/CLAUDE.md`の方針通り、Claude自身がdevサーバーとPlaywrightで自己検証してから完了とする。

## フェーズ1: 基盤

- [x] 1. デザイントークン3層構造の実装（ベースパレット→意味トークン→`:root`/`[data-theme="dark"]`テーマ層。既存の`--color-primary-*`等は維持し共存させる。plan.md「トークン層構成」参照）
- [x] 2. トークンコントラスト自動検証スクリプトの追加（`scripts/maintenance/check-token-contrast.js`、ADR 0017、`npm run check:contrast`）。実行の結果、ライトテーマの金銀アクセントがWCAG AA基準未達と判明したため`--ryujin-gold-800`/`--ryujin-silver-700`をライト専用の階調として追加し、`--brand-accent-primary`/`--brand-accent-secondary`をテーマごとに出し分ける形に修正した
- [x] 3. ロゴ/favicon資産の書き出し（`source-assets/`から`favicon-16/32.png`・`apple-touch-icon.png`・`icon-192/512.png`・`logo.png`・`logo-light.png`を生成し`public/`へ配置。plan.mdの対応表参照。apple-touch-iconは透過だとiOSで見栄えが悪くなるため不透明の深紺背景に変更。OGP画像（`ogp-image.png`）は対応表に含まれないため対象外のまま）
- [x] 4. 明朝体ロゴタイプ用サブセットフォントの生成・自己ホスト設定（`pyftsubset`でNoto Serif JPをサブセット化、`public/fonts/`へ配置、`@font-face`定義。ADR 0018）。再生成用に`scripts/maintenance/generate-logotype-font.sh`（`npm run generate:logotype-font`）を作成。開発環境にPython/fonttools/brotliが必要（スクリプト内にエラーメッセージで明記）

## フェーズ2: ブランドチロム

- [x] 5. Footerコンポーネントの共通化（`src/components/Footer.jsx`新規作成。`App.jsx`・`Holmes.jsx`・`ContentHub.jsx`・`WinningTechniqueAnalysis.jsx`・`ResponsibleGambling.jsx`の重複`<footer>`を置き換え。調査の結果、5ファイルの内容は想定より多様だったため`links`/`extra`/`copyrightText`をpropsで受け取る設計にし、各ページの内容は変更していない。副次的にEnglishGuide/ZhTwGuide/KoGuideにフッターが存在しない欠落を発見、BOA-202として別チケット化）
- [x] 6. Header.jsxのロゴ・ワードマーク刷新（新ロゴ画像、明朝体ワードマーク、意味トークン参照への置き換え）。ナビも塗りピル→下線インジケーターに変更、絵文字ロゴ・floatアニメーションは削除。ThemeToggle自体の設置はタスク12で対応
- [x] 7. IntroBanner.jsxの意匠更新（罫線＋タイポグラフィ中心へ、塗り要素の削減）。あわせてコントラスト検証スクリプトに`--surface-card`×金銀アクセントのペアを追加
- [x] 8. LoadingScreen.jsxへのレーダー掃引モーション追加（線1本、回転3〜4秒/周）。青グラデーション背景・スピナーをsurface-card+レーダー掃引SVGに置き換え
- [x] 9. LanguageSwitcher.jsx・Breadcrumb.jsxのトークン参照更新。白背景ヘッダー前提の配色（白半透明の塗りボタン等）を、罫線+テキスト色ベースの意匠に変更

## フェーズ3: テーマ切替機能

- [x] 10. テーマ状態管理モジュールの実装（`src/config/theme.js`・`src/utils/theme.js`・`src/hooks/useTheme.js`。ADR 0016）。動的importでgetTheme/setTheme/data-theme同期/localStorage永続化を確認、実際に画面がライト/ダーク双方に切り替わることも視認済み
- [x] 11. index.htmlへのFOUC防止インラインスクリプト追加（初期表示前に`data-theme`をlocalStorageから同期）。あわせて`theme-color`（light/dark媒体クエリ）と`manifest.json`のtheme_color/background_colorも旧ブランド色から深紺に更新。localStorageに値を仕込んだ状態でのフルリロードでFOUC無しを確認
- [ ] 12. ThemeToggleコンポーネントの実装とHeaderへの設置
- [ ] 13. `@axe-core/playwright`導入とe2e/smoke.spec.jsへのアクセシビリティスキャン追加（ライト/ダーク両テーマ。ADR 0017）。ここでフェーズ2のブランドチロムが両テーマで機械的に検証可能になる

## フェーズ4: データ密集画面

- [ ] 14. PredictionPanel/PredictionCard/AccuracyStatBadge/RaceResultの意匠刷新（塗りボタン・ピルバッジ廃止、着順の金銀とブランドカラーの統合）
- [ ] 15. PredictionLoadingOverlayへのレーダー掃引モーション適用
- [ ] 16. RaceBottomNav/RaceNavCard/VenueSelector/VolatilityDisplayのトークン参照更新
- [ ] 17. DataRaceTable.cssのモバイル最小フォントサイズ是正（`0.55rem`→11px以上）と二層設計の適用
- [ ] 18. AttackDefenseTable/TurnPatternList/OutcomePatternPreview/TrifectaReferenceCard/RaceCardDataTableへの二層設計適用
- [ ] 19. `src/components/analysis/`配下チャート群の色設定をトークン参照に更新（Rechartsのname prop経由で指定。data keyでの指定は避ける）
- [ ] 20. 全フェーズ通しでのE2Eスモークテスト最終実行、新規主要導線（ThemeToggle等）のスモークテスト追記

## スコープ外（別タスク・別チケット）

- 紹介動画（`/about`等）の刷新
- 既存ブログ記事内のスクリーンショット差し替え
- 管理画面（`AdminRules.jsx`）
