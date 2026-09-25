-- 099_morning_digest_vercel_cron_jobs.sql
--
-- 「本日のデータ一覧」（BOA-402）の2ジョブを Vercel Cron で動かすための scrape_job_state の行を作る。
--
-- 背景（docs/design/morning-data-digest/plan.md §2.4、ADR-0066 §改訂1）:
--   GitHub Actions の定時実行は実測で 2.5〜4.5 時間遅れるのが常態で、朝に出ることが価値の中心の
--   /today では前提が成立しなかった。加えて旧 JST 01:10 の集計は、材料である
--   race_results.actual_course_* を書く kfile_sync（07:00 JST）より6時間早く、前日ぶんを
--   取り込めていなかった。両ジョブを Vercel Cron へ移し、集計は kfile_sync の後（13:00 JST）にする。
--
-- ⚠️ 共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）は **scrape_job_state に行が無い、または
--    mode='off' のとき何もしない**。この行を入れるまで、Vercel Cron は起動しても書き込まない。
--    デプロイ後にこのマイグレーションを適用すること。
--
-- 対応するコード:
--   api/cron/racer-course-technique-stats.js  （vercel.json: `0 4 * * *` = JST 13:00 / `0 8 * * *` = 17:00）
--   api/cron/morning-digest.js                （vercel.json: `30 20`/`30 21`/`0 23` = JST 05:30/06:30/08:00）
--   scripts/lib/scrapeJobs/registry.js        （racer_course_technique_stats / morning_digest）
--
-- 適用手順（ユーザーが実行する）:
--   Supabase Dashboard > SQL Editor で以下を実行する。
--
-- 切り戻し:
--   UPDATE scrape_job_state SET mode = 'off'
--    WHERE job IN ('racer_course_technique_stats', 'morning_digest');
--   （GitHub Actions 側のワークフローは workflow_dispatch で残してあるので、手動実行で復旧できる）

BEGIN;

-- shadow で様子を見たい場合は 'live' を 'shadow' にする（集計だけ行い、書き込まない）
INSERT INTO scrape_job_state (job, mode)
VALUES
  ('racer_course_technique_stats', 'live'),
  ('morning_digest',               'live')
ON CONFLICT (job) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now();

COMMIT;

-- 適用後の確認:
--   SELECT job, mode, last_target_date, last_success_at, last_error, consecutive_failures
--     FROM scrape_job_state
--    WHERE job IN ('racer_course_technique_stats', 'morning_digest');
--
-- 翌日の確認（定時実行が成功したことを実測する。コードのマージを完了としない）:
--   * racer_course_technique_stats.last_success_at が JST 13:00 台であること
--   * morning_digest.last_target_date が当日、last_success_at が JST 05:30 台であること
--   * SELECT max(window_end) FROM racer_course_technique_stats;  -- 前日になっていること
--   * SELECT digest_date, generated_at FROM morning_digest_days ORDER BY digest_date DESC LIMIT 1;
