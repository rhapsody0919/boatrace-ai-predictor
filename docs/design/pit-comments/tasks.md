# ピットレポート（選手コメント）tasks

spec: `spec.md` / plan: `plan.md` / screens: `screens.md`
取得ジョブの運用（切り替え・切り戻し・確認SQL）: [verification-runbook.md §P](../scraping-vercel-consolidation/verification-runbook.md)。データ取得基盤側のタスクは、[scraping-vercel-consolidation/tasks.md T4b-17](../scraping-vercel-consolidation/tasks.md)。

## Phase 1: 取得・保存（コード。本PRで実装済み）

- [x] **T1-1** パーサー（`scripts/lib/pitReportParser.js`。純関数）。実ページのフィクスチャ7件（`scripts/lib/__fixtures__/pitreport/`）で検証
- [x] **T1-2** 行の組み立て・outcome・内容ハッシュ・出走表との突合（`scripts/lib/pitReportRows.js`）
- [x] **T1-3** DDL案 085（保存。2表・RLS有効・匿名の権限なし）・086（匿名へSELECTのみ公開）。`APPLIED.md`に「未適用」で記録
- [x] **T1-4** 取得ジョブ（`scripts/lib/pitReportJob.js`・`api/cron/pit-reports.js`・レジストリ`pit_reports`・`vercel.json`）。既定は off。shadow・live。対象レースにだけスロットを作るストア。未適用のDBでの安全性
- [x] **T1-5** 生HTMLの保管の最小実装（`scripts/lib/rawHtmlArchive.js`）
- [x] **T1-6** 検証（`npm run verify:pit-report-job`。変異検証を含む）

## Phase 2: 公開範囲・公開時刻・更新の実測と、窓の確定

- [ ] **T2-1** 公開時刻の追加実測: 最終日以外の対象レース（複数のレース番号）と、SGの初日1R、を複数の時刻で確認する（spec.md §1.4）。SG・G1・G2の次の開催日に行う
- [ ] **T2-2** 公開後の更新の有無の確認結果を、spec.md §1.5に反映する。更新があれば、履歴の持ち方（plan.md §1.3）を確定する
- [ ] **T2-3** レジストリ`pit_reports`の`offsets`・`graceMin`・`pendingRetrySec`を、実測（shadowの`done_at`の分布を含む）で確定する

## Phase 3: 本番への適用（すべてユーザーの承認が要る）

- [ ] **T3-1** (ユーザー承認) マイグレーション085を適用する
- [ ] **T3-2** (ユーザー承認) `scrape_job_state`の`pit_reports`を`shadow`にする（runbook §P-2）
- [ ] **T3-3** (ユーザー承認) Storageの非公開バケット`raw-pages`を作成し、`live`にする（runbook §P-3）
- [ ] **T3-4** 過去分のバックフィル（plan.md §5）: 手動CLI`scripts/maintenance/backfill-pit-reports.js`を実装（`processPitReportRace`を`skipCandidateCheck`つきで呼ぶ薄いCLI。既定はdry-run、`--apply`で書く）。gradesch（`gradesch?year={年}&hcd={01|02}`）で、2025-12〜2026-02-02の対象日を特定する。実行はユーザーの承認のもと、3夜に分ける

## Phase 4: 画面（**モック承認の後に**実装する）

- [ ] **T4-1** モックの作成（`screens.md`の§3〜§4。追加位置・出典表記・★の見た目・状態）。ユーザーの承認
- [ ] **T4-2** `getRacePitReport`（`supabaseDataService.js`）・`pitReportUrl.js`・`RacePitReportSection`・`RaceBeforeInfoTab`への追加・i18n（4言語）・`termHints.js`（`screens.md` §6）
- [ ] **T4-3** Playwrightでの自己検証（SG・G1のレース詳細で、直前情報タブにセクション・出典・リンクが出る。G3では出ない。ライト・ダーク・モバイル幅）。スモークテストへの追記。`npm run build`・`npm run test:e2e`
- [ ] **T4-4** (ユーザー承認) マイグレーション086を適用する（匿名への公開）。本番で、SG・G1・G2のレース詳細に表示されることを確認する
- [ ] **T4-5** `content-index.json`（`docs/design/pit-comments/content-index.json`）を作成する（新機能のトレーサビリティ。ブログ・SNSへの展開の要否は、フローA参照）
- [ ] **T4-6** ADR-0067の追記案（承認の記録）を確定する（ユーザーの確認後にマージ）

## 完了の定義（データ項目ごと。`.claude/rules/data-acquisition.md`）

データ項目: `race_pit_reports`・`race_pit_comments`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降の`races`のうち、SG（全レース）・G1・G2（7R以降）で、公式ページが対象外と答えなかったレース数。ページが空のレース・`not_target`は分母から除き、件数を報告）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 土日を含む直近7日で、「発走までに公開を検知できた割合」と、公開検知の遅延の分布を実測する（runbook §P-2のクエリ）。欠落率2%以内
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（`scrape-summary`・`scrape-monitor`）
