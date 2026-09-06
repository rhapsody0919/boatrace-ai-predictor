# 会場ページ レース締切ステータスのライブ表示 タスク分解

`docs/design/race-deadline-status/spec.md`・`screens.md`・`plan.md`、`docs/adr/0042`に基づく。依存順。全体を1PRにまとめる（BOA-254と同じ方針、機能として不可分なため）。

## タスク一覧

- [x] **Task 1**: `src/utils/raceDeadlineStatus.js`を新規作成した（FR1/FR2の基盤）。`getDeadlineDate(raceId, startTime)`・`getDeadlineStatus(raceId, startTime, now)`・`DEADLINE_STATUS`enumをplan.mdの設計通り実装。`scripts/analysis/verify-race-deadline-status-logic.js`で境界値（5分1秒前=ACCEPTING、ちょうど5分前=CLOSING_SOON、0秒=CLOSED、`parseRaceId`失敗時=null、大晦日日付またぎ）9ケース全て検証済み
- [x] **Task 2**: `src/components/race/RaceDeadlineCountdown.jsx`を新規作成した（FR2）。Task 1の`getDeadlineDate`を再利用し、`setInterval`（1秒毎）でローカルstateのみ更新する。締切済み・`deadline`が`null`の場合は何も描画しない
- [x] **Task 3**: `src/components/race/RaceCard.jsx`を拡張した（FR1/FR2/FR3統合）。`isCancelled`が真でない場合のみTask 1の`getDeadlineStatus()`を呼び出し、`CLOSING_SOON`/`ACCEPTING`バッジを追加（`CLOSED`は非表示）。`deadlineStatus`が`CLOSED`以外のときTask 2の`RaceDeadlineCountdown`をレンダー。既存の的中/外れ・結果反映待ち・中止バッジ分岐とは独立した追加要素として実装し、既存分岐は変更なし
- [x] **Task 4**: `src/locales/{ja,en,ko,zh-TW}/common.json`に`raceCard.accepting`・`raceCard.closingSoon`・`raceCard.deadlineCountdown`（`{{time}}`プレースホルダ）の3キーを追加した（4言語）。「競艇」表記は使用なし
- [x] **Task 5**: 検証・PR作成。実施内容:
  - `npm run build`成功を確認（2回、コードレビュー修正の前後とも）
  - Task 1の検証スクリプトを実行し全9ケース成功を確認
  - 一時プレビュールート（`/__deadline-preview`、検証後は完全削除・`git checkout`で復元）でPlaywrightにより、`RaceCard`の3状態（受付中/まもなく締切/締切済み）・中止確定時の新バッジ非表示（FR3）・カウントダウンの秒単位更新をライト/ダーク両テーマでスクリーンショット付きで目視確認した
  - `RaceDeadlineCountdown`の`setInterval`更新はコンポーネント内ローカルstateのみを変更する設計（親から渡すのは不変のprops`raceId`/`startTime`のみ）であることをコードレベルで確認。他のレースカード・`RaceCard`本体への再レンダー波及は無い
  - `npm run test:e2e`を実行し、881 passed / 21 failed / 8 skipped（失敗21件はSupabase接続情報が無い本環境固有の既存失敗であることを`git worktree`でのbaseline比較で確認済み、BOA-254 Task 9と同じ手法）。コードレビュー修正後に再実行し、同じ881/21/8で差分無し
  - `/code-review`でセルフレビューを実施し4件の指摘を検出。うち1件（`RaceDeadlineCountdown.jsx`のMM表記が締切60分超で3桁になり崩れる)を修正・再検証済み。残り3件はBOA-243の変更範囲外（既にmasterにマージ済みのBOA-254関連スクリプトの指摘）のため、このPRでは対応せず完了報告に記載
  - masterに追従するため`git merge origin/master`を実施（コンフリクト4件を解消、いずれも新規追加キー・行の単純な統合）
  - PR作成、Linear BOA-243を更新、ユーザーにマージ確認を依頼する
