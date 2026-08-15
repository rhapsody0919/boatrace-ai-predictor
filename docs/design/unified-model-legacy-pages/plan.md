# 旧3モデル依存ページのunified一本化 plan

## データ設計

### 展開予測的中の永続化（ADR 0013）
`docs/db-migration/033_add_is_hit_turn_to_predictions.sql`で`predictions.is_hit_turn`カラムを追加する。`scripts/lib/hitCalculator.js`に判定関数を追加し、`scripts/daily/scrape-results.js`の結果反映処理（`is_hit_place`計算と同じ箇所）で計算・保存する。

過去分（2026-08-11のunified運用開始〜マイグレーション適用日）はNULLのままになるため、`scripts/maintenance/backfill-is-hit-turn.js`（新規、一度きりのバックフィルスクリプト）で既存の確定済みレースに対して一括計算・更新する。

### accuracy_cache（既存キーの拡張、新規マイグレーション不要）
- `unified_model_accuracy`（`scripts/daily/calculate-unified-model-accuracy.js`が更新）: 既に`turn.hitRate`（全体の展開予測的中率）を保持している。FR-2の主役指標にそのまま使える
- `unified_volatility_accuracy`（`scripts/daily/calculate-unified-volatility-accuracy.js`が更新）: 現状`{baseline, byLevel}`のみ。FR-2の「会場別イン崩れ傾向」のために`byVenue`（会場別のイン崩れ率・全体差分）を追加する。計算ロジックは旧`calculate-accuracy.js`の`calculateVolatilityStats()`の`byVenue`集計を、unifiedモデルの`predictions.feature_contributions.volatilityPercentile`ベースに移植する

いずれも`key/data/updated_at`の汎用JSONBキャッシュテーブルのため、スキーマ変更は不要。`data`のJSON構造を変更するだけ。

### race_history_cache（データ構造の刷新）
現行: `data.days[] = { date, totalRaces, finishedRaces, models: [{ modelId, finishedRaces, winHits, winPayouts, placeHits, placePayouts, trifectaHits, trifectaPayouts, trioHits, trioPayouts }] }`

変更後: `data.days[] = { date, totalRaces, finishedRaces, turnRaces, turnHits, turnHitRate }`（モデル別内訳を廃止し、unifiedの展開予測的中のみのフラットな構造にする）

`scripts/daily/update-race-history-cache.js`を改修し、`predictions`の`is_hit_turn`カラム（マイグレーション後）を`model_id='unified'`条件でCOUNTする方式に変更する。旧`fetchPredictionsRange()`が取得していた`is_hit_win/is_hit_place/is_hit_trifecta/is_hit_trio/payout_*`は不要になるため取得列から削除する。

**この変更はスキーマ変更のため、マイグレーション033の適用後にバッチとフロントを同一PRでデプロイする必要がある**（`race_history_cache`の`data`構造が変わるため、フロント側の読み取りロジックも同時に変える）。

## コンポーネント構成・データフロー

### FR-1: /hit-races
```
HitRaces.jsx
  → dataService.getPredictions(date) （既存、変更なし）
  → extractHitRaces(predictions) 内で is_hit_turn を判定基準に変更
     - 本日・昨日: race.result確定済みなら is_hit_turn を直接参照（DBに保存済みならそれを使う。
       未保存＝マイグレーション未適用期間のデータの場合のみ、フォールバックとして
       turnPrediction.patternsからのオンザフライ計算を行う）
  → HitRaceCard（0から再設計、展開予測的中1種類のバッジのみ）
  → HitStats / VenueStatsTable（展開予測的中率の集計に作り替え）
```

### FR-2: /accuracy
```
AccuracyDashboard.jsx
  → dataService.getUnifiedModelAccuracy() （既存関数、そのまま使う） … 全体の展開予測的中率
  → dataService.getUnifiedVolatilityAccuracy() （既存関数、そのまま使う） … 会場別イン崩れ傾向（byVenue追加後）
  → 旧ModelSelector/StatsTable/RecoveryTrendChart/VenueStrategyTable/VenueDetailedAnalysisは削除
  → VolatilityAccuracySection.jsx を byVenue 表示に拡張
```
`dataService.getAccuracy()`（旧3モデル前提の巨大関数、BOA-193で並列化済みだが構造自体は旧モデル前提）は、/accuracyページからの直接利用をやめる。他ページ（`AccuracyHistory.jsx`）からの利用は残るため、関数自体の削除はしない。

### FR-3: /races一覧
```
scripts/daily/update-race-history-cache.js（改修）
  → predictions（is_hit_turn, model_id='unified'）+ races を突き合わせ
  → race_history_cache.data を新構造で upsert
  ↓
api/race-history/summary.js（Edge Function） … data構造非依存のプロキシのため変更不要
  ↓
supabaseDataService.getRaceHistorySummary(days)（既存、変更不要。返り値の中身が変わるだけ）
  ↓
RaceHistory.jsx（改修） … 新構造（turnHitRate）を表示するUIに作り替え
```

## 既存サービス層・共通ライブラリとの連携

- `scripts/lib/supabaseClient.js`の`fetchAll`（ページネーション付き全件取得）を`update-race-history-cache.js`の改修でも継続利用
- `scripts/lib/hitCalculator.js`に`is_hit_turn`計算関数を追加し、`scrape-results.js`から呼び出す（既存の`is_hit_place`計算と同じファイル・同じ関数群に統合）
- `src/services/supabaseDataService.js`の`withCache`パターンを踏襲。新規データ取得は発生しない（既存の`getUnifiedModelAccuracy`/`getUnifiedVolatilityAccuracy`/`getRaceHistorySummary`を使い回す）ため、サービス層への新規関数追加は不要見込み

## ADR

- [ADR 0013: 展開予測的中判定の永続化方式](../../adr/0013-turn-hit-judgment-persistence.md) — `is_hit_turn`カラム新設・結果反映バッチでの一括計算方式を採用

## 実行タイミング・デプロイ順序

1. マイグレーション033（`predictions.is_hit_turn`追加）をユーザーが手動適用
2. `hitCalculator.js`・`scrape-results.js`の改修をデプロイ（今後の結果反映から`is_hit_turn`が入り始める）
3. `scripts/maintenance/backfill-is-hit-turn.js`を一度実行し、過去分（2026-08-11〜）をバックフィル
4. `update-race-history-cache.js`・`calculate-unified-volatility-accuracy.js`（byVenue追加）の改修とフロント側（3ページ）の改修を同一PRでデプロイ
