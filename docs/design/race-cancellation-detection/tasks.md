# レース中止・順延検出の永続化 タスク分解

`docs/design/race-cancellation-detection/spec.md`・`screens.md`・`plan.md`、`docs/adr/0039〜0041`に基づく。依存順。各タスクは目安として1コミットで完結する粒度とし、全体を1PRにまとめる（spec.mdの合意通り、暫定検知・確定検知・UI表示を1回のリリース単位とする）。

## タスク一覧

- [x] **Task 1**: `docs/db-migration/047_race_cancellation_status.sql`をSupabaseに適用する（`races.cancellation_status`・`cancellation_check_streak`カラム追加）。**本番DBへのスキーマ変更のため、実行前にユーザー確認を取ってから行う**（2026-09-06、ユーザーがSupabase Dashboardで実行済み）
- [x] **Task 2**: `scripts/lib/raceSchedule.js`に`getRacesPastResultWindow(schedule, maxMinutesAfter = 90)`を追加する（既存`getRacesAfterStart`と対になるヘルパー、ADR 0040）。「発走90分超」のレースを返す（境界値をnode -eで検証済み、構文チェックOK）
- [x] **Task 3**: `scripts/daily/update-race-info.js`を拡張する（FR1）。`run()`内で`cancellation_status`/`cancellation_check_streak`を取得し、選手情報0人検出時のstreak加算・3回連続到達時の`tentative`昇格・正常検知時のリセットを実装した。状態遷移は`scripts/lib/cancellationStatus.js`の`computeCancellationTransition()`として切り出し、`scripts/analysis/verify-race-cancellation-streak-logic.js`（BOA-255の代替方式）で9ケース全て検証済み。実装時、`entriesRows`が空だと早期returnする既存コードがcancellation更新の書き込みを握りつぶす箇所を発見し、書き込み位置をreturnより前に調整して回避した
- [x] **Task 4**: `scripts/daily/scrape-results.js`を拡張する（FR2）。Task 2のヘルパーを使い「発走90分超・`race_results`未作成・`cancellation_status`が`confirmed`でない」レースを`confirmed`に更新する処理を、独立した新規関数`confirmOverdueCancellations()`として追加した。既存の結果取得ロジック（`scrapeRaceResult`・`scrapeAndSaveResults`）は無変更（構文チェックOK）
- [ ] **Task 5**: `src/services/supabaseDataService.js`の`getPredictions()`を拡張する（FR3）。select句に`cancellation_status`を追加し、`raceData`オブジェクト構築箇所（2箇所）に`cancellationStatus`フィールドを追加する
- [ ] **Task 6**: `src/locales/{ja,en,ko,zh-TW}/common.json`に`raceCard.cancelled`・`panel.cancelledBanner`キーを追加する（4言語、`.claude/rules/code-style.md`準拠で「競艇」表記を使わない）
- [ ] **Task 7**: `src/components/race/RaceCard.jsx`を拡張する（FR4）。`cancellationStatus === "confirmed"`のときに既存の「結果反映待ち」バッジを「中止」バッジに置き換える排他分岐を追加する。`tentative`・`null`では現行表示を維持する
- [ ] **Task 8**: `src/components/race/PredictionPanel.jsx`を拡張する（FR5）。`cancellationStatus === "confirmed"`のときに既存の結果反映待ちバナーを「中止」バナーに置き換える排他分岐を追加する
- [ ] **Task 9**: 検証・PR作成。`npm run build`・`npm run test:e2e`（`RaceCard`は共通コンポーネントのため必須）を実行し、Playwrightで模擬データ（`cancellationStatus`を`confirmed`/`tentative`/`null`にした状態）を使い会場ページ・レース詳細ページの表示をライト/ダーク両テーマで目視確認する。`/code-review`でセルフレビューを実施し、指摘を修正した上でPRを作成する（マージはユーザー承認後）
