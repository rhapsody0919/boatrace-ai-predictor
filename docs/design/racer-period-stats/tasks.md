# タスク: 選手の期別成績（fan）と節メタ（月間スケジュール）の取り込み

設計: [plan.md](./plan.md)。**コード・DDL案・検証は完了。本番の適用・取得・投入は、ユーザーの承認後。**

## 完了（コード・案・検証）

- [x] fan の取得可否・形式・利用条件・提供範囲の確認（公式サイトへ23回。plan.md §2〜3）
- [x] fan パーサー（純関数、バイト幅、410/416の両レイアウト）: `scripts/lib/fanPeriodParser.js`
- [x] 行変換（`racer_period_stats`・`racer_profiles` 反映）: `scripts/lib/fanPeriodRows.js`
- [x] 取得ループの共通化（kb-backfill と同じ安全策）: `scripts/lib/archiveDownloader.js`
- [x] fan CLI（plan/download/parse/load/sync-profiles/status）: `scripts/maintenance/fan-backfill.js`
- [x] 月間スケジュールのパーサー・節の確定・行変換・CLI: `scripts/lib/monthlyScheduleParser.js`・`raceSeriesRows.js`・`scripts/maintenance/monthly-schedule-backfill.js`
- [x] DDL案 083（`racer_period_stats`・`racer_profiles` の列）・084（`race_series`）と、APPLIED.md の「未適用」行
- [x] 検証: `npm run verify:fan-period`・`verify:monthly-schedule`（フィクスチャ、公式ページ・DB・Kファイルとの一致、CLI、変異検証）

## 承認後（ユーザーの実行）

- [ ] 083・084 を本番へ適用（適用前に長時間クエリ0件を確認。適用後に `APPLIED.md` を更新し、RLS・権限を実測）
- [ ] fan の取得（`fan-backfill.js download`、50件、カナリア5件→残り）→ `parse`
- [ ] 月間スケジュールの取得（`monthly-schedule-backfill.js download --from=201903 --to=202610`、92件）→ `parse`
- [ ] `fan-backfill.js load --from=fan1810 --to=fan2604`（検証のみ → `--apply`）
- [ ] `monthly-schedule-backfill.js load --from=201904 --to=202609`（検証のみ → `--apply`）
- [ ] `fan-backfill.js sync-profiles --id=fan2604`（検証のみ → `--apply`）
- [ ] 本番実測: 期待件数（算出根拠: 期ごとの行数＝fan のレコード数（fan2604=1,643）、期数＝16。`race_series` は月別の節数、2019-04で約100）に対し、充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 対象外（半期・月次の確定値。取得時刻は `created_at`）。**この判断をユーザーに承認してもらう**（可変データではない）
- [ ] 継続監視: 新しい期のファイルの公開の検知（4月・10月から最大105日、期限超過でSlack通知）。当面は対話セッションの開始時確認、または Cron 化（plan.md §8.2。Storage・台帳が前提）
- [ ] 投入の前後で、ダッシュボードの Disk IO 消費を確認し、完了報告に含める
- [ ] `racer_profiles` の5列と fan が全選手で一致することを実測（B6縮小の前提）

## 後続（別の作業）

- [ ] B6 を「新人登録のみ」に縮小（plan.md §7 段階2〜3）
- [ ] 節の初日が `races` に欠けている件（plan.md §9.5）の原因調査・修復
- [ ] fan の Vercel Cron 化（Storage のバケット・`raw_snapshots` 台帳が前提）
- [ ] `race_series.grade` が NULL の節の補完（K/B の節名から）、`races.race_grade` との食い違いの実測
