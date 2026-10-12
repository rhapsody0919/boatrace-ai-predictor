-- 154: X のトークンの保存、計測の取り込みジョブ、日次の値、観測と UTM の制約の調整
-- 設計: docs/design/sns-pdca-loop/plan.md §4〜§5、ADR 0093
-- 前提: 136・137・139・146・153。136 の2表は 2026-10-12 時点で0行（本番の読み取りで確認）。適用はオーナーのみ。
-- 状態: 案（/step2）。累積値の時刻の許容差（15分）はユーザーの回答待ち。
BEGIN;

-- 外部サービスの OAuth トークン（X）。値はアプリ側で AES-256-GCM で暗号化して入れる（鍵は Vercel の SNS_TOKEN_ENC_KEY）。
CREATE TABLE public.sns_oauth_tokens (
  provider TEXT PRIMARY KEY CHECK (provider IN ('x')),
  ciphertext TEXT NOT NULL,           -- base64。access token と refresh token を JSON にして暗号化
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,             -- AES-GCM の認証タグ（base64）
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  access_expires_at TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lock_until TIMESTAMPTZ,              -- refresh 中のロック（90秒）。refresh token は使い切りのため同時に更新しない
  locked_by UUID,                      -- ロックを持つ呼び出し。保存は WHERE locked_by=自分 の条件付き UPDATE
  account_id TEXT NOT NULL             -- X の自分のユーザー ID（GET /2/users/{id}/tweets 用）
);

-- 投稿ごとの 48h・168h の取り込みジョブ。
CREATE TABLE public.sns_metric_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES public.sns_drafts(id),
  "window" TEXT NOT NULL CHECK ("window" IN ('48h', '7d')),
  source TEXT NOT NULL CHECK (source IN ('youtube-data', 'x-api')),
  due_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'missing', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, "window", source)
);
CREATE INDEX sns_metric_jobs_due ON public.sns_metric_jobs (due_at) WHERE state = 'pending';

-- 送信が posted になったら取り込みジョブを2つ作る。
CREATE OR REPLACE FUNCTION public.enqueue_sns_metric_jobs() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.state = 'posted' AND (OLD.state IS DISTINCT FROM 'posted') AND NEW.posted_at IS NOT NULL THEN
    INSERT INTO public.sns_metric_jobs (draft_id, "window", source, due_at)
    SELECT NEW.draft_id, w.win, CASE WHEN NEW.channel = 'youtube' THEN 'youtube-data' ELSE 'x-api' END,
           NEW.posted_at + w.span
    FROM (VALUES ('48h', interval '48 hours'), ('7d', interval '168 hours')) AS w(win, span)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sns_metric_jobs_on_posted AFTER UPDATE OF state ON public.sns_x_send_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_sns_metric_jobs();

-- 暦日の値（YouTube Analytics の動画ごと・チャネル全体、GA4 の流入）。136 の窓（48h/168h）に入らないもの。
CREATE TABLE public.sns_channel_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day DATE NOT NULL,                   -- YouTube Analytics は太平洋時間の暦日、GA4 は JST の暦日（definition に書く）
  channel TEXT NOT NULL CHECK (channel IN ('x', 'youtube')),
  draft_id UUID REFERENCES public.sns_drafts(id),   -- 動画・投稿ごとの値なら入れる。チャネル全体なら NULL
  utm_content TEXT,
  source TEXT NOT NULL CHECK (source IN ('youtube-analytics', 'site-analytics')),
  metric_name TEXT NOT NULL CHECK (char_length(metric_name) BETWEEN 1 AND 60),
  metric_value NUMERIC CHECK (metric_value IS NULL OR metric_value >= 0),
  missing_reason TEXT,
  definition TEXT NOT NULL CHECK (char_length(definition) BETWEEN 1 AND 500),
  observed_at TIMESTAMPTZ NOT NULL,
  CHECK ((metric_value IS NULL) <> (missing_reason IS NULL))
);
-- 同じ日・同じ対象・同じ指標は1行（取り直しは値が変わったときだけ UPDATE する）。
-- PostgREST の upsert は式の索引を on_conflict に使えないので、NULL を等しく扱う一意制約にする（PG15 以降）。
ALTER TABLE public.sns_channel_daily ADD CONSTRAINT sns_channel_daily_key
  UNIQUE NULLS NOT DISTINCT (day, channel, draft_id, utm_content, source, metric_name, definition);

-- X の読み取りの費用も送信と同じ月の台帳に予約する。月の残り日数ぶんの送信の予約額を残せないときは拒否する。
CREATE OR REPLACE FUNCTION public.reserve_sns_x_read(p_microusd BIGINT, p_daily_send_microusd BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  c public.sns_x_send_control;
  v_days INTEGER;
BEGIN
  IF p_microusd <= 0 OR p_daily_send_microusd < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id = true FOR UPDATE;
  IF c.period_end IS NULL OR now() >= c.period_end THEN RETURN false; END IF;
  v_days := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (c.period_end - now())) / 86400)::INTEGER);
  IF c.budget_microusd - c.reserved_microusd - p_microusd < v_days * p_daily_send_microusd THEN RETURN false; END IF;
  UPDATE public.sns_x_send_control SET reserved_microusd = reserved_microusd + p_microusd WHERE id = true;
  RETURN true;
END $$;

-- 136 の調整（ユーザーの回答待ち）:
-- 1. 累積値は observed_at = period_end ちょうどだけ保存できる（check6）→ period_end から15分以内なら保存できるようにする。
--    累積値は取得した時点までのデータを含むので、data_through も observed_at と同じ値になる（check5 も累積値だけ緩める）。
--    制約名は本番の pg_constraint で確認済み（2026-10-12）
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_check6;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_snapshot_tolerance
  CHECK (measurement_kind <> 'snapshot' OR metric_value IS NULL
         OR observed_at BETWEEN period_end AND period_end + interval '15 minutes');
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT sns_metric_observations_check5;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_value_data_through
  CHECK (metric_value IS NULL
         OR (measurement_kind = 'period' AND data_through = period_end)
         OR (measurement_kind = 'snapshot' AND data_through = observed_at));
-- 2. UTM の表: campaign に race-full を足し、template_variant_id を任意にする
ALTER TABLE public.sns_post_tracking ALTER COLUMN template_variant_id DROP NOT NULL;
ALTER TABLE public.sns_post_tracking DROP CONSTRAINT sns_post_tracking_utm_campaign_check;
ALTER TABLE public.sns_post_tracking ADD CONSTRAINT sns_post_tracking_utm_campaign_check
  CHECK (utm_campaign IN ('sonar-preview', 'race-full'));

ALTER TABLE public.sns_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_metric_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_channel_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_oauth_tokens, public.sns_metric_jobs, public.sns_channel_daily
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sns_oauth_tokens, public.sns_metric_jobs, public.sns_channel_daily TO service_role;
REVOKE ALL ON FUNCTION public.reserve_sns_x_read(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_sns_x_read(BIGINT, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_sns_metric_jobs() FROM PUBLIC, anon, authenticated;

COMMIT;
