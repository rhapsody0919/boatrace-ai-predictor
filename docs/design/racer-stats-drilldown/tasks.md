# タスク分解

対応: [spec.md](./spec.md) / [screens.md](./screens.md) / [plan.md](./plan.md) / [ADR-0061](../../adr/0061-racer-page-grade-stage-filter-approach.md) / [ADR-0062](../../adr/0062-racer-page-filtered-view-tabs.md)（Superseded） / [ADR-0063](../../adr/0063-racer-page-cross-tab-and-always-on-detail.md)

## Phase 1（完了、PR #686）

- [x] **Task 1: `getRacerRaceHistory` を拡張し、グレード・レース種別・レース名・複勝配当を取得・返却する**
- [x] **Task 2: `aggregateRacerVenueBoatStats` を拡張し、グレード・レース種別フィルタと新規指標に対応する**
- [x] **Task 3: `RacerPerformanceStats.jsx` にグレード・レース種別のフィルタUIを追加する**
- [x] **Task 4: 絞り込み結果をタブ化する（概要／決まり手／推移）**
- [x] **Task 5: レース一覧タブを新規実装する**
- [x] **Task 6: 実データでの動作確認**
- [x] **Task 6.5: セルフレビュー指摘の修正**（vcRacePage依存漏れ・getFinishRank統合・回収率共通化・決まり手JSX共通化）+ モバイル横スクロール修正

## Phase 2（本改訂、ADR-0063：フィルタ配置転換・会場×枠番クロス集計・常時表示化）

- [ ] **Task 7: フィルタブロックを見出し直下・最上部に移動する**
  - `RacerPerformanceStats.jsx`内のJSX順序を変更（フィルタ→概要カード→成績ブロック→...の順に）
  - ロジック（state・イベントハンドラ）は変更しない、位置のみ移動

- [ ] **Task 8: `aggregateRacerCrossStats`を新規実装する**
  - `src/services/supabaseDataService.js`に新規関数を追加
  - `(history, fixed, groupBy, raceGrade, raceStage)`引数。`fixed`は`{venueCode}`または`{boatNumber}`、`groupBy`は`"venue"`または`"boat"`
  - `history`を`fixed`・`raceGrade`・`raceStage`で絞り込んだ後、`groupBy`でグループ化し、グループごとに`n`/`win`/`top2`/`top3`（既存の`isPlaceHit`/`isShowHit`を再利用）を計算した配列を返す
  - 純粋関数（I/O無し）

- [ ] **Task 9: 成績ブロックを4分岐で実装する**
  - `vcVenue`/`vcBoat`の`"all"`判定で分岐するレンダリングを実装
  - 両方`"all"`: 既存の会場別一覧（`venueStats`）・枠番別一覧（`courseStats`）をそのまま使う
  - 会場固定×枠番`"all"`: `aggregateRacerCrossStats`で枠番別一覧を計算・表示
  - 会場`"all"`×枠番固定: `aggregateRacerCrossStats`で会場別一覧を計算・表示
  - 両方固定: 既存の7カードJSX（Phase1で実装済み）を再利用

- [ ] **Task 10: 一覧テーブルの行クリックでフィルタに反映する**
  - 既存の会場別一覧・枠番別一覧、Task 9で追加したクロス集計後の一覧、いずれの行にも`onClick`を追加
  - 会場の行→`setVcVenue(venueCode)`、枠番の行→`setVcBoat(boatNumber)`
  - 新規CSS（cursor: pointer、hover背景）

- [ ] **Task 11: 決まり手・推移・レース一覧を常時表示化する（タブ廃止）**
  - `vcTab` stateとタブUI（JSX・CSS）を削除
  - 決まり手・推移・レース一覧のJSXブロックを、`vcTab`分岐を外して常時表示に変更
  - `vcData`は会場・枠番が両方`"all"`の場合も`aggregateRacerVenueBoatStats(history, null, null, grade, stage)`で全体集計を計算し、決まり手・推移・レース一覧に使う
  - 旧来の`showTechniqueSection`（unfiltered専用）・`!vcActive`分岐は不要になるため削除

- [ ] **Task 12: 実データでの動作確認**
  - Playwrightで以下を確認: (a) フィルタが最上部に表示される、(b) 会場のみ固定→枠番別一覧に切り替わる、(c) 枠番のみ固定→会場別一覧に切り替わる、(d) 両方固定→単一カードに切り替わる、(e) 一覧テーブルの行クリックでフィルタが更新され成績ブロックが切り替わる、(f) 決まり手・推移・レース一覧が常時表示され、フィルタ変更に応じて内容が更新される、(g) グレード・レース種別も含めた組み合わせで正しく絞り込まれる
  - `npm run build` / `npm run test:e2e`
