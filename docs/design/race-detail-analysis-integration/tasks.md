# race-detail-analysis-integration タスク分解

`docs/design/race-detail-analysis-integration/spec.md`・`screens.md`・`plan.md`に基づくタスク一覧。依存順に並べており、上から順に実装する。

## タスク一覧

- [x] **1. FR-1: 深掘りリンクのクリック計測追加**
  `src/components/race/DataRaceTable.jsx`の`deepLink`を使う各`Link`、`src/components/race/VolatilityDisplay.jsx`の`/winning-technique?tab=volatility`リンク、`src/components/race/OutcomePatternPreview.jsx`の`detailLink`に、`onClick={() => trackEvent("deep_link_click", { tab, source })}`を追加する（`src/utils/analytics.js`の既存`trackEvent`を利用）。他タスクと依存関係がなく、ベースライン計測を最速で開始するため最初に実装する。

- [x] **2. 会場統計API層のレスポンス統一**
  `src/services/supabaseDataService.js`の`getTopStartStats`/`getExhibitionTimeTopStats`が返すレスポンスに、`getWinningTechniqueStats`/`getLosingTechniqueStats`と同じ形で`last_updated`をトップレベルに正規化する。DBスキーマ変更なし、アプリ層のみ。

- [x] **3. useVenueTendencyStats フック実装**
  `src/hooks/useVenueTendencyStats.js`を新規作成（ADR-0024）。`venueCode`を引数に、`getWinningTechniqueStats`/`getTopStartStats`/`getLosingTechniqueStats`/`getExhibitionTimeTopStats`を`Promise.all`で並列取得し、各データソース・`last_updated`・ローディング状態を返す。

- [x] **4. i18nキー追加（会場パネル用）**
  `src/locales/{ja,en,zh-TW,ko}/common.json`に`venueTendency`名前空間を追加。行ラベル（決まり手/トップ発走率/負け決まり手/展示最速転換率）、「選手個人の実績ではなく〜」の注記文言、「データ不足」表示文言、集計基準日の文言を定義する。

- [x] **5. VenueTendencyPanel コンポーネント実装**
  `src/components/race/VenueTendencyPanel.jsx`＋`.css`を新規作成。4行（決まり手/トップ発走率/負け決まり手/展示最速転換率）×6艇（枠番）のテーブル。`useVenueTendencyStats`からデータを取得し、各セルにn数を併記。カテゴリ分割指標（決まり手・負け決まり手）はn未満（Wilson区間目安でn<20〜30）で「データ不足」表示、2値指標（トップ発走率・展示最速転換率）はn数併記のみで常に表示。決まり手行に`nige`タブへの追加リンクを併設。デフォルト展開、集計基準日をパネル下部に表示。

- [x] **6. VenueTendencyPanelのPredictionPanel統合＋スモークテスト**
  `src/components/race/PredictionPanel.jsx`の`DataRaceTable`直下に`VenueTendencyPanel`を追加。`src/components/race/index.js`のbarrel exportに追加。`e2e/smoke.spec.js`に会場パネルの表示確認テストを追加する。

- [x] **7. EmbeddedAnalysisSection 共通ラッパー実装**
  `src/components/race/EmbeddedAnalysisSection.jsx`＋`.css`を新規作成（ヘッダ+アイコン+タイトル+chevron、デフォルト`expanded=false`、`expanded`時のみchildrenをマウントするlazy mount）。7セクション分のタイトルi18nキー（`embeddedSection.motor`等）を4言語分`common.json`に追加する。

- [x] **8. MotorConditionChartのembedded対応＋統合（FR-3）**
  `src/components/analysis/MotorConditionChart.jsx`に`embedded`prop（ADR-0023）を追加し、`embedded=true`時は会場・レース選択プルダウンを非表示にする。`PredictionPanel.jsx`に`EmbeddedAnalysisSection`でラップした本コンポーネントを追加し、embedded modeの改修・統合パターンをここで確立する。

- [x] **9. RacerFormChartのembedded対応＋統合（FR-4）**
  `src/components/analysis/RacerFormChart.jsx`に同様の`embedded`propを追加し、`PredictionPanel.jsx`に統合する。

- [x] **10. StPredictabilityChartのembedded対応＋統合（FR-5）**
  `src/components/analysis/StPredictabilityChart.jsx`に同様の対応を行い統合する。

- [x] **11. ExhibitionTimeTrendChartのembedded対応＋統合（FR-6）**
  `src/components/analysis/ExhibitionTimeTrendChart.jsx`に同様の対応を行い統合する。

- [x] **12. RacerTechniqueProfileChartのembedded対応＋統合（FR-7）**
  `src/components/analysis/RacerTechniqueProfileChart.jsx`に同様の対応を行い統合する。

- [x] **13. RacerBoatReturnRateChartのembedded対応＋統合（FR-8）**
  `src/components/analysis/RacerBoatReturnRateChart.jsx`に同様の対応を行い統合する。

- [x] **14. AttackDefenseAnalysisのembedded対応＋統合（FR-9）**
  `src/components/analysis/AttackDefenseAnalysis.jsx`に同様の対応を行い統合する。データソースが`DataRaceTable`と同じ`racerStats`であるため、`PredictionPanel`側で既に取得済みの値を渡せないか確認し、可能なら追加フェッチを避ける。

- [x] **15. 全体動作確認・E2Eスモークテスト仕上げ・PR作成**
  会場パネル＋7つの埋め込みセクションが揃った状態でローカル確認（`npm run dev`、Playwright）。会場パネルの表示・n数閾値の非表示挙動・各アコーディオンの開閉（閉じている間はネットワークリクエストが発生しないことを含む）・モバイル幅（375px等）でのレイアウト崩れがないことを確認する。`e2e/smoke.spec.js`に7セクションぶんの開閉スモークテストを追加。`npm run build`・`npm run test:e2e`実行後、`/create-pr`でPR作成する。
