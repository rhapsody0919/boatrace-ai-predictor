# race-ai-copy 画面・コンポーネント一覧

`docs/design/race-ai-copy/spec.md` の機能要件を実現するために影響する画面・コンポーネントの一覧。

## 前提: 実装箇所は1つで両画面に反映される

`DataRaceTable`・`SocialShareButtons`はいずれも`PredictionPanel.jsx`（`src/components/race/PredictionPanel.jsx`、142行目・220行目）にネストされており、`PredictionPanel`は`PredictionSection.jsx`経由で`src/App.jsx`（766行目）と`src/pages/RaceDetail.jsx`（299行目）の両方から同一コンポーネントとして呼ばれている（`component-reuse.md`が定める「同じUIパターンは共通コンポーネント化」が既に達成された状態）。

したがって本機能は**`PredictionPanel.jsx`配下に実装すれば、ホーム画面（App.jsx）の埋め込み予想パネルとレース詳細ページ（RaceDetail.jsx）の両方に自動的に反映される**。個別画面ごとの実装は不要。

## 影響コンポーネント一覧

| コンポーネント | 種別 | 役割・主要素 |
|---|---|---|
| `PredictionPanel.jsx`（`src/components/race/PredictionPanel.jsx`） | 既存拡張 | 予想パネル全体。142行目`<DataRaceTable>`の直後、220行目`<SocialShareButtons>`の付近の2箇所にコピー起点を追加する。券種プロンプト選択（単勝/3連単/3連複）のUIもこの内部に配置 |
| `AiCopyButton`（新規、`src/components/race/AiCopyButton.jsx`想定） | 新規コンポーネント | コピー実行ボタン本体。クリックでMarkdown表+選択中プロンプトをクリップボードに書き込み、コピー成功時にトースト表示をトリガーする。データ出走表側・予想パネル上部側の2箇所から共通で呼び出せるよう、`variant`（`inline`/`scroll-link`等）propで表示形式を出し分ける |
| `AiCopyPromptSelector`（新規、`AiCopyButton`内に含めるか別コンポーネントにするかは`/step2`で判断） | 新規コンポーネント（小） | 単勝・3連単・3連複の3パターンから選択するUI（タブ or セグメントコントロール想定） |
| `useAiCopyText`（新規、`src/hooks/useAiCopyText.js`想定） | 新規フック | `prediction`/`selectedRace`オブジェクトからMarkdown表+プロンプト文言のテキストを組み立てるロジック。表示言語（`i18n`の現在言語）に応じて出力を切り替える。UIから分離してテスト・再利用しやすくする |
| `Toast`（新規、`src/components/Toast.jsx`想定） | 新規コンポーネント | 「コピーしました」等の一時的な通知表示。既存のトースト/通知コンポーネントは調査の結果**存在しないため新規実装**。今後別機能でも再利用できる汎用設計にする |
| `DataRaceTable.jsx`（`src/components/race/DataRaceTable.jsx`） | 変更なし（参照のみ） | コピー対象データの構造・11指標の定義元。`useAiCopyText`がこのコンポーネントが使う`raceIndicators.jsx`の`buildIndicatorRows`と同じデータソース（`prediction.racerStats`等）を参照する |
| `raceIndicators.jsx`（`src/components/race/raceIndicators.jsx`） | 変更なし（参照のみ） | 11指標の定義・整形ロジックの参照元。`useAiCopyText`が独自にMarkdown化する際、ここでの指標名・単位表記と一致させる |

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

**デザイントークンで表現可能**（`src/styles/design-tokens.css`）:
- ボタンの配色: `--color-primary-500`（メイン）/`--color-primary-600`（ホバー・ダーク）
- トースト通知の成功色: `--color-success` / `--color-success-dark`、`--gradient-success`
- 余白: `--spacing-*`系トークン

**新規CSSが必要な部分**:
- トーストのポジショニング（画面下部固定表示等）・フェードイン/アウトのアニメーション
- 券種選択UI（タブ/セグメントコントロール）のレイアウト
- コピー成功時のボタン自体の一時的な見た目変化（「コピー済み✓」表示等）
- `AiCopyButton`の常時パルス/バウンスアニメーション（`@keyframes`によるCSSアニメーション、`prefers-reduced-motion`への配慮を実装時に検討）と、隣接する短いキャッチコピーバッジ（「あなたのAIに聞ける！」等）のレイアウト・吹き出し風の見た目

## 多言語対応が必要な文言
- 3パターンのプロンプト文言（単勝/3連単/3連複、日本語原文確定後にen/zh-TW/ko翻訳、`docs/reference/i18n-glossary.md`準拠）
- ボタンラベル（例:「AI用にコピー」）
- トースト通知文言（例:「コピーしました」）
- Markdown表の見出し（11指標の項目名）— 既存`raceIndicators.jsx`が持つ表示ラベルの多言語対応状況を`/step2`で確認し、既存のi18nキーを再利用できるか調べる

## 選手名等の固有名詞の扱い
Markdown表に選手名を含める場合、`translate="no"`はコピーされるテキスト自体には適用対象外（HTML属性のためプレーンテキストコピーには影響しない）。多言語ページでコピーした際も選手名は原則日本語表記のまま出力する方針を`/step2`で確認する。
