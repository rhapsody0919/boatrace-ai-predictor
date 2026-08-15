# 旧3モデル依存ページのunified一本化 tasks

依存順。特記なき限り1タスク=1PR。

## 0. 前提作業（ユーザーアクション）

- [ ] マイグレーション033（`docs/db-migration/033_add_is_hit_turn_to_predictions.sql`）をSupabase Dashboardで手動適用する（Supabase MCPアクセストークン失効中のため。BOA-181/032と同じ運用）

## 1. 展開予測的中の永続化（ADR 0013）

- [ ] **Task 1**: `scripts/lib/hitCalculator.js`に展開予測的中の判定関数を追加し、`scripts/daily/scrape-results.js`の結果反映処理に組み込み、`predictions.is_hit_turn`を保存する（マイグレーション033の適用が前提）
- [ ] **Task 2**: `scripts/maintenance/backfill-is-hit-turn.js`を新規作成し、unified運用開始（2026-08-11）〜現在までの確定済みレースに対して`is_hit_turn`を一括計算・更新する。実行後、件数・的中率をログ出力して検証する（Task 1完了・マイグレーション適用後に実行）

## 2. BOA-178: /races一覧のunified一本化

- [ ] **Task 3**: `scripts/daily/update-race-history-cache.js`を改修し、`race_history_cache.data`を新構造（`days[] = {date, totalRaces, finishedRaces, turnRaces, turnHits, turnHitRate}`）で保存するよう変更。旧モデル別集計ロジックを削除（Task 1に依存、`is_hit_turn`カラムを参照するため）
- [ ] **Task 4**: `src/pages/RaceHistory.jsx`（+ `.css`）を新しい`race_history_cache`構造に合わせて改修。日付カードの表示指標を展開予測的中率1つに簡素化。i18n 4言語のキー追加。Task 3と同一PRでデプロイする（データ構造変更のため片方だけのデプロイは不整合を招く）
- [ ] **Task 5**: `/races`一覧のe2eスモークテストを新UIに追随修正

## 3. BOA-175: /accuracyのunified一本化

- [ ] **Task 6**: `scripts/daily/calculate-unified-volatility-accuracy.js`を改修し、`accuracy_cache.unified_volatility_accuracy`に会場別内訳（`byVenue`）を追加する。旧`calculate-accuracy.js`の`calculateVolatilityStats()`の`byVenue`集計ロジックをunifiedモデル向けに移植する
- [ ] **Task 7**: `src/components/accuracy/VolatilityAccuracySection.jsx`（+ `.css`）を`byVenue`表示に対応させる。`src/components/analysis/VolatilityAccuracyChart.jsx`（BOA-177、`/winning-technique`）との表示ロジック共通化を検討し、共通化できる部分は切り出す
- [ ] **Task 8**: `src/components/AccuracyDashboard.jsx`を再設計。旧3モデルタブ・回収率カラムを削除し、`dataService.getUnifiedModelAccuracy()`の展開予測的中率を主役指標に据えたレイアウトに作り替える。`src/components/accuracy/ModelSelector.jsx`・`StatsTable.jsx`・`RecoveryTrendChart.jsx`・`VenueStrategyTable.jsx`・`VenueDetailedAnalysis.jsx`を削除。i18n 4言語のキー追加
- [ ] **Task 9**: `/accuracy`のe2eスモークテストを新UIに追随修正

## 4. BOA-174: /hit-racesのunified一本化

- [ ] **Task 10**: `src/components/HitRaces.jsx`の`extractHitRaces()`を展開予測的中1種類の判定に書き換え（`is_hit_turn`優先、未保存の場合のみ`feature_contributions`からのフォールバック計算）。`selectedModel` state・`MODEL_KEYS`ループを削除
- [ ] **Task 11**: `src/components/hits/HitRaceCard.jsx`を0から再設計（展開予測的中のみの新レイアウト）。`src/components/hits/HitStats.jsx`・`VenueStatsTable.jsx`を展開予測的中率の集計に作り替え。i18n 4言語のキー追加
- [ ] **Task 12**: `/hit-races`のe2eスモークテストを新UIに追随修正

## 5. 後片付け（3ページの置き換え完了後）

- [ ] **Task 13**: `src/pages/AccuracyHistory.jsx`の`ModelComparisonTable`利用箇所を、表示マークアップのページ内インライン化に置き換える（表示内容・凍結アーカイブとしての位置づけは変更しない）
- [ ] **Task 14**: `src/components/ModelComparisonTable.jsx`を削除。他に参照箇所が残っていないことを`grep`で確認してから削除する
- [ ] **Task 15**: `MODEL_NAMES`/`MODEL_KEYS`（`src/constants`）を含め、3ページ+`ModelComparisonTable`以外で参照されていないか確認し、未使用化した定数・i18nキーを削除する

## 備考

- Task 1〜2（永続化）は他の全タスクの前提。ただしTask 6〜9（/accuracy）はunifiedの`feature_contributions`から直接計算する既存スクリプトを流用するため、`is_hit_turn`カラムへの依存は必須ではなく、Task 1〜2と並行して着手可能
- Task 3〜4、Task 8のように「バックエンド改修とフロント改修を同一PRでデプロイ」と明記したタスクは、分割禁止（データ構造の不整合を避けるため）
