# レース中止・順延検出の永続化 タスク分解

`docs/design/race-cancellation-detection/spec.md`・`screens.md`・`plan.md`、`docs/adr/0039〜0041`に基づく。依存順。各タスクは目安として1コミットで完結する粒度とし、全体を1PRにまとめる（spec.mdの合意通り、暫定検知・確定検知・UI表示を1回のリリース単位とする）。

## タスク一覧

- [x] **Task 1**: `docs/db-migration/047_race_cancellation_status.sql`をSupabaseに適用する（`races.cancellation_status`・`cancellation_check_streak`カラム追加）。**本番DBへのスキーマ変更のため、実行前にユーザー確認を取ってから行う**（2026-09-06、ユーザーがSupabase Dashboardで実行済み）
- [x] **Task 2**: `scripts/lib/raceSchedule.js`に`getRacesPastResultWindow(schedule, maxMinutesAfter = 90)`を追加する（既存`getRacesAfterStart`と対になるヘルパー、ADR 0040）。「発走90分超」のレースを返す（境界値をnode -eで検証済み、構文チェックOK）
- [x] **Task 3**: `scripts/daily/update-race-info.js`を拡張する（FR1）。`run()`内で`cancellation_status`/`cancellation_check_streak`を取得し、選手情報0人検出時のstreak加算・3回連続到達時の`tentative`昇格・正常検知時のリセットを実装した。状態遷移は`scripts/lib/cancellationStatus.js`の`computeCancellationTransition()`として切り出し、`scripts/analysis/verify-race-cancellation-streak-logic.js`（BOA-255の代替方式）で9ケース全て検証済み。実装時、`entriesRows`が空だと早期returnする既存コードがcancellation更新の書き込みを握りつぶす箇所を発見し、書き込み位置をreturnより前に調整して回避した
- [x] **Task 4**: `scripts/daily/scrape-results.js`を拡張する（FR2）。Task 2のヘルパーを使い「発走90分超・`race_results`未作成・`cancellation_status`が`confirmed`でない」レースを`confirmed`に更新する処理を、独立した新規関数`confirmOverdueCancellations()`として追加した。既存の結果取得ロジック（`scrapeRaceResult`・`scrapeAndSaveResults`）は無変更（構文チェックOK）
- [x] **Task 5**: `src/services/supabaseDataService.js`の`getPredictions()`を拡張する（FR3）。select句に`cancellation_status`を追加し、`raceData`オブジェクト構築箇所に`cancellationStatus`フィールドを追加した。同じ変更を`getRaces()`（別関数、現状未使用だが同一テーブル）にも適用済み。構文チェックOK
- [x] **Task 6**: `src/locales/{ja,en,ko,zh-TW}/common.json`に`raceCard.cancelled`・`panel.cancelledBanner`キーを追加した（4言語、「競艇」表記は使用なし）。`node -e`で4言語ともJSON構文・値を検証済み
- [x] **Task 7**: `src/components/race/RaceCard.jsx`を拡張する（FR4）。`cancellationStatus === "confirmed"`のときに既存の「結果反映待ち」バッジを「中止」バッジに置き換える排他分岐を追加した。`tentative`・`null`では現行表示を維持（`isAwaitingResult`分岐は変更なし）。括弧バランス確認OK（node_modules未導入のためJSXパーサでの構文チェックは不可、Task 9でのbuild実行時に最終確認する）
- [x] **Task 8**: `src/components/race/PredictionPanel.jsx`を拡張する（FR5）。`cancellationStatus === "confirmed"`のときに既存の結果反映待ちバナーを「中止」バナーに置き換える排他分岐を追加した。括弧バランス確認OK
- [x] **Task 9**: 検証・PR作成。実施内容:
  - `npm install`・`npm run build`成功
  - `npm run test:e2e`（一時設定でchromiumのexecutablePathを指定して実行、881 passed / 21 failed / 8 skipped）。失敗21件は`git worktree`で変更前のmasterに対して同じテストのみ再実行し、**同一の21件が変更前から失敗する（このセッションにSupabase接続情報が無く実データが取得できない環境要因）ことを確認**。新規の失敗は0件
  - 一時的なプレビュールート（`/__cancellation-preview`、検証後に完全削除・`git checkout`で復元）でRaceCard・PredictionPanelの`cancellationStatus`3状態（null/tentative/confirmed）をPlaywrightでスクリーンショットし、ライト/ダーク両テーマで意図通りの表示を目視確認
  - `/code-review`で5件の指摘を検出、すべて修正・再検証済み:
    1. **【致命的】Edge API（`api/predictions/[date].js`→RPC `get_predictions_by_date`/`_light`）が通常運用で最優先経路のため、直接クエリ（Task 5）だけでは本番で機能しない** → `docs/db-migration/048_add_cancellation_status_to_predictions_rpc.sql`を新規作成しRPC自体に`cancellationStatus`を追加。`transformEdgeResponse()`（`supabaseDataService.js`）にもフィールド追加
    2. **【致命的】`RaceDetailPage.jsx`の`buildPrediction()`が`cancellationStatus`を`prediction`に含めておらず、かつ選手情報0人（中止レースの典型パターン）だと`prediction.error`分岐が中止バナーより先に生きてしまい汎用エラーが出る** → `buildPrediction()`のerror/成功両分岐に`cancellationStatus`を追加、`PredictionPanel.jsx`の`prediction.error`分岐内で`isCancelled`を先にチェックし専用メッセージを出すよう修正。プレビューで再検証済み
    3. `update-race-info.js`: cancellation_status取得失敗時、全レースがデフォルト値にフォールバックし既存のtentative状態を誤ってリセットしうる不具合を修正（取得失敗時はその回の計算を丸ごとスキップ）
    4. `scrape-results.js`: `startedRaces`が0件だと`confirmOverdueCancellations()`が早期returnで一切呼ばれない不具合を修正（互いに独立させた）
    5. `scrape-results.js`: 確定更新をレース毎の逐次updateから`.in()`による一括updateに変更（軽微な効率化）
  - 修正後、`npm run build`再実行で成功、関連する既存E2Eテスト（レース詳細ページtitle等）を個別再実行し回帰が無いことを確認
