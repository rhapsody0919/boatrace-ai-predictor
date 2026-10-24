-- 175: sns_metric_observations の窓に 72h を足す（PD02、2026-10-25 hq の依頼。Shorts の動画ごとの engagedViews/views）
-- cron sns_daily（scripts/lib/snsDailyRunner.js の collectEngaged）が、YouTube の動画ごとの engagedViews・views を
-- window=72h・denominator_name=views で入れる。反映の遅れ（2〜3日、BOA-1006 (b)）に合わせ、投稿日から3日目が D−3 以前になってから入れる。
-- 変えるのは観測の表の CHECK 2つだけ（窓の値と、窓の終わりの式）。列・関数・sns_metric_jobs は変えない（72h は job を作らない）。
-- コードは 175 の前でも動く（CHECK で拒まれたら日次の取り込みを失敗にせず report.alerts の engaged_window_unapplied で知らせる）。
-- db-apply で当てる。土台は 169（本番に適用済み、2026-10-19）。
--
-- 適用前の確認（読み取り）:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.sns_metric_observations'::regclass
--     AND conname IN ('sns_metric_observations_window_check', 'sns_metric_observations_period_end');
--   期待: window_check は ('48h','7d','day_end','24h')、period_end は 48h・7d・24h・day_end の4つの枝（169 のとおり）
--   SELECT count(*) FROM public.sns_metric_observations WHERE "window" = '72h';  期待: 0
--
-- 適用後の確認（読み取り）: 上の1文目で window_check に '72h'、period_end に 72h の枝があること
--
-- 戻し方（72h の行が無いときだけ。ある行は記録なので消さない）:
--   SELECT count(*) FROM public.sns_metric_observations WHERE "window" = '72h';  期待: 0。1件以上なら戻さない（コードを戻すだけ）
--   169 の2つの ALTER（DROP → ADD）をそのまま当て直す
BEGIN;

ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_window_check;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_window_check
  CHECK ("window" IN ('48h', '7d', 'day_end', '24h', '72h'));

ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_period_end;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_period_end
  CHECK (CASE "window"
    WHEN '48h' THEN period_end = period_start + interval '48 hours'
    WHEN '7d' THEN period_end = period_start + interval '168 hours'
    WHEN '24h' THEN period_end = period_start + interval '24 hours'
    WHEN '72h' THEN period_end = period_start + interval '72 hours'
    WHEN 'day_end' THEN period_end = (((period_start AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo')
      AND period_end > period_start
  END);

COMMIT;
