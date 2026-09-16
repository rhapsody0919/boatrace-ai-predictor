# 画面・コンポーネント洗い出し

対応spec: [spec.md](./spec.md) / UI/UX方針: [ADR-0062](../../adr/0062-racer-page-filtered-view-tabs.md)

## 影響する画面・コンポーネント

### 1. `src/components/racer/RacerPerformanceStats.jsx`（既存コンポーネントの拡張）

選手ページ（`/racer/:racerId`）の「成績・調子」セクション本体。

#### フィルタ部分（既存拡張）

会場×枠番フィルタ（`vcVenue`/`vcBoat` state）に、グレード（`vcGrade`）・レース種別（`vcStage`）のselectを追加。4軸を同時にAND条件で絞り込む。

#### 絞り込み結果（`vcActive`時）: タブに再構成

現状は「カード → 決まり手傾向 → 展示タイム推移 → STの推移」の順で縦積み表示している（532-681行目）。これを新規タブ（`vcTab` state、初期値 `"overview"`）で切り替える構成に変更する。

| タブ | 内容 | 実装方針 |
|---|---|---|
| 概要 | 勝率・2連率・3連率・単勝回収率・複勝回収率・平均ST・平均展示タイムのカード（既存532-571行目を拡張） | `aggregateRacerVenueBoatStats` の返り値に3指標を追加するだけ。JSX構造は既存パターンのまま |
| 決まり手 | 既存の`showTechniqueSection`ブロック（579-623行目）をそのまま移動 | ロジック変更なし、位置のみ変更 |
| 推移 | 既存の「展示タイムの推移」（627-653行目）・「STの推移」（655-681行目）をそのまま移動 | ロジック変更なし、位置のみ変更 |
| レース一覧 | 新規。絞り込み条件に合致するレースの表＋ページング＋レース詳細へのリンク | 新規実装（下記） |

未選択時（`vcActive === false`）のフラット表示（会場別/枠番別テーブル、unfiltered版の決まり手傾向・推移グラフ）は変更しない。

#### レース一覧タブ（新規）

- 列: 日付・会場・R・レース名（`race_conditions.race_title`）・グレード・レース種別・枠番・ST・着順・決まり手・単勝配当
- 各行: `<Link to={`/race/${race.raceId}`}>` で `RaceDetailPage`（`src/AppRouter.jsx`の既存ルート`race/:raceId`）へ遷移
- ページング: 1ページ10件、前へ/次へボタン（新規の軽量なページャー、既存に similar なパターンは無いため最小限のstateで実装）

### 2. `src/services/supabaseDataService.js`（サービス層の拡張）

- **`getRacerRaceHistory(racerId)`**: `races.race_grade`、`race_conditions.race_stage`・`race_title`、`race_results.payout_place_1`・`payout_place_2` を追加取得
- **`aggregateRacerVenueBoatStats(...)`**: `raceGrade`・`raceStage` によるフィルタ、複勝回収率・平均ST・平均展示タイムの算出、絞り込み後のレコード配列（レース一覧用）を返り値に追加

### 3. `src/utils/raceId.js`（変更不要、既存関数を利用）

`getRacerRaceHistory` が既に保持する `raceId`（`race_entries.race_id`由来）をそのまま`/race/${raceId}`に使う。`parseRaceId`/`getRaceId`の変換は不要（既に完成した形式で保持されている）。

### 4. `src/components/racer/RacerPerformanceStats.css`（新規CSSが必要）

- タブUI: 新規クラス（`.racer-vc-tabs`, `.racer-vc-tab-button` 等）。既存デザイントークン（`--brand-accent-primary`、`--text-secondary`、`--border-hairline`）を使用し、下線タブ形式（モックと同じ見た目）にする
- レース一覧テーブル: 既存の`.racer-return-rate-table`クラスを再利用可能（会場別/枠番別テーブルと同じ見た目にする）
- ページャー: 新規クラス（`.racer-vc-pager`）
- レース名列が長い場合の折り返し/省略: `.table-wrapper`の`overflow-x: auto`は既存流用、セル自体は`white-space: nowrap`にはしない（レース名が長いため、モックとは異なりここは折り返し可能にする）

## デザイントークンで表現できる部分 / 新規CSSが必要な部分

| 部分 | 対応 |
|---|---|
| フィルタのレイアウト（flex-wrap、gap） | 既存 `.racer-vc-filter.controls-section` で対応済み（変更不要） |
| select自体の見た目 | 既存 `.venue-select` クラスをそのまま適用（変更不要） |
| カードグリッド | 既存 `.racer-stat-cards-grid`/`.racer-stat-card` を7枚に拡張してそのまま使う（変更不要、枚数のみ増加） |
| タブUI | 新規CSS（下線タブ、アクセントカラーは`--brand-accent-primary`） |
| レース一覧テーブル | 既存 `.racer-return-rate-table` を流用 |
| ページャー | 新規CSS（最小限、既存ボタンスタイルに準拠） |

新規コンポーネントファイルは作らない（`RacerPerformanceStats.jsx`内の拡張で完結）。
