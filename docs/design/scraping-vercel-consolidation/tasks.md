# データ取得基盤のVercel一本化 tasks（ドラフト）

> **この文書は、ユーザー未承認のドラフトである。** [plan.md](./plan.md)（同じくドラフト）の推奨案に基づくタスク分解であり、plan.mdの要判断4点（予定表テーブル・起動元・予測リフレッシュのきっかけ・着手順）が承認・修正されるまで、着手しない。修正があった場合は、影響するタスクを更新する。

対応: [plan.md](./plan.md) / [orchestration.md](./orchestration.md)（体制の正本。WS4a・WS4b・WS7に対応） / [job-inventory.md](./job-inventory.md) / [完了の定義](../../../.claude/rules/data-acquisition.md)

## 進め方

- **1タスク＝1コミット〜1PR**。タスクIDは、plan.md §13（未確認事項と確認方法）から参照される
- 完了の判定は、コードのマージではなく、**本番DBの実測**で行う。各データ項目に、[完了の定義](../../../.claude/rules/data-acquisition.md)の3行（本番実測・タイミング実測・継続監視）を入れる。完了報告に、実測クエリと結果を添付する
- **本番DBのDDL・書き込みは、ユーザーの承認後に実行する**（マイグレーションは、着手時とPR作成前に`npm run verify:migration-numbers`で番号を確認し、`docs/db-migration/APPLIED.md`に行を追加する。新規テーブルを含む場合は`npm run verify:er-diagram`も実行する）
- **外部サービスの操作（cron-job.orgの停止、Vercel・GitHubの設定変更）は、ユーザーの承認・操作を得る**。Agentは実行しない（該当タスクに「(ユーザー)」と付ける）
- 過去分のバックフィルはWS5の範囲だが、各データ項目の「本番実測」は、過去分を含む件数を要求する。過去分を遡って取得できない場合は「取得開始日以降のみ」と明記し、ユーザーの承認を得る。対象期間は、`races`の最古（2025-12-03）以降（バックフィル範囲の決定は、別PR（`docs/decisions-legal-backfill-ws2`ブランチ）で記録中で、`origin/master`には未マージ）
- 切り替え・切り戻しは、[plan.md §4.7](./plan.md#47-切り替えと切り戻し)の手順に従う（1ジョブずつ。`off`→`shadow`→`live`→`SKIP_<JOB>_ON_GHA=true`）

## 着手順と並列

推奨する着手順（plan.md §4.5・§11(d)）。並列は最大2〜3。

| 順 | 内容 | 並列の単位 | 前提 |
|---|---|---|---|
| 0 | Phase 0: 前提の確認・修正（T0） | 並行して、T4a-01・T4a-04（依頼・計測）も着手できる | なし |
| 1 | Phase 1: 共通基盤（T4a-02〜T4a-11） | **トラックA**（単独。基盤が全ての前提） | plan.mdの承認（G1） |
| 1と並行 | `races-init`・`pcexpect`のfs・`execSync`除去のリファクタ（T4b-07の前半、T4b-08の前半） | **トラックB**（対象ファイルが独立。基盤の完成を待たずに進める） | G1。T4b-03と`generate-predictions.js`が重なるため、下記の順序制約に従う |
| 1と並行（早期） | Phase 1.5: 予測リフレッシュ案1（T4b-03）。現行の`api/cron/exhibition.js`への最小PRのため、基盤（予定表・ラッパ）を待たない | トラックA（基盤の設計・マイグレーション案（T4a-02）と並行可）。ただし`generate-predictions.js`を触るため、トラックBのT4b-07-2より先 | G1（この文書の承認）のみ |
| 2 | Phase 2: 結果取得（T4b-02）、Kファイル・結果のcatch-up（T4b-05） | トラックA | T0、T4a完了 |
| 3 | Phase 3: オッズ（T4b-04） | トラックA | T4b-02、T4b-03 |
| 3と並行 | 日次・低頻度（T4b-12〜16） | **トラックC**（独立。基盤のラッパとレジストリ（T4a-05〜08）が前提） | T4a-08 |
| 4 | Phase 4: レース情報・買い目オッズ（T4b-09・10） | トラックA | T4b-04 |
| 4 | Phase 6: 展示・特記事項の純正Cron化（T4b-06・11） | トラックA | T4a完了 |
| 5 | Phase 7: 最終検証・旧基盤の廃止（T7） | 親＋Agent | 全データセットの完了 |

**順序制約**（同じファイルを触るため、同時に着手しない）:

- `scripts/daily/generate-predictions.js`: T4b-03（`mainRefresh`の除去作業）→T4b-07（`main()`の分割）。範囲が重ならないことを確認した場合に限り並列
- `scripts/daily/scrape-results.js`: T4b-02（結果取得の入口）→T4b-05（Kファイル同期の切り出し）
- `vercel.json`のcrons: 各PRが追記するため、マージ順に注意（コンフリクトは、1ファイルの追記のみなので、手動で解消できる）
- マイグレーション番号: 着手時とPR作成前に、`origin/master`の最大番号を確認する

---

## Phase 0: 前提の確認・修正（T0）

- [ ] **T0-01** WS2（取得時刻列の追加。`exhibition_data`・`race_entries`・`race_start_timings`）が、マイグレーション適用済み・コードのマージ済みであることを確認する。並走比較（GitHub側の行の取得時刻）に必要（[orchestration.md](./orchestration.md) WS2）
- [ ] **T0-02** BOA-349（過去日の進入コース再同期が毎回全件UPDATE）の修正（PR #716でマージ済み）の効果を、`pg_stat_user_tables`の`n_tup_upd`（`race_results`）で確認する。Phase 2の前提（結果取得をVercelへ移しても、不具合が引き継がれるため）
- [ ] **T0-03** 修正後の展示欠落率モニター（BOA-350）で、土日を跨ぐ変動（9/19・9/20分は9/20・9/21朝に確定）を確認し、Phase 2着手のゲート（BOA-313 Step 4）を満たすことを、ユーザーに報告する
- [ ] **T0-04** BOA-352（Supabase障害の対応）・BOA-354（結果7レースの欠損）の状況を確認し、Phase 2の前に必要な対応を洗い出す

## Phase 1: 共通基盤（WS4a、トラックA）

目的: 予定表・共通ラッパ・監視を作り、1つのジョブ（結果取得）で動く状態にする（[orchestration.md](./orchestration.md) WS4aの完了条件）。

- [ ] **T4a-01** (ユーザー) Vercelの環境変数に`SLACK_WEBHOOK_URL`・`VERCEL_DEPLOY_HOOK`が設定されているかを確認し、無ければ設定する。値はAgentに渡さず、名前の有無のみを確認する（plan.md U10、リスクR15）
- [ ] **T4a-02** スキーマ確定とマイグレーション案の作成（`docs/db-migration/`、番号は`origin/master`の最大番号+1）: `scrape_slots`・`scrape_job_state`・`race_odds`の`window_min`・`source`・部分一意索引、RPC 2本（`ensure_scrape_slots`・`claim_scrape_slots`）。ヘッダーコメントに`docs/design/scraping-vercel-consolidation/plan.md`を参照する。`node scripts/maintenance/generate-er-diagram.js scraping-vercel-consolidation`の出力で、plan.md §3.4の手書きER図を置き換える。`npm run verify:migration-numbers`・`npm run verify:er-diagram`を実行し、`APPLIED.md`に「未適用」の行を追加する。1行のサイズ見積り（`pg_column_size`の軽い集計。plan.md U4）を記録する。**本番には適用しない**
- [ ] **T4a-03** (ユーザー承認) T4a-02のマイグレーションを本番へ適用する（ユーザーの対話ターミナル、またはManagement API）。適用後、`information_schema`・`pg_proc`・`pg_index`で、テーブル・列・関数・索引の存在を確認し、`APPLIED.md`を「適用済み」に更新する。RPCの動作を、`races`の1日分で、書き込みを伴う最小の確認（`ensure_scrape_slots`で行数、`claim_scrape_slots`が0件を返すこと）で検証する
- [ ] **T4a-04** リージョン・取得先のプローブ（一時的。マージせず、または確認後に削除する）: `regions`をsyd1・hnd1の2通りに指定した関数で、(1)Supabaseの軽い読み取りのRTT（10回の中央値）、(2)boatrace.jpの代表ページ（`raceresult`・`odds3t`）の取得時間・成功率（10回）、(3)`VERCEL_REGION`を計測する。現在のリージョン・Fluid Computeの状態（plan.md U1・U2）を確認し、結果からジョブ単位のリージョンの案（plan.md §8）を出す。取得先へのリクエストは最小限にする
- [ ] **T4a-05** 共通ラッパ: 認証（`CRON_SECRET`の定数時間比較を共通化）、`scrape_job_state.mode`（`off`／`shadow`／`live`）の読み取り、同期の応答（`waitUntil`を使わず、完了後に200/500）、ソフトデッドライン、`getRaceSchedule`の例外モード（DBエラーを空配列にしない。BOA-359と同型）、`last_tick_at`（5分に1回）・`last_success_at`・`last_error`の更新
- [ ] **T4a-06** スロット操作ライブラリ: `claim_scrape_slots`の呼び出し、完了・再試行・失敗の条件付き更新（`claimed_by`一致）、`outcome`・`rows_written`・`result_digest`の記録、リース奪取後の二重完了の防止。`scripts/maintenance/verify-*.js`の形式で、DBを使わない単体検証（状態遷移・リース・期限計算のJST）を追加する
- [ ] **T4a-07** `politeFetch`とバックオフ・サーキットブレーカー（BOA-368）: 15秒タイムアウト（既存の`supabaseClient.js`のパターン踏襲）、429/503の指数バックオフ（ジッター、2回まで）、ホスト単位のブレーカー（`scrape_job_state`の`host:boatrace.jp`）、並列度の上限。閾値はplan.md §8の初期値
- [ ] **T4a-08** ジョブレジストリと日次ジョブの雛形: `scripts/lib/scrapeJobs/registry.js`（plan.md §3.6の窓・許容幅・再試行・リース・並列度・完了条件）、`resolveTargetDate(now, 指定時刻)`（plan.md §4.3）、日次ジョブの雛形（`last_target_date`による冪等・補足の起動・期待件数の判定関数による0件エラー）
- [ ] **T4a-09** `scrape-monitor`（`api/cron/scrape-monitor.js`）: plan.md §7の指標（窓内取得率・遅延・`expired`・未実行・0件・死活・連続失敗・ブレーカー）を、予定表・ジョブ状態のSQLで計測し、Slackへ通知する（5分ごとは当日のみ、7日集計は1時間に1回）。監視自体の実行を`scrape_job_state`に記録する。メタ監視として、`scrape-monitor`の`last_tick_at`の鮮度を日次で確認するGitHub Actionsのワークフローを追加する（`exhibition-gap-monitor.yml`と同じ方式。通知は既存の`SLACK_WEBHOOK_URL`）
- [ ] **T4a-10** 疑似ジョブでの検証（`mode=off`→`shadow`）: 取得先へアクセスしない疑似ジョブ（スロットを消化するだけ）で、重複配信・リースの奪取・二重claim・期限計算のJST・順延の追従（plan.md U9・U16）と、環境変数の変更が再デプロイなしに反映されるか（U17）を、Previewの手動リクエストと、本番の`shadow`で確認する。Vercel Cronの実際の未配信・重複の頻度を計測する。**Previewでは、Cronが発火しない**（productionのみ）ため、手動リクエストで検証する
- [ ] **T4a-11** `vercel.json`に`crons`を追加する（基盤のみ先行: `scrape-monitor`・`scrape-cleanup`）。`scrape-cleanup`（`api/cron/scrape-cleanup.js`）は、予定表の`race_date`が60日より古い行を日次で削除する。cron式はUTCで、JSTをコメントで併記する。既存の`api/`のヘッダー設定（`Access-Control-Allow-Origin: *`）が、cronのエンドポイントに問題ないことを確認する

**Phase 1の完了条件**: ラッパが1つのデータセット（T4b-02）で動く。監視が、疑似ジョブの`expired`・未実行を検知して、Slackに通知する。

---

## Phase 1.5: 予測リフレッシュ（案1、Phase 1と並行して早期に着手）

### T4b-03 予測リフレッシュ（A7、`predictions`の再計算）

- [ ] **T4b-03-1** `mainRefresh`をVercelで動かせる形にする（`scripts/daily/generate-predictions.js`）: `process.exit(1)`を例外に、`process.argv`（`parseDateArg`）の日付を引数に、Deploy Hookは`decideDeployHook`の抑制を維持する（Vercelの環境変数の有無に従う）。既存のGitHub Actions経路の挙動は変えない。`node scripts/maintenance/verify-deploy-hook-policy.js`ほか既存の検証が通ることを確認する
- [ ] **T4b-03-2** `api/cron/exhibition.js`（現行の`waitUntil`版）の内側で、`runExhibition`が変更を書いたレース（30/15/10分前の窓のレース）に対し、`mainRefresh`を呼ぶ。`REFRESH_ON_VERCEL`フラグで有効化する。GitHub側は、`scrape-scheduled.js`の`updatedRaceIds`から、オッズ由来の追加を外す変数（`SKIP_ODDS_REFRESH_ON_GHA`等。名称は実装時に決める）で切り替える。**併走させない**（plan.md §5 併走の防止）。切り替えの順序と、切り戻しの手順をPR本文に書く
- [ ] **T4b-03-3** 展示更新が再計算のきっかけから外れた影響（plan.md U8）を、GitHub Actionsの実行ログで確認する（2026-09-16以降の、展示由来の再計算の有無）。Vercelでの`mainRefresh`の所要時間（26レース時の約8秒が実測か、週末のピーク）と、`predictions`の`UNIQUE`制約の有無（plan.md U14）を確認する
- [ ] **T4b-03-4** `REFRESH_ON_VERCEL`を有効化する（ユーザーの承認）。切り替え後、再計算の回数（`predictions`のINSERT・DELETE、`n_tup_ins`）が、約55%減の見込みどおりかを実測する

データ項目: `predictions`（再計算）。

- [ ] 本番実測: 期待件数（算出根拠: 展示・レース情報の変更を書いたレース数。各レースにつき、再計算後も`predictions`が空にならず、3モデル＋unifiedの行が揃う）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（`DELETE→INSERT`が非トランザクションで、間に空になる瞬間があるため、再計算の直後に空のレースが残らないこと）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。ここでは「展示・レース情報の取得成功から、予測の再計算が完了するまでの遅延」（`predictions.predicted_at`と、予定表の`done_at`の差）を実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（再計算の回数の急増・空の`predictions`のレース数を含める）

---

## Phase 2: 結果取得（トラックA）

### T4b-02 結果取得（A6）: `race_results`・`race_start_timings`

- [ ] **T4b-02-1** `scrape-results.js`に、レース単位の入口を追加する（例: `runForRaces(races, { date })`）。既存の`run(schedule, date)`は残す（二重実装しない）。的中フラグの補完（`fixMissingHitFlags`）は、完了したレースのみを対象にする（直近10日のスキャンを毎回やめ、日次に1回へ）。結果の完了判定（`payout_win`・`winning_technique`）は現行と同じ
- [ ] **T4b-02-2** `api/cron/result.js`: 共通ラッパ・レジストリの`result`定義（`+5`分から`+90`分、再試行300秒、リース180秒、40件×4並列）で、スロットを消化する。`+90`分での未完了は、既存の中止・順延の確定処理（`confirmOverdueCancellations`）へ
- [ ] **T4b-02-3** `scrape_job_state`に`result`を`shadow`で登録する（DBの更新。ユーザーの承認）。`shadow`で3日（土日のいずれか1日を含む）: 一致率（`result_digest`と、GitHub側が書いた`race_results`の値）、窓内取得率、1回の呼び出しの所要時間（plan.md U13）、取得先の拒否率（U3）、Vercelの使用量（U5）を計測する
- [ ] **T4b-02-4** `live`にして3日並走する（二重書き込みは上書き型で無害）。GitHub側の結果取得を止めるリポジトリ変数`SKIP_RESULTS_ON_GHA`を、`scrape-scheduled.js`・`scrape-scheduled.yml`に追加する（コードは削除しない。展示の`SKIP_EXHIBITION_ON_GHA`と同じ方式）
- [ ] **T4b-02-5** (ユーザー承認) `SKIP_RESULTS_ON_GHA=true`にして、切り替え後7日（土日を含む）の実測を行う。GitHub Actionsの1回の実行時間（379秒→約262秒の見込み）、キャンセル率を再測定する

データ項目: `race_results`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（`races`）−確定中止（`cancellation_status='confirmed'`）。除外した件数も報告する。1レース1行）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（月別。現状の未達は、2025-12が93.0%、2026-01が94.5%、2026-03が91.0%。過去分の補填はWS5）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。結果は窓型ではないため、「発走5分後から結果が全て揃うまでの遅延」の分布（p50・p95）と、`+90`分までに完了した割合を、予定表の`done_at`と`race_results.result_at`から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（結果のexpired・欠落、0件を含む）

データ項目: `race_start_timings`。

- [ ] 本番実測: 期待件数（算出根拠: 上記の結果があるレース×出走艇数（欠場・失格の艇の扱いは、`race_entries`と突合して実装時に確定し、除外した件数を報告））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。スタート情報・決まり手は、発走20分後以降に公開されるため、「発走20分後から取得までの遅延」を実測する（取得時刻列は、WS2または予定表）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

### T4b-05 Kファイル同期・結果のcatch-up（A6補助）: `race_results.actual_course_*`・`rank4〜6`

- [ ] **T4b-05-1** Kファイル同期を、独立のジョブ（`api/cron/kfile-sync.js`、日次07:00・12:00 JST）へ切り出す。進入コース（`syncActualCourseFromKFile`）とrank4〜6（`syncRank456FromKFile`）が、同じ日のKファイルを別々にダウンロードしている重複（D4）を解消し、1回のダウンロードで両方を処理する。BOA-349の修正（変更のある行のみ書く）を維持する。`@kirinsaninc/lhats`（LZH展開）が関数内で動くか、Previewの手動リクエストで確認する（plan.md U15）
- [ ] **T4b-05-2** `api/cron/result-catchup.js`（日次23:50 JST）: 当日`expired`になった`result`のスロットを再取得し、補填する。完了の定義Aを守るための後追い（Bの計測は、expiredの記録が残る）
- [ ] **T4b-05-3** `shadow`→`live`→`SKIP_KFILE_ON_GHA=true`の手順で切り替える。GitHub側の`scrape-results.js`から、Kファイル同期（`syncRecentActualCourse`・`syncRecentRank456`）の呼び出しを外す変数を追加する

データ項目: `race_results.actual_course_1〜6`・`rank4〜6`（Kファイル）。

- [ ] 本番実測: 期待件数（算出根拠: 結果確定済みのレース数（除外: 確定中止）。`actual_course`は全艇分が全てNULLでないこと（欠場艇の列のみNULLは正常。BOA-349の判定に従う）。`rank4〜6`は、直近7日で96.4%（欠場・失格を含み、構造的に100%にならない可能性。原因は未調査）。分母の定義を確定し、除外した件数を報告）に対し、過去分を含めて充足率99%以上（または、構造的な未達の理由を件数付きで説明）であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。Kファイルは開催日の夜〜翌日に公開されるため、窓型ではなく、「公開から取得までの遅延」（当日分の実進入コースは、当日中に取得できない仕様。plan.md・job-inventory.md G10）を実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

---

## Phase 3: オッズ（トラックA）

### T4b-04 オッズ（A3）: `race_odds`

- [ ] **T4b-04-1** `scrape-odds.js`に、レース×窓の入口を追加する（`runForRaces`）。既存の`run`は残す。取得は、会場直列を、レース単位の並列（上限あり）に。5ページ（`oddstf`・`odds3t`・`odds3f`・`odds2tf`・`oddsk`）の取得が一部失敗した場合は`partial`として、同じ行を更新する再試行（`window_min`の一意索引によるupsert）。0分窓の欠けた全通り系は、過去のスナップショットで補完する現行の挙動（`fillMissingFullOddsFromLatestSnapshot`）を維持する。書き込む行に`window_min`・`source='vercel'`を設定する
- [ ] **T4b-04-2** `api/cron/odds.js`: レジストリの`odds`定義（`-60`・`-30`・`-15`・`-10`・`-5`・`0`、許容幅3分、再試行60秒、リース90秒、30件×4レース）
- [ ] **T4b-04-3** 案1の予測リフレッシュ（T4b-03）が有効であることを確認してから着手する（オッズをVercelへ移すと、GitHub側の再計算のきっかけが消える）。GitHub側の再計算の対象から、オッズ由来を外す変数が有効であること
- [ ] **T4b-04-4** `shadow`で3日（`result_digest`と最新の`race_odds`の一致）、`live`で3〜7日並走する。`race_odds.source`（`gha`／`vercel`）ごとに、窓別の窓内取得率を比較する。取得先への追加ページ数（1レース約33ページ、180レースの日で約5,900ページ/日）を、ブレーカーと拒否率の監視のもとで確認する
- [ ] **T4b-04-5** (ユーザー承認) `SKIP_ODDS_ON_GHA=true`にして、切り替え後7日（土日を含む）の窓内取得率を実測する。ADR-0057の窓の意味論の更新（承認後）を、この時点で反映する

データ項目: `race_odds`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降ではなく、全通り系は2026-09-16から保存のため、取得開始日以降のみ（ユーザーの承認が要る）。レース数（除外: 確定中止）×6窓。過去の時系列オッズの各窓は、遡って取得できない）に対し、取得開始日以降を含めて充足率99%以上であることを実測クエリで確認する（窓別・会場別）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓別（60/30/15/10/5/0分前）に、`source`ごとに集計する（現状の直近7日は、60分前89.6%〜5分前93.0%、0分前43.4%で、全て98%未達）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（`expired`は即時）

---

## Phase 4: レース情報・買い目オッズ（トラックA）

### T4b-09 レース情報更新（A1）: `race_entries`・`race_conditions`

- [ ] **T4b-09-1** `update-race-info.js`に、レース単位の入口を追加する（`runForRaces`）。全行upsertは、変更のある行のみ書く現行（WS8(b)、`unchangedRows.js`）を維持する。`beforeinfo`・`racelist`の重複（D2・D3）は、この移行では変更せず、移行後に見直す
- [ ] **T4b-09-2** `api/cron/race-info.js`: レジストリの`race_info`定義（`-60`、許容幅3分、再試行60秒、リース90秒）。成功して変更を書いたときに、案1の予測リフレッシュ（T4b-03）を呼ぶ
- [ ] **T4b-09-3** `shadow`→`live`→`SKIP_RACE_INFO_ON_GHA=true`の手順で切り替える。GitHub側の`scrape-scheduled.js`の`updatedRaceIds`から、レース情報由来を外す（この時点でGitHub側の再計算は不要になる）

データ項目: `race_entries`（レース情報更新分）。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×6艇。行の有無に加え、`racer_id`・`win_rate`等の主要列がNULLでないこと（`racer_id`のNULLは、BOA-325で0件）。`series_day`・`today_weight`のNULLはWS5）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓は60分前。取得時刻列はWS2の`updated_at`（並走中のGitHub側）と、予定表の`done_at`（Vercel側）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

データ項目: `race_conditions`（気象を含む）。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×1行。気象は展示取得側（BOA-358、PR #724）でも更新される）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。気象は、発走直前の観測の割合（`weather_observed_at`、WS9）と、公式との一致率（サンプル100レース）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

### T4b-10 買い目オッズ（A4）: `prediction_odds`

- [ ] **T4b-10-1** D1（A3と同じ`odds3t`・`odds3f`の重複取得）の判断: A4を、`race_odds`の最新スナップショットからの導出に置き換えられるかを確認する。更新頻度の要件（A4は5分ごと、`race_odds`は窓内のみ）と、表示側の要件を確認し、ユーザーに提示する（実装せず、判断のみ）
- [ ] **T4b-10-2** 導出に置き換えない場合: `api/cron/prediction-odds.js`（5分間隔）へ移す。ジョブ単位のリース、現行の`run(raceIds, date)`を再利用し、対象は発走60分以内のレース。`shadow`→`live`→`SKIP_PRED_ODDS_ON_GHA=true`
- [ ] **T4b-10-3** 導出に置き換える場合: 導出の実装は別タスクとして分け、`prediction_odds`の更新をA3の完了に連動させる。この場合、A4のCronは作らない

データ項目: `prediction_odds`。

- [ ] 本番実測: 期待件数（算出根拠: 予想のある、発走前のレース数×1行（1レース1行を上書き）。発走後のレースは対象外）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（履歴の無い表のため、直近の充足を実測）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓型ではなく「発走60分前から発走まで5分ごと」の連続更新のため、`updated_at`の間隔（最大間隔）が5分を大きく超えないこと、発走直前（5分前以内）の更新があることを実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

---

## Phase 6: 展示・特記事項の純正Cron化（トラックA）

### T4b-06 展示（A2）: `exhibition_data`

- [ ] **T4b-06-1** 展示公開時刻の分布を実測する（plan.md U6）: WS2の取得時刻列と`races.start_time`の差（会場別。展示STが先に出る会場を含む）。結果から、レジストリの展示定義（1本のスロット`-33`〜`-7`、再試行120秒）が妥当か、現行の3窓（30/15/10分前）へ戻すかを、ユーザーに提示する
- [ ] **T4b-06-2** `api/cron/exhibition.js`を共通ラッパ・スロット化する（`waitUntil`を廃止し、同期の応答にする）。現行の`getRaceIdsWithExhibitionTime`による取得済みのスキップは`skipped_have_data`として記録する。案1の予測リフレッシュ（T4b-03）を、スロットの完了後に呼ぶ
- [ ] **T4b-06-3** `vercel.json`のcronsに追加して、純正Cronで起動する（cron-job.orgの`Vercel Exhibition Cron`と並走。同じエンドポイントで、リースと冪等により無害）。並走の後に、(ユーザー)cron-job.orgのジョブを停止する
- [ ] **T4b-06-4** 切り替え後7日の窓内取得率を、予定表と、WS2の取得時刻で実測する（展示タイム非NULL基準）

データ項目: `exhibition_data`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×6艇で、`exhibition_time`が非NULL。現状は、行の有無で99.5%、展示タイム非NULL基準で98.2%（未達。鳴門・丸亀・児島・江戸川等で、展示STが展示タイムより先に公開される））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する。未達は理由を件数付きで説明する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓は30・15・10分前（または、実測に基づく1本のスロットの、期限（33分前）から取得までの遅延）。WS2の取得時刻列と、予定表の`done_at`から計測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（既存の`exhibition-gap-monitor.yml`を、`scrape-monitor`へ統合または併存）

### T4b-11 特記事項（A5）: `race_special_notes`

- [ ] **T4b-11-1** `api/cron/race-notices.js`を共通ラッパへ（ジョブ単位のリース、同期の応答、DB障害を200にしない。G13）。`race_notices_health`の毎回のupsertは、変更のある行のみに（D9）
- [ ] **T4b-11-2** `vercel.json`のcronsに追加（10分間隔、`*/10 22-23,0-14 * * *`）。cron-job.orgの登録内容の確認（plan.md、job-inventory.md U1）と、(ユーザー)cron-job.orgのジョブの停止
- [ ] **T4b-11-3** `race_special_notes`が0件（G4）の判別: 通知のある日を、公式ページで確認し、パースの失敗か、通知が無いだけかを判定する（WS5。実装は、その結果に従う）

データ項目: `race_special_notes`。

- [ ] 本番実測: 期待件数（算出根拠: 公式の`race/information`に通知がある、会場×日の通知数（事故・内規違反・減点、モーター・ボート変更、欠場・帰郷）。現状は0件。0件が正常か、パースの失敗かを、通知のある日の実データで判別する。判別できない場合は、その旨と確認方法を報告）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（通知が無い日は、0件が正しい）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓の無い随時掲載型のため、「掲載から取得までの遅延（最大10分）」を、`scraped_at`と公式の掲載時刻（ある場合）から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（既存の構造変化の監視（`race-notices-drift-monitor.yml`）に、0件・未実行の検知を追加）

---

## 並行: `races`初期化（`morning-init`）と公式予想（トラックB）

### T4b-07 朝の初期化（A8）: `races`・`race_entries`・`race_conditions`

- [ ] **T4b-07-1**（基盤を待たず着手可） `scripts/scrape-to-json.js`の取得部分を、ファイルへ書かず、**メモリ上のデータを返す関数**にする（CLIの`main()`は、その関数を呼んでfsへ書く形で残す）。`getTodayVenues`は既にexportされている
- [ ] **T4b-07-2**（T4b-03と`generate-predictions.js`が重なる。T4b-03の後に着手） `generate-predictions.js`の`main()`から、`races.json`のfs読み込み以降の書き込み処理を、**データを引数で受け取る関数**として切り出す（CLIの`main()`は、fsで読んで、その関数を呼ぶ形で残す）。`writeToSupabase`の既存のロジック（変更のある行のみ書く）は変更しない
- [ ] **T4b-07-3** `generate-unified-predictions.js`の`main()`を、CLIガード付きの関数に分ける（import時に`main()`が走る現状の解消）。`scrape-pcexpect.js`も同様（T4b-08-1）
- [ ] **T4b-07-4** `api/cron/races-init.js`（`*/2 20-23,0 * * *`、`maxDuration: 800`）: 会場一覧（`race/index?hd=`）を取得し、会場を4件ずつのチャンクで処理する。進捗を`scrape_job_state.cursor`に保存する。`ensureAllVenuesScraped`相当の取りこぼし会場の確認を、同じチャンク処理に組み込む。各チャンク完了時に`ensure_scrape_slots`でスロットを生成する。最後のチャンクで、unified予測の生成・Deploy Hookを呼ぶ
- [ ] **T4b-07-5** 予測ロジックの変更検知による再生成（`git log`依存）を、内容ハッシュ（ビルド時に計算し、`scrape_job_state`の`predict-code-hash`と比較）へ置き換える（plan.md §11(g)の判断に従う。廃止する場合は、手動のCLI再生成の手順をドキュメントに残す）
- [ ] **T4b-07-6** 24会場の日の所要時間を、プローブで実測する（plan.md U12。会場数を変えて）。結果から、チャンクの会場数・`maxDuration`を調整する
- [ ] **T4b-07-7** `shadow`（05:00 JSTに取得・解析のみ。会場・レース数・出走表のダイジェストを記録）で3日、GitHub Actionsが07:00に書いた値と比較する。一致を確認して`live`にし、3日並走する。GitHub側の`morning-init`は、初期化済みとして、既存の確認処理のみを行う（plan.md §4.6）。切り戻しは、Vercelを`off`にするのみ
- [ ] **T4b-07-8** (ユーザー承認) 7日（土日を含む）の実測後、`morning-init`を`scrape-scheduled.yml`から外す（G3の条件の一部。WS7）

データ項目: `races`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降の開催日ごとの、公式の開催会場×12レース。12レース未満の日は、公式の出走表で確認し、件数付きで説明。開催中止日は除外して件数を報告）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する。`start_time`がNULLのレースが無いこと
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓型ではなく、「当日の最初の発走の60分前までに、その日の`races`が全会場分揃っている」割合を、`races.created_at`と最初の発走時刻から実測する（現行は初回完了が07:35頃の見込み。`races-init`は05:00開始）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（08:00 JSTに当日の`races`が0件、会場の取りこぼし、`races-init`の未完了（`cursor`が終わっていない）を検知）

データ項目: `race_entries`（朝の初期化分）。

- [ ] 本番実測: 期待件数（算出根拠: 上記`races`のレース数×6艇。`racer_id`が非NULL）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。朝の初期化の完了時刻（上記と同じ指標）。取得時刻列は、WS2の`created_at`
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

### T4b-08 公式コンピュータ予想（B1）: `external_predictions`

- [ ] **T4b-08-1**（基盤を待たず着手可） `scrape-pcexpect.js`の`main()`を、CLIガード付きの関数に分け、レース単位の入口（`runForRaces`）を追加する
- [ ] **T4b-08-2** `api/cron/pcexpect.js`（5分間隔）: レジストリの`pcexpect`定義（`-720`、許容幅690分、再試行600秒、リース300秒、20件×3並列）。1レース約10.6秒（実測）のため、1回で約75秒。180レースで約10回の呼び出し。1リクエストが約9秒かかる原因（plan.md U7）の切り分け（取得先の応答か、制限か）を、プローブで確認する
- [ ] **T4b-08-3** 公式コンピュータ予想が、朝の1回の取得で足りるか（発走前に更新されるか）を確認する（U7）。足りない場合は、窓型（発走前の複数窓）への変更を、ユーザーに提示する
- [ ] **T4b-08-4** `shadow`→`live`→（`races-init`の切り替え（T4b-07-8）と同時に）GitHub側の`morning-init`から外す

データ項目: `external_predictions`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×1（公式予想が公開されているレース。公開されないレースの有無を、実データで確認し、除外件数を報告））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（過去分の公式予想が、遡って取得できるかは、WS5で確認。取得できない場合は「取得開始日以降のみ」とし、ユーザーの承認を得る）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。公式予想が発走前に更新される場合は窓型（plan.md U7）。朝の1回で足りる場合は、「発走の30分前までに取得済み」の割合を、`scraped_at`と`race_start_at`から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

---

## 日次・低頻度（トラックC）

各ジョブは、plan.md §4.3の日付解決（`resolveTargetDate`）・補足の起動・0件エラー（期待件数の判定関数）を使う。`git push`・`fs`で書いている成否履歴（health.json等）は、`scrape_job_state.last_report`へ移す。

### T4b-12 得点率（B2）: `racer_series_points`

- [ ] **T4b-12-1** `scrape-point-rank.js`を、対象日を引数で受ける形にして、`api/cron/point-rank.js`へ（`0 13 * * *`、`30 14,16 * * *`）。対象日は`resolveTargetDate`（22:00指定）。0件エラー（記念競走のある日のみ期待あり。PR #715の修正を踏襲）
- [ ] **T4b-12-2** 記念競走以外に表が無い仕様上の空が、0件にどの程度含まれるか（job-inventory.md U13）を、表のある日（SG/G1開催日）に、日付を取り違えない条件での再取得で確認する
- [ ] **T4b-12-3** `live`→`SKIP_POINT_RANK_ON_GHA=true`。対象日がずれる問題（G1）が、Vercelで再発しないことを、実測する

データ項目: `racer_series_points`。

- [ ] 本番実測: 期待件数（算出根拠: 表のある会場（SG/G1等の記念競走の開催）×日ごとの、公式の`pointrank`ページの掲載選手数。現状は0件（原因は日付の取り違え。PR #715で修正済み））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（過去分は、遡って取得できるかをWS5で確認。取得できない場合は「取得開始日以降のみ」）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。日次ジョブのため、窓ではなく、「対象日の結果確定後（22:00 JST以降）、日付が変わる前に取得できた」割合を、`scraped_at`と対象日から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（0件テーブルの検知、`last_target_date`の遅れ）

### T4b-13 進入コース別選手成績（B4）: `venue_entry_course_stats`

- [ ] **T4b-13-1** `scrape-venue-entry-course-stats.js`を、対象日を引数で受ける形にして、`api/cron/entry-course-stats.js`へ（`0 11 * * *`、`30 13 * * *`、`30 15 * * *`）。`git push`・`fs`（health.json）を`last_report`へ（`driftHealth.js`のコア機構は再利用）。当日の出走表がある会場のみ処理し、対象日を`resolveTargetDate`で明示（G2の恒久対策）
- [ ] **T4b-13-2** 表示側の読み手の有無を確認する（job-inventory.md U11。`src/`・`api/`に見つからなかった）。読み手が無い場合、取得を続ける価値をユーザーに提示する
- [ ] **T4b-13-3** `live`→`SKIP_ENTRY_COURSE_ON_GHA=true`

データ項目: `venue_entry_course_stats`。

- [ ] 本番実測: 期待件数（算出根拠: 対象10会場（常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・多摩川）の開催日ごとに、12レース×6枠×6進入コース＝432行/会場/日（2026-09-16の実測）。戸田・浜名湖・宮島はToS制限、児島は非開催期間で未確認のため対象外）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（`racer_id`の解決率も報告）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。日次ジョブのため、「対象日の出走表が揃った後に、対象日のまま取得できた」割合（現状は、日付をまたぐと0件になる）を、`scraped_at`と対象日から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（0件、構造変化）

### T4b-14 会場別モーター成績（B3）: `venue_motor_stats`

- [ ] **T4b-14-1** `scrape-venue-motor-stats.js`を、`api/cron/venue-motor-stats.js`へ（`0 21 * * *`、`0 23 * * *`）。会場間の待機なしで、22会場を取得する現状の負荷を見積もり、並列度の上限・待機を追加する。成否履歴（`venue-motor-stats-health.json`のgit push）を`last_report`へ（BOA-360の`git push`競合の恒久解消）
- [ ] **T4b-14-2** `live`→`SKIP_MOTOR_STATS_ON_GHA=true`

データ項目: `venue_motor_stats`。

- [ ] 本番実測: 期待件数（算出根拠: 対象22会場（戸田・平和島はデータなしで対象外、宮島はPDF）の、会場ごとのモーター数×日次スナップショット（`scraped_date`）。会場ごとのモーター数を、公式の一覧で確認）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（過去分の日次スナップショットは、遡って取得できない場合が多い。「取得開始日以降のみ」とし、ユーザーの承認を得る）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。日次ジョブのため、「その日のレース前（指定06:00 JST）までに取得できた」割合を、`scraped_date`と（あれば）取得時刻から実測する（現状は、`scraped_date`が日付のみで時刻が計測不能。`last_report`に取得時刻を持たせる）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（0件、14日連続失敗の構造変化を維持）

### T4b-15 選手ニュース（B5）: `racer_news`

- [ ] **T4b-15-1** `pending.json`（人手確認リスト）のコミットを、DBの表へ移す（plan.md §11(i)の判断に従う）。`session-start-check.js`の読み先を、DBに変更する（`.claude/rules/content-ops.md`フローC-4の手順も更新）。`collect-racer-news.js`を`api/cron/racer-news.js`へ（`10 14 * * *`、`10 16 * * *`）
- [ ] **T4b-15-2** `live`→`SKIP_RACER_NEWS_ON_GHA=true`

データ項目: `racer_news`。

- [ ] 本番実測: 期待件数（算出根拠: 公式ニュースの「レーサーデータ」カテゴリ（`site/news/racer/{YYYY}/{MM}/`）の一覧に掲載された節目記録の記事のうち、選手を特定できたもの。月1〜2件と少ない。一覧ページと、`racer_news`＋`pending`の件数を突合）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。可変データではなく、記事の公開から取得までの遅延（日次）を、`racer_news.created_at`と公開日から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（ジョブ自体の失敗検知、`pending`の滞留）

### T4b-16 選手プロフィール・期別成績（B6）: `racer_profiles`

- [ ] **T4b-16-1** `scrape-racer-profiles.js`（`scripts/maintenance/`）を、`api/cron/racer-profiles.js`へ。1,627人を300人程度のチャンクで処理し、位置を`cursor`に保存して再開可能にする（`*/10 0-3 1 * *`、`*/10 0-3 8,15 5,11 *`）。`profile-scrape-report.json`のgit pushを`last_report`へ。取得ロジックは`scripts/lib/racerProfileSync.js`を再利用する
- [ ] **T4b-16-2** 初回実行（`ability_index`が0/1,627件）は、WS5で手動実行する（少数のdry-runから段階的に。PR #721の修正後）。実行時間の実測（plan.md、job-inventory.md U9）を、チャンクの人数の調整に使う
- [ ] **T4b-16-3** `live`→`SKIP_RACER_SEASON_ON_GHA=true`

データ項目: `racer_profiles`。

- [ ] 本番実測: 期待件数（算出根拠: `race_entries`に登場した全`racer_id`（約1,627人）。`ability_index`・期別成績の列が非NULL。現状は`ability_index`が0/1,627件）に対し、充足率99%以上であることを実測クエリで確認する（過去の期別の値は、遡って取得できない。「取得開始日以降のみ」とし、ユーザーの承認を得る）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。半年に1回しか変化しないため、窓型ではない。「月次の指定日（1日09:00 JST）から3日以内に全選手を取得できた」割合と、期の切り替わり（5/1・11/1）直後の追従を、`scraped_at`・`official_updated_at`から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（月次ジョブの未実行の検知（実行履歴0件のまま見逃した実績あり）、`cursor`の未完了）

---

## Phase 7: 最終検証と旧基盤の廃止（WS7、G3）

- [ ] **T7-01** 全データセットの、完了の定義A・B・Cの実測を再実行し（`scripts/analysis/data-health-report.js`、WS1）、証拠（クエリと結果）を、orchestration.mdに記録する
- [ ] **T7-02** (ユーザー承認) 取得系のGitHub Actions（`scrape-scheduled.yml`・`scrape-point-rank.yml`・`scrape-venue-motor-stats.yml`・`scrape-venue-entry-course-stats.yml`・`collect-racer-news.yml`・`scrape-racer-season-stats.yml`）を、コードを残したまま、`SKIP_*_ON_GHA=true`で停止した状態で、土日を含む7日間、本番データが欠けないことを実測で確認する（G3）
- [ ] **T7-03** (ユーザー) cron-job.orgの全ジョブ（`scrape-scheduled`・`exhibition`・`race-notices`・`aggregate-stats`のdispatch等）を停止・削除する。`docs/operation/external-cron-setup.md`を、廃止または更新する。`aggregate-stats`のdispatchは、取得ではなくDB内集計のため、GitHub Actionsの`schedule`で足りるか、別の起動元が要るかを、ユーザーに確認する
- [ ] **T7-04** 旧基盤のコード・ワークフローを削除する: 取得系のGitHub Actionsワークフロー、`scrape-scheduled.js`・`morning-init.js`、`SKIP_*_ON_GHA`変数、`api/scrape-races.js`（利用の有無を全期間で確認した後。plan.md U11）、展示の旧実装（D5: `scrape-to-json.js`・`api/scrape-races.js`のbeforeinfo別パーサー）。`continue-on-error`を残さない
- [ ] **T7-05** 既存ドキュメントに、置き換えの注記を追記する（plan.md §12）。ADR-0057（窓の意味論）・ADR-0066（移行specの参照先）を更新する。orchestration.mdのWS4a・WS4b・WS7を完了に更新する

**完了条件（G3）**: `morning-init`を含む全取得処理がVercelへ移行済みで、旧基盤を止めても本番データが欠けないことを実測で確認している。
