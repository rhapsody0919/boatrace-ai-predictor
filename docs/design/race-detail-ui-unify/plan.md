# レース詳細ページのスマホ幅・色分け統一 plan

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md)

データ・DBの変更は無い（表示だけ）。ER図は不要。

## 1. 最良値の判定（R1、PR2a）

### 今

- `bestOf(candidates, dir)`（`src/components/race/raceIndicators.jsx` L73、非公開）が、最良の艇番を1つ返す（同値は艇番の若い方）。全艇同値・値なしは `null`
- 呼び出し側は `boat === best` で判定（`DataRaceTable.jsx` L77、`RaceBeforeInfoTab.jsx` L556、`RaceCardDataTable.jsx` L43）
- 別実装が5つ。いずれも `===` 比較なので同値は全部光るが、全艇同値の除外が無い
  - `MotorConditionChart.jsx` L368 `bestMotor2Rate`（null を 0 扱い）
  - `RacerFormChart.jsx` L81 `bestDelta`（0 より大のときだけ）
  - `StPredictabilityChart.jsx` L83 `bestDeviation`
  - `ExhibitionTimeTrendChart.jsx` L82 `bestAvgTime`
  - `RacerBoatReturnRateChart.jsx` `bestWinReturnRate`（0 より大のときだけ）

### 変更

- `bestOf` を `src/utils/` の新ファイル `bestOf.js` に移して export する（race と analysis の両方から使うため。`docs/reference/shared-logic-index.md` に同等の関数が無いことを確認済み）
- 返り値を「最良の艇番の集合」（`Set<number>`）に変える。値なし・全艇同値は空集合
  - 判定は値の比較だけ。浮動小数の誤差はこの用途では出ない（DB の値をそのまま比べる）
- 呼び出し側は `best.has(boat)`。`best: null`（向きなし）の行はそのまま `null` を許す（`best?.has(boat)`）
- 別実装5つは `bestOf` に置き換える。行全体の `.best-motor` クラスは残す（モーター表は BOA-428 子1 で外す。埋め込み分析4つは PR2b でセルの強調に変える）
  - 「0 より大のときだけ」の条件（Δ・回収率）は呼び出し側で残す（Δ が全員マイナスなら最良でも強調しない、という今の意図を変えない）
- 型: JSDoc で `@param {{boat:number, value:number|null|undefined}[]} candidates` `@returns {Set<number>}`

## 2. 共通クラス（R1・R2、PR2a）

- 新ファイル `src/styles/indicators.css`（`src/main.jsx` で読む）に置く
  - `.ind-best`: `.drt-best` と同じ見た目。背景・枠の濃さは新トークン `--ind-best-bg` / `--ind-best-ring`（`design-tokens.css` の :root で `color-mix(… --brand-accent-primary 14% / 40%)`。`--brand-accent-primary` がダークで切り替わるので、トークン側の再定義は要らない）
  - `.ind-good` / `.ind-bad`: `--color-success-text` / `--color-error-text`＋太字。記号（↑↓・＋−）は呼び出し側が文字で付ける
- `.drt-best` は `.ind-best` と同じトークンを参照する形に書き換える（見た目は不変）。セレクタ名は e2e（`smoke.spec.js` L4065）と既存 CSS が使っているので残す
- `.drt-up` / `.drt-down` の色の入れ替えは PR2b（基本情報）

## 3. 一律の緑の除去（R5、PR2a）

- `MotorConditionChart.css` L186 `.motor-ranking-table td.rate { color: var(--color-success-text) }` の color を外す（太さは残す）
- このクラスを使う表: モーター一覧（レース詳細・分析ページ）、埋め込み分析5つ、`MotorWakuStatsGrid`、`VenueRankingChart`、`VenueGradeMatrix`、`RacerFormRankingChart`、`RacerTechniqueProfileChart`。分析ページの見た目も変わる（spec「既定値で決定」: 部品ごと直す）
- 機力指数の `.power-index-good/-bad`、小標本の `td.rate.is-small-sample` は残す。詳細度を確認し、緑を外した後も機力指数の緑・赤が効くこと

## 4. 余白（PR1）

- `RaceDetailPage.css` の `@media (max-width: 480px)` に置く
  - `.race-detail-page-v2` の左右 padding 0.75rem → 0.5rem
  - `.race-detail-page-v2 .prediction-section` の左右 padding → 0
  - ページ側の変数 `--rdp-card-pad: 10px` を置き、各カード（`.rmt-card` `.rbi-card` `.rwit-card` `.rsc-card` `.nsc-card` `.prediction-result` `.race-result` `.rol-*` `.venue-tendency-panel` `.embedded-analysis-section` ほか、棚卸しの一覧）の左右 padding をこの変数にする
  - カードの中の表・グラフの外枠に `margin-inline: calc(-1 * var(--rdp-card-pad))`
  - `--rdp-bleed`（#1127）を `calc(0.5rem + 0)` に合わせる
- 320px 以下の指定（RaceDetail.css）とぶつからないよう、最終値を `e2e/layout.spec.js` で 320 / 375 で確認

## 5. 以降のPR

PR2b〜PR5 は tasks.md の各節。PR ごとに plan の該当節を追記してから着手する（PR2a の結果を見て共通クラスの使い方を確定させるため）。

## テスト

- `bestOf` の単体の検証: `scripts/maintenance/verify-best-of.js`（同値・全艇同値・null・min/max）。`verify-registry.json` に `ci` で登録
- e2e: smoke の `td.drt-best` は1要素前提の `toHaveText` なので、同値が無いスタブのまま通ることを確認
- 受け入れE2E: `e2e/acceptance/race-detail-ui-unify.spec.js`（acceptance-test-writer）
