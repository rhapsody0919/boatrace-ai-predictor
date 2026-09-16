# タスク分解

対応: [spec.md](./spec.md) / [screens.md](./screens.md) / [plan.md](./plan.md) / [ADR-0061](../../adr/0061-racer-page-grade-stage-filter-approach.md) / [ADR-0062](../../adr/0062-racer-page-filtered-view-tabs.md)

- [ ] **Task 1: `getRacerRaceHistory` を拡張し、グレード・レース種別・レース名・複勝配当を取得・返却する**
  - `src/services/supabaseDataService.js` の `getRacerRaceHistory(racerId)`
  - `races` のSELECT列に `race_grade` を追加
  - `race_conditions` を新規 `fetchAllByIn("race_conditions", "race_id, race_stage, race_title", "race_id", raceIds)` で取得し、`race_id` をキーにした `Map` でJOIN
  - `race_results` のSELECT列に `payout_place_1, payout_place_2` を追加
  - 返却する各エントリに `raceGrade`・`raceStage`・`raceTitle`・`payoutPlace1`・`payoutPlace2` を追加

- [ ] **Task 2: `aggregateRacerVenueBoatStats` を拡張し、グレード・レース種別フィルタと新規指標に対応する**
  - 同ファイルの `aggregateRacerVenueBoatStats(history, venueCode, boatNumber)` に `raceGrade`・`raceStage` 引数を追加（完全一致、`null`は絞り込みなし）
  - 複勝回収率の算出（既存の`getRacerBoatReturnRate`と同じ「艇番がrank1/rank2と一致する場合にpayout_place_1/2を採用」ロジック）
  - 平均ST・平均展示タイムの算出（既存の`series`配列からの単純平均）
  - 絞り込み後のレコード配列（`matchedRaces`、raceId・raceTitle・venueCode・raceGrade・raceStage・boatNumber・startTiming・rank1-3・winningTechnique・payoutWinを含む）を返り値に追加
  - サンプル数閾値は追加しない
  - 純粋関数であることを維持（ネットワークI/O追加なし）

- [ ] **Task 3: `RacerPerformanceStats.jsx` にグレード・レース種別のフィルタUIを追加する**
  - `vcGrade`・`vcStage` state追加（初期値 `"all"`）
  - `vcActive` 判定式に2軸を追加
  - `.racer-vc-filter.controls-section` 内に「グレード」（全グレード/一般戦/G1/G2/G3/SG）・「レース種別」（全レース/優勝戦/準優勝戦）の `<select>` を、既存クラスで追加
  - `vcLabel` 生成ロジックを4軸対応に拡張
  - `vcData` の `useMemo` 依存配列に `vcGrade`・`vcStage` を追加

- [ ] **Task 4: 絞り込み結果をタブ化する（概要／決まり手／推移）**
  - `vcTab` state追加（初期値 `"overview"`）
  - タブナビゲーションUIを追加（新規CSS: `.racer-vc-tabs`等）
  - 「概要」パネル: 既存カードJSXに複勝回収率・平均ST・平均展示タイムのカードを追加
  - 「決まり手」パネル: 既存`showTechniqueSection`ブロックをそのまま移動
  - 「推移」パネル: 既存の「展示タイムの推移」「STの推移」グラフをそのまま移動
  - 各パネルの表示/非表示は`vcTab`で制御し、既存の表示条件（`vcData.n > 0`等）は変更しない

- [ ] **Task 5: レース一覧タブを新規実装する**
  - `vcRacePage` state追加（初期値1、フィルタ変更時に1へリセット）
  - `vcData.matchedRaces`を`vcRacePage`でスライスして表を表示（列: 日付・会場・R・レース名・グレード・レース種別・枠番・ST・着順・決まり手・単勝配当）
  - 各行を`<Link to={`/race/${race.raceId}`}>`でレース詳細ページへリンク
  - ページャー（1ページ10件、前へ/次へ、新規CSS: `.racer-vc-pager`）
  - 0件時は既存の「該当する出走がありません」表示を使う

- [ ] **Task 6: 実データでの動作確認**
  - 本番Supabaseで、優勝戦・準優勝戦にヒットする選手・グレードの組み合わせを事前に確認する
  - Playwrightで以下を確認: (a) 初期状態（4軸とも未選択）が現状の表示と変わらないこと、(b) グレード単独選択、(c) レース種別単独選択（優勝戦/準優勝戦それぞれ）、(d) 4軸すべて選択、(e) 該当0件時の表示、(f) 4タブそれぞれの表示内容、(g) レース一覧の行からレース詳細ページへの遷移、(h) レース一覧が10件を超える場合のページング
  - `npm run build` / `npm run test:e2e`
