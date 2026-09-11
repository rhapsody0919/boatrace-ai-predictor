# ADR 0040: 発走後の確定中止検知の実装場所

## ステータス
採用

## 背景
BOA-254 FR2（発走後の確定検知）をどこに実装するか。調査の結果、`scripts/daily/scrape-results.js`の`run()`は`getRacesAfterStart(schedule, 5)`で「発走5分後〜90分後（`maxMinutesAfter`のデフォルト値）」のレースだけを結果取得対象にしており、90分を過ぎると対象から外れ、結果が来ないレースは誰にも気づかれず`race_results`未作成のまま放置される実装になっていることが判明した（`docs/proposal/DATA_FLOW_COMPARISON.md`が指摘していた「永遠に未取得のまま残る」という既知の課題の直接の原因）。

## 決定
新規バッチスクリプトを作らず、既存`scripts/daily/scrape-results.js`の`run()`を拡張する。具体的には、同じ`schedule`（`getRaceSchedule()`の返り値）を使って「発走90分超・`race_results`行が存在しない・`cancellation_status`がまだ`confirmed`でない」レースを抽出し、`races.cancellation_status = 'confirmed'`を書き込む処理を追加する。90分という閾値は、既存の`getRacesAfterStart`のデフォルト`maxMinutesAfter`とそのまま一致させる。

## 却下した選択肢
- **新規バッチスクリプトを作る**: 対象レースの特定に必要な`schedule`は`scrape-results.js`が既に取得済みであり、新規スクリプトを作ると同じスケジュール取得処理・cron登録（`scrape-scheduled.yml`）を重複させることになる。既存の90分という区切りとも独立して新しい閾値を管理することになり、2箇所の定数がズレるリスクも生まれる
- **`update-race-info.js`（発走前スクリプト）に統合する**: このスクリプトは発走1時間前ウィンドウのみを対象にしており、発走90分後という発走後のタイミングを扱う設計になっていない。役割（発走前の情報更新 vs 発走後の結果取得）が異なるスクリプトに無理に混ぜると責務が曖昧になる

## 影響
- `scrape-results.js`の`run()`が担う責務が「結果取得」から「結果取得＋確定中止判定」に広がる。処理自体は既存の`schedule`ループに追加するだけで、新たな外部リクエストは発生しない（DBクエリのみ追加）
- 既存の結果取得ロジック（`scrapeRaceResult`・`scrapeAndSaveResults`）には変更を加えない。追加ロジックは`run()`内で独立した処理ブロックとして実装する
