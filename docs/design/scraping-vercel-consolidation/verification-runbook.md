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

## F. 予測リフレッシュ案1の有効化と効果の実測（tasks.md T4b-03-4、plan.md §5）

`REFRESH_ON_VERCEL`（Vercel）と`SKIP_ODDS_REFRESH_ON_GHA`（GitHubのリポジトリ変数）は、どちらも既定off＝現行動作。組み合わせと順序の考え方は`scripts/lib/predictionRefresh.js`の冒頭。DBに関わらない部分（トグル・併走・書き込み方式・取得失敗時の挙動）は、`npm run verify:prediction-refresh`で検証済み。

### F-0. 有効化の前に、ユーザーの判断が要る点

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

### F-1. 有効化の手順（レースの無い時間帯に行う。併走が起きない）

| 手順 | 操作 | 確認 |
|---|---|---|
| 1 | （ユーザー）このPRがマージされ、本番にデプロイ済みであることを確認する。既定offのため、この時点で動作は変わらない | 展示の関数が従来どおり動く（`api/cron/exhibition`のログに`展示データ取得`。`予測の再計算（Vercel）`は出ない） |
| 2 | （ユーザー）VercelのProductionの環境変数に`REFRESH_ON_VERCEL=true`を追加し、**再デプロイする**（環境変数の変更は、新しいデプロイにのみ反映される。plan.md U17）。F-0の2も、同時に | 再デプロイ完了 |
| 3 | 翌朝、最初の展示の取得（発走約33分前）の後、Vercelのランタイムログ（`/api/cron/exhibition`）を確認する | `🤖 予測の再計算（Vercel）: Nレース`→`predictions: M件（Nレース、upsert）`→`🏁 リフレッシュ完了`。エラー（`予測の再計算エラー`）が無い |
| 4 | 下のF-2の「再計算後の鮮度」「空のレース」のクエリで、Vercel経路が正しく書けていることを確認する | 全て期待どおり |
| 5 | （ユーザーの承認後）GitHubのリポジトリ変数`SKIP_ODDS_REFRESH_ON_GHA=true`を設定する。次のGitHub Actionsの実行から、オッズ起点の再計算が外れる（再デプロイ不要） | 実行ログに`オッズ起点の予測リフレッシュを除外`と、`predictions: …（Mレース、upsert）` |
| 6 | 土日を含む7日間、F-2で効果と鮮度を実測する | 下記 |

順序が重要: **Vercelを先にon、GitHubを後にon**（空白を作らない。逆にすると、展示の変更を起点にする再計算が、どこにも無い時間ができる）。手順2〜5の間に併走が起きても、Vercel側はupsert方式のため、予測が空になったり書き込みが衝突したりはしない（無駄な再計算が増えるだけ。GitHub側は、手順5までは削除→挿入のままのため、同じレースを同時に再計算した場合のみ、その回のGitHub側の書き込みが失敗しうる。レースの無い時間帯に切り替えれば起きない）。

### F-2. 効果と正しさの実測

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

### F-3. 切り戻し（空白を作らない順序）

1. （ユーザー）GitHubのリポジトリ変数`SKIP_ODDS_REFRESH_ON_GHA`を`false`にするか、削除する（次の実行から、オッズ起点の再計算が復活。再デプロイ不要）
2. （ユーザー）Vercelの環境変数`REFRESH_ON_VERCEL`を`false`にするか、削除して、**再デプロイする**（展示の関数が、再計算を呼ばなくなる）

どちらもコード変更は不要。GitHub側を先に戻す（Vercelが再デプロイ中に、再計算の空白ができない）。

## 結果の記録

検証したら、結果（実行したコマンド・SQLと出力）を、tasks.md T4a-10のチェックとともに、PRの説明または`orchestration.md`に記録する。U16・U17は、plan.md §13の表に結果を追記する。
