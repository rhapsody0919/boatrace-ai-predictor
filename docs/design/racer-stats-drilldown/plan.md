# システム設計

対応spec: [spec.md](./spec.md) / 画面設計: [screens.md](./screens.md)

技術方針の詳細な比較検討は [ADR-0061](../../adr/0061-racer-page-grade-stage-filter-approach.md)（4軸フィルタの実現方式）・[ADR-0062](../../adr/0062-racer-page-filtered-view-tabs.md)（タブ化の設計判断）を参照。

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
  └─ 追加の通信なしに aggregateRacerVenueBoatStats(history, venue, boat, grade, stage) で
     フロント側（ブラウザ内）で再集計:
       ├─ 概要カード用の集計値（勝率・2連率・3連率・単勝/複勝回収率・平均ST・平均展示タイム）
       ├─ 決まり手内訳（既存ロジック、tech オブジェクト）
       ├─ 推移用シリーズ（既存ロジック、ST・展示タイムの時系列配列）
       └─ 絞り込み後のレコード配列そのもの（レース一覧タブ用、raceId・raceTitle等を保持）
     → vcData を更新 → タブ切り替えは追加I/Oなしでこの1つのvcDataを出し分けるだけ
```

## コンポーネント構成

### `src/services/supabaseDataService.js`

- **`getRacerRaceHistory(racerId)`**（既存関数の拡張）
  - `races` のSELECT列に `race_grade` を追加
  - `race_conditions` の新規 `fetchAllByIn("race_conditions", "race_id, race_stage, race_title", "race_id", raceIds)` を追加
  - `race_results` のSELECT列に `payout_place_1, payout_place_2` を追加
  - 返却する各エントリに `raceGrade`・`raceStage`・`raceTitle`・`payoutPlace1`・`payoutPlace2` を追加

- **`aggregateRacerVenueBoatStats(history, venueCode, boatNumber, raceGrade, raceStage)`**（既存関数の拡張）
  - 既存の `venueCode`/`boatNumber` によるフィルタ条件に、`raceGrade`・`raceStage`（完全一致、`null`は絞り込みなし）を追加
  - 返り値に以下を追加:
    - `placeReturnRate`（複勝回収率。`getRacerBoatReturnRate`と同じ「自艇の艇番がrank1またはrank2と一致する場合にpayout_place_1/2を採用」ロジック）
    - `avgStartTiming`・`avgExhibitionTime`（既存の`series`配列から算出可能な平均値。新規に平均計算のみ追加）
    - `matchedRaces`（絞り込み条件に合致したレコードそのものの配列。既存の集計元データを外に出すだけで、新規のクエリ・集計ロジックは不要）
  - サンプル数閾値は追加しない
  - 純粋関数のまま維持

### `src/components/racer/RacerPerformanceStats.jsx`

- 既存 state `vcVenue`/`vcBoat` と同じパターンで `vcGrade`・`vcStage` を追加
- 新規 state `vcTab`（初期値 `"overview"`、`"technique"`/`"trend"`/`"races"` の4値）
- 新規 state `vcRacePage`（レース一覧のページ番号、初期値1。フィルタが変わったら1にリセット）
- `vcActive` 判定式を4軸に拡張
- `.racer-vc-filter.controls-section` 内にグレード・レース種別の `<select>` を追加
- `vcActive`時のJSXを、既存の縦積み（カード→決まり手→展示タイム推移→ST推移）から、タブナビゲーション＋4パネル（概要／決まり手／推移／レース一覧）に再構成
  - 概要パネル: 既存カードJSXを拡張（複勝回収率・平均ST・平均展示タイムのカードを追加）
  - 決まり手パネル: 既存`showTechniqueSection`ブロックをそのまま移動
  - 推移パネル: 既存の展示タイム推移・ST推移の2グラフをそのまま移動
  - レース一覧パネル: 新規。`vcData.matchedRaces`を`vcRacePage`でスライスして表示、`<Link to={`/race/${race.raceId}`}>`でレース詳細へ
- `vcLabel` 生成ロジックを拡張（4軸対応、既存のまま）

### `src/components/racer/RacerPerformanceStats.css`

- 新規: タブUI（`.racer-vc-tabs`, `.racer-vc-tab-button`, `.racer-vc-tab-button.active`）
- 新規: ページャー（`.racer-vc-pager`）
- レース一覧テーブルは既存 `.racer-return-rate-table` を再利用（新規クラス不要）

### 変更不要

- `getRacerFormTrend`・unfiltered版の決まり手傾向・展示タイム推移・STの推移（`vcActive === false`時のJSX）
- 会場別・枠番別の既存テーブル自体
- `src/utils/raceId.js`（既存の`raceId`文字列をそのまま使うため変換不要）
- `src/AppRouter.jsx`のレース詳細ルート（既存の`race/:raceId`をそのまま使う）

## 既存サービス層・共通ライブラリとの連携

- `fetchAllByIn` は既存共通ヘルパーをそのまま使う
- キャッシュ機構（`withCache`、`racer-race-history-${racerId}` キー）は変更しない
- グラフ描画は既存の`recharts`（`LineChart`等）をそのまま使う。新規チャートライブラリは導入しない

## 実装順序（`/step3` でタスク分解する際の目安）

1. `getRacerRaceHistory` の拡張（race_grade・race_conditions JOIN・payout_place_1/2追加）
2. `aggregateRacerVenueBoatStats` の拡張（grade/stageフィルタ、複勝回収率・平均ST/展示タイム・matchedRaces追加）
3. `RacerPerformanceStats.jsx` のフィルタUI拡張（vcGrade/vcStage追加、既存4軸化と同じ）
4. `RacerPerformanceStats.jsx` のタブ化（vcTab追加、既存3セクションの移動＋概要カード拡張）
5. レース一覧タブの新規実装（テーブル・ページング・リンク）
6. CSSの追加（タブ・ページャー）
7. 実データでの動作確認
