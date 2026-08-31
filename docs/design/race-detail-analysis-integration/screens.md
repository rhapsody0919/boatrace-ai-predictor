# レース詳細×分析ツールデータ統合 screens

spec: `spec.md`

## 影響する画面・コンポーネント一覧

| 画面/コンポーネント | 種別 | 内容 |
|---|---|---|
| `src/components/race/VenueTendencyPanel.jsx` + `.css` | **新規** | FR-2「この会場の枠番別傾向」パネル。4行（決まり手/トップ発走率/負け決まり手/展示最速転換率）×6艇（枠番）の会場統計テーブル。n数併記・閾値未満は「データ不足」表示。決まり手行に`nige`タブへの追加リンク併設。デフォルト展開 |
| `src/hooks/useVenueTendencyStats.js` | **新規** | `venue_code`単位で会場統計4関数（`getWinningTechniqueStats`/`getTopStartStats`/`getLosingTechniqueStats`/`getExhibitionTimeTopStats`）を束ねるフック。`useRaceAnalysisData`（raceId単位）とは責務が異なるため分離 |
| `src/components/race/EmbeddedAnalysisSection.jsx` + `.css` | **新規** | FR-3〜9共通の折りたたみアコーディオンラッパー。ヘッダ（アイコン+タイトル+chevron）、デフォルト閉、開いた時だけchildrenをマウント（lazy mount） |
| `src/components/analysis/MotorConditionChart.jsx` | 変更 | FR-3。`embedded`propを追加し、trueの場合は会場・レース選択プルダウンを非表示にする |
| `src/components/analysis/RacerFormChart.jsx` | 変更 | FR-4。同上 |
| `src/components/analysis/StPredictabilityChart.jsx` | 変更 | FR-5。同上 |
| `src/components/analysis/ExhibitionTimeTrendChart.jsx` | 変更 | FR-6。同上 |
| `src/components/analysis/RacerTechniqueProfileChart.jsx` | 変更 | FR-7。同上 |
| `src/components/analysis/RacerBoatReturnRateChart.jsx` | 変更 | FR-8。同上 |
| `src/components/analysis/AttackDefenseAnalysis.jsx` | 変更 | FR-9。同上。自前の会場・レース選択state/UIを持つ点は他6コンポーネントと同型（spec記載の「追加フェッチ不要」はデータ量の話で、UI構造の改修自体は他と同様必要） |
| `src/components/race/PredictionPanel.jsx` | 変更 | `DataRaceTable`直下に`VenueTendencyPanel`+`EmbeddedAnalysisSection`×7（FR-3〜9）を追加 |
| `src/components/race/DataRaceTable.jsx` | 変更 | FR-1。既存`deepLink`の`Link`に`onClick`で`trackEvent`を追加 |
| `src/components/race/VolatilityDisplay.jsx` | 変更 | FR-1。既存の`/winning-technique?tab=volatility`リンクに同様のクリック計測を追加 |
| `src/components/race/OutcomePatternPreview.jsx` | 変更 | FR-1。既存の`detailLink`に同様のクリック計測を追加 |
| `src/components/race/index.js` | 変更 | barrel exportに`VenueTendencyPanel`/`EmbeddedAnalysisSection`を追加 |
| `src/locales/{ja,en,zh-TW,ko}/common.json` | 変更 | `venueTendency.*`（会場パネルの行ラベル・注記・データ不足文言）／`embeddedSection.*`（7セクションのタイトル）キー追加 |
| `e2e/smoke.spec.js` | 変更 | 会場パネル表示・アコーディオン開閉のスモークテスト追加 |
| App.jsx | **無改修** | 本specはRaceDetail（`PredictionPanel`経由）のみが対象。トップページ一覧側は`formranking`/`venueranking`と同じく別課題として対象外 |

## 再利用の方針（component-reuse.md準拠）

- **アコーディオンパターンの共通化必須**: FR-3〜9の7セクションは全て同じ「ヘッダ+chevron+デフォルト閉+lazy mount」の挙動を持つため、`EmbeddedAnalysisSection`という1つの共通コンポーネントに切り出す。7箇所に同じ折りたたみUIをそれぞれ個別実装しない
- **会場統計フックの分離**: 既存`useRaceAnalysisData`はraceId単位の7関数を束ねる設計（`SOURCES`のcontractが`fn(raceId)`）。`venue_code`単位で完結する会場統計4関数を無理に同じフックへ混ぜ込まず、`useVenueTendencyStats(venueCode)`として独立させる（前回のFEエンジニアレビュー指摘を反映）
- **既存分析コンポーネントは`embedded`propで拡張、複製しない**: `MotorConditionChart`等6+1コンポーネントは単独ページ（`/winning-technique`）でも引き続き使われるため、埋め込み用に別コンポーネントを新規作成せず、既存コンポーネントに`embedded`（真偽値）propを追加して条件分岐する
- **App.jsx/RaceDetail.jsx双方に必要か**: 不要。本機能はRaceDetail（`PredictionPanel`）専用。App.jsxのレース一覧カード側への横展開は今回のスコープ外（`formranking`/`venueranking`と同じ扱い）
- **デザイントークンで表現できる部分**: 色・スペーシング・角丸・フォントサイズ・ボーダーは全て`design-tokens.css`と既存`DataRaceTable.css`のパターン（`drt-*`クラス命名・n数を薄いサブテキストで表示する等）を踏襲する
- **新規CSSが必要な部分**: `VenueTendencyPanel`のグリッド構造とn数不足時のグレーアウト表現、`EmbeddedAnalysisSection`のアコーディオン開閉アニメーション

## ワイヤーフレーム（レース選択後、DataRaceTable〜AIデータ分析の間）

```
┌──────────────────────────────┐
│ 📋 データ出走表（既存・無変更）  │
│ ...11行×6艇...                │
├──────────────────────────────┤
│ 📍 この会場の枠番別傾向 ▲      │←デフォルト展開
│ ┌────────┬──┬──┬──┬──┬──┬──┐ │
│ │        │1 │2 │3 │4 │5 │6 │ │
│ │決まり手 │逃92%│差57%│不足│..│  │←nigeへの追加リンク付き
│ │        │n=182│n=94│n=8│  │  │
│ │トップ発走│71% │18% │22%│..│  │
│ │展示転換 │64% │33% │29%│..│  │
│ │負け決まり│..  │..  │.. │..│  │
│ └────────┴──┴──┴──┴──┴──┴──┘ │
│ ※選手個人の実績ではなく会場の傾向 │
│ 集計基準: 前夜更新・過去90日     │
├──────────────────────────────┤
│ 🔧 モーター調子 ▶              │←デフォルト閉（FR-3）
│ 📈 選手調子の推移 ▶            │←デフォルト閉（FR-4）
│ ⏱ スタートタイミングの安定性 ▶  │←デフォルト閉（FR-5）
│ 〰 展示タイムの推移 ▶          │←デフォルト閉（FR-6）
│ 🎯 決まり手の内訳（選手別） ▶   │←デフォルト閉（FR-7）
│ 💰 回収率の詳細 ▶              │←デフォルト閉（FR-8）
│ ⚔ 超展開データ ▶              │←デフォルト閉（FR-9）
├──────────────────────────────┤
│ 🤖 AIデータ分析（既存・無変更） │
└──────────────────────────────┘
```
