# 予定表・共通ラッパの実環境での検証手順書（tasks.md T4a-10）

対応: [plan.md](./plan.md) §3.5・§10（R1・R2・R14）・§13（U9・U16・U17） / [tasks.md](./tasks.md) T4a-10

本番DBのテーブル（`scrape_slots`・`scrape_job_state`）がある状態でしかできない検証の手順。DBに関わらない部分（期限計算のJST・許容幅・リース・冪等・ブレーカー・0件エラー等）は、DDLの適用前に、次のコマンドで検証済み（PGliteとインメモリのストア）。

| コマンド | 内容 |
|---|---|
| `npm run verify:scrape-slots-sql` | マイグレーション075をPGlite（インメモリPostgreSQL）に適用し、RPCの意味論（期限・許容幅・リース・奪取・確定中止・日付またぎ・順延の追従）を検証（`npm i --no-save @electric-sql/pglite`が要る） |
| `npm run verify:scrape-jobs` | 共通ラッパ・politeFetch・ブレーカー・レジストリ・`resolveTargetDate` |
| `npm run verify:scrape-monitor` | 監視・cleanup・メタ監視・`api/cron/*`と`vercel.json`の整合 |

## 前提

1. マイグレーション075を本番へ適用済み（T4a-03。**ユーザーの承認後**）。適用後、PostgRESTのスキーマキャッシュに反映されていること（Supabaseは通常DDLの直後に自動で更新する。反映されていない場合は、SQL Editorで`NOTIFY pgrst, 'reload schema';`）
2. Vercelの環境変数（Production）に、`CRON_SECRET`・`SUPABASE_URL`・`SUPABASE_SERVICE_KEY`・`SLACK_WEBHOOK_URL`が設定済み（値は確認せず、名前の有無のみ。T4a-01）
3. このPRがマージされ、本番にデプロイ済み

**Previewでは、Cronが発火しない**（Productionのみ。plan.md R14）。Previewでの検証は、`CRON_SECRET`付きの手動リクエストで行う。Previewには、Deployment Protectionがかかっている場合があり、その場合は保護のバイパスの設定（`x-vercel-protection-bypass`ヘッダー）が要る。Previewの環境変数（Preview環境に`CRON_SECRET`・`SUPABASE_*`があるか）は未確認。無い場合は、Productionで疑似ジョブを（`mode=shadow`で）実行する。**本番の予定表・ジョブ状態への書き込み（下記の`INSERT`・`UPDATE`）は、ユーザーの承認を得てから実行する**（`pseudo`・`pseudo_verify`のジョブ名の行のみ）。

## A. DBのRPCの検証（二重claim・リースの奪取・期限計算・expired）

```
node --env-file=.env.local scripts/maintenance/verify-scrape-slots-on-db.js            # dry-run（何をするかを表示）
node --env-file=.env.local scripts/maintenance/verify-scrape-slots-on-db.js --execute  # 実行（承認後）
```

`scrape_slots`に`job='pseudo_verify'`の行（`--date`のレース分。既定は今日）を作り、終了時に削除する。他のジョブ・テーブルには書かない。時刻は`p_now`で固定するため、実行時刻に依存しない（対象日のracesが41件以上必要）。

| 確認 | 期待 |
|---|---|
| `ensure_scrape_slots`の冪等 | 全レース分を作成、再実行は0件 |
| 期限計算（JST） | 期限の1秒前には取れず、期限ちょうどに取れる（期限＝発走時刻をJSTとして扱い−60分） |
| 二重claim（**PGliteでは検証できない並行実行**） | 8本の同時`claim`で40件を取り、同じスロットを2つの実行が取らない（重複0件） |
| リースの奪取 | リース切れの`running`を別workerが取り`attempts`が2になる。奪われた旧workerの完了の更新は0行 |
| expired | 許容幅を超えた未完了は`expired`。一度も`claim`されなかったものは`attempts=0`（未実行） |

実行後の確認（読み取り）: `SELECT count(*) FROM scrape_slots WHERE job='pseudo_verify';` が0（後片付け済み）。

## B. Vercel上の疑似ジョブ（`api/cron/scrape-pseudo`）での検証

疑似ジョブは、取得先へアクセスせず、予定表のスロットを消化するだけ（`resultDigest`に、処理した実行とattemptを残す）。Cronには登録しない。

準備（承認後）: 
```sql
INSERT INTO scrape_job_state (job, mode) VALUES ('pseudo', 'shadow')
ON CONFLICT (job) DO UPDATE SET mode = 'shadow';
```
リクエスト: `curl -s -H "Authorization: Bearer $CRON_SECRET" "https://www.boat-ai.jp/api/cron/scrape-pseudo"`（`$CRON_SECRET`はシェルに渡すが、値は出力・記録しない）。1回目は、最初の起動のため予定表（`race_date`＝今日のレースの`-60`分スロット、期限+30分の間のもの）を生成して消化する。

| 確認 | 手順 | 期待 |
|---|---|---|
| モードのゲート | `mode='off'`で呼ぶ → `skipped: mode_off`。行を削除して呼ぶ → 行が`off`で作られ`skipped` | 書き込みなし（`scrape_slots`に行が増えない） |
| 認証 | `Authorization`なし・誤りで呼ぶ | 401 |
| 重複配信・二重claim | `?sleepMs=3000`を付けて**同時に2件**のリクエストを送る（`curl ... & curl ... & wait`）。2件の`claimed`の合計が、消化された行数と一致 | `SELECT race_id, attempts FROM scrape_slots WHERE job='pseudo' AND status='done' AND attempts > 1;` が0行。各`resultDigest`の`worker`が、2つの実行のどちらか一方のみ |
| リースの奪取（実環境） | 疑似ジョブのリースは20秒。`?sleepMs=25000`で1件目を実行中（25秒）に、別のリクエストを21秒後に送る | 2件目が同じスロットを奪取して`attempts=2`、1件目の完了は`claimed_by`不一致で記録されない（関数ログに「リースを失っていたため記録しませんでした」）。最終的に`done`は2件目の`worker` |
| 期限計算 | 消化された行で`done_at - 期限`（`(race_date + races.start_time) AT TIME ZONE 'Asia/Tokyo' - 60分`）を確認 | 期限以降。JSTとして扱われている（9時間ずれていない） |
| 環境変数の変更が、再デプロイなしに反映されるか（plan.md U17） | Vercelのダッシュボードで`SCRAPE_PSEUDO_PROBE`を追加・変更（**再デプロイしない**）→ 疑似ジョブを呼ぶ → `resultDigest`の`probe=`を確認 | 反映されない（新しいデプロイにのみ反映）場合、本設計の前提（モードをDBに持つ）が正しい。反映される場合は、その旨を`plan.md`のU17に記録 |
| 監視（`scrape-monitor`） | `pseudo`を`shadow`にし、`ensure`された（期限を過ぎていない）スロットを、疑似ジョブを呼ばずに放置して、許容幅（30分）を超えさせる | `scrape-monitor`（5分ごと）が、`expired`（未実行 attempts=0）をSlackへ通知する。同じスロットの再通知はしない。`SLACK_WEBHOOK_URL`が無い場合は、監視の実行が失敗し（`scrape_job_state`の`scrape-monitor`の`last_error`）、メタ監視が検知する |
| メタ監視 | Actionsの`Scrape Monitor Liveness`を手動実行（`workflow_dispatch`） | `scrape-monitor`の`last_tick_at`が新しければOK。運用窓（JST 07:10〜23:59）の外では`SKIP` |
| 後片付け | 検証後 `UPDATE scrape_job_state SET mode='off' WHERE job='pseudo';`、`DELETE FROM scrape_slots WHERE job='pseudo';`。疑似ジョブが不要になったら、`api/cron/scrape-pseudo.js`と`registry.js`の`pseudo`を削除 | `off`の疑似ジョブの`expired`は、監視が通知しない |

## C. Vercel Cronの未配信・重複の頻度（plan.md U16）

疑似ジョブ・実ジョブを`shadow`で本番Cronから動かした後に、次を集計する（読み取りのみ）。

- 未配信: `scrape_slots`の`attempts=0`のまま`expired`になった件数（`SELECT job, count(*) FROM scrape_slots WHERE status='expired' AND attempts=0 GROUP BY 1;`）。`scrape-monitor`が即時通知する
- 重複配信: 同じ分に、同じエンドポイントが2回起動された回数。Vercelのランタイムログ（`/api/cron/scrape-monitor`の呼び出し時刻）から、分単位で集計する。予定表側では、二重claimは起きない設計のため、`attempts`の増加ではなく、リース中の`claim`が0件で終わった実行（`claimed: 0`）の増加として現れる
- 死活: `scrape_job_state.last_tick_at`の更新間隔（5分ごとの書き込みのため、最大約5分の間隔）と、`scrape-monitor`の`liveness`通知の有無

## D. 順延の追従（plan.md U9）

期限は保存せず、`races.start_time`から都度計算するため、発走時刻が変わればまだ`done`でないスロットは新しい期限に追従する（PGliteの検証で確認済み: `verify-scrape-slots-sql.js`）。既に`done`のスロットは再オープンしない（既知の限界）。**発走時刻の変更の頻度**は、運用開始後に、`first_attempt_at`と期限のずれ（期限より前に`first_attempt_at`がある行＝期限が後ろへずれた）から計測する:

```sql
SELECT s.job, count(*) AS moved
FROM scrape_slots s JOIN races r ON r.race_id = s.race_id
WHERE s.first_attempt_at IS NOT NULL
  AND s.first_attempt_at < ((r.race_date + r.start_time) AT TIME ZONE 'Asia/Tokyo') + make_interval(mins => s.offset_min)
GROUP BY 1;
```

## E. shadowからliveへの切り替え時の注意（レビュー指摘）

`shadow`で`done`になったスロットは、`live`に切り替えても再取得されない（データテーブルへ書いていないのに、その窓は「済み」になる）。GitHub側の停止（`SKIP_*_ON_GHA=true`）は、`live`に切り替え、少なくとも1つ後の窓が`live`で完了したのを確認してから行う。急ぐ場合は、切り替え直後に、許容幅の内側の`shadow`の`done`を戻す:

```sql
UPDATE scrape_slots
   SET status='pending', done_at=NULL, outcome=NULL, run_mode=NULL, next_attempt_at=NULL
 WHERE job='<ジョブ>' AND run_mode='shadow' AND status='done' AND race_date=<今日>;
```

（期限+許容幅を過ぎたスロットは、次の`claim`で`expired`になるため、戻しても再取得されない。`expired`は通知される。）

## 結果の記録

検証したら、結果（実行したコマンド・SQLと出力）を、tasks.md T4a-10のチェックとともに、PRの説明または`orchestration.md`に記録する。U16・U17は、plan.md §13の表に結果を追記する。

## G. 特記事項（A5、race-notices）の共通ラッパへの切り替え（tasks.md T4b-11）

対応: `api/cron/race-notices.js`・`scripts/lib/raceNoticesJob.js`・レジストリの`race_notices`・`vercel.json`のcrons。DBに関わらない部分（モード・リース・DB障害を200にしない・会場の失敗の扱い・変更のある行のみ・並列度・配線）は`npm run verify:race-notices-job`で検証済み。

**A5は、既に本番で稼働している**（cron-job.orgが10分ごとに、同じエンドポイントを叩く）。共通ラッパはモードのゲートを掛けるため、**`scrape_job_state`の`race_notices`が`off`（または行なし）だと、マージ後、cron-job.orgの呼び出しも何もしなくなり、特記事項の取得が止まる**。次の順序を守る。

### G-1. マージ前（本番DBへの書き込み。ユーザーの承認後）

`live`の行を先に作る（マージ前の現行コードは、この行を読まないため、影響しない）。
```sql
INSERT INTO scrape_job_state (job, mode) VALUES ('race_notices', 'live')
ON CONFLICT (job) DO UPDATE SET mode = 'live';
```
（075の適用後。`scrape_job_state`が無ければ、共通ラッパは「075未適用」として何もせず200で終わり、同じく取得が止まる。前提: 075は適用済み）

### G-2. マージ後: 稼働の確認（cron-job.orgと並走）

マージ後、Vercel Cron（10分ごと）とcron-job.org（10分ごと）の両方が、同じエンドポイントを叩く。ジョブ単位のリースで、同時には1つだけが走り、書き込みは変更のある行のみ・重複を無視するupsertのため、二重に起動されても無害。

| 確認 | 手順 | 期待 |
|---|---|---|
| ゲート | `curl -s -H "Authorization: Bearer $CRON_SECRET" "https://www.boat-ai.jp/api/cron/race-notices"` | `success: true`・`mode: "live"`・`venuesChecked`が当日の開催会場数・`venuesFailed`が空 |
| 死活・成功の記録 | `SELECT job, mode, last_tick_at, last_success_at, last_error, consecutive_failures, last_report FROM scrape_job_state WHERE job = 'race_notices';` | `last_success_at`が10分以内、`last_error`なし、`last_report`に`digest`・`venuesChecked` |
| 集計行の書き込み削減（D9） | `SELECT check_date, count(*) FROM race_notices_health WHERE check_date = '<今日>' GROUP BY 1;` を、朝と夕方に | 会場数のまま（従来と同じ）。`last_checked_at`が朝の値のまま（変更が無い会場は、書き直さない） |
| 二重起動が無害 | Vercelのランタイムログ（`/api/cron/race-notices`）で、同じ10分の枠に2件のリクエスト（cron-job.orgとVercel Cron）があり、片方の応答が`skipped: lease_held`、または2回とも処理（`healthWritten: 0`） | データが増えない・エラーなし |
| cron-job.org側の表示 | cron-job.orgの実行履歴 | **30秒を超えた実行は、cron-job.org側だけが「失敗（タイムアウト）」と表示する**（関数は完走する。以前は、即時に202を返していた）。会場数×約8〜10秒÷6並列（13会場で約20秒、24会場で約40秒）。連続失敗でジョブが自動無効化される設定なら、並走は短期間にとどめる |

### G-3. cron-job.orgの登録内容の確認と、停止（ユーザー作業）

- 確認（plan.md・job-inventory.md U1）: race-noticesのジョブの、URL（`/api/cron/race-notices`）・間隔・稼働窓（JST 07:00〜23:59か）・Authorizationヘッダー
- Vercel Cronでの稼働（G-2）を、数日（土日を含む）確認した後、cron-job.orgの`race-notices`のジョブを停止する。停止後は、Vercel Cronのみで動く（JST 07:00〜23:50の10分ごと）。**切り戻し**: cron-job.orgのジョブを再開する（Vercel Cronと並走してよい）。または`UPDATE scrape_job_state SET mode = 'off' WHERE job = 'race_notices';`で、両方を止める（従来のコードへは、PRのrevertで戻す）

### G-4. shadow（任意）

特記事項の一覧は、公式ページが節の累積を毎回表示するため、`shadow`で数回の取得を飛ばしても、次の`live`の実行で追いつく（データは失われない）。取得・解析の一致だけを確認したい場合の手順（夜間に短時間）:
```sql
UPDATE scrape_job_state SET mode = 'shadow' WHERE job = 'race_notices';   -- 取得・解析のみ。DBへ書かない
-- 1〜2回の実行（10分ごと）を待つ
SELECT last_report FROM scrape_job_state WHERE job = 'race_notices';       -- notesParsed・venuesChecked・venuesFailed・digest
UPDATE scrape_job_state SET mode = 'live' WHERE job = 'race_notices';      -- 必ず戻す
```
`shadow`の間は、`race_special_notes`・`race_notices_health`は書かれない（取得の継続は止まる）。`digest`は、解析した通知の一覧（会場・日付・区分・本文）のハッシュで、`live`の実行の`digest`と同じ内容なら一致する。

### G-5. 継続監視（完了の定義C）

- 失敗: 共通ラッパが`scrape_job_state`の`consecutive_failures`・`last_error`に記録し、`scrape-monitor`が3回以上の連続失敗を通知する（DB障害・全会場の取得失敗）
- 構造変化: 既存の`race-notices-drift-monitor.yml`（`race_notices_health`の`had_success`・`last_reason`を日次で畳み込む）。変更のある行のみの書き込みでも、判定に必要な情報は失われない
- **未整備**: `race_notices`（continuous）の死活（`last_success_at`が古い）は、`scrape-monitor`の死活判定の対象外（対象は窓型）。Cronの未配信・関数の障害で、特記事項が止まっても、通知されない。WS4aの`scrape-monitor`の拡張として、別タスクで追加する（`last_success_at`が運用窓内で30分以上古い、など）
- `race_notices_health.last_checked_at`は、変更のある行のみ書くため、最終確認の時刻ではない。`scripts/analysis/data-health-report.js`の鮮度（`max(last_checked_at)`）は、この表では、実際より古く出る。最終確認は`scrape_job_state.last_success_at`
