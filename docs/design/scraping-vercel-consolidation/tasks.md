# データ取得基盤のVercel一本化 tasks

> [plan.md](./plan.md)の設計判断(a)〜(j)は、2026-09-20に、すべて推奨案で承認された。本文書は、承認された設計に基づくタスク分解で、着手してよい。**本番DBのDDLの適用と、外部サービスの設定変更は、着手のたびにユーザーの承認が要る**（下記「進め方」）。

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

- [x] **T0-01** WS2（取得時刻列の追加。`exhibition_data`・`race_entries`・`race_start_timings`）が、マイグレーション適用済み・コードのマージ済みであることを確認する。並走比較（GitHub側の行の取得時刻）に必要（[orchestration.md](./orchestration.md) WS2）。2026-09-23実測: 3テーブルとも`created_at`・`updated_at`が本番に存在（`information_schema.columns`で確認）。PR #727はマージ済み（2026-09-19）
- [x] **T0-02** BOA-349（過去日の進入コース再同期が毎回全件UPDATE）の修正（PR #716でマージ済み）の効果を、`pg_stat_user_tables`の`n_tup_upd`（`race_results`）で確認する。Phase 2の前提（結果取得をVercelへ移しても、不具合が引き継がれるため）。2026-09-23実測: [orchestration.md](./orchestration.md)「T0ゲート実測」参照。`race_entries`・`races`のn_tup_updが9/20 11時台からほぼ横ばい（+0.15%/3日）に転じており、修正が効いていることを確認。`race_results`自体は修正前の個別ベースラインが未記録のため、今回の値（315,097）を新たな基準点として記録し、以降の伸び率で確認する
- [x] **T0-03** 修正後の展示欠落率モニター（BOA-350）で、土日を跨ぐ変動（9/19・9/20分は9/20・9/21朝に確定）を確認し、Phase 2着手のゲート（BOA-313 Step 4）を満たすことを、ユーザーに報告する。2026-09-23実測: 9/19欠落0.11%（1/936）、9/20欠落0.10%（1/1008）で、修正前ベースライン（9/17: 20件、9/18: 29件欠落）から大幅改善。土日を跨いでも悪化なし。**ゲート条件を満たす**
- [x] **T0-04** BOA-352（Supabase障害の対応）・BOA-354（結果7レースの欠損）の状況を確認し、Phase 2の前に必要な対応を洗い出す。2026-09-23実測: BOA-352の再発防止PR #712はマージ済み（2026-09-19）。BOA-354のバックフィルツールPR #711もマージ済みで、実際に9/14〜9/22の期間で未確定中止を除く結果欠損は0件（`races`と`race_results`の突合で確認）。両方とも対応済みと判断してよい。**Linear側のチケット状態（Done等への更新）は、このセッションではLinear MCP未認証・`.env.local`がこのworktreeに存在せず`linear-cli.js`も使えないため未確認**。ユーザーまたは別セッションでの更新を推奨

## Phase 1: 共通基盤（WS4a、トラックA）

目的: 予定表・共通ラッパ・監視を作り、1つのジョブ（結果取得）で動く状態にする（[orchestration.md](./orchestration.md) WS4aの完了条件）。

- [x] **T4a-01** (ユーザー) Vercelの環境変数に`SLACK_WEBHOOK_URL`・`VERCEL_DEPLOY_HOOK`が設定されているかを確認し、無ければ設定する。値はAgentに渡さず、名前の有無のみを確認する（plan.md U10、リスクR15） — 完了（2026-09-20: Vercel Productionに`SLACK_WEBHOOK_URL`を登録済み。`VERCEL_DEPLOY_HOOK`はVercel側に無く、不要方針）
- [x] **T4a-02** スキーマ確定とマイグレーション案の作成（`docs/db-migration/`、番号は`origin/master`の最大番号+1）: `scrape_slots`・`scrape_job_state`・`race_odds`の`window_min`・`source`・部分一意索引、RPC 2本（`ensure_scrape_slots`・`claim_scrape_slots`）。ヘッダーコメントに`docs/design/scraping-vercel-consolidation/plan.md`を参照する。`node scripts/maintenance/generate-er-diagram.js scraping-vercel-consolidation`の出力で、plan.md §3.4の手書きER図を置き換える。`npm run verify:migration-numbers`・`npm run verify:er-diagram`を実行し、`APPLIED.md`に「未適用」の行を追加する。1行のサイズ見積り（`pg_column_size`の軽い集計。plan.md U4）を記録する。**本番には適用しない** — 完了（PR #733。マイグレーションは075に番号変更）
- [x] **T4a-03** (ユーザー承認) T4a-02のマイグレーションを本番へ適用する（ユーザーの対話ターミナル、またはManagement API）。適用後、`information_schema`・`pg_proc`・`pg_index`で、テーブル・列・関数・索引の存在を確認し、`APPLIED.md`を「適用済み」に更新する。RPCの動作を、`races`の1日分で、書き込みを伴う最小の確認（`ensure_scrape_slots`で行数、`claim_scrape_slots`が0件を返すこと）で検証する — 完了（2026-09-20 11:4x JSTに適用。実測はAPPLIED.md）
- [x] **T4a-04** リージョン・取得先のプローブ（一時的。マージせず、または確認後に削除する）: `regions`をsyd1・hnd1の2通りに指定した関数で、(1)Supabaseの軽い読み取りのRTT（10回の中央値）、(2)boatrace.jpの代表ページ（`raceresult`・`odds3t`）の取得時間・成功率（10回）、(3)`VERCEL_REGION`を計測する。現在のリージョン・Fluid Computeの状態（plan.md U1・U2）を確認し、結果からジョブ単位のリージョンの案（plan.md §8）を出す。取得先へのリクエストは最小限にする — 完了（プローブは2026-09-20 10:10〜10:20 JST、boatrace.jpへ最大26回。結果はplan.md §8・U1/U2。関数リージョンはiad1、DB(シドニー)まで約250ms、syd1なら約28〜46ms。boatrace.jpの応答は約8〜10秒でリージョン差なし。syd1への変更はユーザー承認待ち）
- [x] **T4a-05** 共通ラッパ: 認証（`CRON_SECRET`の定数時間比較を共通化）、`scrape_job_state.mode`（`off`／`shadow`／`live`）の読み取り、同期の応答（`waitUntil`を使わず、完了後に200/500）、ソフトデッドライン、`getRaceSchedule`の例外モード（DBエラーを空配列にしない。BOA-359と同型）、`last_tick_at`（5分に1回）・`last_success_at`・`last_error`の更新 — 完了（PR #737）
- [x] **T4a-06** スロット操作ライブラリ: `claim_scrape_slots`の呼び出し、完了・再試行・失敗の条件付き更新（`claimed_by`一致）、`outcome`・`rows_written`・`result_digest`の記録、リース奪取後の二重完了の防止。`scripts/maintenance/verify-*.js`の形式で、DBを使わない単体検証（状態遷移・リース・期限計算のJST）を追加する — 完了（PR #737）
- [x] **T4a-07** `politeFetch`とバックオフ・サーキットブレーカー（BOA-368）: 15秒タイムアウト（既存の`supabaseClient.js`のパターン踏襲）、429/503の指数バックオフ（ジッター、2回まで）、ホスト単位のブレーカー（`scrape_job_state`の`host:boatrace.jp`）、並列度の上限。閾値はplan.md §8の初期値 — 完了（PR #737）
- [x] **T4a-08** ジョブレジストリと日次ジョブの雛形: `scripts/lib/scrapeJobs/registry.js`（plan.md §3.6の窓・許容幅・再試行・リース・並列度・完了条件）、`resolveTargetDate(now, 指定時刻)`（plan.md §4.3）、日次ジョブの雛形（`last_target_date`による冪等・補足の起動・期待件数の判定関数による0件エラー） — 完了（PR #737）
- [x] **T4a-09** `scrape-monitor`（`api/cron/scrape-monitor.js`）: plan.md §7の指標（窓内取得率・遅延・`expired`・未実行・0件・死活・連続失敗・ブレーカー）を、予定表・ジョブ状態のSQLで計測し、Slackへ通知する（5分ごとは当日のみ、7日集計は1時間に1回）。監視自体の実行を`scrape_job_state`に記録する。メタ監視として、`scrape-monitor`の`last_tick_at`の鮮度を日次で確認するGitHub Actionsのワークフローを追加する（`exhibition-gap-monitor.yml`と同じ方式。通知は既存の`SLACK_WEBHOOK_URL`） — 完了（PR #738。本番で`scrape-monitor`のCronが5分ごとに200を返すことを確認: 2026-09-20 02:35・02:40 UTC）
- [ ] **T4a-10** 疑似ジョブでの検証（`mode=off`→`shadow`）: 取得先へアクセスしない疑似ジョブ（スロットを消化するだけ）で、重複配信・リースの奪取・二重claim・期限計算のJST・順延の追従（plan.md U9・U16）と、環境変数の変更が再デプロイなしに反映されるか（U17）を、Previewの手動リクエストと、本番の`shadow`で確認する。Vercel Cronの実際の未配信・重複の頻度を計測する。**Previewでは、Cronが発火しない**（productionのみ）ため、手動リクエストで検証する — 一部完了（2026-09-20）: 実DBで`verify-scrape-slots-on-db.js --execute`が全通過（ensure冪等、8本同時claimで二重claimなし、リース奪取、expired、後片付け）。未実施: Vercel上の疑似ジョブでの`mode=off`→`shadow`と、環境変数変更の再デプロイなし反映の確認（WS4bの最初の`shadow`開始時に実施）
- [x] **T4a-11** `vercel.json`に`crons`を追加する（基盤のみ先行: `scrape-monitor`・`scrape-cleanup`）。`scrape-cleanup`（`api/cron/scrape-cleanup.js`）は、予定表の`race_date`が60日より古い行を日次で削除する。cron式はUTCで、JSTをコメントで併記する。既存の`api/`のヘッダー設定（`Access-Control-Allow-Origin: *`）が、cronのエンドポイントに問題ないことを確認する — 完了（PR #738。2026-09-20、本番でcrons登録・401（未認証）・200（Cron）を確認）

**Phase 1の完了条件**: ラッパが1つのデータセット（T4b-02）で動く。監視が、疑似ジョブの`expired`・未実行を検知して、Slackに通知する。

---

## Phase 1.5: 予測リフレッシュ（案1、Phase 1と並行して早期に着手）

### T4b-03 予測リフレッシュ（A7、`predictions`の再計算）

- [x] **T4b-03-1** `mainRefresh`をVercelで動かせる形にする（`scripts/daily/generate-predictions.js`）: `process.exit(1)`を例外に、`process.argv`（`parseDateArg`）の日付を引数に、Deploy Hookは`decideDeployHook`の抑制を維持する（Vercelの環境変数の有無に従う）。既存のGitHub Actions経路の挙動は変えない。`node scripts/maintenance/verify-deploy-hook-policy.js`ほか既存の検証が通ることを確認する
- [x] **T4b-03-2** `api/cron/exhibition.js`（現行の`waitUntil`版）の内側で、`runExhibition`が変更を書いたレース（30/15/10分前の窓のレース）に対し、`mainRefresh`を呼ぶ。`REFRESH_ON_VERCEL`フラグで有効化する。GitHub側は、`scrape-scheduled.js`の`updatedRaceIds`から、オッズ由来の追加を外す変数（`SKIP_ODDS_REFRESH_ON_GHA`等。名称は実装時に決める）で切り替える。**併走させない**（plan.md §5 併走の防止）。切り替えの順序と、切り戻しの手順をPR本文に書く
- [x] **T4b-03-3** 展示更新が再計算のきっかけから外れた影響（plan.md U8）を、GitHub Actionsの実行ログで確認する（2026-09-16以降の、展示由来の再計算の有無）。Vercelでの`mainRefresh`の所要時間（26レース時の約8秒が実測か、週末のピーク）と、`predictions`の`UNIQUE`制約の有無（plan.md U14）を確認する
  - 実装（PRの説明に、切り替え・切り戻しの順序）: `mainRefresh`は、`process.exit`を例外に、`date`・`writeMode`（`replace`＝従来／`upsert`）・`client`・`now`を引数に追加、`race_id`の一括取得を100件ずつに分割（1000行上限）。展示取得（`scrape-exhibition-data.js`）が、実際に書き込んだレースを`changedRaceIds`で返す。トグルは`REFRESH_ON_VERCEL`（Vercel）と`SKIP_ODDS_REFRESH_ON_GHA`（GitHubのリポジトリ変数）。組み合わせと順序は`scripts/lib/predictionRefresh.js`、手順は[verification-runbook.md](./verification-runbook.md) J
  - 確認（T4b-03-3）: U8（展示由来の再計算は9/16以降0件。ただし、オッズの窓が同じ時刻に再計算を起動しており、9/20の46レースで、全レースの予測が展示の最終書き込みより後）、U14（`UNIQUE (race_id, model_id)`あり）。詳細は[plan.md](./plan.md) §5「案1の実装で確認した事項」。**unifiedの日全体の再生成が止まる影響（有効化前にユーザー判断）を含む**
- [ ] **T4b-03-4** `REFRESH_ON_VERCEL`を有効化する（ユーザーの承認）。切り替え後、再計算の回数（`predictions`のINSERT・DELETE、`n_tup_ins`）が、約55%減の見込みどおりかを実測する。手順・確認クエリは[verification-runbook.md](./verification-runbook.md) J

データ項目: `predictions`（再計算）。

- [ ] 本番実測: 期待件数（算出根拠: 展示・レース情報の変更を書いたレース数。各レースにつき、再計算後も`predictions`が空にならず、3モデル＋unifiedの行が揃う）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（`DELETE→INSERT`が非トランザクションで、間に空になる瞬間があるため、再計算の直後に空のレースが残らないこと）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。ここでは「展示・レース情報の取得成功から、予測の再計算が完了するまでの遅延」（`predictions.predicted_at`と、予定表の`done_at`の差）を実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（再計算の回数の急増・空の`predictions`のレース数を含める）

---

## Phase 2: 結果取得（トラックA）

### T4b-02 結果取得（A6）: `race_results`・`race_start_timings`

- [x] **T4b-02-1**（コード実装済み。`runForRaces`、`fixMissingHitFlags`は日次の`result-catchup`へ） `scrape-results.js`に、レース単位の入口を追加する（例: `runForRaces(races, { date })`）。既存の`run(schedule, date)`は残す（二重実装しない）。的中フラグの補完（`fixMissingHitFlags`）は、完了したレースのみを対象にする（直近10日のスキャンを毎回やめ、日次に1回へ）。結果の完了判定（`payout_win`・`winning_technique`）は現行と同じ
- [x] **T4b-02-2**（コード実装済み。cron窓は翌00:59まで延長、中止・順延の確定は毎分の`onTick`。マージ後も`mode`が`off`の間は何もしない） `api/cron/result.js`: 共通ラッパ・レジストリの`result`定義（`+5`分から`+90`分、再試行300秒、リース180秒、40件×4並列）で、スロットを消化する。`+90`分での未完了は、既存の中止・順延の確定処理（`confirmOverdueCancellations`）へ
- [ ] **T4b-02-3** `scrape_job_state`に`result`を`shadow`で登録する（DBの更新。ユーザーの承認）。`shadow`で3日（土日のいずれか1日を含む）: 一致率（`result_digest`と、GitHub側が書いた`race_results`の値）、窓内取得率、1回の呼び出しの所要時間（plan.md U13）、取得先の拒否率（U3）、Vercelの使用量（U5）を計測する
- [ ] **T4b-02-4**（`SKIP_RESULTS_ON_GHA`のコードは実装済み。既定はfalse。手順は[verification-runbook.md](./verification-runbook.md) §F） `live`にして3日並走する（二重書き込みは上書き型で無害）。GitHub側の結果取得を止めるリポジトリ変数`SKIP_RESULTS_ON_GHA`を、`scrape-scheduled.js`・`scrape-scheduled.yml`に追加する（コードは削除しない。展示の`SKIP_EXHIBITION_ON_GHA`と同じ方式）
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

- [x] **T4b-05-1**（コード実装済み。LZH展開の動作確認（U15）は、`?probeDate=`の手動リクエスト。runbook §G） Kファイル同期を、独立のジョブ（`api/cron/kfile-sync.js`、日次07:00・12:00 JST）へ切り出す。進入コース（`syncActualCourseFromKFile`）とrank4〜6（`syncRank456FromKFile`）が、同じ日のKファイルを別々にダウンロードしている重複（D4）を解消し、1回のダウンロードで両方を処理する。BOA-349の修正（変更のある行のみ書く）を維持する。`@kirinsaninc/lhats`（LZH展開）が関数内で動くか、Previewの手動リクエストで確認する（plan.md U15）
- [x] **T4b-05-2**（コード実装済み。cronは23:50と翌00:30の2回） `api/cron/result-catchup.js`（日次23:50 JST）: 当日`expired`になった`result`のスロットを再取得し、補填する。完了の定義Aを守るための後追い（Bの計測は、expiredの記録が残る）
- [ ] **T4b-05-3**（`SKIP_KFILE_ON_GHA`のコードは実装済み。既定はfalse。手順はrunbook §G） `shadow`→`live`→`SKIP_KFILE_ON_GHA=true`の手順で切り替える。GitHub側の`scrape-results.js`から、Kファイル同期（`syncRecentActualCourse`・`syncRecentRank456`）の呼び出しを外す変数を追加する

データ項目: `race_results.actual_course_1〜6`・`rank4〜6`（Kファイル）。

- [ ] 本番実測: 期待件数（算出根拠: 結果確定済みのレース数（除外: 確定中止）。`actual_course`は全艇分が全てNULLでないこと（欠場艇の列のみNULLは正常。BOA-349の判定に従う）。`rank4〜6`は、直近7日で96.4%（欠場・失格を含み、構造的に100%にならない可能性。原因は未調査）。分母の定義を確定し、除外した件数を報告）に対し、過去分を含めて充足率99%以上（または、構造的な未達の理由を件数付きで説明）であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。Kファイルは開催日の夜〜翌日に公開されるため、窓型ではなく、「公開から取得までの遅延」（当日分の実進入コースは、当日中に取得できない仕様。plan.md・job-inventory.md G10）を実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

---

## Phase 3: オッズ（トラックA）

### T4b-04 オッズ（A3）: `race_odds`

- [x] **T4b-04-1**（コード実装済み。`runForRaces`・`fetchOddsDetailed`。既存の`run`は残し、解析・行の組み立て・0分窓の補完を共有） `scrape-odds.js`に、レース×窓の入口を追加する（`runForRaces`）。既存の`run`は残す。取得は、会場直列を、レース単位の並列（上限あり）に。5ページ（`oddstf`・`odds3t`・`odds3f`・`odds2tf`・`oddsk`）の取得が一部失敗した場合は`partial`として、同じ行を更新する再試行（`window_min`の一意索引によるupsert。再試行は前回の値を引き継ぎ、nullで上書きしない）。0分窓の欠けた全通り系は、過去のスナップショットで補完する現行の挙動（`fillMissingFullOddsFromLatestSnapshot`）を維持する（自分の窓の行は補完元にしない）。書き込む行に`window_min`・`source='vercel'`を設定する。shadowは取得・解析のみで、構造のダイジェスト（`oddsDigest.js`）を`result_digest`に記録する
- [x] **T4b-04-2**（コード実装済み。`api/cron/odds.js`。マージ後も`mode`が`off`（行なし）の間は何もしない） `api/cron/odds.js`: レジストリの`odds`定義（`-60`・`-30`・`-15`・`-10`・`-5`・`0`、許容幅3分、再試行60秒、リース120秒、24件×4並列。WS4aの調整後の値）、`vercel.json`のcrons（毎分、JST 07:00〜23:59）
- [x] **T4b-04-3**（`SKIP_ODDS_ON_GHA`のコードは実装済み。既定はfalse。順序は[verification-runbook.md](./verification-runbook.md) M-1） 案1の予測リフレッシュ（T4b-03）が有効であることを確認してから着手する（オッズをVercelへ移すと、GitHub側の再計算のきっかけが消える）。GitHub側の再計算の対象から、オッズ由来を外す変数（`SKIP_ODDS_REFRESH_ON_GHA`）が有効であること。`scrape-scheduled.js`は、`SKIP_ODDS_ON_GHA=true`で`SKIP_ODDS_REFRESH_ON_GHA`がtrueでないとき警告する
- [ ] **T4b-04-4**（手順・確認SQL・成功基準・ロールバックは[verification-runbook.md](./verification-runbook.md) M-2・M-3。確認スクリプトは`check-odds-shadow.js`） `shadow`で3日（`result_digest`（構造のダイジェスト）と、同じレースの既存基盤の行の一致）、`live`で3〜7日並走する。`race_odds.source`（`gha`／`vercel`）ごとに、窓別の窓内取得率を比較する。取得先への追加ページ数（1レース約33ページ、180レースの日で約5,900ページ/日）を、ブレーカーと拒否率の監視のもとで確認する
- [ ] **T4b-04-5** (ユーザー承認。手順はM-4・M-5) `SKIP_ODDS_ON_GHA=true`にして、切り替え後7日（土日を含む）の窓内取得率を実測する。ADR-0057の窓の意味論の更新（承認後）を、この時点で反映する

データ項目: `race_odds`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降ではなく、全通り系は2026-09-16から保存のため、取得開始日以降のみ（ユーザーの承認が要る）。レース数（除外: 確定中止）×6窓。過去の時系列オッズの各窓は、遡って取得できない）に対し、取得開始日以降を含めて充足率99%以上であることを実測クエリで確認する（窓別・会場別）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓別（60/30/15/10/5/0分前）に、`source`ごとに集計する（現状の直近7日は、60分前89.6%〜5分前93.0%、0分前43.4%で、全て98%未達）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（`expired`は即時）

### T4b-23 朝の最初のレースの、発走60分前のオッズの未公開を、監視の対象外（想定内）にする（BOA-386）

設計・実測: [verification-runbook.md](./verification-runbook.md) M-7 / 定義の正本: `scripts/lib/scrapeJobs/expectedUnpublished.js` / 新しいテーブル・マイグレーション・`scrape_job_state`の`mode`の変更は無い（監視の判定の補正のみ。本番のDDL・設定変更は要らない）。

- [x] **T4b-23-1**（コード実装済み。`scripts/lib/scrapeJobs/expectedUnpublished.js`（定義の正本・SQLの式）・`monitor.js`（`classifyExpectedUnpublished`・`evaluateExpired`・`computeWindowStats`・日次サマリー・`collectMonitorInput`）・`scripts/analysis/data-health-report.js`（同じ定義の窓内取得率）。検証: `npm run verify:scrape-monitor`・`verify:data-health-report`。変異検証済み（監視15件・レポート8件、全て検出）） 各会場・日の第1レース（`races`の最小のレース番号）の`odds`の`-60`窓が、`no_values`（未公開）で期限切れになっても、後続の窓（`-30`〜`0`）のどれかが取れていれば、`expired`の警告を出さず、窓内取得率の分母から外して「未公開(想定内)」として別に数える。後続の窓も取れなければ、従来どおり警告する。後続の窓が未到来の間は、警告を保留する
- [ ] **T4b-23-2** (親・ユーザー) マージ・デプロイ後、翌営業日の朝（第1レースが08時台の会場がある日）に、`scrape-monitor`のSlack通知に第1レースの`-60`の`expired`が出ないこと、日次サマリー（翌日01:00頃）の`odds`の行に「未公開(想定内・分母から除外) 前日 N件」が出ることを確認する。9/23 06:30のオッズのGitHub側停止の朝は、この確認を先に済ませておく

データ項目: `race_odds`（新しい項目は無い。完了の定義B・Cの判定の補正）。

- [ ] 本番実測: 想定内の未公開の件数を、直近7日（土日を含む）の各日・窓（`-60`）で実測する（`data-health-report.js`の「第1レースの60分前の窓」。第1レース・窓内・想定内の未公開・取れていない（後続の窓にも無い）の日別の件数）。除外は、後続の窓で公開が確認できたものだけ（確認できない第1レースの`-60`は、除外しない）。2026-09-22の実測（9/15〜9/21）: 第1レース94件のうち窓内76・想定内の未公開18・取れていない0。`-60`の全体は、除外なし88.9%（993/1,117）→ 除外後90.4%（993/1,099）
- [ ] タイミング実測: 完了の定義B（窓内取得率98%以上）は、除外後の値（`rateAdjusted`）で判定し、除外なしの値・除外件数を併記する。土日を含む直近7日で確認する。**第1レース以外の`-60`（R2以降）と、第1レースの`-30`にも、同種の未公開が残る**（runbook M-7の未確認事項）ため、この補正だけでは`-60`は98%に届かない（除外後90.4%）
- [ ] 継続監視: 第1レースの`-60`の未公開が、警告（`expired`）にも窓内取得率の警告にも出ず、日次サマリーに「未公開(想定内・分母から除外)」として毎日出る（0件でも出す）こと。後続の窓も取れなかった第1レースは、`expired`として通知される（後続の窓が全て過ぎる、最大で発走の3分後に）ことを、実際の事象で確認する

### T4b-24 完了の定義Bの`-60`の窓の基準の見直し: 未公開の間、`-30`の窓が始まるまで1分間隔で再試行する（BOA-386続き、`.claude/rules/data-acquisition.md`のB）

設計・実測: [verification-runbook.md](./verification-runbook.md) M-8 / 定義の正本: `scripts/lib/scrapeJobs/expectedUnpublished.js`（T4b-23と共有）/ 新しいマイグレーション: `docs/db-migration/092_claim_scrape_slots_by_offset.sql`（既存の`claim_scrape_slots`・`scrape_slots`・`ensure_scrape_slots`は変更しない。新関数の追加のみ）。T4b-23（後続の窓で確認できたものを分母から除外）だけでは、除外後も第1レース以外の`-60`・第1レースの`-30`に未公開が残り98%に届かない上、除外した分の「取得の遅れの大きさ」自体が計測されていなかった。これを埋める。

- [x] **T4b-24-1**（コード実装済み。`registry.js`の`odds`に`graceMinByOffset: {-60: 30}`（`-60`だけ許容幅を30分＝`-30`の窓の開始まで延長。他の窓・他のジョブは変えない）、`store.js`の`claimSlots`が上書きのあるジョブだけ新関数`claim_scrape_slots_by_offset`（092）を呼び、関数が無い（`PGRST202`）ときだけ既存の`claim_scrape_slots`へ自動フォールバックする（`cronWrapper.js`が`scrape_job_state.last_report.alerts`に残し、監視が通知する。延長が効かない状態を黙って放置しない）、`oddsHandlers.js`・`scrape-odds.js`の`winFirst`（未公開の間の再試行は単勝1ページの確認に絞り、取得先への追加リクエストを抑える）、`expectedUnpublished.js`に`isExtensionSuccess`（延長で取得できた判定）・`detectionLagOf`/`summarizeDetectionLags`（発売開始の検知の遅れの計測。定義はファイル冒頭コメント）を追加、`monitor.js`に`evaluateDetectionLag`・日次サマリーの検知の遅れの行、`data-health-report.js`に`detectionLag`クエリ・集計・Markdown・警告（近似値。予定表の実際の試行時刻は読まない設計のため、監視側が正確に計測する役割分担）。検証: `npm run verify:scrape-jobs`・`verify:scrape-monitor`・`verify:scrape-odds-job`・`verify:data-health-report`・`verify:scrape-slots-sql`（PGliteで092を適用し、`p_grace_by_offset='{}'`のとき既存の`claim_scrape_slots`と同じ結果になる差分テスト、`-60`の延長・他の窓が変わらないこと、権限がservice_roleのみであることを確認）。変異は加えていないが、既存の変異検証（monitor・data-health-report）に新規ケースを追加して確認）
- [ ] **T4b-24-2**（親・ユーザー承認。DDL適用） `docs/db-migration/092_claim_scrape_slots_by_offset.sql`を、Supabase Dashboard/Management APIで適用する（関数追加のみ・テーブル変更なし・ロック影響なし、開催時間帯でも適用可）。適用後、`APPLIED.md`の092行を「適用済み」に更新する。コードは適用前でもマージ・デプロイして安全（新関数が無い間は既存の`claim_scrape_slots`へフォールバックし、延長は効かないだけ）
- [ ] **T4b-24-3** (親・ユーザー) マージ・DDL適用後、翌営業日以降の日次サマリーで、`odds`の「発売開始の検知の遅れ」が、5分以内の割合98%以上に近づくこと（延長前の実測はp50 27.6分・p95 47.4分・5分以内0%。runbook M-8）、`scrape_job_state`の`odds`の`last_report.alerts`にフォールバックの通知が出ていないこと（=092が適用され新関数が使われていること）を確認する

データ項目: `race_odds`（新しい項目は無い。完了の定義Bの`-60`の判定・再試行方式の変更）。

- [ ] 本番実測（2026-09-22、読み取りのみ）: 直近7日（9/16〜9/21）の`-60`の未公開（窓内に取れず）は、第1レース16/81（19.8%）・第1レース以外104/880（11.8%）、合計120件。このうち後続の窓で確認できたのは115件（5件は後続の窓にも取れず、本当の欠落）。発売開始の検知の遅れ（後続の窓での取得時刻－窓が閉じた時刻の近似値、延長導入前）はp50 27.6分・p95 47.4分・最大52.6分、5分以内の割合0%（0/115）。延長導入により、未公開の間1分間隔で再試行するため、この遅れがおおむね1分程度に縮む見込み（`verify-scrape-slots-sql.js`のPGliteシナリオで、延長中は毎分再試行できることを確認済み）
- [ ] タイミング実測: 延長後、直近7日（土日を含む）で、発売開始の検知の遅れが5分以内の割合98%以上であることを確認する（`data-health-report.js`の「発売開始の検知の遅れ」の表）。延長しても後続の窓でしか取れない（検知の遅れが5分を超える）件数が多い場合、延長の許容幅・再試行間隔の見直しが要る
- [ ] 追加リクエストの見積り: `-60`が未公開のレースだけ、発売開始まで（最大27分、1分間隔）×1ページ（単勝のみ、`winFirst`）の追加リクエストが発生する。直近7日の実測（1日あたり未公開のレース数、上記の120件/6日≒20件/日）から、1日あたり最大約540リクエスト（20件×最大27回）の増加見込み。取得先が共有ブレーカーで保護されているため、失敗率の悪化が無いかも合わせて確認する
- [ ] 継続監視: 上記が閾値を割った場合の`data-health-report.js`の警告（`kind: "detection_lag"`）と、`scrape-monitor`の日次サマリー・`evaluateDetectionLag`（5分超が1件でも通知）が機能することを、実際の事象で確認する

---

## Phase 4: レース情報・買い目オッズ（トラックA）

### T4b-09 レース情報更新（A1）: `race_entries`・`race_conditions`

- [x] **T4b-09-0**（コード実装済み。DDL案081は未適用。ユーザー承認待ち） 出走表の全項目化（[pre-race-full-fields/plan.md](../pre-race-full-fields/plan.md)）: 解析は`scripts/lib/raceListParser.js`（純関数）、行の組み立て・締切予定時刻による`races.start_time`の追従は`scripts/lib/preRaceRows.js`、未適用のDBでの安全な書き込みは`scripts/lib/preRaceSchema.js`。`update-race-info.js`の`run`は、この解析・行の組み立てを使い、`client`・`syncDeadlines`を引数に取る（`runForRaces`は、この上に作る）。検証: `npm run verify:pre-race-parsers`
- [x] **T4b-09-1** `update-race-info.js`に、レース単位の入口を追加する（`runForRaces`）。全行upsertは、変更のある行のみ書く現行（WS8(b)、`unchangedRows.js`）を維持する。`beforeinfo`・`racelist`の重複（D2・D3）は、この移行では変更せず、移行後に見直す
  - 実装（2026-09-21）: `runForRaces`（`scripts/daily/update-race-info.js`）。**出走表（racelist）だけを取り、beforeinfoは取らない（D2を、この移行で解消。本タスクの「変更しない」から、指示により変更）**。`run`は同じ書き込み部品（`flushRaceInfo`）を共有し、動作を変えない（`verify:pre-race-parsers`）。shadowは読み取りのみ・`resultDigest`（`scripts/lib/scrapeJobs/preRaceDigest.js`）。中止・順延の暫定検知は、ページ取得後に選手0人のときだけ連続回数を進める（通信・HTTPエラーは数えない）
- [x] **T4b-09-2** `api/cron/race-info.js`: レジストリの`race_info`定義（`-60`、許容幅3分、再試行60秒、リース90秒）。成功して変更を書いたときに、案1の予測リフレッシュ（T4b-03）を呼ぶ
  - 実装: `api/cron/race-info.js`・`scripts/lib/scrapeJobs/preRaceHandlers.js`。変更を書いたレースは、全スロットの完了後に日付ごとに1回だけ`mainRefresh`（upsert）を呼ぶ（`REFRESH_ON_VERCEL`）。`maxDuration`は再計算の余裕を含めて180秒。`vercel.json`に毎分のcronを追加。検証: `npm run verify:scrape-pre-race-job`
- [ ] **T4b-09-3** `shadow`→`live`→`SKIP_RACE_INFO_ON_GHA=true`の手順で切り替える。GitHub側の`scrape-scheduled.js`の`updatedRaceIds`から、レース情報由来を外す（この時点でGitHub側の再計算は不要になる）
  - **コード側は完了**（`SKIP_RACE_INFO_ON_GHA`を`scrape-scheduled.js`・`scrape-scheduled.yml`に追加。既定は未設定＝従来どおり。#760のフェイルセーフ付きSKIP（`GHA_SKIP_TARGETS.SKIP_RACE_INFO_ON_GHA`）に対応）。切り替え（shadow→live→変数）の実施は未。手順・確認SQL・成功基準・切り戻しは[verification-runbook.md](./verification-runbook.md) Q-5

データ項目: `race_entries`（レース情報更新分）。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×6艇。行の有無に加え、`racer_id`・`win_rate`等の主要列がNULLでないこと（`racer_id`のNULLは、BOA-325で0件）。`series_day`・`today_weight`のNULLはWS5）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓は60分前。取得時刻列はWS2の`updated_at`（並走中のGitHub側）と、予定表の`done_at`（Vercel側）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

データ項目: `race_conditions`（気象を含む）。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×1行。気象は展示取得側（BOA-358、PR #724）でも更新される）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。気象は、発走直前の観測の割合（`weather_observed_at`、WS9）と、公式との一致率（サンプル100レース）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

### T4b-10 買い目オッズ（A4）: `prediction_odds`

- [x] **T4b-10-1**（調査済み。鮮度要件の確認・判断は、ユーザー待ち） D1（A3と同じ`odds3t`・`odds3f`の重複取得）の判断: A4を、`race_odds`の最新スナップショットからの導出に置き換えられるかを確認する。更新頻度の要件（A4は5分ごと、`race_odds`は窓内のみ）と、表示側の要件を確認し、ユーザーに提示する（実装せず、判断のみ）
  - 調査結果（2026-09-20、読み取りのみ）: **`prediction_odds`を表示する画面は、現在無い**（2026-08-14のAI予想モデル刷新（`038461205`）で、`PredictionPanel`の買い目オッズ表示を削除済み。`src/services/supabaseDataService.js`が取得して`raceData.predictionOdds`に載せ、RPC`get_predictions_by_date`等も同じ値を返すが、読む部品が無い）。読み手は、(1)`generate-moriarty-recommendations.js`（GitHub Actions、1日1回。実績は約11:30 JST起動で、その時点で行があるのは発走60分以内に入ったレースのみ）、(2)`train-moriarty-calibration.js`（週次の学習。発走前の最終値を使う）、(3)`data-health-report.js`（存在の確認）。**5分ごとの鮮度を必要とする読み手は、確認できなかった**。導出の妥当性（2026-09-17〜19の516レース）: 予想の買い目のキーは、`race_odds.trifecta_all`・`trio_all`に514/514で存在（形式が一致）。A4の最終値との差は、最新のスナップショットが約3.3分古い（p50。p90は5.8分）ため、3連単で中央値8.8%・p90 32%、3連複で中央値12.1%・p90 42%。A4の最終更新は、発走の0〜2分後（中央値。2026-09-14〜19）。鮮度の比較・設計案は、親への完了報告に記載
- [ ] **T4b-10-2** 導出に置き換えない場合: `api/cron/prediction-odds.js`（5分間隔）へ移す。ジョブ単位のリース、現行の`run(raceIds, date)`を再利用し、対象は発走60分以内のレース。`shadow`→`live`→`SKIP_PRED_ODDS_ON_GHA=true`
- [ ] **T4b-10-3** 導出に置き換える場合: 導出の実装は別タスクとして分け、`prediction_odds`の更新をA3の完了に連動させる。この場合、A4のCronは作らない

データ項目: `prediction_odds`。

- [ ] 本番実測: 期待件数（算出根拠: 予想のある、発走前のレース数×1行（1レース1行を上書き）。発走後のレースは対象外）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（履歴の無い表のため、直近の充足を実測）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓型ではなく「発走60分前から発走まで5分ごと」の連続更新のため、`updated_at`の間隔（最大間隔）が5分を大きく超えないこと、発走直前（5分前以内）の更新があることを実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

---

## Phase 6: 展示・特記事項の純正Cron化（トラックA）

### T4b-06 展示（A2）: `exhibition_data`

- [x] **T4b-06-0**（コード実装済み。DDL案082は未適用。ユーザー承認待ち） 直前情報の全項目化（[pre-race-full-fields/plan.md](../pre-race-full-fields/plan.md)）: 解析は`scripts/lib/beforeInfoParser.js`（純関数。展示進入・展示STのF/L・前走の着順の生表記・欠場・気象を1回で解析）、行の組み立ては`scripts/lib/preRaceRows.js`。`scrape-exhibition-data.js`の`scrapeAndUpsertRaces`は、この解析・行の組み立てを使う（気象の書き込みは従来どおり）。検証: `npm run verify:pre-race-parsers`
- [x] **T4b-06-1** 展示公開時刻の分布を実測する（plan.md U6）: WS2の取得時刻列と`races.start_time`の差（会場別。展示STが先に出る会場を含む）。結果から、レジストリの展示定義（1本のスロット`-33`〜`-7`、再試行120秒）が妥当か、現行の3窓（30/15/10分前）へ戻すかを、ユーザーに提示する
  - 実測（2026-09-21、202レース）: 最初に取得できた時点は発走の30.6〜8.6分前（中央値16.2分前）、全レース7分前までに取得。`-33`〜`-7`を採る（3窓へは戻さない）。尾部（7分前より後）は従来の窓で観測できないため、live後に確認。詳細は[verification-runbook.md](./verification-runbook.md) Q-0
- [x] **T4b-06-2** `api/cron/exhibition.js`を共通ラッパ・スロット化する（`waitUntil`を廃止し、同期の応答にする）。現行の`getRaceIdsWithExhibitionTime`による取得済みのスキップは`skipped_have_data`として記録する。案1の予測リフレッシュ（T4b-03）を、スロットの完了後に呼ぶ
  - 実装: `api/cron/exhibition.js`・`preRaceHandlers.js`・`runForRaces`（`scrape-exhibition-data.js`）。**`scrape_job_state`の`exhibition`が行なし・`off`の間は、従来の経路（cron-job.org起点・`waitUntil`）がそのまま動く**（マージで展示が止まらない。mode=shadowは従来の経路＋スロットのshadow、liveはスロットのみ）。取得済みは`skipped_have_data`、展示STのみは`partial`。案1の再計算は、全スロットの完了後に1回
- [x] **T4b-06-3** `vercel.json`のcronsに追加して、純正Cronで起動する（cron-job.orgの`Vercel Exhibition Cron`と並走。同じエンドポイントで、リースと冪等により無害）。並走の後に、(ユーザー)cron-job.orgのジョブを停止する
  - 実装: `vercel.json`に`/api/cron/exhibition`（毎分）を追加。`off`のとき、Vercel Cron（`User-Agent: vercel-cron/1.0`）の起動は何もしない（従来の経路をcron-job.orgと二重に動かさない）。cron-job.orgの停止は、liveの安定後のユーザー作業（[verification-runbook.md](./verification-runbook.md) Q-4）。切り替え（shadow→live）の実施は未
- [ ] **T4b-06-4** 切り替え後7日の窓内取得率を、予定表と、WS2の取得時刻で実測する（展示タイム非NULL基準）
  - 旧方式と新方式の比較の手順・SQLは[verification-runbook.md](./verification-runbook.md) Q-4-1（窓ごとの直接比較はできないため、7分前までの取得率・発走前の分数で比べる）。実測は、live後

データ項目: `exhibition_data`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×6艇で、`exhibition_time`が非NULL。現状は、行の有無で99.5%、展示タイム非NULL基準で98.2%（未達。鳴門・丸亀・児島・江戸川等で、展示STが展示タイムより先に公開される））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する。未達は理由を件数付きで説明する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓は30・15・10分前（または、実測に基づく1本のスロットの、期限（33分前）から取得までの遅延）。WS2の取得時刻列と、予定表の`done_at`から計測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（既存の`exhibition-gap-monitor.yml`を、`scrape-monitor`へ統合または併存）

### T4b-22 展示の窓の外の補完（BOA-382）: `exhibition`の発走の10分後のスロット

- [x] **T4b-22-1**（コード実装済み。レジストリ`exhibition`に`offsets: [-33, 10]`・`catchupOffsets: [10]`・`catchupRetrySec: 600`、`preRaceHandlers.js`（補完のスロットは、気象を書かず・予測の再計算の対象にせず・再試行600秒）、`scrape-exhibition-data.js`の`runForRaces`に`catchup`（取得済みのスキップをshadowにも効かせ、気象を書かない）、`monitor.js`（補完を窓内取得率のジョブ別集計に束ねない・中止・順延の疑いの期限切れを通知しない）、`check-pre-race-shadow.js`（補完を別の節に集計）。DB・`vercel.json`・APIの変更なし。既存の`-33`のスロット・従来の経路・shadow・liveの挙動は不変。検証: `verify:scrape-pre-race-job`（実ページのフィクスチャ・変異検証つき）・`verify:scrape-monitor`・`verify-scrape-slots-sql.js`。設計・比較・負荷の見積りは[verification-runbook.md](./verification-runbook.md) Q-8）2026-09-21の住之江5R（発走17:02）で、展示の公開が窓の終わり（7分前）より後だった（展示タイムが0行のまま。公式ページには後から載った）ことへの対応。発走後にも、展示タイムの無いレースを再取得して埋める
- [ ] **T4b-22-2** (親・ユーザー承認) マージ後、`exhibition`を`live`へ切り替える（Q-4）のと同時に、補完が効き始める（追加の操作は無い）。**補完のコードのマージより前の欠落5件**（9/19の3件・9/21の2件）は、既存の`backfill-exhibition-by-race-id.js`のdry-run→`--apply`で補填する（本番DBへの書き込みのため、ユーザーの承認。runbook Q-8）
- [ ] **T4b-22-3** live後、補完のスロットの内訳（skipped_have_data・ok・expired）と、補完で埋まったレースの発走後の取得の遅延を、runbook Q-8の確認SQLで測る。公開の尾部の分布（-7分〜発走後）を実測して、補完の窓・間隔・`graceMin`の延長（Q-0の26→29）を、必要なら見直す

データ項目: `exhibition_data`（T4b-06と同じ）。

- [ ] 本番実測（A）: 期待件数（算出根拠: 2025-12-03以降のレース数から確定中止を除いたもの×展示タイムが非NULL。runbook Q-8の(4)。直近の実測: 9/19が98.08%・9/21が98.35%＝99%未満）に対し、補完のlive後の直近5日（土日を含む）で、展示タイムの充足率が99%以上であることを実測クエリで確認する。未達は、レースごとに理由（中止・順延の未確定、補完の窓を超える公開の遅れ、Cronの障害）を説明する
- [ ] タイミング実測（B）: 補完は、可変データの窓の外の回復（`-33`のスロットの窓内取得率の代わりではない）。`-33`の窓内取得率（98%）は、補完を束ねずに計測される（`monitor.js`）。補完のスロットの`done_at`の、発走からの分数（runbook Q-8の(2)）を、土日を含む直近5日で実測して、尾部の分布（発走の何分後までに、何%が取れたか）を残す
- [ ] 継続監視（C）: 補完のexpired（最後まで取れなかったレース。中止・順延の疑いを除く）が、`scrape-monitor`のSlack通知（`expired`・`unexecuted`）に出ることを確認する（liveのみ。`monitor.js`・`verify-scrape-monitor.js`で検証済み）。展示タイムの充足率は、`data_health`（T7-06）の日次の充足率で、継続的に計測される

### T4b-11 特記事項（A5）: `race_special_notes`

- [x] **T4b-11-1** `api/cron/race-notices.js`を共通ラッパへ（ジョブ単位のリース、同期の応答、DB障害を200にしない。G13）。`race_notices_health`の毎回のupsertは、変更のある行のみに（D9）
  - 実装: レジストリに`race_notices`（continuous、リース300秒）、`scripts/lib/raceNoticesJob.js`（ラッパへの接続。DB障害・全会場の取得失敗は500、shadowは取得・解析のみ）、`scrape-race-information.js`の`run`に`client`・`fetchPage`・`dryRun`・`strict`・`concurrency`・`shouldStop`を追加（オプション無しの従来の呼び出しは不変）、集計行は`diffRows`で変更のある行のみ（`last_checked_at`は比較から外す。**最終確認の時刻は`scrape_job_state.last_success_at`になる**）。会場は6並列。検証は`npm run verify:race-notices-job`
- [x] **T4b-11-2** `vercel.json`のcronsに追加（10分間隔、`*/10 22-23,0-14 * * *`）。cron-job.orgの登録内容の確認（plan.md、job-inventory.md U1）と、(ユーザー)cron-job.orgのジョブの停止
  - `vercel.json`のcronsに追加済み（`regions`・`functions`には触れていない）。`scrape_job_state`の`race_notices`が`off`（または行なし）の間は、Vercel Cronもcron-job.orgの呼び出しも、何もしない。**このため、マージ前に`live`の行を作らないと、現行の特記事項の取得が止まる**（[verification-runbook.md](./verification-runbook.md) K-1）。cron-job.orgの停止は、ユーザー作業（未実施）。cron-job.orgの登録内容の確認は、ユーザー作業（G-3）
- [x] **T4b-11-3** `race_special_notes`が0件（G4）の判別: 通知のある日を、公式ページで確認し、パースの失敗か、通知が無いだけかを判定する（WS5。実装は、その結果に従う）
  - 結果（2026-09-20、公式ページへのリクエスト9回、逐次・3秒間隔、UA `BoatraceAIBot/1.0`、429/503なし）: **0件は「通知が無いだけ」で、パースの失敗ではない**。(1)通知のある既知の実例（2017-12-24 住之江 SG。フィクスチャの原本）: 生の表の行9件（事故・内規違反・減点5、モーター・ボート変更2、欠場・帰郷2）が、パーサーで9件とも解析された。(2)2026-09-20の6会場（桐生・多摩川（72周年記念）・尼崎・鳴門（6日目）・児島・唐津）: 3区分とも「現在、お知らせはありません」で、解析は0件（正しい）。(3)全レース内欠場（Kファイルの`K1`）があった日（2026-09-16 唐津、2026-09-15 平和島）も、通知なし（レース内の欠場は、この一覧に載らない）。本番の集計行83件（9/15〜9/20）は全て`had_success=true`・`last_reason`なしで、見出しの構造は毎回認識できている
  - **発見**: `race_special_notes`の一意索引`uq_race_special_notes_dedup (venue_code, race_date, category, detail_text)`のため、同じ日に同じ内容の別選手の通知（例: 待機行動違反・落水失格の各2名）が1件に潰れる（2017年の実例で、9件中2件が失われる。検証スクリプトで再現）。**別タスクとして起票推奨**（コードのみで直せる: `detail_text`に選手名・レース番号を含める。または一意索引に選手名を加えるDDL。表は0件のため、今なら安全）
  - 未確認: 2026年に通知が実際に出たときの構造（実例が2017年のSGのみ）。通知のある会場の割合。行があるのに解析できなかった場合（セルの数が想定と違う）は、現状、解析0件と区別できない（`race_notices_health`は成功のまま）。**別タスクとして起票推奨**: 生の行があるのに解析0件なら、`rows_unparsed`の失敗として集計行に記録する

データ項目: `race_special_notes`。

- [ ] 本番実測: 期待件数（算出根拠: 公式の`race/information`に通知がある、会場×日の通知数（事故・内規違反・減点、モーター・ボート変更、欠場・帰郷）。現状は0件。0件が正常か、パースの失敗かを、通知のある日の実データで判別する。判別できない場合は、その旨と確認方法を報告）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（通知が無い日は、0件が正しい）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。窓の無い随時掲載型のため、「掲載から取得までの遅延（最大10分）」を、`scraped_at`と公式の掲載時刻（ある場合）から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（既存の構造変化の監視（`race-notices-drift-monitor.yml`）に、0件・未実行の検知を追加）

---

## 並行: `races`初期化（`morning-init`）と公式予想（トラックB）

### T4b-07 朝の初期化（A8）: `races`・`race_entries`・`race_conditions`

- [x] **T4b-07-1**（基盤を待たず着手可） `scripts/scrape-to-json.js`の取得部分を、ファイルへ書かず、**メモリ上のデータを返す関数**にする（CLIの`main()`は、その関数を呼んでfsへ書く形で残す）。`getTodayVenues`は既にexportされている。→ `getTodayVenues`・`scrapeVenue`・`scrapeRacesData`（`fetchHtml`差し替え・`strict`つき）。旧実装の出力と完全一致（`npm run verify:morning-init-refactor`）
- [x] **T4b-07-2**（T4b-03と`generate-predictions.js`が重なる。T4b-03の後に着手） `generate-predictions.js`の`main()`から、`races.json`のfs読み込み以降の書き込み処理を、**データを引数で受け取る関数**として切り出す（CLIの`main()`は、fsで読んで、その関数を呼ぶ形で残す）。`writeToSupabase`の既存のロジック（変更のある行のみ書く）は変更しない。→ `generateAndWriteFromRacesData`。`writeToSupabase`に`client`・`throwOnError`を追加（既定は従来どおり握りつぶす。書き込みのロジックは変更なし）
- [x] **T4b-07-3** `generate-unified-predictions.js`の`main()`を、CLIガード付きの関数に分ける（import時に`main()`が走る現状の解消）。`scrape-pcexpect.js`も同様（T4b-08-1）。→ `generateUnifiedPredictions`・`findRacesMissingUnified`
- [x] **T4b-07-4** `api/cron/races-init.js`（`*/2 20-23,0-14 * * *`、`maxDuration: 800`）: 会場一覧（`race/index?hd=`）を取得し、会場を4件ずつのチャンクで処理する。進捗を`scrape_job_state.cursor`に保存する。`ensureAllVenuesScraped`相当の取りこぼし会場の確認を、同じチャンク処理に組み込む。各チャンク完了時に`ensure_scrape_slots`でスロットを生成する。最後のチャンクで、unified予測の生成・Deploy Hookを呼ぶ。→ 実装: `scripts/lib/racesInit/job.js`（1回の呼び出しは最大8会場、進捗は`cursor`。会場一覧の再確認は9時前の1回。予定表の生成は全会場が済んだ後の後始末で、有効な窓型ジョブのみ）。`races`に行のある会場は書かない（初期化済みの予測・的中フラグを上書きしない）
- [x] **T4b-07-5** 予測ロジックの変更検知による再生成（`git log`依存）を、内容ハッシュ（ビルド時に計算し、`scrape_job_state`の`predict-code-hash`と比較）へ置き換える（plan.md §11(g)の判断に従う。廃止する場合は、手動のCLI再生成の手順をドキュメントに残す）。→ **ビルド時の計算ではなく、デプロイされた予測ロジックのソース（`generate-predictions.js`・`turnPrediction.js`・`venueParameters.js`・`winningTechniques.js`）を、実行時に読んでハッシュを計算する**（import されたファイルは関数のバンドルに含まれる。ビルド時の生成物は、bundling の順序に依存するため避けた）。`races_init`の`onTick`（liveのみ、起動のたび）で比較し、変わっていたら当日の発走前のレースだけ`mainRefresh`（upsert）で再生成する。**範囲の限界: cronの時間帯（05:00〜09:58 JST）のみ。終日にするならcronを広げる（ユーザー判断。runbook N-3）**
- [x] **T4b-07-6** 24会場の日の所要時間を、プローブで実測する（plan.md U12。会場数を変えて）。結果から、チャンクの会場数・`maxDuration`を調整する。→ 1会場（12レース、25リクエスト、同時12）を実サイトで実測: **29.0秒**（全て200）。24会場で約12〜14分の見積り。公式サイトへのアクセスは合計33回（上限40回）。24会場の日・Vercel上の書き込みを含む所要時間は、shadow・live初日に実測（runbook N-0・N-7）。1回の会場数8・`maxDuration` 800秒は据え置き
- [ ] **T4b-07-7** `shadow`（05:00 JSTに取得・解析のみ。会場・レース数・出走表のダイジェストを記録）で3日、GitHub Actionsが07:00に書いた値と比較する。一致を確認して`live`にし、3日並走する。GitHub側の`morning-init`は、初期化済みとして、既存の確認処理のみを行う（plan.md §4.6）。切り戻しは、Vercelを`off`にするのみ。→ 手順・成功基準（数値）・短縮手順（shadow 1日→live化とGitHub側停止を同時）: verification-runbook.md N。確認は`scripts/maintenance/check-morning-init-shadow.js`。GitHub側の停止は`SKIP_MORNING_INIT_ON_GHA`（JST 07:00になっても当日のracesが無ければ従来どおり初期化するフェイルセーフつき）
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

- [x] **T4b-08-1**（基盤を待たず着手可） `scrape-pcexpect.js`の`main()`を、CLIガード付きの関数に分け、レース単位の入口（`runForRaces`）を追加する。→ CLIの`main()`も`runForRaces`を使う。payloadのダイジェスト（`computePcexpectDigest`）を追加
- [x] **T4b-08-2** `api/cron/pcexpect.js`（5分間隔。cronは`*/5 20-23,0-14 * * *`＝JST 05:00〜23:59。朝の初期化の直後から消化するため、設計の`22-23`から広げた）: レジストリの`pcexpect`定義（`-720`、許容幅690分、再試行600秒、リース300秒、20件×3並列）。1レース約10.6秒（実測）のため、1回で約75秒。180レースで約10回の呼び出し。1リクエストが約9秒かかる原因（plan.md U7）の切り分け（取得先の応答か、制限か）を、プローブで確認する。→ 1ページ約9.2秒は、取得先の応答時間（リージョン・実行元によらない。plan.md §8）
- [x] **T4b-08-3** 公式コンピュータ予想が、朝の1回の取得で足りるか（発走前に更新されるか）を確認する（U7）。足りない場合は、窓型（発走前の複数窓）への変更を、ユーザーに提示する。→ 朝の1回で足りる見込み: 02:25に保存したpayloadと、8.5時間後の再取得が、未発走の3レースで完全一致（3/3）。2026-09-10〜21の全レースで保存は朝の1回のみ。発走30分前以内の更新の有無は、shadowの一致率で間接的に確認（runbook N-0）
- [ ] **T4b-08-4** `shadow`→`live`→（`races-init`の切り替え（T4b-07-8）と同時に）GitHub側の`morning-init`から外す。→ runbook N-4。GitHub側は`SKIP_PCEXPECT_ON_GHA`（初期化の中のpcexpectの段だけ）

データ項目: `external_predictions`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降のレース数（除外: 確定中止）×1（公式予想が公開されているレース。公開されないレースの有無を、実データで確認し、除外件数を報告））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（過去分の公式予想が、遡って取得できるかは、WS5で確認。取得できない場合は「取得開始日以降のみ」とし、ユーザーの承認を得る）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。公式予想が発走前に更新される場合は窓型（plan.md U7）。朝の1回で足りる場合は、「発走の30分前までに取得済み」の割合を、`scraped_at`と`race_start_at`から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する

---

## 日次・低頻度（トラックC）

各ジョブは、plan.md §4.3の日付解決（`resolveTargetDate`）・補足の起動・0件エラー（期待件数の判定関数）を使う。`git push`・`fs`で書いている成否履歴（health.json等）は、`scrape_job_state.last_report`へ移す。

### T4b-12 得点率（B2）: `racer_series_points`

- [x] **T4b-12-1**（コード実装済み。`scripts/lib/pointRankJob.js`・`api/cron/point-rank.js`。モードは`off`のまま。検証: `npm run verify:scrape-daily-jobs`。切り替えはrunbook §L-1） `scrape-point-rank.js`を、対象日を引数で受ける形にして、`api/cron/point-rank.js`へ（`0 13 * * *`、`30 14,16 * * *`）。対象日は`resolveTargetDate`（22:00指定）。0件エラー（記念競走のある日のみ期待あり。PR #715の修正を踏襲）
- [x] **T4b-12-2**（調査済み。結果はrunbook §L-6。要点: 開催会場日の約94%は表が無いのが仕様。表があるのは、SG/G1の中盤〜終盤（多摩川G1は3日目にもあり）。実測でG3・一般戦は表なし） 記念競走以外に表が無い仕様上の空が、0件にどの程度含まれるか（job-inventory.md U13）を、表のある日（SG/G1開催日）に、日付を取り違えない条件での再取得で確認する
- [ ] **T4b-12-3**（`SKIP_POINT_RANK_ON_GHA`のコードは実装済み。既定は未設定＝従来どおり。手順はrunbook §L-1） `live`→`SKIP_POINT_RANK_ON_GHA=true`。対象日がずれる問題（G1）が、Vercelで再発しないことを、実測する

データ項目: `racer_series_points`。

- [ ] 本番実測: 期待件数（算出根拠: 表のある会場（SG/G1等の記念競走の開催）×日ごとの、公式の`pointrank`ページの掲載選手数。現状は0件（原因は日付の取り違え。PR #715で修正済み））に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（過去分は、遡って取得できるかをWS5で確認。取得できない場合は「取得開始日以降のみ」）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。日次ジョブのため、窓ではなく、「対象日の結果確定後（22:00 JST以降）、日付が変わる前に取得できた」割合を、`scraped_at`と対象日から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（0件テーブルの検知、`last_target_date`の遅れ）

### T4b-13 進入コース別選手成績（B4）: `venue_entry_course_stats`

- [x] **T4b-13-1**（コード実装済み。`scripts/lib/venueEntryCourseStatsJob.js`・`scripts/lib/scrapeJobs/venueDailyJob.js`・`api/cron/entry-course-stats.js`。成否履歴は`scrape_job_state.last_report`へ。構造変化の通知は`last_report.alerts`→`scrape-monitor`。切り替えはrunbook §L-2） `scrape-venue-entry-course-stats.js`を、対象日を引数で受ける形にして、`api/cron/entry-course-stats.js`へ（`0 11 * * *`、`30 13 * * *`、`30 15 * * *`）。`git push`・`fs`（health.json）を`last_report`へ（`driftHealth.js`のコア機構は再利用）。当日の出走表がある会場のみ処理し、対象日を`resolveTargetDate`で明示（G2の恒久対策）
- [x] **T4b-13-2**（確認済み。**読み手なし**。結果と要判断はrunbook §L-6。ユーザーの判断待ち） 表示側の読み手の有無を確認する（job-inventory.md U11。`src/`・`api/`に見つからなかった）。読み手が無い場合、取得を続ける価値をユーザーに提示する
- [ ] **T4b-13-3**（`SKIP_ENTRY_COURSE_ON_GHA`のコードは実装済み。既定は未設定＝従来どおり。手順はrunbook §L-2。T4b-13-2の判断で、取得を続けない場合は不要） `live`→`SKIP_ENTRY_COURSE_ON_GHA=true`

データ項目: `venue_entry_course_stats`。

- [ ] 本番実測: 期待件数（算出根拠: 対象10会場（常滑・三国・びわこ・尼崎・徳山・下関・若松・芦屋・唐津・多摩川）の開催日ごとに、12レース×6枠×6進入コース＝432行/会場/日（2026-09-16の実測）。戸田・浜名湖・宮島はToS制限、児島は非開催期間で未確認のため対象外）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（`racer_id`の解決率も報告）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。日次ジョブのため、「対象日の出走表が揃った後に、対象日のまま取得できた」割合（現状は、日付をまたぐと0件になる）を、`scraped_at`と対象日から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（0件、構造変化）

### T4b-14 会場別モーター成績（B3）: `venue_motor_stats`

- [x] **T4b-14-1**（コード実装済み。`scripts/lib/venueMotorStatsJob.js`・`api/cron/venue-motor-stats.js`。負荷の見積りと同時数の上限はrunbook §L-6。切り替えはrunbook §L-3） `scrape-venue-motor-stats.js`を、`api/cron/venue-motor-stats.js`へ（`0 21 * * *`、`0 23 * * *`）。会場間の待機なしで、22会場を取得する現状の負荷を見積もり、並列度の上限・待機を追加する。成否履歴（`venue-motor-stats-health.json`のgit push）を`last_report`へ（BOA-360の`git push`競合の恒久解消）
- [ ] **T4b-14-2**（`SKIP_MOTOR_STATS_ON_GHA`のコードは実装済み。既定は未設定＝従来どおり。手順はrunbook §L-3） `live`→`SKIP_MOTOR_STATS_ON_GHA=true`

データ項目: `venue_motor_stats`。

- [ ] 本番実測: 期待件数（算出根拠: 対象22会場（戸田・平和島はデータなしで対象外、宮島はPDF）の、会場ごとのモーター数×日次スナップショット（`scraped_date`）。会場ごとのモーター数を、公式の一覧で確認）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する（過去分の日次スナップショットは、遡って取得できない場合が多い。「取得開始日以降のみ」とし、ユーザーの承認を得る）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。日次ジョブのため、「その日のレース前（指定06:00 JST）までに取得できた」割合を、`scraped_date`と（あれば）取得時刻から実測する（現状は、`scraped_date`が日付のみで時刻が計測不能。`last_report`に取得時刻を持たせる）
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（0件、14日連続失敗の構造変化を維持）

### T4b-15 選手ニュース（B5）: `racer_news`

- [x] **T4b-15-1**（コード実装済み。マイグレーション案`080_racer_news_pending.sql`（**未適用。ユーザー承認待ち**）・`scripts/lib/racerNewsJob.js`・`api/cron/racer-news.js`・`scripts/maintenance/resolve-racer-news-pending.js`。`session-start-check.js`とフローC-4はDB＋pending.jsonの統合を読む。切り替えはrunbook §L-4） `pending.json`（人手確認リスト）のコミットを、DBの表へ移す（plan.md §11(i)の判断に従う）。`session-start-check.js`の読み先を、DBに変更する（`.claude/rules/content-ops.md`フローC-4の手順も更新）。`collect-racer-news.js`を`api/cron/racer-news.js`へ（`10 14 * * *`、`10 16 * * *`）
- [ ] **T4b-15-2**（`SKIP_RACER_NEWS_ON_GHA`のコードは実装済み。既定は未設定＝従来どおり。手順はrunbook §L-4） `live`→`SKIP_RACER_NEWS_ON_GHA=true`

データ項目: `racer_news`。

- [ ] 本番実測: 期待件数（算出根拠: 公式ニュースの「レーサーデータ」カテゴリ（`site/news/racer/{YYYY}/{MM}/`）の一覧に掲載された節目記録の記事のうち、選手を特定できたもの。月1〜2件と少ない。一覧ページと、`racer_news`＋`pending`の件数を突合）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。可変データではなく、記事の公開から取得までの遅延（日次）を、`racer_news.created_at`と公開日から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（ジョブ自体の失敗検知、`pending`の滞留）

### T4b-16 選手プロフィール・期別成績（B6）: `racer_profiles`

- [x] **T4b-16-1**（コード実装済み。`scripts/lib/racerProfilesJob.js`・`api/cron/racer-profiles.js`・`racerProfileSync.js`にafterRacerId・同時取得・ソフトデッドラインを追加（CLIの既定挙動は不変）。**`maxDuration`は800秒**（2026-09-20にFluid Computeの有効をユーザーが確認して、当初の300秒から引き上げ。runbook §L-5・§L-6）。切り替えはrunbook §L-5） `scrape-racer-profiles.js`（`scripts/maintenance/`）を、`api/cron/racer-profiles.js`へ。1,627人を300人程度のチャンクで処理し、位置を`cursor`に保存して再開可能にする（`*/10 18-20 1 * *`、`*/10 18-20 8,15 5,11 *`。**夜間**: UTC 18:00〜20:50＝JST 03:00〜05:50。日付は従来のGitHub Actionsと同じUTC基準の式で、JSTでは2日・9日・16日）。`profile-scrape-report.json`のgit pushを`last_report`へ。取得ロジックは`scripts/lib/racerProfileSync.js`を再利用する
- [ ] **T4b-16-2**（2026-09-20時点の実測: `ability_index`が非NULLの選手は1,592/1,628人。初回実行は済んでいる。実行時間の実測は、Vercelの`?chunk=N`の手動確認とlive初回で行う。runbook §L-5） 初回実行（`ability_index`が0/1,627件）は、WS5で手動実行する（少数のdry-runから段階的に。PR #721の修正後）。実行時間の実測（plan.md、job-inventory.md U9）を、チャンクの人数の調整に使う
- [ ] **T4b-16-3**（`SKIP_RACER_SEASON_ON_GHA`のコードは実装済み。既定は未設定＝従来どおり。手順はrunbook §L-5） `live`→`SKIP_RACER_SEASON_ON_GHA=true`

データ項目: `racer_profiles`。

- [ ] 本番実測: 期待件数（算出根拠: `race_entries`に登場した全`racer_id`（約1,627人）。`ability_index`・期別成績の列が非NULL。現状は`ability_index`が0/1,627件）に対し、充足率99%以上であることを実測クエリで確認する（過去の期別の値は、遡って取得できない。「取得開始日以降のみ」とし、ユーザーの承認を得る）
- [ ] タイミング実測: 可変データは、土日を含む直近7日で窓内取得率（窓の中心±3分以内）を実測する（欠落率2%以内）。半年に1回しか変化しないため、窓型ではない。「月次の指定日（1日09:00 JST）から3日以内に全選手を取得できた」割合と、期の切り替わり（5/1・11/1）直後の追従を、`scraped_at`・`official_updated_at`から実測する
- [ ] 継続監視: 上記指標が日次で自動計測され、閾値超過でSlack通知されることを確認する（月次ジョブの未実行の検知（実行履歴0件のまま見逃した実績あり）、`cursor`の未完了）

### T4b-17 ピットレポート（選手コメント。N24、BOA-379）: `pit_reports`

設計: [pit-comments/](../pit-comments/spec.md)（spec・plan・screens・tasks）。SG・G1・G2の対象レースのみ（1日6〜18ページ）。

- [x] **T4b-17-1**（コード実装済み。`scripts/lib/pitReportParser.js`・`pitReportRows.js`・`pitReportSchema.js`・`pitReportJob.js`・`rawHtmlArchive.js`・`api/cron/pit-reports.js`、レジストリ`pit_reports`、`vercel.json`のcron。既定は`off`（行なし）で挙動不変。検証は`npm run verify:pit-report-job`）
- [ ] **T4b-17-2** (ユーザー承認) マイグレーション085（保存）を本番へ適用する。APPLIED.mdの「未適用」を「適用済み」に更新する
- [ ] **T4b-17-3** (ユーザー承認) `scrape_job_state`の`pit_reports`を`shadow`にする。SG・G1・G2の開催日に、`scrape_slots`の`done`（`outcome`）・`result_digest`・`done_at`の分布から、公開時刻と公開後の更新の有無を実測し、窓（`offsets`・`graceMin`・`pendingRetrySec`）を確定する
- [ ] **T4b-17-4** (ユーザー承認) Storageの非公開バケット`raw-pages`を作成し、`live`にする
- [ ] **T4b-17-5** 過去分のバックフィル（2025-12以降。約1,700ページ、3夜。[plan.md §5](../pit-comments/plan.md)）。手動CLI（`scripts/maintenance/backfill-pit-reports.js`、未実装）と、実行前のユーザー承認

データ項目: `race_pit_reports`・`race_pit_comments`。

- [ ] 本番実測: 期待件数（算出根拠: 2025-12-03以降の`races`のうち、SG（全レース）・G1・G2（7R以降）で、公式ページが対象外と答えなかったレース。`race_pit_reports.status='published'`のレース数。ページが空のレース・`not_target`は分母から除き、件数を報告）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する。艇ごとの行数（`race_pit_comments`）は、公式ページのコメント数と一致すること（サンプルで突合）
- [ ] タイミング実測: 可変データ（公開時刻がある）は、土日を含む直近7日で、「発走までに公開を検知できた割合」（`scrape_slots`の`done_at <= 期限`）と、公開検知の遅延（`done_at`−発走）の分布を実測する。窓内取得率（中心±3分）は当てはまらないため、「公開後5分以内に検知」（再試行間隔）を基準にする
- [ ] 継続監視: 上記指標が日次で自動計測され（`scrape-summary`に`pit_reports`が出る）、`expired`（対象レースで許容幅まで公開を検知できなかった）が即時通知されることを確認する。`parse_anomaly`（構造の変化）の`error`が通知されること

### T4b-19 BOATCAST（N25 オリジナル展示・N26 モーター使用開始日）: `boatcast_oriten`・`boatcast_motor_start`

設計: [boatcast-original-exhibition/](../boatcast-original-exhibition/spec.md)（spec・plan）。別ホスト `race.boatcast.jp`。**日次（当日）の取得のみ**。過去分（約44,700リクエスト）のバックフィルは、第1弾の対象外（完了の定義Aの例外。取得開始日以降のみ）。取得・解析・書き込み（`processOritenRace`）は、将来の手動CLIと共有できる構造。

- [x] **T4b-19-1**（コード実装済み。`scripts/lib/boatcast/`（公開マップ・パーサー・行の組み立て・カナリア・取得ジョブ・probe）・`api/cron/boatcast-oriten.js`・`api/cron/boatcast-motor-start.js`、レジストリ`boatcast_oriten`（窓型・発走8分前）・`boatcast_motor_start`（日次・06:30 JST）、`vercel.json`のcron。既定は`off`（行なし）で挙動不変。検証は`npm run verify:boatcast-job`。共有の`politeFetch`・ブレーカーは変更していない）
- [ ] **T4b-19-2** (ユーザー承認) マイグレーション091（保存: `race_original_exhibition`・`race_original_exhibition_values`・`venue_motor_start_dates`。匿名のSELECTなし）を本番へ適用する。APPLIED.mdの「未適用」を「適用済み」に更新する。091が未適用の間は`live`にしない（liveのスロットが`error`になる）
- [ ] **T4b-19-3** (親: マージ・デプロイ後。CRON_SECRETを持つユーザー経由) **probe**: Vercel（syd1）からBOATCASTへ到達できるかを、`GET /api/cron/boatcast-oriten?probe=1[&race=YYYY-MM-DD-VV-RR]`で確認する（`scrape_job_state`の`boatcast_oriten`を`shadow`にした後。既知の存在ファイル`bc_mst_12`が200か）。403・失敗ならshadowに進まない（[runbook S-2](./verification-runbook.md)）
- [ ] **T4b-19-4** (ユーザー承認。新規テーブルのみに書くジョブは、shadowを省いて直接liveにできる: [cutover-fast-track.md §12](./cutover-fast-track.md)) `boatcast_oriten`・`boatcast_motor_start`を`shadow`（推奨: 1日。公開時刻（`source_last_modified`は書かないが、`scrape_slots.done_at`）・403の打ち切りの内訳を確認）→ `live`にする。liveの初回に、公開マップの項目名の一致（`parse_anomaly`の通知が0件）を確認する
- [ ] **T4b-19-5** (実施しない・第1弾の対象外) 過去分のバックフィルCLI（2025-12以降、約44,700リクエスト。夜間・複数夜・実行前にユーザー承認）

**Bの基準の提案（未承認。ユーザーが承認するまで、この項目のBは確定しない）**: 窓内取得率（窓の中心±3分以内）は当てはまらない（公開時刻が発走の9.9〜29.0分前と幅があり、取得は公開後の固定の期限=発走8分前・1回目）。代わりに、次を提案する。土日を含む直近5日で、
1. **発走の2分前までに取得できた割合**（`race_original_exhibition.created_at <= 発走 − 2分`）が、公開が確認できたレース（`scrape_slots.outcome='ok'`）の98%以上（欠落率2%以内。BOA-313の基準）
2. **公開の検知遅延**（`created_at − source_last_modified`）の分布（p50・p95）を報告する。設計上の見込みは、p50 約6分・p95 約21分（公開が発走の10〜29分前、取得が発走の約8分前のため）。実測がこれを超えたら、期限（`offsets`）を早める
3. **`source_last_modified`が記録されているレースが99%以上**（公開時刻の分布を計測できること）

#### データ項目: `race_original_exhibition`・`race_original_exhibition_values`（N25）

- [ ] 本番実測: 期待件数（算出根拠: 公開マップ（`scripts/lib/boatcast/publicMap.js`）で対象の23会場（江戸川を除く）の、取得開始日以降の各レース（中止・順延（`cancellation_status='confirmed'`）を除く）× 艇数（`race_entries.is_absent`の欠場艇を除く）× 項目数（3項目の20会場は3、住之江・尼崎・徳山は2）。**分母は事前凍結のマップと`races`・`race_entries`から算出し、BOATCASTの観測から作らない**（分母が分子に従属してAが自明に満たされるのを避ける）。除外（計測不可=`measure_status=2`・403の打ち切り=`scrape_slots.outcome='skipped_not_target'`・欠場艇・対象外会場の江戸川のレース）は、**件数付きで報告する**）に対し、充足率99%以上であることを実測クエリで確認する（実測クエリ: [runbook S-5](./verification-runbook.md)）。過去分は取得できない扱い（第1弾の対象外）のため、「取得開始日以降のみ」とし、ユーザーの承認を得る
- [ ] タイミング実測: 土日を含む直近5日で、公開時刻（`source_last_modified`）が窓のどこに入るか（発走の何分前にファイルが現れたか）の分布と、上記**Bの基準の提案**（発走の2分前までの取得率98%以上・検知遅延のp50/p95・公開時刻の記録率99%以上）を`race_original_exhibition`の取得時刻列から実測する（窓内取得率（中心±3分）は当てはまらない。提案の承認後に確定）
- [ ] 継続監視: `scrape-monitor`（`expired`・未実行・死活・連続失敗・0件エラー・ブレーカー）に加えて、`last_report.alerts`の`canary_failed`（カナリア失敗）・`parse_anomaly`（構造の異常・未知の項目名・マップと違う項目名。件数と例）・`no_data:{会場}`（会場の打ち切りが多い）が、Slackに通知されることを確認する（0件は共通ラッパの0件エラー）。日次の充足率の自動計測は、完了の定義Cの汎用監視（別タスク）へ、上の期待件数のSQLを登録する

#### データ項目: `venue_motor_start_dates`（N26）

- [ ] 本番実測: 期待件数（算出根拠: 公開マップの全24会場（江戸川を含む。`bc_mst`は24会場とも2026-09-21に200を確認）の`bc_mst`。**日ごとの取得は24件が期待値**で、`scrape_job_state.last_report.history`の各日の`fetched=24`・`complete=true`で確認する。テーブルは新しい（会場, 使用開始日）の組が現れたときだけ増えるため、全24会場に最低1行あること（`count(distinct venue_code)=24`）を確認する）に対し、充足率99%以上であることを実測クエリで確認する。過去の使用開始日の履歴は取得元に無い（最新の1つのみ）ため、「取得開始日以降のみ」とし、ユーザーの承認を得る
- [ ] タイミング実測: 日次（1日1回）のため窓型ではない。**Bの基準の提案（未承認）**: 土日を含む直近5日、毎日、06:30 JSTの指定から3時間以内（09:30 JSTまで）に24会場を取得できた（`last_report.history`の`doneAt`と`complete`）。新しい使用開始日が、変更の翌日までにテーブルに入る（`created_at`と、モーター交換の日）
- [ ] 継続監視: 日次の期限超過（指定から3時間で未処理→`daily_overdue`）・0件エラー（最初の3会場が続けて失敗→`error`）・一部の欠落（`last_report.alerts`の`motor_start_incomplete`）が、Slackに通知されることを確認する

### T4b-18 順延・中止の早期確定（`race_status`）: `races.cancellation_status`

設計: [postponed-day-early-detection.md](./postponed-day-early-detection.md)。開催場一覧（`race/index`）の告知と、レース単位の結果ページ（「レース中止」）が一致したレースを、発走を待たずに`confirmed`にする。書き込みは`races.cancellation_status`のみ（未確定→確定の1回）。

- [x] **T4b-18-1**（コード実装済み。`scripts/lib/raceStatusParsers.js`・`raceStatusJob.js`・`api/cron/race-status.js`、レジストリ`race_status`、`vercel.json`のcron、`compareRaceDigests`の`excludeRaceIds`。既定は`off`（行なし）で挙動不変。検証は`npm run verify:race-status-job`。実ページの固定資料は`scripts/lib/__fixtures__/raceStatus/`）
- [ ] **T4b-18-2** (ユーザー承認) `scrape_job_state`の`race_status`を`shadow`にする。順延・中止が起きた日に、`last_report`の`announced`・`wouldConfirm`・`unrecognized`・`contradictions`を、公式の開催場一覧と既存基盤の確定結果に突き合わせる。**告知（開催場一覧）から結果ページの「レース中止」表示までの遅延**と、告知から`wouldConfirm`に載るまでの時間を実測する（設計書§6）
- [ ] **T4b-18-3** (ユーザー承認) 一致が確認できたら`live`にする

データ項目: `races.cancellation_status`（中止・順延の確定）。

- [ ] 本番実測: 期待件数（算出根拠: 順延・中止が告知された会場×日の、N R以降のレースのうち結果の無いもの。開催場一覧の状態欄の告知数から算出。結果のあるレースは分母から除き、件数を報告）に対し、`cancellation_status='confirmed'`が99%以上であることを、告知日ごとに実測クエリで確認する。過去分は、全日順延が過去日の開催場一覧に残る（2026-09-09の江戸川で確認）ため、その範囲で遡及して確認する
- [ ] タイミング実測: 告知から確定までの遅延（`shadow`の`last_report`、`live`では`races`の確定時刻は保存しないため`scrape_job_state.last_report`）を、順延・中止の発生日（土日を含む直近5日に発生が無い場合は、発生した日のみ）で実測する。目標は、発走前に確定していること
- [ ] 継続監視: `scrape-monitor`の連続失敗・死活が`race_status`に効くこと（`live`・`shadow`で有効）を確認する。`unrecognized`（未知の状態欄）と`contradictions`（告知と結果の矛盾）が、`scrape-summary`または日次の点検で人に見えること（未実装。`last_report`の確認は手動）

---

## Phase 7: 最終検証と旧基盤の廃止（WS7、G3）

- [ ] **T7-01** 全データセットの、完了の定義A・B・Cの実測を再実行し（`scripts/analysis/data-health-report.js`、WS1）、証拠（クエリと結果）を、orchestration.mdに記録する
- [ ] **T7-02** (ユーザー承認) 取得系のGitHub Actions（`scrape-scheduled.yml`・`scrape-point-rank.yml`・`scrape-venue-motor-stats.yml`・`scrape-venue-entry-course-stats.yml`・`collect-racer-news.yml`・`scrape-racer-season-stats.yml`）を、コードを残したまま、`SKIP_*_ON_GHA=true`で停止した状態で、土日を含む7日間、本番データが欠けないことを実測で確認する（G3）
- [ ] **T7-03** (ユーザー) cron-job.orgの全ジョブ（`scrape-scheduled`・`exhibition`・`race-notices`・`aggregate-stats`のdispatch等）を停止・削除する。`docs/operation/external-cron-setup.md`を、廃止または更新する。`aggregate-stats`のdispatchは、取得ではなくDB内集計のため、GitHub Actionsの`schedule`で足りるか、別の起動元が要るかを、ユーザーに確認する
- [ ] **T7-04** 旧基盤のコード・ワークフローを削除する: 取得系のGitHub Actionsワークフロー、`scrape-scheduled.js`・`morning-init.js`、`SKIP_*_ON_GHA`変数、`api/scrape-races.js`（利用の有無を全期間で確認した後。plan.md U11）、展示の旧実装（D5: `scrape-to-json.js`・`api/scrape-races.js`のbeforeinfo別パーサー）。`continue-on-error`を残さない
- [ ] **T7-05** 既存ドキュメントに、置き換えの注記を追記する（plan.md §12）。ADR-0057（窓の意味論）・ADR-0066（移行specの参照先）を更新する。orchestration.mdのWS4a・WS4b・WS7を完了に更新する

- [x] **T7-06**（コード実装済み。`scripts/lib/dataHealth/`（登録表`checks.js`・関数のSQLの正本`functions.js`・判定`evaluate.js`・実行`job.js`）、`api/cron/data-health.js`、レジストリ`data_health`（daily・06:30 JST指定）、`vercel.json`のcron、`docs/db-migration/089_data_health_functions.sql`、メタ監視`check-scrape-monitor-liveness.js`の拡張、`npm run verify:data-health-job`・`npm run check:data-health`。既定は`off`（行なし）で挙動不変。runbook §U） **汎用の日次監視（完了の定義C）**。件数の充足率・0件のテーブルを、DBの実測から日次で自動計測し、閾値未達を既存のSlack通知（`scrape-monitor`経由）に流す。期待件数のSQLは、データセットごとの固定の関数（089。任意のSQLを渡す口は作らない）で宣言し、閾値・分類・除外は登録表で宣言する（新しいデータセットは、そのマイグレーションで関数を足し、登録表に1件足す）。分母の定義は`data-health-report.js`と共有（`coverageSpec.js`）
- [ ] **T7-06-1** (ユーザー承認) マイグレーション089（関数7本。テーブル・データの変更なし）を本番へ適用する。`docs/db-migration/APPLIED.md`の089を「適用済み」に更新する。適用後の確認SQLは、ファイル冒頭
- [ ] **T7-06-2** (ユーザー承認) `scrape_job_state`の`data_health`を`shadow`にし、翌朝06:35 JST以降の`last_report`（`wouldAlert`・`checks`）でノイズ（誤警告・閾値の見直し）を確認する。runbook §U-3
- [ ] **T7-06-3** (ユーザー承認) `data_health`を`live`にする（`SLACK_WEBHOOK_URL`はVercelの環境変数に設定済みであること。`scrape-monitor`の通知と同じ）。初回は、実際に未達の項目が1回だけ通知される（runbook §U-4）。`scrape-monitor-liveness`（日次）が`data_health`の未処理を検知することを、次の朝に確認する

データ項目: 汎用の日次監視`data_health`（`scrape_job_state`の`last_report`。データテーブルへは書かない）。

- [ ] 本番実測: 期待件数（算出根拠: 登録表`checks.js`の各項目。分母は`data-health-report.js`と同じ定義（開催中止を除く。rank4〜6は完走艇数まで。全券種オッズは2026-09-17以降）で、直近7日）に対し、登録した全ての項目のSQLが本番で動き、期待どおりの値を返すことを実測クエリで確認する（`npm run check:data-health`。実測はPR本文・完了報告に添付）
- [ ] タイミング実測: 日次の集計であり、可変データの窓型ではない。代わりに「06:35 JSTの実行が、指定時刻06:30から3時間以内（`scrape-monitor`の日次の期限超過の基準）に完了する」ことを、`scrape_job_state`の`last_target_date`・`last_success_at`で連続5日確認する
- [ ] 継続監視: 閾値未達・0件のテーブルが日次で計測され、Slackへ通知されること（初回の実通知を確認）。監視自体の失敗（未実行・全関数の失敗・089の未適用）が、`scrape-monitor`（日次の期限超過・連続失敗）と、`scrape-monitor-liveness`（日次。`scrape-monitor`自体が止まっている場合）で検知されること

**完了条件（G3）**: `morning-init`を含む全取得処理がVercelへ移行済みで、旧基盤を止めても本番データが欠けないことを実測で確認している。

---

## N23・N29: 前検タイムと日次の照合（トラックC。T4b-20・T4b-21。第1弾の追加項目）

設計: [plan.md §15](./plan.md) / 手順: [verification-runbook.md](./verification-runbook.md) T / 既定は`off`（`scrape_job_state`に行を作らない）。本番のDDL・`mode`の変更・過去分の取得は、着手のたびにユーザーの承認が要る。

### T4b-20 前検タイム・前検順位・節時点のモーター/ボート2連対率（N23）: `motor_pretest_stats`

- [x] **T4b-20-1**（コード実装済み。`scripts/lib/motorPretestParser.js`・`motorPretestRows.js`・`motorPretestJob.js`・`api/cron/motor-pretest.js`・レジストリ`motor_pretest`・`vercel.json`のcron・`docs/db-migration/090_motor_pretest_stats.sql`（**未適用。ユーザー承認待ち**）・`scripts/maintenance/motor-pretest-backfill.js`。検証: `npm run verify:motor-pretest`。変異検証済み） 公式`race/rankingmotor`を、その日の開催会場ごとに1ページ取得し、前検タイム・前検順位（前検タイムから計算）・モーター/ボートの番号と2連対率を保存する日次ジョブと、過去分のCLI
- [ ] **T4b-20-2** (ユーザー承認) マイグレーション090を本番へ適用する（APPLIED.mdの「未適用」を「適用済み」に更新）。適用前は、ジョブを`shadow`にしてよい（書かないため。`live`にすると、成功にせず失敗する）
- [ ] **T4b-20-3** (ユーザー承認) `scrape_job_state`の`motor_pretest`を`shadow`にし、3日（土日を含む）、`last_report.summary`（期待した選手がページに載る割合・前検タイムの非NULL率）と`last_report.alerts`を確認する。**前提**: `races_init`が`live`（朝05:00に`races`が揃う）。runbook T-2
- [ ] **T4b-20-4** (ユーザー承認) 090の適用後、`live`にする。翌朝の最初の書き込みを観測する（runbook T-3）
- [ ] **T4b-20-5** (ユーザー承認) 過去分のバックフィル（2025-12-03〜。節の初日のみ703リクエスト、1夜、約2.7時間。CLIの`plan`→`download`（夜間）→`parse`→`load --apply`）。実行前に、CLIの`plan`の出力と範囲（`first-days`か`all-days`）を提示して承認を得る。取得先への負荷: 逐次・3秒以上・JST 00-06・日次上限1,500・サーキットブレーカー（ADR-0067）

データ項目: `motor_pretest_stats`。取得できる情報は前検タイムのみが新規で、2連対率・番号は`race_entries`の低精度の重複（plan.md §15.1）。

- [ ] 本番実測: 期待件数（算出根拠: `races`の会場×日ごとの、`race_entries`の（会場, 日付, 登録番号）のdistinct。確定中止のレースの選手は除き、除外した件数を報告。日次ジョブの稼働日は、全会場×日。過去分は、範囲に応じて、節の初日のみ（2025-12-03〜2026-09-20で703会場日）または全会場日（3,722）で、前者は「選手・会場ごとの直近の行が同じ節（8日以内）にある」割合で数える。SQLはrunbook T-4）に対し、過去分を含めて充足率99%以上であることを実測クエリで確認する。前検タイムの非NULL率も報告する。**過去の日次の2連対率は、遡って取得できるが、低精度の重複のため、初日のみ**とし、ユーザーの承認を得る
- [ ] タイミング実測（**B基準は提案。ユーザーの承認前**）: 「D日の開催全会場×全出走選手の行が、D日07:00 JST（オッズの運用窓の開始）までに書かれている」割合を、土日を含む直近5日で実測する（`created_at`が07:00 JST以前の行の割合。欠落率2%以内）。前検の公開: 前日の夕方（2026-09-21 17:38 JSTの実測で、翌日初日の3会場の全選手の前検タイムが載っていた）。ページに載る時刻（前日の何時から）の実測は未了（runbook T-1）。SQLはrunbook T-4
- [ ] 継続監視: 上記指標が日次で自動計測され（`scrape_job_state.last_report.summary`）、閾値超過（期待した選手がページに載っていない会場・前検タイムの非NULL率95%未満・構造変化2日連続・日次の未処理3時間）でSlack通知されることを確認する（runbook T-5）

### T4b-21 日次の照合（N29）: 前日の結果・払戻・着順・進入を、DBとKファイルで突き合わせる

- [x] **T4b-21-1**（コード実装済み。`scripts/lib/dailyReconcile.js`・`dailyReconcileJob.js`・`api/cron/daily-reconcile.js`・レジストリ`daily_reconcile`・`vercel.json`のcron・`raceResultAudit.js`の`kVenuesToRaceFacts`（進入・払戻明細を追加。既存の返り値は不変）。検証: `npm run verify:daily-reconcile`。変異検証済み。**新しい取得先・テーブルは無い**） 前日Dの1レースごとに、結果の有無・rank1〜6・払戻（旧15列と`race_payouts`）・進入を、Kファイル（別の公式ファイル）と突き合わせ、不一致（レースID・項目・DB値・K値）を`last_report`に上限30件で残し、閾値（1レース）以上で`alerts`に出す。Kが未取得・会場が未展開のものは「照合不能」、確定中止は「除外」、Kファイル同期の前の`rank4〜6`・進入は「同期待ち」として、不一致に混ぜない
- [ ] **T4b-21-2** (ユーザー承認) `scrape_job_state`の`daily_reconcile`を`shadow`にし、3日（土日を含む）、`last_report`（`summary`・`mismatches`・`wouldAlert`）を確認する。**前提**: `kfile_sync`が`live`（rank4〜6・進入が07:00・12:00に同期される）。runbook T-6
- [ ] **T4b-21-3** (ユーザー承認) `live`にする。不一致の通知の実受信を確認する（runbook T-7）。`shadow`の間に見つかった実際の不整合（2026-09-18の江戸川11R 2連複、2026-09-11の第1日3会場36レース。plan.md §15.2）の扱い（修正・別チケット）は、ユーザーが判断する

データ項目: 日次の照合結果（`scrape_job_state.last_report`。新規テーブルは無い）。

- [ ] 本番実測: 期待件数（算出根拠: 前日Dの`races`のレース数から、確定中止を除いたもの。**照合できた（`compared`）**レース数と、照合不能・同期待ちの件数を、`last_report.history`に日次で残す。除外した件数も報告）に対し、照合できた割合99%以上であることを、日次照合の稼働日について実測クエリで確認する（未達は、理由（Kの会場が未展開等）を件数付きで説明）。**日次の照合は、稼働開始日以降のみ**（過去日の突合は、既存のCLI`scripts/maintenance/audit-race-result-anomalies.js`（`--k-dir`）で行う。過去分を遡る照合は範囲外）とし、ユーザーの承認を得る
- [ ] タイミング実測（**B基準は提案。ユーザーの承認前**）: 「D+1の12:30 JSTまでに、Dの照合が完了（`last_target_date`がD+1）している」割合を、土日を含む直近5日で実測する（欠落率2%以内）。08:00 JSTの起動で、Kファイル同期（07:00）の後に照合する。12:30（`kfile_sync`の12:00の後）・17:30（最後の照合。同期待ちを不一致に数え、照合不能を通知）が補足。SQLはrunbook T-7
- [ ] 継続監視: 照合の結果が日次で自動計測され（`last_report.history`、直近14日）、不一致・照合不能（最後の照合）が`alerts`→Slackに出ること、照合自体の未実行が日次の未処理（3時間）として検知されることを確認する（runbook T-7）
