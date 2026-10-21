-- PR-A'（#1722 のマージの後）: db-apply の定期の突き合わせの起動（Vercel Cron、job='db_apply_dispatch'）を shadow → live にする
-- 設計: docs/design/db-apply-automation-finish/plan.md §2・§5「PR-A'」。番号つきのマイグレーションにはしない（§5 の表）。
-- 当てる場所: Supabase の SQL Editor（オーナー）。上から順に。各手順の「期待値」と違えば、そこで止めてオーケストレーターに知らせる。
--
-- ============================================================ 手順0: 本番のデプロイが終わったかを確かめる（SQL ではない）
-- 次のどちらかで確かめる。
--   (a) 端末で: curl -s -o /dev/null -w '%{http_code}\n' https://www.boat-ai.jp/api/cron/db-apply-dispatch
--       期待値: 401（関数があり、CRON_SECRET の無い呼び出しを断っている）。404 ならまだデプロイされていない
--       （比べる相手: 既にある /api/cron/in-caution-dispatch は 401、無いパスは 404）
--   (b) GitHub の master のコミット 4d50f6fd6（#1722）の「Vercel」の状態が success
-- 401 になる前に手順1〜2を当ててもよい（INSERT ... ON CONFLICT はラッパが行を作る前でも後でも効く）。ただし手順3の確認は
-- デプロイの後の毎時17分（UTC・JST とも）の起動を待つ。

-- ============================================================ 手順1: 適用前の確認（読み取りだけ）
SELECT job, mode, last_tick_at, last_success_at, consecutive_failures, last_error, last_report
FROM scrape_job_state
WHERE job = 'db_apply_dispatch';
-- 期待値: 0行（デプロイ後の最初の17分より前）か、1行で mode = 'off'・consecutive_failures = 0
--        （デプロイ後の最初の起動で、共通ラッパが off の行を作る。off の間は何もしない）

-- ============================================================ 手順2: shadow にする（書き込み）
INSERT INTO scrape_job_state (job, mode) VALUES ('db_apply_dispatch', 'shadow')
ON CONFLICT (job) DO UPDATE SET mode = excluded.mode;
-- 期待値: 成功（SQL Editor では「Success. No rows returned」）。行が無くても有っても効く

-- ============================================================ 手順3: 適用後の確認（読み取りだけ）
-- 3-1 すぐに
SELECT job, mode FROM scrape_job_state WHERE job = 'db_apply_dispatch';
-- 期待値: 1行で mode = 'shadow'

-- 3-2 次の毎時17分の起動の後（数分待つ）
SELECT job, mode, last_tick_at, last_success_at, consecutive_failures, last_error, last_report
FROM scrape_job_state
WHERE job = 'db_apply_dispatch';
-- 期待値: last_success_at が直近の17分台・consecutive_failures = 0・last_error が NULL・
--        last_report が {"target":"db_apply_reconcile","workflow":"db-apply.yml","dispatched":false,"wouldDispatch":true}
--        （shadow は起動せず、起動するはずだったことだけを残す）。Actions の「DB Apply (production)」に、
--        17分の workflow_dispatch の run は増えない（47分の schedule の run は来れば増える。それは今までと同じ）

-- ============================================================ 手順4: 1日 shadow で見た後に live にする（書き込み）
-- 前提: 手順3-2 の期待値が、1日（24回の17分）続けて満たされている（consecutive_failures が 0 のまま）
INSERT INTO scrape_job_state (job, mode) VALUES ('db_apply_dispatch', 'live')
ON CONFLICT (job) DO UPDATE SET mode = excluded.mode;
-- 期待値: 成功（「Success. No rows returned」）

-- ============================================================ 手順5: live の後の確認
-- 5-1 次の毎時17分の起動の後
SELECT job, mode, last_success_at, consecutive_failures, last_error, last_report
FROM scrape_job_state
WHERE job = 'db_apply_dispatch';
-- 期待値: mode = 'live'・consecutive_failures = 0・last_report に "dispatched": true と "liveSince"（この起動の時刻）、
--        "watch": {"checked": false, "reason": "live の最初の起動から3時間以内"}。
--        Actions の「DB Apply (production)」に、17分台の workflow_dispatch の run が1本増え、その reconcile の job が success
--        （inspect・apply は skipped。今は試運転 DB_APPLY_DRY_RUN=true なので、どこにも当てない）
-- 5-2 live にしてから3時間を過ぎた後の17分の起動の後
--        同じ SELECT で last_report の "watch" が {"checked": true, "found": true, ...}・consecutive_failures = 0
--        found が無く consecutive_failures が 1 以上で last_error に「reconcile の job が success で終わった run が無い」なら、
--        run が skipped（repo の変数 REVIEWER_BOT_USER_ID）か queued のままかを Actions で見る（Slack にも出る）

-- ============================================================ 戻し方（いつでも。書き込み）
-- off にすると Vercel Cron の起動は何もしなくなり、予備の schedule（毎時47分）だけに戻る（PR-A の前と同じ動き）。
-- monitor の job は off でも失敗の回数が残る間は scrape-monitor が知らせ続けるので、回数も 0 に戻す。
-- UPDATE scrape_job_state SET mode = 'off', consecutive_failures = 0, last_error = NULL WHERE job = 'db_apply_dispatch';
-- 期待値: 成功。戻した後の確認は手順3-1 と同じ SELECT で mode = 'off'
-- 急ぎで Vercel の Cron 自体を外すなら、vercel.json の /api/cron/db-apply-dispatch の行を消す PR（plan §6）
