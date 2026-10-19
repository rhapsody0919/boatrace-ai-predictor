-- 167: 全貌動画（format=full_picture）の数字の測り時を「当日の全レース終了後（JST 23:00）」と「投稿の24時間後」にする
-- 2026-10-19 オーナー決定（hq 経由）: 過去のレースの全貌にはユーザーは基本的に興味を持たないので、48h・7d で測っても意味がない。
-- 全貌以外（ブログなど残り続ける投稿・/today）は今までどおり 48h・7d。
-- 設計: docs/design/sns-pdca-loop/plan.md §5、docs/design/sns-hub-metrics/contract.md。前提: 136・154（本番に適用済み）。適用はオーナーのみ。
-- 番号は hq が予約（2026-10-19。164 から付け直し）。手順・確認の SELECT は 167-runbook.md。
-- 制約名は本番の pg_constraint で確認済み（2026-10-19、読み取り）:
--   sns_metric_jobs_window_check、sns_metric_observations_window_check、sns_metric_observations_check2（period_end = period_start + 48h/168h）
-- 本番の sns_metric_jobs は2行（/today の 48h・7d、pending）、sns_metric_observations は0行（2026-10-19）。どちらも新しい CHECK に違反しない。
BEGIN;

-- 1. 窓の名前に day_end（投稿日の JST 23:00 まで）と 24h を足す
ALTER TABLE public.sns_metric_jobs DROP CONSTRAINT sns_metric_jobs_window_check;
ALTER TABLE public.sns_metric_jobs ADD CONSTRAINT sns_metric_jobs_window_check
  CHECK ("window" IN ('48h', '7d', 'day_end', '24h'));
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_window_check;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_window_check
  CHECK ("window" IN ('48h', '7d', 'day_end', '24h'));

-- 2. 窓の終わりの時刻。day_end は投稿日（JST）の 23:00 で、投稿より後でなければならない
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_check2;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_period_end
  CHECK (CASE "window"
    WHEN '48h' THEN period_end = period_start + interval '48 hours'
    WHEN '7d' THEN period_end = period_start + interval '168 hours'
    WHEN '24h' THEN period_end = period_start + interval '24 hours'
    WHEN 'day_end' THEN period_end = (((period_start AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo')
      AND period_end > period_start
  END);

-- 3. posted で作る取り込みの job を、下書きの format で分ける（154 の置き換え）。
--    全貌: day_end（投稿日の JST 23:00。23:00 を過ぎてから投稿されたものは作らない）と 24h。それ以外: 48h と 7d
CREATE OR REPLACE FUNCTION public.enqueue_sns_metric_jobs() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_format TEXT;
  v_day_end TIMESTAMPTZ;
BEGIN
  IF NEW.state = 'posted' AND (OLD.state IS DISTINCT FROM 'posted') AND NEW.posted_at IS NOT NULL THEN
    SELECT format INTO v_format FROM public.sns_drafts WHERE id = NEW.draft_id;
    IF v_format = 'full_picture' THEN
      v_day_end := ((NEW.posted_at AT TIME ZONE 'Asia/Tokyo')::date + time '23:00') AT TIME ZONE 'Asia/Tokyo';
      INSERT INTO public.sns_metric_jobs (draft_id, "window", source, due_at)
      SELECT NEW.draft_id, w.win, CASE WHEN NEW.channel = 'youtube' THEN 'youtube-data' ELSE 'x-api' END, w.due
      FROM (VALUES ('day_end', v_day_end), ('24h', NEW.posted_at + interval '24 hours')) AS w(win, due)
      WHERE w.win <> 'day_end' OR v_day_end > NEW.posted_at
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.sns_metric_jobs (draft_id, "window", source, due_at)
      SELECT NEW.draft_id, w.win, CASE WHEN NEW.channel = 'youtube' THEN 'youtube-data' ELSE 'x-api' END,
             NEW.posted_at + w.span
      FROM (VALUES ('48h', interval '48 hours'), ('7d', interval '168 hours')) AS w(win, span)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_sns_metric_jobs() FROM PUBLIC, anon, authenticated;

COMMIT;
