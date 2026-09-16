# 画面・コンポーネント洗い出し

対応spec: [spec.md](./spec.md) / UI/UX方針: [ADR-0061](../../adr/0061-racer-page-grade-stage-filter-approach.md)・[ADR-0063](../../adr/0063-racer-page-cross-tab-and-always-on-detail.md)（[ADR-0062](../../adr/0062-racer-page-filtered-view-tabs.md)はSuperseded）

## 影響する画面・コンポーネント

### 1. `src/components/racer/RacerPerformanceStats.jsx`（既存コンポーネントの拡張）

選手ページ（`/racer/:racerId`）の「成績・調子」セクション本体。全体の並び順を以下に変更する。

```
見出し「成績・調子」
フィルタ（会場・枠番・グレード・レース種別、常時表示・最上部）        ← 移動
概要カード（選手調子=全国勝率、平均ST。フィルタの影響を受けない）
────────────────────────────────
成績ブロック（会場・枠番の固定状況で動的切り替え）                    ← 新規ロジック
  ├─ 全×全: 会場別一覧 + 枠番別一覧（既存2テーブル、行クリック可）
  ├─ 会場固定×全: 会場限定の枠番別一覧（新規集計、行クリック可）
  ├─ 全×枠番固定: 枠番限定の会場別一覧（新規集計、行クリック可）
  └─ 会場固定×枠番固定: 単一カード7指標（既存の概要タブ相当）
────────────────────────────────
枠番別回収率（過去180日、既存のまま・変更なし）
決まり手傾向（常時、現在の全フィルタ条件で絞り込み）                  ← タブ廃止・常時表示化
推移（平均ST・平均展示タイムの折れ線、常時、同上）                    ← タブ廃止・常時表示化
レース一覧（常時、同上、ページングあり）                              ← タブ廃止・常時表示化
────────────────────────────────
分析ツールへのリンク
```

#### フィルタ部分（配置転換）

既存の会場×枠番×グレード×レース種別の4軸フィルタ（selectとロジックはBOA-159で実装済み）を、コンポーネントの先頭（見出し直下）に移動する。ロジック自体（`vcVenue`/`vcBoat`/`vcGrade`/`vcStage` state）は変更しない。

#### 成績ブロック（新規ロジック）

`vcVenue`・`vcBoat`の固定状況（`"all"`かどうか）で4パターンに分岐する。

| 会場 | 枠番 | 内容 | データ源 |
|---|---|---|---|
| all | all | 既存の会場別一覧・枠番別一覧（stats propsの`venueStats`/`aggregatedStats.course_race_counts`） | 既存（変更なし） |
| 固定 | all | その会場限定の枠番別一覧 | 新規：`aggregateRacerCrossStats(history, {venueCode}, "boat", grade, stage)` |
| all | 固定 | その枠番限定の会場別一覧 | 新規：`aggregateRacerCrossStats(history, {boatNumber}, "venue", grade, stage)` |
| 固定 | 固定 | 単一カード7指標 | 既存：`aggregateRacerVenueBoatStats`（ADR-0061で拡張済み） |

一覧テーブル（既存2種＋新規クロス集計2種）の各行は`onClick`でフィルタ更新関数（`setVcVenue`/`setVcBoat`）を呼び、クリックした値に絞り込む。

#### 常時表示セクション（タブ廃止）

決まり手・推移・レース一覧は、`vcTab`によるタブ切り替えを廃止し、常に表示する。表示内容は「現在の全フィルタ条件（4軸すべて）」で絞り込んだ単一の内訳（`aggregateRacerVenueBoatStats`の結果、会場・枠番が`"all"`の場合は`venueCode=null`/`boatNumber=null`を渡して全体集計）。

- **決まり手**: 既存の`TechniqueBarLegend`サブコンポーネント（レビュー修正で切り出し済み）をそのまま使う
- **推移**: 既存の展示タイム推移・STの推移グラフをそのまま使う
- **レース一覧**: 既存のテーブル・ページングをそのまま使う

未選択時専用だった`showTechniqueSection`（`!vcActive`分岐）・`!vcActive && exhibitionChartData`分岐は不要になる（常時表示セクションに統合されるため）。

### 2. `src/services/supabaseDataService.js`（サービス層の拡張）

- **新規関数 `aggregateRacerCrossStats(history, fixed, groupBy, raceGrade, raceStage)`**: `fixed`は`{venueCode}`または`{boatNumber}`のどちらか一方、`groupBy`は`"venue"`または`"boat"`（固定していない方の軸）。`history`を`fixed`とグレード・レース種別で絞り込んだ後、`groupBy`でグループ化し、グループごとに`n`/`win`/`top2`/`top3`（既存の`isPlaceHit`/`isShowHit`を再利用）を計算した配列を返す
- **既存の`aggregateRacerVenueBoatStats`**: 変更不要（両方固定の単一集計用として維持）

### 3. `src/components/racer/RacerPerformanceStats.css`

- タブUI（`.racer-vc-tabs`等）は不要になるため削除
- 一覧テーブルの行クリックスタイル: 既存の`.racer-vc-row-highlight`（選択中ハイライト）に加え、クリック可能であることを示すホバースタイルを追加（既存の`.racer-vc-race-list tr`パターンを参考に、cursor: pointer等）
- フィルタの新配置に伴うマージン調整（見出い直下に来るため、既存の`.racer-vc-filter.controls-section`の`margin`値を確認・調整）

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

| 部分 | 対応 |
|---|---|
| フィルタのレイアウト | 既存 `.racer-vc-filter.controls-section` をそのまま使う（配置のみ移動） |
| 一覧テーブル（既存2種+新規2種） | 既存 `.racer-return-rate-table` を流用 |
| 一覧テーブルの行クリック | 新規CSS（cursor: pointer、hover背景。既存`.racer-vc-race-list`のリンク色パターンを参考） |
| カードグリッド | 既存 `.racer-stat-cards-grid`/`.racer-stat-card`（変更不要） |
| 決まり手・推移・レース一覧のセクション見出し | 既存 `.racer-technique-profile`/`.racer-stat-chart` をそのまま使う |

新規コンポーネントファイルは作らない（`RacerPerformanceStats.jsx`内の拡張で完結）。タブUI関連のCSS・stateは削除する。
