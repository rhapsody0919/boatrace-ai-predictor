# 予定表・共通ラッパの実環境での検証手順書（tasks.md T4a-10）

対応: [plan.md](./plan.md) §3.5・§10（R1・R2・R14）・§13（U9・U16・U17） / [tasks.md](./tasks.md) T4a-10

本番DBのテーブル（`scrape_slots`・`scrape_job_state`）がある状態でしかできない検証の手順。DBに関わらない部分（期限計算のJST・許容幅・リース・冪等・ブレーカー・0件エラー等）は、DDLの適用前に、次のコマンドで検証済み（PGliteとインメモリのストア）。

| コマンド | 内容 |
|---|---|
| `npm run verify:scrape-slots-sql` | マイグレーション075をPGlite（インメモリPostgreSQL）に適用し、RPCの意味論（期限・許容幅・リース・奪取・確定中止・日付またぎ・順延の追従）を検証（`npm i --no-save @electric-sql/pglite`が要る） |
| `npm run verify:scrape-jobs` | 共通ラッパ・politeFetch・ブレーカー・レジストリ・`resolveTargetDate` |
| `npm run verify:scrape-monitor` | 監視・cleanup・メタ監視・`api/cron/*`と`vercel.json`の整合 |
| `npm run verify:scrape-result-job` | 結果取得・Kファイル同期・catch-up（WS4b。DB・取得先なし。実際の結果ページのフィクスチャで解析・digest・shadowが書かないこと・中止確定・cron窓を検証） |

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

## F. 結果取得（`result`・`result_catchup`）の切り替え（tasks.md T4b-02-3〜5、T4b-05-2）

対象: `api/cron/result.js`（毎分、JST 07:00〜翌00:59）、`api/cron/result-catchup.js`（23:50・翌00:30 JST）。コードのマージ・本番デプロイ後に始める。マージ直後は、`scrape_job_state` に行が無い（または `off`）ため、両ジョブは何も取得せず何も書かない（行が無い場合は、`mode='off'` の行を1つ作るだけ。`mode` は変更しない）。

操作の区分: **読み取りSQL・確認スクリプトはAgentが実行してよい。`scrape_job_state` の `mode` の更新（書き込み）と、リポジトリ変数の変更は、ユーザーの承認を得てから行う。**

共通の状態確認（読み取り）:

```sql
SELECT job, mode, last_tick_at, last_success_at, consecutive_failures, last_error,
       last_rows_written, last_target_date, breaker_open_until
  FROM scrape_job_state
 WHERE job IN ('result', 'result_catchup', 'kfile_sync') OR job LIKE 'host:%'
 ORDER BY job;
```

### F1. shadow（3日。土日のいずれか1日を含む）

開始（承認後）。`result` と `result_catchup` を同時に `shadow` にする（どちらも取得・解析のみで、データテーブルへ書かない）:

```sql
INSERT INTO scrape_job_state (job, mode) VALUES ('result', 'shadow'), ('result_catchup', 'shadow')
ON CONFLICT (job) DO UPDATE SET mode = 'shadow', updated_at = now();
```

shadow の間、GitHub Actions側の結果取得は、そのまま動く（Vercel側は取得先へ、レースごとに約1回ずつ余分に取得する。1日あたり、約180〜290ページ）。

毎日の確認（読み取り）:

```
node --env-file=.env.local scripts/maintenance/check-result-shadow.js --days=3
```

`result_digest`（shadow が解析した値のハッシュ）を、既存基盤が `race_results`・`race_start_timings` に書いた値から計算したハッシュと比べ、一致率・不一致のレース・遅延（完了−発走5分後）のp50・p95・試行回数を出す。

```sql
-- shadow が、データテーブルへ書いていないこと（rows_written が全て0）
SELECT count(*) AS shadow_rows_written_nonzero
  FROM scrape_slots WHERE job = 'result' AND run_mode = 'shadow' AND rows_written > 0;          -- 期待: 0

-- 状況（JSTの直近3日。確定中止のレースを除く）
WITH s AS (
  SELECT s.*, ((r.race_date + r.start_time) AT TIME ZONE 'Asia/Tokyo') + make_interval(mins => s.offset_min) AS deadline
    FROM scrape_slots s JOIN races r ON r.race_id = s.race_id
   WHERE s.job = 'result'
     AND s.race_date >= (now() AT TIME ZONE 'Asia/Tokyo')::date - 3
     AND r.cancellation_status IS DISTINCT FROM 'confirmed')
SELECT coalesce(run_mode, '未着手') AS run_mode,
       count(*) AS total,
       count(*) FILTER (WHERE status = 'done' AND outcome = 'ok') AS ok,
       count(*) FILTER (WHERE status = 'expired') AS expired,
       count(*) FILTER (WHERE status = 'expired' AND attempts = 0) AS unexecuted,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM done_at - deadline) / 60)
              FILTER (WHERE status = 'done' AND outcome = 'ok'))::numeric, 1) AS p50_min,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM done_at - deadline) / 60)
              FILTER (WHERE status = 'done' AND outcome = 'ok'))::numeric, 1) AS p95_min
  FROM s GROUP BY 1 ORDER BY 1;

-- 取得先の拒否（429・503）とブレーカー
SELECT count(*) AS retried_with_429_503 FROM scrape_slots
 WHERE job = 'result' AND race_date >= (now() AT TIME ZONE 'Asia/Tokyo')::date - 3
   AND (last_error LIKE '%429%' OR last_error LIKE '%503%');
SELECT job, breaker_open_until, last_error, updated_at FROM scrape_job_state WHERE job LIKE 'host:%';
```

Vercelのダッシュボード（Logs・Usage）で、`/api/cron/result` の関数の所要時間（p95）・500の応答数・Active CPUと呼び出し回数を確認する（plan.md U5・U13）。

**成功基準（全て満たせば live へ）**:

| 項目 | 基準 |
|---|---|
| ダイジェストの一致率 | 99%以上（不一致は原因を調べる。公式ページの後日訂正なら許容、解析の差なら修正）。比較できた行が、1日あたり全レースの9割以上 |
| shadow の完了率（確定中止を除く） | `ok` が98%以上。`unexecuted`（`attempts=0` の expired）は0件 |
| 1回の呼び出しの所要時間 | p95が240秒以下（`maxDuration` 300秒、ソフトデッドラインは270秒）。着手を見送った（`deferred`）スロットが、頻発していない |
| 取得先の拒否 | 429・503が0件、ブレーカーが一度も開いていない |
| 500の応答・連続失敗 | 0件。`consecutive_failures` が3以上になっていない |
| shadow の書き込み | 上の `shadow_rows_written_nonzero` が0 |

shadow の間に出うる誤報: 中止・順延のレースは、shadow では `onTick`（中止・順延の確定）が動かないため、GitHub側が確定するまで、スロットが `no_values` で再試行され、最後は `expired`（`run_mode='shadow'`）になる。shadow の `expired` は監視が通知しない（`evaluateExpired`）。集計の `expired` には、こうしたレースが含まれる。

ロールバック（shadow を止める）: `UPDATE scrape_job_state SET mode = 'off', updated_at = now() WHERE job IN ('result', 'result_catchup');`

### F2. live に切り替えて3日並走

`shadow` で `done` になったスロットは、live にしても再取得されない（前の§E）。**切り替えは、その日の最後のレースの許容幅が過ぎた後（翌 00:20 JST 以降）か、早朝（07:00 JST より前）に行う**（許容幅の内側の `shadow` の `done` が無い時間帯）。日中に切り替える場合は、§Eの、`shadow` の `done` を戻すSQLを、ジョブを `result` にして、直後に実行する。

切り替え（承認後）:

```sql
UPDATE scrape_job_state SET mode = 'live', updated_at = now() WHERE job IN ('result', 'result_catchup');
```

live の間、GitHub Actions側の結果取得も動き続ける（同じ行を上書きする。値が同じ行は、両方とも書かない＝変更のある行のみ書く）。

確認（読み取り）:

```sql
-- 結果の充足率（前日以前。確定中止を除く。決まり手・払戻が揃うレースの割合も）
SELECT r.race_date, count(*) AS races,
       count(*) FILTER (WHERE rr.race_id IS NOT NULL) AS with_result,
       count(*) FILTER (WHERE rr.payout_win IS NOT NULL AND rr.winning_technique IS NOT NULL) AS complete
  FROM races r LEFT JOIN race_results rr ON rr.race_id = r.race_id
 WHERE r.race_date BETWEEN (now() AT TIME ZONE 'Asia/Tokyo')::date - 4 AND (now() AT TIME ZONE 'Asia/Tokyo')::date - 1
   AND r.cancellation_status IS DISTINCT FROM 'confirmed'
 GROUP BY 1 ORDER BY 1;

-- 書き込み量（並走前後の24時間の差を比べる。二重書き込みで増えていないこと。tasks.md T0-02と同じ）
SELECT relname, n_tup_ins, n_tup_upd, n_tup_hot_upd
  FROM pg_stat_user_tables WHERE relname IN ('race_results', 'race_start_timings', 'predictions');
```

Vercel側のスロットの状況は F1 の「状況」のSQL（`run_mode = 'live'`）。`check-result-shadow.js` は、live のスロットの遅延・expired の件数も出す。

**成功基準（3日、土日を含む）**:

| 項目 | 基準 |
|---|---|
| 結果の充足率 | 前日以前の `complete` が、確定中止を除くレースの99%以上（並走前より悪化していない） |
| live のスロット | `expired` が0件（出た場合は理由を説明でき、後日の catch-up で補填されている）。遅延のp95が、shadow の値と同程度 |
| 書き込み量 | `race_results`・`race_start_timings` の1日あたりの `n_tup_upd` が、並走前の24時間より増えていない |
| 中止・順延の確定 | 1日あたりの確定件数が、並走前と同程度（`cancellation_status='confirmed'` の件数。大きく増えたら、誤って確定していないかを、結果ページで確認する） |
| catch-up | 23:50 の実行が `incomplete: true` になった日は、翌 00:30 に完了し、`last_target_date` が対象日になる |

ロールバック: `UPDATE scrape_job_state SET mode = 'off', updated_at = now() WHERE job IN ('result', 'result_catchup');`（GitHub側は動いたままなので、取得の空白は無い）。

### F3. GitHub側の停止（`SKIP_RESULTS_ON_GHA`、`SKIP_KFILE_ON_GHA`）

前提: F2が成功基準を満たし、live で、少なくとも1つ後の窓が live で完了している。Kファイル同期は別の変数（`SKIP_KFILE_ON_GHA`）で止める（`SKIP_RESULTS_ON_GHA=true` だけでは、GitHub側のKファイル同期は動き続ける）。Kファイル同期の停止は、§G2の基準を満たしてから。両方を止めた場合、GitHub Actionsは結果取得の呼び出し自体を行わない（`scrape-scheduled.js`）。

手順（承認後。リポジトリ変数の変更）:

```
gh variable set SKIP_KFILE_ON_GHA --body true --repo rhapsody0919/boatrace-ai-predictor
gh variable set SKIP_RESULTS_ON_GHA --body true --repo rhapsody0919/boatrace-ai-predictor
```

（次のGitHub Actionsの実行から反映される。コード変更・再デプロイは不要。`gh` は、このプロジェクトのアカウント（rhapsody0919）で実行する。）

停止後の7日（土日を含む）の実測（tasks.md T4b-02-5）:

```
gh run list --workflow scrape-scheduled.yml --repo rhapsody0919/boatrace-ai-predictor --limit 300 --json conclusion,status,createdAt,updatedAt
```

- GitHub Actionsの1回の実行時間: 379秒 → 約262秒の見込み（結果関連の約117秒が減る）
- キャンセル率: 11.8%（400件中47件、plan.md F11）から低下しているか
- 完了の定義（A・B・C）: F2の充足率のSQL、`result` の窓内取得率（監視の日次サマリー）、`expired` の件数・監視の通知

ロールバック（順序を守る。取得の空白を作らない）:

1. `gh variable set SKIP_RESULTS_ON_GHA --body false --repo rhapsody0919/boatrace-ai-predictor`（と、`SKIP_KFILE_ON_GHA` も `false`）。次のGitHub Actionsの実行から、結果取得・Kファイル同期が再開する
2. Vercel側を止める場合は、GitHub側の再開を確認してから `UPDATE scrape_job_state SET mode = 'off', updated_at = now() WHERE job IN ('result', 'result_catchup', 'kfile_sync');`

`mode` が `off` の間に積み上がった `pending` のスロットは、監視が通知しない（`off` のジョブは対象外）。`scrape-cleanup` が古い行を整理する。

## G. Kファイル同期（`kfile_sync`）の切り替え（T4b-05-1・T4b-05-3）

対象: `api/cron/kfile-sync.js`（07:00・12:00 JST）。当日を除く直近4日について、進入コース・rank4〜6を、同じ日のKファイル1回のダウンロードで同期する。未同期のレースが無い日は、ダウンロードしない。マージ直後は `off`（何もしない）。

### G1. LZH展開の動作確認（plan.md U15）と shadow

`mode` を `shadow` にしてから、手動リクエストで、Vercel関数の中でLZHの展開が動くかを確認する（`probe`。書き込み・同期なし。取得先へ1リクエスト）:

```sql
INSERT INTO scrape_job_state (job, mode) VALUES ('kfile_sync', 'shadow')
ON CONFLICT (job) DO UPDATE SET mode = 'shadow', updated_at = now();
```

```
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://www.boat-ai.jp/api/cron/kfile-sync?probeDate=2026-09-19"
```

（`$CRON_SECRET` はシェルに渡すが、値は出力・記録しない。）期待: `probe: {downloaded: true, chars: <数十万>, races: 100以上}`。`downloaded: false` なら、その日のKファイルが未公開・開催なし。500なら、展開・取得の失敗（応答の `error`）。

shadow を1日（07:00・12:00の実行）動かして確認する:

```sql
SELECT last_success_at, last_target_date, last_rows_written, last_error, last_report
  FROM scrape_job_state WHERE job = 'kfile_sync';
```

`last_report.days[]` に、直近4日それぞれの、`actualCourse.status`・`rank456.status`（`nothing_pending`＝同期済み・ダウンロードなし、`synced`＝ダウンロードして解析、`kfile_unavailable`＝未同期があるのにKファイルが未公開、`kfile_error`）と、書くはずの件数（`updated`。shadow は dryRun のため書かない）が入る。

**成功基準（shadow 1日）**: `problems` が空（`kfile_error`・`pending_check_failed`・`no_races_parsed` が無い）。`unpublished` が、12:00の実行の後に空。`synced` の日は、`updated` が、GitHub側の同期が後で書いた件数と一致する（`nothing_pending` だけの日は、shadow が確認するものが無い。probe で展開の動作は確認済み）。

ロールバック: `UPDATE scrape_job_state SET mode = 'off', updated_at = now() WHERE job = 'kfile_sync';`

### G2. live（3日並走）

```sql
UPDATE scrape_job_state SET mode = 'live', updated_at = now() WHERE job = 'kfile_sync';
```

GitHub側の同期も動き続ける（同じ値の上書きは、どちらも書かない）。確認（読み取り。結果確定済みのレースについて、進入コース・rank4〜6の充足）:

```sql
SELECT r.race_date,
       count(*) FILTER (WHERE rr.rank1 IS NOT NULL) AS finished,
       count(*) FILTER (WHERE rr.rank1 IS NOT NULL AND rr.actual_course_1 IS NULL AND rr.actual_course_2 IS NULL AND rr.actual_course_3 IS NULL
                          AND rr.actual_course_4 IS NULL AND rr.actual_course_5 IS NULL AND rr.actual_course_6 IS NULL) AS course_missing,
       count(*) FILTER (WHERE rr.rank1 IS NOT NULL AND rr.rank4 IS NULL) AS rank4_missing
  FROM race_results rr JOIN races r ON r.race_id = rr.race_id
 WHERE r.race_date BETWEEN (now() AT TIME ZONE 'Asia/Tokyo')::date - 5 AND (now() AT TIME ZONE 'Asia/Tokyo')::date - 1
 GROUP BY 1 ORDER BY 1;
```

**成功基準**: `course_missing` が、前日以前で0件。`rank4_missing` は、並走前（GitHub側のみ）の件数を上回らない（3着以内しか完走しない等で、構造的に残るレースがある。分母の定義は tasks.md T4b-05 の本番実測）。`last_report.problems` が空。`consecutive_failures` が0。

ロールバック: `mode = 'off'`（GitHub側は動いたまま）。

### G3. GitHub側の停止

F3の手順（`SKIP_KFILE_ON_GHA=true`）。停止後、`course_missing` が0のまま、`kfile_sync` の `last_target_date` が毎日更新されることを、7日確認する（未更新なら監視が `daily_overdue` を通知する）。ロールバックはF3。

## H. 結果のcatch-up（`result_catchup`）の確認

`result` と同じ `shadow` → `live`（F1・F2）。確認するのは次の点。

```sql
SELECT last_success_at, last_target_date, last_rows_written, last_error, last_report
  FROM scrape_job_state WHERE job = 'result_catchup';
```

- 23:50 JST の実行: 対象日の結果のスロットに、まだ `pending`・`running` があれば、`last_report.openSlots > 0`・応答が `incomplete: true`（対象日を処理済みにしない）
- 翌 00:30 JST の実行: `last_target_date` が対象日になる（以降の起動は `already_done`）
- `last_report.candidates`（再取得の対象＝expired のスロット）と `outcomes`。`unresolved` に残ったレースは、結果ページで、まだ結果が無いか（中止・順延）を確認する
- live のとき、`confirmedCancellations`（発走+90分を超えて結果の無いレースの確定）と、`hitFlags`（直近10日の的中フラグの補完。`missing` が0でなければ、`fixed` が補完した件数）
- 0件エラー（再取得の対象があるのに、1件も取得・解析できなかった）が出たら、`last_error` に「0件」と出て、監視が通知する

## I. 切り戻しの早見表

| 状況 | 操作 | 影響 |
|---|---|---|
| shadow・live の Vercel側に問題 | `UPDATE scrape_job_state SET mode = 'off' WHERE job IN ('result','result_catchup','kfile_sync')` | Vercel側が止まる。GitHub側が動いていれば、取得の空白なし |
| GitHub停止後に問題 | ①`SKIP_*_ON_GHA` を `false` → ②Vercel側を `off`（順序を守る） | 次のGitHub Actionsの実行から再開 |
| 中止・順延を誤って確定した疑い | 対象レースの結果ページを確認し、結果がある場合は `UPDATE races SET cancellation_status = NULL WHERE race_id = '<race_id>'`（承認後）。`result_catchup` の live は、確定済みのレースを再取得しない | 該当レースの結果は、手動のバックフィル（`scripts/maintenance/backfill-results-by-race-id.js`）で補う |

## J. 予測リフレッシュ案1の有効化と効果の実測（tasks.md T4b-03-4、plan.md §5）

`REFRESH_ON_VERCEL`（Vercel）と`SKIP_ODDS_REFRESH_ON_GHA`（GitHubのリポジトリ変数）は、どちらも既定off＝現行動作。組み合わせと順序の考え方は`scripts/lib/predictionRefresh.js`の冒頭。DBに関わらない部分（トグル・併走・書き込み方式・取得失敗時の挙動）は、`npm run verify:prediction-refresh`で検証済み。

### J-0. 有効化の前に、ユーザーの判断が要る点

1. **unifiedの日全体の再生成が止まる**（plan.md §5「unifiedの扱い」）。今は、再計算（削除→挿入）が`unified`の行も消し、次のGitHub Actionsの`ensureUnifiedPredictions`が日全体を約170回/日再生成している。upsert方式はunifiedを触らないため、この再生成が止まり、Disk IOは大きく減るが、unifiedのイン崩れバッジが朝の気象で固定される。許容するか、展示後のunified再生成を先に作るか、を決める。確認クエリ（有効化前の現状）:
   ```sql
   -- unified の最新の predicted_at が、発走の何分前後か（終了済みレース。負＝発走後）
   WITH st AS (SELECT race_id, ((race_date + start_time) AT TIME ZONE 'Asia/Tokyo') AS start_at FROM races WHERE race_date = '<今日>')
   SELECT count(*) AS races,
     round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (st.start_at - p.predicted_at))/60)::numeric, 1) AS p50_min_before_start
   FROM predictions p JOIN st USING (race_id)
   WHERE p.model_id = 'unified' AND p.race_id LIKE '<今日>-%' AND st.start_at < now();
   ```
   有効化後は、この中央値が大きく正（朝の値のまま）になる。
2. **`VERCEL_DEPLOY_HOOK`をVercelの環境変数（Production）に設定するか**。`mainRefresh`は、毎時の先頭5分以内に、更新があれば、Deploy Hookを叩く（BOA-361）。今は、GitHub側の再計算がこれを担っているが、案1でGitHub側の再計算がレース情報の起点のみになると、叩く機会が減る。Vercel側の環境変数が無ければ、Vercel経路は叩かない（`VERCEL_DEPLOY_HOOK 未設定`のログ）。時間ごとの再デプロイ（AIクローラー向けスナップショットの更新等）を維持するなら、設定する（値は確認せず、名前の有無のみ。plan.md U10）。

### J-1. 有効化の手順（レースの無い時間帯に行う。併走が起きない）

| 手順 | 操作 | 確認 |
|---|---|---|
| 1 | （ユーザー）このPRがマージされ、本番にデプロイ済みであることを確認する。既定offのため、この時点で動作は変わらない | 展示の関数が従来どおり動く（`api/cron/exhibition`のログに`展示データ取得`。`予測の再計算（Vercel）`は出ない） |
| 2 | （ユーザー）VercelのProductionの環境変数に`REFRESH_ON_VERCEL=true`を追加し、**再デプロイする**（環境変数の変更は、新しいデプロイにのみ反映される。plan.md U17）。F-0の2も、同時に | 再デプロイ完了 |
| 3 | 翌朝、最初の展示の取得（発走約33分前）の後、Vercelのランタイムログ（`/api/cron/exhibition`）を確認する | `🤖 予測の再計算（Vercel）: Nレース`→`predictions: M件（Nレース、upsert）`→`🏁 リフレッシュ完了`。エラー（`予測の再計算エラー`）が無い |
| 4 | 下のF-2の「再計算後の鮮度」「空のレース」のクエリで、Vercel経路が正しく書けていることを確認する | 全て期待どおり |
| 5 | （ユーザーの承認後）GitHubのリポジトリ変数`SKIP_ODDS_REFRESH_ON_GHA=true`を設定する。次のGitHub Actionsの実行から、オッズ起点の再計算が外れる（再デプロイ不要） | 実行ログに`オッズ起点の予測リフレッシュを除外`と、`predictions: …（Mレース、upsert）` |
| 6 | 土日を含む7日間、F-2で効果と鮮度を実測する | 下記 |

順序が重要: **Vercelを先にon、GitHubを後にon**（空白を作らない。逆にすると、展示の変更を起点にする再計算が、どこにも無い時間ができる）。手順2〜5の間に併走が起きても、Vercel側はupsert方式のため、予測が空になったり書き込みが衝突したりはしない（無駄な再計算が増えるだけ。GitHub側は、手順5までは削除→挿入のままのため、同じレースを同時に再計算した場合のみ、その回のGitHub側の書き込みが失敗しうる。レースの無い時間帯に切り替えれば起きない）。

### J-2. 効果と正しさの実測

**再計算の回数（主指標）**。GitHub Actionsのログと、Vercelのログから数える。
```bash
# GitHub: 1日分の scrape-scheduled の実行から、再計算の対象レース数を集計する（3件に1件など標本でよい。標本率で割り戻す）
gh run list --workflow=scrape-scheduled.yml --limit 400 --json databaseId,createdAt,conclusion
gh run view <run id> --log | grep "予測リフレッシュ対象"
```
Vercel側は、ランタイムログの`予測の再計算（Vercel）: Nレース`のNを、日ごとに合計する（Vercel MCPの`get_runtime_logs`、またはダッシュボード）。1レースあたりの再計算回数＝（GitHubの合計＋Vercelの合計）÷その日のレース数（`SELECT count(*) FROM races WHERE race_date = '<日>'`）。**基準（有効化前、2026-09-15〜19の実測）: 約5.0〜5.8回/レース/日。見込み: 約2.2〜3.2回（約45〜60%減）。**

**predictionsの書き込み量（補助指標。DB全体の累積カウンタの差分）**。
```sql
-- 有効化前後の同じ曜日（例: 日曜）の 07:00 と 23:59 JST に、それぞれ実行して差分を取る
SELECT now(), n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, n_dead_tup
FROM pg_stat_user_tables WHERE relname = 'predictions';
```
注意: 有効化後は、再計算が「削除→挿入」（`n_tup_del`＋`n_tup_ins`）から「upsert」（`n_tup_upd`）に変わり、さらにunifiedの日全体の再生成（`n_tup_upd`。約170回/日×約160行）が止まる。したがって`n_tup_ins`だけでなく、`n_tup_ins + n_tup_upd + n_tup_del`の合計と、内訳の変化で見る。**回数の減少（約55%）と、方式の変更（削除＋挿入→更新1回）と、unifiedの再生成の停止は、別々の要因**であり、合計の変化は約55%より大きくなる見込み。Disk IOの実消費は、Supabaseのダッシュボードで、同じ時間帯を比較する。

**再計算後の鮮度（正しさ）**。有効化後の終了済みレースで、予測が、展示・気象の最終書き込みより後に書かれていること（`exhibition_data.created_at`・`updated_at`は、9/19夜以降の行にある）。
```sql
WITH ex AS (
  SELECT race_id, max(coalesce(updated_at, created_at)) AS ex_last
  FROM exhibition_data WHERE race_id LIKE '<日>-%' AND created_at IS NOT NULL GROUP BY 1
), pr AS (
  SELECT race_id, min(predicted_at) AS pred_min
  FROM predictions WHERE race_id LIKE '<日>-%' AND is_shadow = false AND model_id IN ('standard','safeBet','upsetFocus') GROUP BY 1
)
SELECT count(*) AS races,
  count(*) FILTER (WHERE pr.pred_min >= ex.ex_last) AS fresh,
  count(*) FILTER (WHERE pr.pred_min <  ex.ex_last) AS stale,
  count(*) FILTER (WHERE pr.pred_min IS NULL) AS no_prediction
FROM ex LEFT JOIN pr USING (race_id);
```
期待: `stale = 0`、`no_prediction = 0`。**有効化前（2026-09-20の46レース）は、fresh 46・stale 0**（オッズの窓の再計算が、展示の後に走っていたため）。

**空のレースが残っていないこと**（完了の定義Aの充足率）:
```sql
SELECT count(*) AS races_with_entries_but_no_prediction
FROM (SELECT DISTINCT race_id FROM race_entries WHERE race_id LIKE '<日>-%') e
WHERE NOT EXISTS (SELECT 1 FROM predictions p WHERE p.race_id = e.race_id AND p.model_id = 'standard' AND p.is_shadow = false);
```
期待: 0（朝の初期化が済んだ日。発走前のレースを含む）。

**Vercelの所要時間（plan.md U14）**: `/api/cron/exhibition`の呼び出しの所要時間（Vercelのランタイムログ）から、再計算の有無で差を見る。26レース・週末のピーク（180レース）の日を含める。推定は、iad1で最大約8〜10秒/回（syd1なら約1〜2秒）。

### J-3. 切り戻し（空白を作らない順序）

1. （ユーザー）GitHubのリポジトリ変数`SKIP_ODDS_REFRESH_ON_GHA`を`false`にするか、削除する（次の実行から、オッズ起点の再計算が復活。再デプロイ不要）
2. （ユーザー）Vercelの環境変数`REFRESH_ON_VERCEL`を`false`にするか、削除して、**再デプロイする**（展示の関数が、再計算を呼ばなくなる）

どちらもコード変更は不要。GitHub側を先に戻す（Vercelが再デプロイ中に、再計算の空白ができない）。

## 結果の記録

検証したら、結果（実行したコマンド・SQLと出力）を、tasks.md T4a-10のチェックとともに、PRの説明または`orchestration.md`に記録する。U16・U17は、plan.md §13の表に結果を追記する。

## K. 特記事項（A5、race-notices）の共通ラッパへの切り替え（tasks.md T4b-11）

対応: `api/cron/race-notices.js`・`scripts/lib/raceNoticesJob.js`・レジストリの`race_notices`・`vercel.json`のcrons。DBに関わらない部分（モード・リース・DB障害を200にしない・会場の失敗の扱い・変更のある行のみ・並列度・配線）は`npm run verify:race-notices-job`で検証済み。

**A5は、既に本番で稼働している**（cron-job.orgが10分ごとに、同じエンドポイントを叩く）。共通ラッパはモードのゲートを掛けるため、**`scrape_job_state`の`race_notices`が`off`（または行なし）だと、マージ後、cron-job.orgの呼び出しも何もしなくなり、特記事項の取得が止まる**。次の順序を守る。

### K-1. マージ前（本番DBへの書き込み。ユーザーの承認後）

`live`の行を先に作る（マージ前の現行コードは、この行を読まないため、影響しない）。
```sql
INSERT INTO scrape_job_state (job, mode) VALUES ('race_notices', 'live')
ON CONFLICT (job) DO UPDATE SET mode = 'live';
```
（075の適用後。`scrape_job_state`が無ければ、共通ラッパは「075未適用」として何もせず200で終わり、同じく取得が止まる。前提: 075は適用済み）

### K-2. マージ後: 稼働の確認（cron-job.orgと並走）

マージ後、Vercel Cron（10分ごと）とcron-job.org（10分ごと）の両方が、同じエンドポイントを叩く。ジョブ単位のリースで、同時には1つだけが走り、書き込みは変更のある行のみ・重複を無視するupsertのため、二重に起動されても無害。

| 確認 | 手順 | 期待 |
|---|---|---|
| ゲート | `curl -s -H "Authorization: Bearer $CRON_SECRET" "https://www.boat-ai.jp/api/cron/race-notices"` | `success: true`・`mode: "live"`・`venuesChecked`が当日の開催会場数・`venuesFailed`が空 |
| 死活・成功の記録 | `SELECT job, mode, last_tick_at, last_success_at, last_error, consecutive_failures, last_report FROM scrape_job_state WHERE job = 'race_notices';` | `last_success_at`が10分以内、`last_error`なし、`last_report`に`digest`・`venuesChecked` |
| 集計行の書き込み削減（D9） | `SELECT check_date, count(*) FROM race_notices_health WHERE check_date = '<今日>' GROUP BY 1;` を、朝と夕方に | 会場数のまま（従来と同じ）。`last_checked_at`が朝の値のまま（変更が無い会場は、書き直さない） |
| 二重起動が無害 | Vercelのランタイムログ（`/api/cron/race-notices`）で、同じ10分の枠に2件のリクエスト（cron-job.orgとVercel Cron）があり、片方の応答が`skipped: lease_held`、または2回とも処理（`healthWritten: 0`） | データが増えない・エラーなし |
| cron-job.org側の表示 | cron-job.orgの実行履歴 | **30秒を超えた実行は、cron-job.org側だけが「失敗（タイムアウト）」と表示する**（関数は完走する。以前は、即時に202を返していた）。会場数×約8〜10秒÷6並列（13会場で約20秒、24会場で約40秒）。連続失敗でジョブが自動無効化される設定なら、並走は短期間にとどめる |

### K-3. cron-job.orgの登録内容の確認と、停止（ユーザー作業）

- 確認（plan.md・job-inventory.md U1）: race-noticesのジョブの、URL（`/api/cron/race-notices`）・間隔・稼働窓（JST 07:00〜23:59か）・Authorizationヘッダー
- Vercel Cronでの稼働（K-2）を、数日（土日を含む）確認した後、cron-job.orgの`race-notices`のジョブを停止する。停止後は、Vercel Cronのみで動く（JST 07:00〜23:50の10分ごと）。**切り戻し**: cron-job.orgのジョブを再開する（Vercel Cronと並走してよい）。または`UPDATE scrape_job_state SET mode = 'off' WHERE job = 'race_notices';`で、両方を止める（従来のコードへは、PRのrevertで戻す）

### K-4. shadow（任意）

特記事項の一覧は、公式ページが節の累積を毎回表示するため、`shadow`で数回の取得を飛ばしても、次の`live`の実行で追いつく（データは失われない）。取得・解析の一致だけを確認したい場合の手順（夜間に短時間）:
```sql
UPDATE scrape_job_state SET mode = 'shadow' WHERE job = 'race_notices';   -- 取得・解析のみ。DBへ書かない
-- 1〜2回の実行（10分ごと）を待つ
SELECT last_report FROM scrape_job_state WHERE job = 'race_notices';       -- notesParsed・venuesChecked・venuesFailed・digest
UPDATE scrape_job_state SET mode = 'live' WHERE job = 'race_notices';      -- 必ず戻す
```
`shadow`の間は、`race_special_notes`・`race_notices_health`は書かれない（取得の継続は止まる）。`digest`は、解析した通知の一覧（会場・日付・区分・本文）のハッシュで、`live`の実行の`digest`と同じ内容なら一致する。

### K-5. 継続監視（完了の定義C）

- 失敗: 共通ラッパが`scrape_job_state`の`consecutive_failures`・`last_error`に記録し、`scrape-monitor`が3回以上の連続失敗を通知する（DB障害・全会場の取得失敗）
- 構造変化: 既存の`race-notices-drift-monitor.yml`（`race_notices_health`の`had_success`・`last_reason`を日次で畳み込む）。変更のある行のみの書き込みでも、判定に必要な情報は失われない
- **未整備**: `race_notices`（continuous）の死活（`last_success_at`が古い）は、`scrape-monitor`の死活判定の対象外（対象は窓型）。Cronの未配信・関数の障害で、特記事項が止まっても、通知されない。WS4aの`scrape-monitor`の拡張として、別タスクで追加する（`last_success_at`が運用窓内で30分以上古い、など）
- `race_notices_health.last_checked_at`は、変更のある行のみ書くため、最終確認の時刻ではない。`scripts/analysis/data-health-report.js`の鮮度（`max(last_checked_at)`）は、この表では、実際より古く出る。最終確認は`scrape_job_state.last_success_at`
