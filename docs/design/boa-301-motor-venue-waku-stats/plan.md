# モーター単体の会場内比較・枠番別成績 plan

対応: [spec.md](./spec.md) / [screens.md](./screens.md)

## データ設計

**結論: 新規テーブル・新規マイグレーションは不要。** 必要な生データは既存テーブルに全て存在し、FR-1〜FR-4はいずれも「1会場×1モーター」に絞り込んだ範囲のクエリで完結する（下記ADR-0060参照）。

| FR | データソース | クエリの形 |
|---|---|---|
| FR-1（会場内ランキング） | `venue_motor_stats` | `WHERE venue_code = ?`で同一会場の全モーター（最大24機程度）を取得し、指標（`win_rate`/`top2_rate`/`top3_rate`）でソートして順位を算出。**新規データ不要** |
| FR-2（枠番別1着率/2連率/3連率） | `race_entries`（`motor_number`, `boat_number`, `race_id`）× `race_results`（`rank1`〜`rank6`） | `WHERE venue_code = ? AND motor_number = ?`で対象モーターの全出走を取得し、コース列（下記参照）でグルーピングして集計 |
| FR-3（枠番別展示タイム推移） | `exhibition_data`（`race_id`, `boat_number`, `exhibition_time`） | FR-2と同じ絞り込み＋日付順に並べてスパークライン用の配列を返す |
| FR-4（選手×モーター×枠） | FR-2と同じJOINに`race_entries.racer_id`を追加 | `GROUP BY racer_id, コース列`。サンプル数がn<6になるケースを想定し、常にnを返す |

### コース列の扱い（BOA-257実装中を踏まえた抽象化）

BOA-257（進入コース精度改善）が別Agentで実装中のため、この機能のクエリ層は「コース列」を固定の`boat_number`ではなく**設定可能な列名**として実装する（例: `getMotorWakuStats(venueCode, motorNumber, { courseColumn: 'boat_number' })`のように、BOA-257がリリースされ次第`actual_course`に切り替えられる形にする）。UIコンポーネント側（`MotorWakuStatsGrid`等）は「コース番号」という抽象的なpropを受け取るだけで、どちらの列由来かを意識しない設計にする（screens.md参照）。

### モーター交換（BOA-329）への当面の対応

BOA-329の対応（使用開始日の記録等）が別途検証中で未確定のため、本機能では**暫定的に「直近180日」に集計ウィンドウを絞る**ことでリスクを緩和する（180日は既存の`getRacerVenueStats`等の会場別集計と同じ窓を踏襲し、一貫性を持たせる）。ウィンドウ内でモーター交換をまたぐ可能性は残るため、UIに「集計期間: 直近180日」という表記を必ず添える（数値の出所を明示する、[[feedback_ui_visualization_over_statistical_rigor]]の「可視化を止めない」方針と両立させる）。BOA-329の対応が完了次第、正確な使用開始日を起点にした窓に切り替える。

## コンポーネント構成・データフロー

screens.mdの一覧を前提に、データフローは以下の通り:

```
MotorConditionChart（embedded有無で表示範囲を分岐）
  ├─ 既存: MotorStatBadgeRow（badgesにFR-1の順位バッジを追加）
  ├─ 既存: MotorRecordStatCards（据え置き）
  ├─ 新規: MotorWakuStatsGrid
  │    ├─ embedded=true: 今日の艇番の行のみ強調、タップで全6コース展開
  │    └─ embedded=false: 常に全6コース表示
  └─ 新規: MotorRacerWakuDrillDown（DrillDownHeaderを流用）
       └─ MotorWakuStatsGridの特定コース行タップで開く
```

`supabaseDataService.js`に追加する関数（いずれも1会場×1モーターに絞り込んだクエリ、既存の`getRacerVenueStats`と同じ「単一エンティティ範囲ならライブ集計してよい」規約に従う）:

- `getVenueMotorRanking(venueCode, metric)` — FR-1
- `getMotorWakuStats(venueCode, motorNumber, { courseColumn })` — FR-2/FR-3
- `getMotorRacerWakuStats(venueCode, motorNumber, { courseColumn })` — FR-4

## 既存サービス層・共通ライブラリとの連携

- `getVenueMotorRanking`は`venue_motor_stats`の最新1件（スクレイピング日ベース）を使う。既存の`getVenueMotorStats`（`supabaseDataService.js:2609`、最新1件スナップショット取得）と同じテーブルを参照するため、内部で共通化できないか実装時に確認する
- `useVenueRaceSelector`フック（`MotorConditionChart.jsx`が既に使用）はそのまま流用し、新規フックは作らない

## 実装前提の確認事項（実装着手時に再確認）

- `docs/db-migration/`の最新番号は本plan.md作成時点で062（`062_race_odds_all_combinations.sql`、FR-4未実装の草案）。本機能は新規マイグレーション不要のため採番は発生しない想定だが、実装時に前提が変わっていないか確認する

## ADR

[ADR-0060: モーター単体集計はライブ計算とする（会場横断ランキングとは規模が異なる）](../../adr/0060-motor-stats-live-query-scope.md)
