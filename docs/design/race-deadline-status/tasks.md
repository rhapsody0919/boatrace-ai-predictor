# 会場ページ レース締切ステータスのライブ表示 タスク分解

`docs/design/race-deadline-status/spec.md`・`screens.md`・`plan.md`、`docs/adr/0042`に基づく。依存順。全体を1PRにまとめる（BOA-254と同じ方針、機能として不可分なため）。

## タスク一覧

- [ ] **Task 1**: `src/utils/raceDeadlineStatus.js`を新規作成する（FR1/FR2の基盤）。`getDeadlineDate(raceId, startTime)`・`getDeadlineStatus(raceId, startTime, now)`・`DEADLINE_STATUS`enumをplan.mdの設計通り実装する。`scripts/analysis/verify-race-deadline-status-logic.js`を新設し、境界値（5分1秒前=ACCEPTING、ちょうど5分前=CLOSING_SOON、0秒=CLOSED、`parseRaceId`失敗時=null）をnode実行で検証する
- [ ] **Task 2**: `src/components/race/RaceDeadlineCountdown.jsx`を新規作成する（FR2）。plan.mdの設計通り、Task 1の`getDeadlineDate`を再利用し、`setInterval`（1秒毎）でローカルstateのみ更新する。締切済み・`deadline`が`null`の場合は何も描画しない
- [ ] **Task 3**: `src/components/race/RaceCard.jsx`を拡張する（FR1/FR2/FR3統合）。`isCancelled`が真でない場合のみTask 1の`getDeadlineStatus()`を呼び出し、`CLOSING_SOON`/`ACCEPTING`バッジを追加する（`CLOSED`は非表示）。`deadlineStatus`が`CLOSED`以外のときTask 2の`RaceDeadlineCountdown`をレンダーする。既存の的中/外れ・結果反映待ち・中止バッジ分岐とは独立した追加要素として実装し、既存分岐は変更しない
- [ ] **Task 4**: `src/locales/{ja,en,ko,zh-TW}/common.json`に`raceCard.accepting`・`raceCard.closingSoon`・`raceCard.deadlineCountdown`（`{{time}}`プレースホルダ）の3キーを追加する（4言語）。「競艇」表記を使わない
- [ ] **Task 5**: 検証・PR作成。実施内容:
  - `npm run build`成功を確認
  - Task 1の検証スクリプトを実行し全ケース成功を確認
  - 一時プレビュールートでPlaywrightにより、`RaceCard`の3状態（受付中/まもなく締切/締切済み）・中止確定時の非表示・カウントダウンの秒単位更新をライト/ダーク両テーマで目視確認する（検証後は完全削除）
  - React DevTools相当の確認（またはコード上の設計確認）で、`RaceDeadlineCountdown`の`setInterval`更新が他のレースカード・`RaceCard`本体の再レンダーを誘発しないことを確認する
  - `npm run test:e2e`を実行し、変更前から存在する失敗との差分が無いことを確認する（BOA-254 Task 9と同じ手法、必要なら`git worktree`でbaseline比較）
  - `/code-review`でセルフレビューを実施し、指摘があれば修正・再検証する
  - PR作成、Linear BOA-243を更新、ユーザーにマージ確認を依頼する
