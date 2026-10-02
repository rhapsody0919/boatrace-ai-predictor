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
- 第3引数 `{ digits }` で、**画面に出す桁に丸めてから比べる**（design-reviewer 指摘1）。生の値で比べると、表示が同じ「54.8」（54.84 と 54.80）の片方だけが光る。JS で平均した値は 6.710000000000001 と 6.71 のように一致しない。呼び出し側は表示と同じ桁を渡す（勝率・ST・展示 2、2連率・モーター 1、枠番勝率・回収率 0、ST偏差 3）
  - 結果として、平均ST のように表示桁で並びやすい行は、複数の艇が同時に光る（実測: 2026-10-02 児島12R の平均ST は 0.13 が5艇）
- 呼び出し側は `best.has(boat)`。`best: null`（向きなし）の行はそのまま `null` を許す（`best?.has(boat)`）
- モーター表の `rankClassFor`（1着率・優出数・優勝数の1位・2位を金で塗る）も `bestOf` にし、1位だけにする（2位の薄い金はやめる。R1。design-reviewer 指摘2）
- `src/components/analysis/RaceCardDataTable.jsx` の上位3位の色分けは分析ページ専用なので対象外
- 開催場一覧（`/`）の `RaceCard` も `race/RaceCardDataTable.jsx`（`rcdt-best`）を使うので、同値の全強調はそこにも出る（指摘9。Preview 確認の対象に `/` を含める）
- 別実装5つは `bestOf` に置き換える。行全体の `.best-motor` クラスは残す（モーター表は BOA-428 子1 で外す。埋め込み分析4つは PR2b でセルの強調に変える）
  - 「0 より大のときだけ」の条件（Δ・回収率）は呼び出し側で残す（Δ が全員マイナスなら最良でも強調しない、という今の意図を変えない）
- 型: JSDoc で `@param {{boat:number, value:number|null|undefined}[]} candidates` `@returns {Set<number>}`

## 2. 共通クラス（R1・R2、PR2a）

- 新ファイル `src/styles/indicators.css`（`src/main.jsx` で読む）に置く
  - 各表の指定（`.motor-ranking-table td` の文字色 0,1,1、偶数行の縞の background）に負けないよう、同じクラスを3つ重ねて詳細度を上げ、塗りは inset の box-shadow で描く（design-reviewer 指摘4）
  - `.ind-best`: `.drt-best` と同じ見た目。背景・枠の濃さは新トークン `--ind-best-bg` / `--ind-best-ring`（`design-tokens.css` の :root で `color-mix(… --brand-accent-primary 14% / 40%)`。`--brand-accent-primary` がダークで切り替わるので、トークン側の再定義は要らない）
  - `.ind-good` / `.ind-bad`: `--color-success-text` / `--color-error-text`＋太字。記号（↑↓・＋−）は呼び出し側が文字で付ける
- `.drt-best` は `.ind-best` と同じトークンを参照する形に書き換える（見た目は不変）。セレクタ名は e2e（`smoke.spec.js` L4065）と既存 CSS が使っているので残す
- `.drt-up` / `.drt-down` の色の入れ替えは PR2b（基本情報）

## 3. 一律の緑の除去（R5、PR2a）

- `MotorConditionChart.css` L186 `.motor-ranking-table td.rate { color: var(--color-success-text) }` の color を外す（太さは残す）
- このクラスを使う表: モーター一覧（レース詳細・分析ページ）、埋め込み分析5つ、`MotorWakuStatsGrid`、`VenueRankingChart`、`VenueGradeMatrix`、`RacerFormRankingChart`、`RacerTechniqueProfileChart`。分析ページの見た目も変わる（spec「既定値で決定」: 部品ごと直す）
- `.usage-history-rate` の一律の緑も外す（指摘7）
- 機力指数の `.power-index-good/-bad`、小標本の `td.rate.is-small-sample` は残す。詳細度を確認し、緑を外した後も機力指数の緑・赤が効くこと

## 4. 余白（PR1）

- `RaceDetailPage.css` の `@media (max-width: 767px)` に置く（481〜767px の帯もユーザー報告で対象に追加）
  - `.race-detail-page-v2` の左右 padding 0.5rem。`--rdp-card-pad: 10px`、`--rdp-bleed: 0.5rem`
  - `.race-detail-page-v2 .prediction-section` の左右 padding 0（RaceDetail.css の裸の指定 0,1,0 に 0,2,0 で勝つ。320px 以下の 0.75rem も同じく打ち消すので、#1127 の 320px の `--rdp-bleed` 再定義は削除した）
  - カード（`.rmt-card` `.rbi-card` `.rwit-card` `.rsc-card` `.nsc-card` `.venue-tendency-panel` `.prediction-result` `.race-result` `.rol-disclaimer` `.rol-status` `.race-tabs-empty` `.motor-condition-container`）の左右 padding を `--rdp-card-pad` に。480px 以下で 8px だった `.rsc-card` `.nsc-card` `.venue-tendency-panel` は 10px になる
  - 表を広げるのは、カードの内余白の直下にある表か横スクロール枠だけ（`.rmt-card > .rmt-compare` `.rmt-card > .hscroll-hint` `.rmt-card .race-history-hscroll` `.rwit-card > .rwit-today-table` `.rwit-card .rwit-grid-wrapper` `.rsc-card > .rsc-grid-wrapper` `.venue-tendency-panel .vtp-table-wrapper` `.motor-condition-container .table-wrapper`）。負の margin と `width: calc(100% + 2 * pad)` を一緒に付ける（指摘5）。グラフは広げない
  - 展示情報カードの `.hscroll-hint` の打ち消しは `var(--rdp-card-pad)`（指摘3）
  - データ出走表の行見出しを短縮ラベルに（481px 以上では全名が1行で並び、行見出しの列が 139px になっていた）
- 実測（開発サーバー、2026-10-02 児島8R）: 320〜700px の全幅で、今節・直前情報・枠別情報・モータ情報のカードの外側が左右 8px、ページの横スクロール無し。展示情報の表は 520・600・700px で横スクロール無し

## 5. 調子（Δ）の最良（PR2b）

- データ出走表の `form` 行は、全員が下がっていても「最もマシな艇」に金枠が付く。埋め込み分析の選手調子は Δ > 0 のときだけ。PR2b でデータ出走表も「Δ > 0 のときだけ最良」にそろえる。赤（下がった）の値に金枠が付くと R2 と矛盾するため（指摘8）

## 6. 今節・枠別情報（PR3）

- 今節の「6艇の今節」: 得点率（高、2桁）・節内順位（低）・前検タイム（低、2桁）の最良に `.ind-best`（モックどおり3列）。欠場・未出走の行は候補に入らない
  - 走数が少ない（⚠、3走未満）艇の得点率・順位は比べるが、最良でも金枠を付けない。次の艇へ繰り下げもしない（`bestOf` の `hidden`）。初日の1走だけの「⚠10.00」が光っていた（ファン評価1周目）
  - 表の下の注記に金枠の意味と、⚠ が最良のときはどの艇にも付けないことを書く（`meetTab.bestLegend`）
  - 選択中の行の最良は枠を不透明の金にする。行の青い塗りと混ざって灰色の箱に見えた（ファン評価2周目）
  - 得点率・順位・前検のセルの右に余白（`--spacing-1`）。数字が金枠の線に接していた（ファン評価3周目）。列の数字の右端がそろうよう、金枠の有無によらず付ける
- 得点率早見のボーダー超えの塗りは新トークン `--color-success-bg`（`--color-success-text` の 16%。ダークで切り替わる）
- 今節のSTの判定文: 「踏んでいる」＝`.ind-good`、「慎重」＝`.ind-bad`（差に −/+ が付く）。色は差 0.02 以上かつ今節3走以上のときだけ（`meetStVerdictTone`）。条件は推移の注記（`meetTab.sparkNote`）に書く。差 0.01・1走で赤の「慎重」が出ていた（ファン評価1周目）。展示の判定文は以前に廃止済みなので対象外
- 日別の走り（`RaceHistoryTable`、今節タブだけが使う）の着順: 1着＝金、5・6着と F・L・転覆などの記号＝赤（`RecentRunsBar` と同じ）。欠場は色なし
- **ST考察には金枠を付けない**（モックからの変更。ファン評価1周目 P1）。安定率・出遅率・抜出はコースで水準が違い、生の値の最良はほぼ毎回内側の艇に付く（2026-10-02 平和島12R: 安定率の金枠は1号艇 93.8・平均との差 +19.4、3号艇は 90.7 で +24.3）。カードの見方は「同コース・同級別の平均との差」なので、良し悪しは差の緑・赤で示す
  - 平均との差の緑・赤は、走数が少ない艇（⚠）には付けない（`diffTone`）。1走で「−56.1」が赤く出ていた（ファン評価2周目）。凡例にも書き、走数に⚠を付ける（凡例の⚠が表に無かった。ファン評価3周目）
  - 抜出に平均（期待回数）との差を ＋− 付きで出す。期待回数が1未満で0回のときは色なし（カードの既存方針）。表示の桁で0になる差は符号・色なし（以前は「−0.0」）
  - 代案（判断材料）: 「平均との差」の最良に金枠を付ける。コース補正後の最良が分かるが、金枠のセルの値が6艇の最大・最小と一致しなくなる
- **コース別成績・全コースには金枠を付けない**（spec FR-4 から外す）。どちらも1艇の期間・条件・コース別の表で、6艇の比較ではない。行は母数が違い、全コースは1コースが常に最良になる。PR2b の「条件別」を外した判断と同じ（spec「6艇比較が無いセクション」）

## 7. 以降のPR

PR2b〜PR5 は tasks.md の各節。PR ごとに plan の該当節を追記してから着手する（PR2a の結果を見て共通クラスの使い方を確定させるため）。

## 9. AI予想・オッズ・結果（PR5、イン崩れ注意度を除く）

（§6・§7 は PR3 #1187・PR4 #1193 で足す。番号を空けておく）

- 決まり手の色: 4コンポーネント（分析ページの決まり手3つ・選手ページ）に複製されていた hex の表を `src/utils/techniqueColors.js` の `techniqueColor` にまとめ、色は `--technique-color-1`〜`7`（design-tokens.css）。値は今のまま。カテゴリの色で良し悪しは無い（R3）。棒・帯の塗りだけに使い、ライト・ダークで同じ値
- 結果: 1着の行・最速STのタグ・払戻の最高額の背景の `rgba(201,162,39,…)` を `color-mix(--ryujin-gold-500 N%)` に（同じ色のトークン。見た目は変わらない）。当初は `--brand-accent-primary` から作ったが、ライトの金（#6b500f）が濃く、払戻の最高額の行で文字のコントラストが 4.83 → 4.37 と AA を割った（ファン評価2周目）
- 結果: 着順表の列見出し「レースタイム」は 768px 以下で短い「タイム」（`result.columns.timeShort`、4言語）。列が 2.4〜2.8rem しか無く、375px で 15px はみ出してカードの外で切れていた（本番でも同じ。ファン評価1周目）
- 結果: 「この日の水面傾向」（`.vds-card`）は `.race-result` の中のカードで、767px 以下で外の内余白に自分の 16px が重なっていた。ほかのカードと同じ `--rdp-card-pad` に
- AI予想: 確定後の展開予測の的中・不的中（`.turn-pattern-summary--hit/--miss`、クラスだけあって CSS が無かった）を緑・赤に。文の頭に ✅ / ❌ が付く
- AI予想（イン崩れ注意度）の確定後の振り返りには良し悪しの色を付けない。単発のレースで的中・不的中を判定しない方針（2026-08-14、RaceAiPredictionTab のコメント）
- BOA-619 の残り: 発走前の AI予想（`.prediction-result`）も 1025px 以上で 720px・中央に（確定後の振り返りは #1185 で済み）。1440px で展開予測の決まり手と確率が約1130px 離れていた
- オッズ一覧の濃淡（`--color-primary-alpha-10`〜`50`）は既にトークンで、ライト・ダークどちらのカードにも馴染むよう選んだ値（RaceOddsListTab.css のコメント）。変えない
- イン崩れ注意度（VolatilityDisplay）の直書きの色は、オッズ一覧レーンの #1186（BOA-706）のマージ後に別に行う

## テスト

- `bestOf` の単体の検証: `scripts/maintenance/verify-best-of.js`（同値・全艇同値・null・min/max）。`verify-registry.json` に `ci` で登録
- e2e: smoke の `td.drt-best` は1要素前提の `toHaveText` なので、同値が無いスタブのまま通ることを確認
- 受け入れE2E: `e2e/acceptance/race-detail-ui-unify.spec.js`（acceptance-test-writer）
