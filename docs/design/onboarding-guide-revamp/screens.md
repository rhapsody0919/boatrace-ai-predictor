# オンボーディング・ガイドページ刷新 画面・コンポーネント一覧

`spec.md`のA（ガイドページ刷新）・B（オンサイト導線）・動画要件が影響する画面・コンポーネントを洗い出す。`.claude/rules/component-reuse.md`に基づき、新規/既存拡張の別と共通化方針を明記する。

**訂正（実装中に判明）**: 本ドキュメントの調査は、masterから大きく遅れた古いブランチ（`docs/tiktok-post3-live-prediction`）上で行っていたため、以下の記述は古いコード構造を前提にしている。実際のmasterでは「開催場一覧ページ再設計」（PR#415、`venue_list_redesign_2026_08_28`）により、ホーム画面（`/`）は`App.jsx`ではなく新設の**`src/pages/VenueGridPage.jsx`**（内部の`TodayVenueGridPage`関数）が担当しており、`IntroBanner`もそちらに移動済みだった。B-1/B-3の実装は`App.jsx`ではなく`VenueGridPage.jsx`に対して行った（`docs/design/onboarding-guide-revamp/tasks.md`のTask5実装メモ参照）。一方、B-2が対象とする`DataRaceTable.jsx`/`AiAnalysisSection.jsx`/`PredictionPanel.jsx`/`raceIndicators.jsx`はmasterでも同じ場所・同じ共通化状態のままであることを確認済み（呼び出し元は`RaceDetail.jsx`ではなく`src/pages/RaceDetailPage.jsx`に変わっているが、コンポーネント自体は不変）。

## 前提として判明した既存構造（実装前に必ず踏まえること、※App.jsxへの言及はVenueGridPage.jsxと読み替え）

- ホーム画面のvenue/race選択は`App.jsx`内の素の`useState`で完結しており、`history.pushState`やURLクエリは使っていない
- **データ出走表（`DataRaceTable.jsx`）とAIデータ分析（`AiAnalysisSection.jsx`）は実装が1本のみ**で、`PredictionPanel.jsx` → `PredictionSection.jsx`を経由して`App.jsx`（ホーム・今日のレース）と`RaceDetail.jsx`（過去レース `/races/:date`）の両方から共通利用されている。B-2の「?」ヒントは1箇所実装すれば両画面に自動反映される
- ホーム画面のレース一覧より上には、既存の`IntroBanner.jsx`（「龍神レーダー - 無料のボートレースAI予想＆データ分析...詳しくはこちら→」、localStorageで一度きり非表示）が既に存在する。調査の過程で、この文言が2026-08-14に撤去済みの「複勝予想」機能（`PredictionPanel.jsx:19-24`、BOA-180の回収率計算バグが理由）にまだ言及していることが判明し、ja/en/zh-TW/ko全ロケールの文言を先行修正済み（`introBannerText`から「複勝予想」系の言及を除去し「展開予測・イン崩れ指数」に統一）
- 上記の発見を機に、B-1カードと`IntroBanner`の共存方針を確定した（spec.md B-3）。**初回訪問者にはB-1カードのみ、2回目以降の訪問者には`IntroBanner`のみを表示する**排他制御とする。判定には共有の「初回訪問かどうか」フック（`useFirstVisit`、plan.md参照）を新設し、`App.jsx`側で`isFirstVisit ? <FirstVisitGuideCard /> : <IntroBanner />`のように分岐する

## A. ガイドページ（`/how-to-use`）刷新

対象ファイル: [src/pages/HowToUse.jsx](../../../src/pages/HowToUse.jsx)（既存拡張） / [src/pages/HowToUse.css](../../../src/pages/HowToUse.css)（既存拡張）

| # | 画面/コンポーネント | 役割 | 新規/既存 |
|---|---------------------|------|-----------|
| A-1 | `HowToUse.jsx` の各 `steps[].content` | 各ステップの説明文中に実画面スクリーンショット`<img>`を追加 | 既存拡張。画像アセットは新規（`public/`配下に配置） |
| A-2 | `HowToUse.jsx` 冒頭（`how-to-use-header`直後、新設セクション） | 実画面に①②③吹き出しを重ねた「ツアー画像」1枚を表示 | 既存拡張＋新規CSSクラス。画像アセットは新規 |
| A-3 | `HowToUse.jsx` 冒頭（A-2と同エリアまたは直後、新設セクション） | 「初めての方」「用語だけ知りたい方」等の入口リンク（該当stepへスクロール/切替） | 既存拡張。`steps-navigation`の`onClick={() => setActiveStep(index)}`と同じ仕組みを流用 |
| A-4 | 各`steps[].content`内の`example-box` | 抽象的な例文を`/hit-races`等の実データへのリンクに差し替え | 既存の`example-box`要素の中身変更のみ。新規コンポーネント不要 |
| A-5 | `HowToUse.jsx` Step1冒頭（`steps[0].content`直前） | 操作キャプチャ動画をサムネイル＋再生ボタンで埋め込み | 下記「動画プレイヤー」共通コンポーネントを呼び出す |

## B. オンサイト導線

### B-1: 「初めての方へ」カード（B-3: `IntroBanner`との出し分け含む）

対象ファイル: [src/App.jsx](../../../src/App.jsx)（既存拡張、`race-list-section`内 `<h2>` 直後、`IntroBanner`と排他表示） / [src/components/IntroBanner.jsx](../../../src/components/IntroBanner.jsx)（既存拡張、表示条件のみ変更）

| コンポーネント | 役割 | 新規/既存 |
|---|---|---|
| `src/hooks/useFirstVisit.js`（仮称、新規） | localStorageの新規フラグ（`boatai:visited-before`等）を見て「このブラウザは初回訪問か」を判定する共有フック。マウント時にフラグが無ければ`isFirstVisit=true`を返し、副作用でフラグを立てる（以後の訪問では`false`を返す） | 新規 |
| `src/components/FirstVisitGuideCard.jsx`（仮称、新規） | `useFirstVisit()`が`true`の間のみ`App.jsx`から描画される。「動画を見る」CTA→動画プレイヤー表示、「✕」「あとで」は**このページ表示中だけ**非表示にするローカルstate（localStorageへの書き込みは無し。次回訪問時は`isFirstVisit`が`false`になり自動的に`IntroBanner`側に切り替わるため） | 新規 |
| `src/components/IntroBanner.jsx` | `useFirstVisit()`が`false`（＝2回目以降の訪問）の場合のみ描画するよう条件を追加。既存の`DISMISS_KEY`による一度きり非表示ロジックはそのまま維持 | 既存拡張（表示条件の追加のみ） |

### B-2: 用語「?」ヒント

**スコープ拡大（ユーザー指示）**: データ出走表・AIデータ分析だけでなく、レース詳細ページの埋め込み分析セクション全体（下記8種）が対象。「レース詳細で表示している指標に関しては基本的に全て出す」方針。

調査の結果、7セクション（モーター調子・選手調子・STのズレ・展示タイム推移・選手別決まり手傾向・回収率分析・超展開データ）は`EmbeddedAnalysisSection.jsx`という共通アコーディオンラッパー1つで実装されていることが判明した（`PredictionPanel.jsx`から`title`propを渡して7回呼び出されている）。ここに`hintKey`propを1つ追加するだけで7セクション分をまとめてカバーできる（component-reuse.mdの理想形）。残る1種（この会場の枠番別傾向）は`VenueTendencyPanel.jsx`が独自の別実装のアコーディオンを持つため、そこだけ個別対応する。

対象ファイル:
- [src/components/race/raceIndicators.jsx](../../../src/components/race/raceIndicators.jsx)（`buildIndicatorRows()`のlabel生成箇所、既存拡張）
- [src/components/race/DataRaceTable.jsx](../../../src/components/race/DataRaceTable.jsx)（`drt-label-cell`のレンダリング箇所、既存拡張）
- [src/components/race/AiAnalysisSection.jsx](../../../src/components/race/AiAnalysisSection.jsx)（タイトル部、既存拡張）
- [src/components/race/PredictionPanel.jsx](../../../src/components/race/PredictionPanel.jsx)（展開予測・イン崩れ指数の各見出し、既存拡張）
- [src/components/race/EmbeddedAnalysisSection.jsx](../../../src/components/race/EmbeddedAnalysisSection.jsx)（`hintKey`prop新設、既存拡張。7セクション分を1箇所でカバー）
- [src/components/race/VenueTendencyPanel.jsx](../../../src/components/race/VenueTendencyPanel.jsx)（見出し部、既存拡張。「この会場の枠番別傾向」用）

| コンポーネント | 役割 | 新規/既存 |
|---|---|---|
| `src/components/race/TermHintButton.jsx`（仮称、新規） | 「?」ボタン＋タップで表示される説明ポップオーバー。同一UIパターンが多数の箇所で使われるため、component-reuse.mdの原則に従い共通コンポーネントとして最初から切り出す | 新規。`--z-index-popover`(60)・`--radius-md`/`--radius-lg`・`--shadow-md`/`--shadow-lg`（`design-tokens.css`）を流用。汎用tooltip/popover CSSクラスは既存に無いため新規CSS（`TermHintButton.css`）が必要 |

`PredictionPanel.jsx`は`VenueGridPage.jsx`（ホーム）と`src/pages/RaceDetailPage.jsx`（過去レース）の両方から`PredictionSection.jsx`経由で共通利用されているため、上記の変更だけで両画面に反映される。ページ単位での複製実装は不要。

## 動画関連（A-5・B-1共通）

| コンポーネント | 役割 | 新規/既存 |
|---|---|---|
| `src/components/GuideVideoPlayer.jsx`（仮称、新規） | サムネイル表示＋クリックで動画再生（自動再生・自動読み込みなし）。`HowToUse.jsx`（A-5）と`FirstVisitGuideCard.jsx`（B-1）の両方から呼ばれるため、component-reuse.mdの原則に従い最初から共通コンポーネントとして設計する | 新規 |
| 動画アセット本体 | `sns-video-studio/remotion`（既存パイプライン）で制作したmp4 | 新規アセット。配置先（`public/`配下か外部ホスティングか）は`spec.md`の未確定事項のまま、動画制作着手時に決定 |

## デザイントークンの流用方針

- 色・境界線・カード背景: 既存の`--ryujin-*`系トークン（navy/gold/ivory）をそのまま使用し、新規カラー定義はしない
- z-index: `--z-index-popover`(60)、`--z-index-tooltip`(70)をTermHintButtonのポップオーバーに使用
- 角丸・影: `--radius-md`/`--radius-lg`、`--shadow-md`/`--shadow-lg`を使用
- 新規CSSが必要な箇所: `FirstVisitGuideCard.css`、`TermHintButton.css`、`GuideVideoPlayer.css`（いずれも上記トークンの組み合わせで表現し、独自の色・サイズ値をハードコードしない）
