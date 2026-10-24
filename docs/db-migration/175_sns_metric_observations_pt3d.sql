-- 175: sns_metric_observations の窓に pt3d（太平洋時間の投稿日から3日の暦日の和）を足す（PD02、2026-10-25 hq の依頼。Shorts の動画ごとの engagedViews/views）
-- cron sns_daily（scripts/lib/snsDailyRunner.js の collectEngaged）が、YouTube の動画ごとの engagedViews（分母 views）・views・
-- averageViewPercentage・averageViewDuration を window=pt3d で入れる。反映の遅れ（2〜3日、BOA-1006 (b)）に合わせ、3日目が D−3 より前になってから入れる。
-- 窓の終わりは PT の3日目の翌日 0:00（day_end と同じく暦日の境目で、投稿ごとに長さが違う窓）。Analytics は暦日の粒度なので、
-- 「投稿から72時間」の時間の窓へ変換しない（docs/design/sns-hub-metrics/contract.md「日次Analyticsを時間窓へ推測変換しない」）。
-- 投稿前の views は0なので、和は [posted_at, period_end) と同じで、data_through=period_end が成り立つ。
-- 変えるのは観測の表の CHECK 2つだけ（窓の値と、窓の終わりの式）。列・関数・sns_metric_jobs は変えない（pt3d は job を作らない）。
-- コードは 175 の前でも動く（窓の CHECK で拒まれたら日次の取り込みを失敗にせず report.alerts の engaged_window_unapplied で知らせる）。
-- db-apply で当てる。土台は 169（本番に適用済み、2026-10-19）。マージした日のうちに当てる（取り直しの範囲は10日で、それより前の動画は戻らない）。
--
-- 適用前の確認（読み取り）:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.sns_metric_observations'::regclass
--     AND conname IN ('sns_metric_observations_window_check', 'sns_metric_observations_period_end');
--   期待: window_check は ('48h','7d','day_end','24h')、period_end は 48h・7d・24h・day_end の4つの枝（169 のとおり、2026-10-25 本番で確認）
--   SELECT count(*) FROM public.sns_metric_observations WHERE "window" = 'pt3d';  期待: 0
--
-- 適用後の確認（読み取り）: 上の1文目で window_check に 'pt3d'、period_end に pt3d の枝があること
--
-- 戻し方（pt3d の行が1件でもあれば、新しい CHECK の検証で落ちて自分で止まる。ある行は記録なので消さない。コードを戻すだけにする）:
--   BEGIN;
--   ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_window_check;
--   ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_window_check
--     CHECK ("window" IN ('48h', '7d', 'day_end', '24h'));
--   ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_period_end;
--   ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_period_end
--     CHECK (CASE "window"
--       WHEN '48h' THEN period_end = period_start + interval '48 hours'
--       WHEN '7d' THEN period_end = period_start + interval '168 hours'
--       WHEN '24h' THEN period_end = period_start + interval '24 hours'
--       WHEN 'day_end' THEN period_end = (((period_start AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo')
--         AND period_end > period_start
--     END);
--   COMMIT;
BEGIN;

ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_window_check;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_window_check
  CHECK ("window" IN ('48h', '7d', 'day_end', '24h', 'pt3d'));

ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_period_end;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_period_end
  CHECK (CASE "window"
    WHEN '48h' THEN period_end = period_start + interval '48 hours'
    WHEN '7d' THEN period_end = period_start + interval '168 hours'
    WHEN '24h' THEN period_end = period_start + interval '24 hours'
    WHEN 'day_end' THEN period_end = (((period_start AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo')
      AND period_end > period_start
    WHEN 'pt3d' THEN period_end = ((((period_start AT TIME ZONE 'America/Los_Angeles')::date + 3)::timestamp) AT TIME ZONE 'America/Los_Angeles')
  END);

COMMIT;
