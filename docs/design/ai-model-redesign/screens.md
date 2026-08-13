# AI予想モデル大規模改修 画面・コンポーネント一覧

`docs/design/ai-model-redesign/spec.md`（2026-08-13方針転換版）の機能要件（FR1〜FR9）に基づく。`.claude/rules/component-reuse.md`に従い、新規/既存拡張/廃止の区分と再利用方針を明記する。

## 方針転換の要約（screens.md観点）
旧設計は「3連単中心の統合モデル＋展開パターン×3通りの推奨買い目カード（`RecommendedBetsSection`）」が主役だったが、新設計では**複勝予想（コース別勝率）・展開予測パネル・イン崩れ指数バッジ**の3つが主役になり、3連単は控えめな参考情報に格下げされた。`RecommendedBetsSection`（旧FR5の2階層UI）は実装しない。

## 1. 予想表示コア（トップページ・レース詳細で共通、`PredictionSection`配下）

`App.jsx`と`RaceDetail.jsx`（当日詳細部分）の両方で`PredictionSection`が使われており、この配下は共通コンポーネントとして扱われている（既に共通化済み）。今回もこの構造を維持する。

| コンポーネント | 区分 | 役割・変更内容 |
|---|---|---|
| `PredictionSection.jsx` | 既存拡張 | セクション見出し（`section.resultTitle`＝現行「AI予想結果」）をFR7の新文言（例:「データ分析」寄りの表現）に変更する以外は構造を維持 |
| `PredictionPanel.jsx` | 既存拡張 | `DataRaceTable`＋`AiAnalysisSection`の外枠構成は維持。`AiAnalysisSection`の中身を「展開予測パネル」「イン崩れ指数バッジ」「3連単参考情報」の3ブロックに再構成する |
| `DataRaceTable.jsx` / `raceIndicators.jsx` | 既存拡張 | FR5: 既存11指標行と並ぶ「複勝予想」行を追加（`buildIndicatorRows`にビルダー追加）。コース別勝率（既存`courseRate`指標）を根拠として、上位2艇を複勝予想としてバッジ表示する。**常時表示**（他の指標行と同じ扱い） |
| `AiAnalysisSection.jsx` | 既存拡張（軽微） | 折りたたみコンテナ構造はそのまま流用。ヘッダーのサマリー文言を「展開予測○%」等に見直す。中身を新規3ブロックに差し替え |
| `ModelSwitcher.jsx` | 廃止 | 3モデル切替タブ。モデル一本化（FR6）により不要 |
| `ModelDescription.jsx` | 廃止 | 予想モデル説明セクション。同上の理由で不要 |
| `FirstMarkAnimation.jsx` | **既存活用（主役に格上げ）** | FR2の展開予測パネル本体。表示ロジックは維持し、的中率80.0%を裏付けとして訴求する文言・バッジを周辺に追加する |
| `VolatilityDisplay.jsx` | 既存拡張 | FR3: イン崩れ指数バッジとして再構成。high/medium/lowラベルではなく連続値パーセンタイル＋「イン崩れ率○%」という実測値を表示する方向に変更 |
| `PredictionFlash.jsx` | 既存拡張（縮小して転用） | FR4（3連単参考情報）の土台として使う。「買い目＋根拠」の構造を活かしつつ、複数モデル依存（`MODEL_NAMES`/`MODEL_KEY_MAP`）を外し、控えめな表示（例: 折りたたみのさらに下層、小さめのカード）に縮小する |
| `BettingValueSection.jsx` | 既存拡張（縮小して転用） | FR4のオッズ・EV表示部分として使う。`MODEL_SUFFIX`（3モデル対応）を外し、EV最大1点のみのシンプル表示にする |
| `OutcomePatternPreview.jsx` | 既存活用を見送り | 旧FR5（類似条件過去実績）向けに拡張予定だったが、複数買い目パターン機能を実装しないため、現状の「出現パターンプレビュー」のまま据え置く（変更なし） |
| `PredictionTable.jsx` | 削除 | 既にどこからもimportされていないデッドコード。barrel export（`index.js`）からも削除 |
| `AttackDefenseTable.jsx` | 既存活用（変更なし） | 超展開データ表示、変更不要 |

## 2. トップページ固有（`App.jsx`）

| コンポーネント | 区分 | 役割・変更内容 |
|---|---|---|
| `App.jsx` | 既存拡張 | FR7: レースカードCTA文言（`home.viewPrediction`＝現行「AI予想を見る」）を「複勝予想を見る」等の新表現に変更。IntroBanner文言も同様。`activeTab === "picks"`分岐（`TodaysPicks`呼び出し）をFR6に伴い削除し、`/picks`ルートのリダイレクト処理に置き換え |
| `TodaysPicks.jsx` | 廃止 | 「今日のおすすめ」機能本体。FR6で廃止 |

## 3. 過去予想・実績ページ

| コンポーネント | 区分 | 役割・変更内容 |
|---|---|---|
| `RaceHistory.jsx` | 既存拡張 | `ModelComparisonTable`呼び出し（compact表示）をFR6-1のアーカイブ方針に合わせて改修 |
| `RaceDetail.jsx` | 既存拡張 | 同上（過去の予想履歴ページ最上部の`ModelComparisonTable`） |
| `ModelComparisonTable.jsx` | 既存活用（大きな変更不要） | `data`配列を受け取る汎用テーブル設計のため、モデル数に依存しない。旧3モデルの実績表示（アーカイブ）にはそのまま使う。新モデルは複勝・展開予測・イン崩れ・3連単の4指標を持つため、表示列の再設計が必要（3連単中心だった旧設計とは列構成が変わる） |
| `AccuracyDashboard.jsx` | 既存拡張 | FR6-1: `standard`/`safeBet`/`upsetFocus`ハードコードの集計ロジックを、「旧モデル（アーカイブ）」と「新モデル（複勝的中率・展開予測的中率・イン崩れ相関・3連単参考回収率の4指標）」の2セクションに分離する |
| `AccuracyHistory.jsx` | 既存拡張 | 同上。月次推移グラフも新モデル分（特に複勝回収率）を追加表示できる構成に変更 |

## 4. 廃止対象ページ・リダイレクト

| 対象 | 区分 | 役割・変更内容 |
|---|---|---|
| `Holmes.jsx`（`/holmes`） | **維持（訂正）** | ホームズ5探偵ページ。当初FR6で廃止対象としたが、ナビ非公開のα版検証ページであり並行セッションでWatson/Mycroft等が現在も開発中と判明したため維持に訂正（spec.md訂正参照） |
| `Poirot.jsx`（`/poirot`） | **維持（訂正）** | ポアロ予想ページ。同上の理由で維持 |
| `AppRouter.jsx` | 既存拡張 | `/picks`のリダイレクトを実装。既存の`OutcomeDistributionRedirect`（`/outcome-distribution`→`/winning-technique?tab=outcome`）と同じパターンを踏襲し、専用のRedirectコンポーネントを追加する（`/holmes`・`/poirot`は対象外に変更） |

## 5. ナビゲーション

| 対象 | 区分 | 役割・変更内容 |
|---|---|---|
| `Header.jsx` | 変更ほぼ不要（要確認） | 現状ホームズ・ポアロ・「今日のおすすめ」への直接リンクはハンバーガーメニューにも存在しない（孤立導線）。ナビ自体の変更は不要な見込みだが、実装時に念のため全リンクを再確認する |

## デザイントークン・スタイルの方針

- 複勝予想バッジ（データ出走表内）は、既存の`drt-value`/`drt-plus`等のCSSクラス（`raceIndicators.jsx`の`returnRate`行等で既に使用中の「達成時ハイライト」パターン）を再利用する
- イン崩れ指数バッジは、既存`VolatilityDisplay.jsx`の勝率ゲージパターン（色分け: 赤/オレンジ/緑）を、連続値パーセンタイル用に流用する
- 3連単参考情報（`PredictionFlash`/`BettingValueSection`縮小版）は、視覚的に控えめなスタイル（既存より小さいフォント・淡い配色）にすることで「主役ではない」ことをUI上でも表現する。デザイントークンの範囲内（新規トークン追加なし）で表現する
- `BOAT_COLORS`（艇番バッジの配色）は複勝予想・3連単参考情報の両方で共通利用する
- モバイル対応: `DataRaceTable`が既に持つ「横スクロールテーブル＋ラベル列sticky固定」パターン（`AttackDefenseTable.css`と同様）を複勝予想行にもそのまま適用する

## 未確定・screens段階では決めきれない事項

- `AiAnalysisSection`内の3ブロック（展開予測パネル/イン崩れバッジ/3連単参考情報）の表示順序・レイアウト詳細はplan.mdで検討する
- `/holmes`・`/poirot`のリダイレクト先（新AI予想セクションの具体的なURL・アンカー）はplan.mdで確定する
- `AccuracyDashboard.jsx`/`AccuracyHistory.jsx`の「旧モデル/新モデル」2セクション構成の具体的なUI（タブ切り替えか、上下に並べるか）、および新モデルの4指標（複勝・展開予測・イン崩れ・3連単）をどう1画面にまとめるかはplan.mdで検討する
- 3連複の扱い（spec.md未確定事項）が決まり次第、表示要否を反映する
