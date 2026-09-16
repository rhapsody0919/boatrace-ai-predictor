# システム設計

対応spec: [spec.md](./spec.md) / 画面設計: [screens.md](./screens.md)

技術方針の詳細な比較検討は [ADR-0061](../../adr/0061-racer-page-grade-stage-filter-approach.md)（4軸フィルタの実現方式）・[ADR-0063](../../adr/0063-racer-page-cross-tab-and-always-on-detail.md)（フィルタ配置転換・会場×枠番クロス集計・常時表示化）を参照。[ADR-0062](../../adr/0062-racer-page-filtered-view-tabs.md)（タブ化）はSupersededのため、以下の記述はADR-0063を反映した内容に更新済み。

## データ設計

新規マイグレーション・新規テーブル・新規RPCは**不要**。既存カラムをそのまま使う。

| データ | テーブル・カラム | 備考 |
|---|---|---|
| グレード | `races.race_grade` | コード値 `ippan`/`G1`/`G2`/`G3`/`SG`。2026-02以降のレースにのみ値がある |
| レース種別 | `race_conditions.race_stage` | 「優勝戦」「準優勝戦」の完全一致のみ使用。2026-02-03以降のレースにのみ値がある |
| レース名 | `race_conditions.race_title` | 充足率99.96%。レース一覧の表示列に使う |
| 複勝配当 | `race_results.payout_place_1`・`payout_place_2` | 既存の`getRacerBoatReturnRate`と同じ「艇番と`rank1`/`rank2`の一致判定」ロジックを流用 |

`race_conditions` と `races`/`race_entries` の結合キーは `race_id`（既存の `races`/`race_results`/`exhibition_data` と同じ結合パターン）。

## データフロー

```
選手ページ表示
  └─ RacerPerformanceStats.jsx（会場×枠番フィルタのみ既存表示、grade/stage未選択時は現状と同じ）

フィルタ操作（会場・枠番・グレード・レース種別のいずれか選択）
  └─ vcActive = true になった時点で1回だけ:
       supabaseDataService.getRacerRaceHistory(racerId)
         ├─ race_entries から対象選手の出走一覧を取得（既存）
         ├─ races から race_id, venue_code, race_grade を取得（race_grade を追加）
         ├─ race_conditions から race_id, race_stage, race_title を取得（新規fetchAllByIn）
         ├─ race_results から着順・単勝配当・複勝配当(payout_place_1/2)を取得（列を追加）
         └─ exhibition_data から展示情報(ST・展示タイム)を取得（既存）
       → 履歴配列（各要素に raceGrade・raceStage・raceTitle・payoutPlace1/2 を追加）を返却、racerId単位でキャッシュ

以後のフィルタ変更（会場/枠番/グレード/レース種別いずれの組み合わせでも）
  └─ 追加の通信なしにフロント側（ブラウザ内）で再集計。venue/boatの固定状況で呼ぶ関数が変わる:

     【会場・枠番どちらも固定、またはどちらも未固定】
       aggregateRacerVenueBoatStats(history, venue, boat, grade, stage) で単一集計:
         ├─ 概要カード用の集計値（勝率・2連率・3連率・単勝/複勝回収率・平均ST・平均展示タイム）
         ├─ 決まり手内訳（既存ロジック、tech オブジェクト）
         ├─ 推移用シリーズ（既存ロジック、ST・展示タイムの時系列配列）
         └─ 絞り込み後のレコード配列そのもの（レース一覧用、raceId・raceTitle等を保持）
       venue/boatどちらも未固定の場合は「決まり手・推移・レース一覧」表示にのみ使う
       （成績ブロックは既存propsのvenueStats/aggregatedStatsをそのまま使う、変更なし）

     【会場のみ固定、枠番は未固定】
       aggregateRacerCrossStats(history, {venueCode}, "boat", grade, stage) で
       枠番別グループ化配列を返す（成績ブロック用）
       + aggregateRacerVenueBoatStats(history, venueCode, null, grade, stage) で
       決まり手・推移・レース一覧用の単一集計も並行して計算

     【枠番のみ固定、会場は未固定】
       aggregateRacerCrossStats(history, {boatNumber}, "venue", grade, stage) で
       会場別グループ化配列を返す（成績ブロック用）
       + aggregateRacerVenueBoatStats(history, null, boatNumber, grade, stage) で
       決まり手・推移・レース一覧用の単一集計も並行して計算

  → 決まり手・推移・レース一覧は常時表示（タブ切り替えなし）。一覧テーブルの行クリックは
    setVcVenue/setVcBoatを呼ぶだけで、上記の再集計が自動的に走る
```

## コンポーネント構成

### `src/services/supabaseDataService.js`

- **`getRacerRaceHistory(racerId)`**（既存関数の拡張）
  - `races` のSELECT列に `race_grade` を追加
  - `race_conditions` の新規 `fetchAllByIn("race_conditions", "race_id, race_stage, race_title", "race_id", raceIds)` を追加
  - `race_results` のSELECT列に `payout_place_1, payout_place_2` を追加
  - 返却する各エントリに `raceGrade`・`raceStage`・`raceTitle`・`payoutPlace1`・`payoutPlace2` を追加

- **`aggregateRacerVenueBoatStats(history, venueCode, boatNumber, raceGrade, raceStage)`**（既存関数の拡張、両方固定or両方未固定の単一集計用）
  - 既存の `venueCode`/`boatNumber` によるフィルタ条件に、`raceGrade`・`raceStage`（完全一致、`null`は絞り込みなし）を追加
  - 返り値に以下を追加:
    - `placeReturnRate`（複勝回収率。`getRacerBoatReturnRate`と同じ「自艇の艇番がrank1またはrank2と一致する場合にpayout_place_1/2を採用」ロジック）
    - `avgStartTiming`・`avgExhibitionTime`（既存の`series`配列から算出可能な平均値。新規に平均計算のみ追加）
    - `matchedRaces`（絞り込み条件に合致したレコードそのものの配列。既存の集計元データを外に出すだけで、新規のクエリ・集計ロジックは不要）
  - サンプル数閾値は追加しない
  - 純粋関数のまま維持

- **新規 `aggregateRacerCrossStats(history, fixed, groupBy, raceGrade, raceStage)`**（ADR-0063、会場・枠番の一方のみ固定時のクロス集計用）
  - `fixed`: `{ venueCode }` または `{ boatNumber }` のいずれか一方
  - `groupBy`: `"venue"` または `"boat"`（固定していない方）
  - `history` を `fixed`・`raceGrade`・`raceStage` で絞り込んだ後、`groupBy` の値ごとにグループ化し、グループごとに `n`/`win`/`top2`/`top3`（既存の `isPlaceHit`/`isShowHit` を再利用）を計算した配列を返す
  - 既存の会場別成績（`getRacerVenueStats`、5走未満非表示）とは別のクエリ経路のため、閾値を適用するかは`aggregateRacerVenueBoatStats`の他フィールドと同じ方針（FR-4により適用しない）
  - 純粋関数（I/O無し）

### `src/components/racer/RacerPerformanceStats.jsx`

- 既存 state `vcVenue`/`vcBoat`/`vcGrade`/`vcStage`・`vcRacePage`はそのまま維持
- **`vcTab` stateを削除**（タブ廃止、ADR-0063）
- フィルタJSXブロックをコンポーネントの先頭（見出し直下）に移動
- 成績ブロックを新規実装: `vcVenue`/`vcBoat`の`"all"`判定で4分岐するレンダリング関数（または条件付きJSX）
  - 両方`"all"`: 既存の会場別一覧・枠番別一覧（`venueStats`/`courseStats`）をそのまま使うが、行に`onClick={() => setVcVenue(row.venue_code)}`等を追加
  - 片方のみ固定: `aggregateRacerCrossStats`の結果をテーブル表示、行クリックで残りの軸を確定
  - 両方固定: 既存の7カードJSX（BOA-159で実装済み）を再利用
- 決まり手・推移・レース一覧のJSXブロックを、`vcTab`分岐を外して常時表示に変更（`vcData`は`vcVenue`/`vcBoat`が`"all"`でも`aggregateRacerVenueBoatStats(history, null, null, grade, stage)`で計算した全体集計を使う）
- `vcLabel` 生成ロジックは維持（4軸対応、既存のまま）

### `src/components/racer/RacerPerformanceStats.css`

- **タブUI関連CSSを削除**（`.racer-vc-tabs`, `.racer-vc-tab-button`等、ADR-0063）
- 既存の会場別/枠番別一覧テーブルの行に、クリック可能であることを示すCSS（cursor: pointer、hover背景）を追加。既存の`.racer-vc-race-list`のリンク色パターンを参考にする
- ページャー（`.racer-vc-pager`）はレース一覧が常時表示に変わっても引き続き使うため維持

### 変更不要

- `getRacerFormTrend`（全国勝率推移、フィルタの影響を受けない概要カード扱い）
- `src/utils/raceId.js`（既存の`raceId`文字列をそのまま使うため変換不要）
- `src/AppRouter.jsx`のレース詳細ルート（既存の`race/:raceId`をそのまま使う）
- `getRacerVenueStats`・`aggregatedStats.course_race_counts`（会場・枠番どちらも未固定時にそのまま使う既存の事前集計）

## 既存サービス層・共通ライブラリとの連携

- `fetchAllByIn` は既存共通ヘルパーをそのまま使う
- キャッシュ機構（`withCache`、`racer-race-history-${racerId}` キー）は変更しない
- グラフ描画は既存の`recharts`（`LineChart`等）をそのまま使う。新規チャートライブラリは導入しない

## 実装順序（`/step3` でタスク分解する際の目安）

**Phase 1（実装済み、PR #686・ADR-0061/0062）**
1. `getRacerRaceHistory` の拡張（race_grade・race_conditions JOIN・payout_place_1/2追加）
2. `aggregateRacerVenueBoatStats` の拡張（grade/stageフィルタ、複勝回収率・平均ST/展示タイム・matchedRaces追加）
3. `RacerPerformanceStats.jsx` のフィルタUI拡張（vcGrade/vcStage追加）
4. タブ化（vcTab追加）、レース一覧の実装

**Phase 2（本改訂、ADR-0063）**
5. フィルタブロックを見出し直下・最上部に移動
6. `aggregateRacerCrossStats`（会場×枠番クロス集計）を新規実装
7. 成績ブロックの4分岐レンダリング実装（既存一覧＋新規クロス集計一覧＋既存単一カード）
8. 一覧テーブル（既存2種＋新規2種）の行クリック→フィルタ反映を実装
9. 決まり手・推移・レース一覧を常時表示化（`vcTab`・タブUI・タブ専用CSSを削除）
10. 実データでの動作確認（4分岐すべて、行クリック連携、常時表示セクション）
