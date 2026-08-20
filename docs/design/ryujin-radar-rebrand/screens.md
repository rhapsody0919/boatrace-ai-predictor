# 龍神レーダー ブランドビジュアル刷新 画面・コンポーネント洗い出し

spec.mdのフェーズ順（基盤→ブランドチロム→テーマ切替機能→データ密集画面）に沿って整理する。ページ単位ではなく、design-tokens.cssへの追従で自動的に見た目が変わるものと、個別にコード変更が必要なものを分けて記載する。

## 0. 基盤（画面ではないが全体に影響）

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| `src/styles/design-tokens.css` | 全ブランドトークンの定義元 | 既存拡張 | ベースパレット→意味トークン→テーマ層（`[data-theme]`）の層構造に再設計。既存の`--color-primary-*`等170箇所以上の参照は互換のため当面残し、新トークンを追加する形にする |
| フォント読み込み（`index.html`または`App.jsx`） | Noto Serif JPサブセットの自己ホスト読み込み | 新規 | ロゴタイプのみの数文字サブセット |
| `public/logo.png`, `favicon-*.png`, `apple-touch-icon.png`, `icon-192/512.png` | ロゴ・favicon資産 | 既存拡張 | `docs/design/ryujin-radar-rebrand/source-assets/`の生成画像から書き出し。favicon 16/32pxは簡略化クロップ版 |

## 1. テーマ切替機能（新規）

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| ThemeContext / useThemeフック（仮称） | ライト/ダークの状態管理・永続化 | 新規 | 現状`prefers-color-scheme`のみでユーザー選択トグルは存在しないため新規実装。永続化方式は`/step2`で決定 |
| ThemeToggleコンポーネント（仮称） | テーマ切替UI本体 | 新規 | Header内に配置想定 |

## 2. ブランドチロム（優先度高、フェーズ2）

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| [Header.jsx](src/components/Header.jsx) | 全ページ共通ヘッダー。ロゴ・ナビ・言語切替 | 既存拡張 | ロゴ差し替え、ワードマーク明朝体化、ThemeToggle設置 |
| Footerコンポーネント（新規抽出） | 全ページ共通フッター | **新規共通化** | 現状`App.jsx`・`Holmes.jsx`・`ContentHub.jsx`・`WinningTechniqueAnalysis.jsx`・`ResponsibleGambling.jsx`の5箇所に`<footer>`が重複実装されている（component-reuse.mdのチェックリストに抵触）。今回のブランド意匠変更を機に共通コンポーネント化する |
| [IntroBanner.jsx](src/components/IntroBanner.jsx) | トップページのヒーロー部分（ブランド名+サブタイトル表示） | 既存拡張 | 罫線+タイポグラフィ中心の意匠に更新 |
| [LoadingScreen.jsx](src/components/LoadingScreen.jsx) | アプリ全体の初期ローディング画面 | 既存拡張 | ロゴ+レーダー掃引モーションの適用対象 |
| [LanguageSwitcher.jsx](src/components/LanguageSwitcher.jsx) | 言語切替ドロップダウン | 既存拡張 | 罫線ベースの意匠に統一 |
| [Breadcrumb.jsx](src/components/Breadcrumb.jsx) | パンくずリスト | 既存拡張 | トークン参照のみで対応可能な想定 |

## 3. 予想・着順関連（component-reuse.mdの既存共通コンポーネント群）

component-reuse.mdに明記済みの通り、これらは`App.jsx`・`RaceDetail.jsx`両方から参照される共通コンポーネント。ここを直せば両画面に伝播するため、ページ単位の個別対応は基本不要。

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| [PredictionPanel.jsx](src/components/race/PredictionPanel.jsx) | AI予想セクション全体 | 既存拡張 | 塗りボタン・ピルバッジ廃止の主対象 |
| [PredictionCard.jsx/css](src/components/race/PredictionCard.jsx) | 予想カード | 既存拡張 | 罫線+タイポグラフィ意匠へ |
| [PredictionLoadingOverlay.jsx/css](src/components/race/PredictionLoadingOverlay.jsx) | AI分析中のローディング演出 | 既存拡張 | レーダー掃引モーションの実装対象そのもの |
| [AccuracyStatBadge.jsx](src/components/race/AccuracyStatBadge.jsx) | 的中率等のバッジ表示 | 既存拡張 | ピル→罫線ベースへ |
| [RaceResult.jsx](src/components/race/RaceResult.jsx) | レース結果・着順表示 | 既存拡張 | 金銀（既存の1着/2着色）とブランドカラーの統合対象。銅色は変更なし |
| [RaceCard.jsx](src/components/race/RaceCard.jsx) | レースカード（一覧用） | 既存拡張 | |
| [RaceBottomNav.jsx/css](src/components/race/RaceBottomNav.jsx) / [RaceNavCard.jsx/css](src/components/race/RaceNavCard.jsx) | レース間・会場間ナビゲーション（BOA-118） | 既存拡張 | |
| [VenueSelector.jsx](src/components/race/VenueSelector.jsx) | 会場選択 | 既存拡張 | トークン参照中心 |
| [VolatilityDisplay.jsx](src/components/race/VolatilityDisplay.jsx) | 荒れ度表示 | 既存拡張 | 色のみ調整、ロジック変更なし（[[feedback_volatility_model_tuning_avoid]]の通りモデル自体には触れない） |

## 4. データ密集画面（二層設計・モバイルフォント是正の対象）

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| [DataRaceTable.jsx/css](src/components/race/DataRaceTable.css) | 出走表本体 | 既存拡張 | モバイル最小フォントサイズ是正（`0.55rem`→11px以上）の対象ファイル |
| [AttackDefenseTable.jsx/css](src/components/race/AttackDefenseTable.jsx) | 超展開データテーブル | 既存拡張 | 二層設計（見出しのみブランド言語、データ行は機能重視） |
| [TurnPatternList.jsx/css](src/components/race/TurnPatternList.jsx) | 展開パターン一覧 | 既存拡張 | 同上 |
| [OutcomePatternPreview.jsx/css](src/components/race/OutcomePatternPreview.jsx) | 出目分布プレビュー | 既存拡張 | 同上 |
| [TrifectaReferenceCard.jsx/css](src/components/race/TrifectaReferenceCard.jsx) | 3連単参考カード | 既存拡張 | 同上 |
| [RaceCardDataTable.jsx/css](src/components/analysis/RaceCardDataTable.jsx) | 分析ツール内データテーブル | 既存拡張 | 同上 |
| `src/components/analysis/`配下の各種チャート（12ファイル） | 分析ツールのグラフ表示 | 既存拡張 | Rechartsの色設定をトークン参照に更新。[[i18n_p1_analysis_tools_handoff]]の教訓通りdata keyでなくname propで色指定する |

## 5. ページ単位（個別対応が必要なもののみ）

大半のページはトークン刷新とブランドチロム（Header/Footer）の変更が自動的に伝播するため個別のコード変更は不要。以下は個別確認・対応が必要なもの。

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| [App.jsx](src/App.jsx) | トップページ | 既存拡張 | IntroBanner・footer部分の意匠調整（2・3と重複するため実質はコンポーネント側の変更が主） |
| [RaceDetail.jsx](src/pages/RaceDetail.jsx) | レース詳細ページ | 既存拡張 | 3・4のコンポーネント変更が伝播。ページ固有の追加CSSは基本不要 |
| [WinningTechniqueAnalysis.jsx](src/pages/WinningTechniqueAnalysis.jsx) | 分析ツール（15タブ） | 既存拡張 | 4のデータ密集画面の意匠が適用される |
| [AccuracyHistory.jsx](src/pages/AccuracyHistory.jsx) / [RaceHistory.jsx](src/pages/RaceHistory.jsx) | 的中率・実績ページ | 既存拡張 | リピーターの主要導線（[[boatai_rebrand_investigation_2026_08_19]]参照）のため視覚的一貫性を優先確認 |
| [Holmes.jsx](src/pages/Holmes.jsx) / [Poirot.jsx](src/pages/Poirot.jsx) | 予想モデル関連ページ | 既存拡張 | footer共通化の影響を受ける |
| [Blog.jsx](src/pages/Blog.jsx) / [BlogPost.jsx](src/pages/BlogPost.jsx) | ブログ一覧・詳細 | 既存拡張 | Header/Footer/トークンの影響のみ。本文中の既存画像差し替えはスコープ外（spec.md参照） |
| 各種ガイド系ページ（`VenueGuide.jsx`, `EnglishGuide.jsx`, `EnglishVenueGuide.jsx`, `ZhTwGuide.jsx`, `ZhTwVenueGuide.jsx`, `KoGuide.jsx`, `KoVenueGuide.jsx`, `VenueRegionHub.jsx`） | 多言語ガイド | 既存拡張 | 個別改修不要、Header/共通トークンの影響のみ確認 |
| [AdminRules.jsx](src/pages/admin/AdminRules.jsx) | 管理画面 | 対象外 | `.claude/CLAUDE.md`のja専用区分と同様、ブランド訴求の優先度が低いため本刷新の対象外（ユーザー確認済み） |

## 6. その他共通UI部品

| 対象 | 役割 | 新規/既存拡張 | 備考 |
|------|------|--------------|------|
| [Toast.jsx](src/components/Toast.jsx) | トースト通知 | 既存拡張 | トークン参照のみ |
| [CookieConsent.jsx](src/components/CookieConsent.jsx) | Cookie同意バナー | 既存拡張 | ボタン意匠の一貫性確認 |
| [ShareButton.jsx](src/components/ShareButton.jsx) / [SocialShareButtons.jsx](src/components/SocialShareButtons.jsx) | シェアボタン | 既存拡張 | トークン参照のみ |

## デザイントークンで表現できる範囲 / 新規CSSが必要な範囲

- **トークン変更のみで追従**: グレー系背景・境界線・状態色（success/warning/error/info）・グレード色・銅色を使う箇所全般。コード変更不要
- **新規CSSが必要**: 塗りボタン→罫線ボタンへの構造変更（`AccuracyStatBadge`等のピル型バッジ廃止）、テーマ切替の`[data-theme]`セレクタ追加、明朝体ロゴタイプのfont-family指定、レーダー掃引アニメーションの`@keyframes`、モバイル最小フォントサイズの底上げ
