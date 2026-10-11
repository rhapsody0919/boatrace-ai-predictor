-- 依頼2: 旧sns_draft_metricsには観測窓を推測付与しない。適用はオーナーのみ。
BEGIN;
CREATE TABLE sns_metric_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES sns_drafts(id),
  "window" TEXT NOT NULL CHECK ("window" IN ('48h', '7d')),
  external_post_id TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  data_through TIMESTAMPTZ,
  source TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC CHECK (metric_value >= 0 AND metric_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')),
  missing_reason TEXT,
  definition TEXT NOT NULL CHECK (length(trim(definition)) BETWEEN 1 AND 500),
  denominator_name TEXT,
  denominator_value NUMERIC CHECK (denominator_value >= 0 AND denominator_value::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')),
  CHECK (denominator_value IS NULL OR denominator_name IS NOT NULL),
  measurement_kind TEXT NOT NULL CHECK (measurement_kind IN ('period', 'snapshot')),
  duration_seconds NUMERIC CHECK (duration_seconds > 0),
  curve JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(curve) = 'array'),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, "window", metric_name, source, definition, measurement_kind, revision),
  CHECK ((metric_value IS NULL AND length(trim(missing_reason)) > 0 AND missing_reason IS NOT NULL)
      OR (metric_value IS NOT NULL AND missing_reason IS NULL)),
  CHECK (period_end = period_start + CASE "window" WHEN '48h' THEN INTERVAL '48 hours' ELSE INTERVAL '168 hours' END),
  CHECK (observed_at >= period_end),
  CHECK (data_through IS NULL OR data_through BETWEEN period_start AND observed_at),
  CHECK (metric_value IS NULL OR (data_through IS NOT NULL AND data_through = period_end)),
  CHECK (measurement_kind <> 'snapshot' OR metric_value IS NULL OR observed_at = period_end)
);
CREATE INDEX sns_metric_observations_window_idx ON sns_metric_observations("window", metric_name, draft_id);
ALTER TABLE sns_metric_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sns_metric_observations FROM anon, authenticated;
GRANT SELECT, INSERT ON sns_metric_observations TO service_role;

-- 同じ投稿の追記を行ロックで直列化。revisionをクライアントから受け取らない。
CREATE FUNCTION append_sns_metric_observation(p_draft_id UUID, p_observation JSONB)
RETURNS sns_metric_observations LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_draft sns_drafts;
  v_row sns_metric_observations;
  v_revision INTEGER;
BEGIN
  SELECT * INTO v_draft FROM sns_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR v_draft.status <> 'posted' OR v_draft.posted_at IS NULL THEN
    RAISE EXCEPTION 'posted draft required';
  END IF;
  IF (p_observation->>'period_start')::TIMESTAMPTZ <> v_draft.posted_at THEN
    RAISE EXCEPTION 'period_start must match posted_at';
  END IF;
  SELECT COALESCE(MAX(revision), 0) + 1 INTO v_revision FROM sns_metric_observations
  WHERE draft_id = p_draft_id AND "window" = p_observation->>'window'
    AND metric_name = p_observation->>'metric_name' AND source = p_observation->>'source'
    AND definition = p_observation->>'definition' AND measurement_kind = p_observation->>'measurement_kind';
  INSERT INTO sns_metric_observations(draft_id, "window", external_post_id, observed_at, period_start, period_end, data_through, source, metric_name, metric_value, missing_reason, definition, measurement_kind, denominator_name, denominator_value, duration_seconds, curve, revision)
  VALUES (p_draft_id, p_observation->>'window', p_observation->>'external_post_id',
    (p_observation->>'observed_at')::TIMESTAMPTZ, (p_observation->>'period_start')::TIMESTAMPTZ,
    (p_observation->>'period_end')::TIMESTAMPTZ, (p_observation->>'data_through')::TIMESTAMPTZ,
    p_observation->>'source', p_observation->>'metric_name', (p_observation->>'metric_value')::NUMERIC,
    p_observation->>'missing_reason', p_observation->>'definition', p_observation->>'measurement_kind',
    p_observation->>'denominator_name', (p_observation->>'denominator_value')::NUMERIC,
    (p_observation->>'duration_seconds')::NUMERIC, COALESCE(p_observation->'curve', '[]'::JSONB), v_revision)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION append_sns_metric_observation(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION append_sns_metric_observation(UUID, JSONB) TO service_role;
-- 公開確認の方式が決まるまで登録・投稿への自動適用経路は追加しない。
CREATE TABLE sns_post_tracking (
  draft_id UUID PRIMARY KEY REFERENCES sns_drafts(id),
  template_variant_id UUID NOT NULL REFERENCES sns_template_variants(id),
  race_url TEXT NOT NULL,
  tracking_url TEXT NOT NULL,
  utm_source TEXT NOT NULL DEFAULT 'x' CHECK (utm_source = 'x'),
  utm_medium TEXT NOT NULL DEFAULT 'social' CHECK (utm_medium = 'social'),
  utm_campaign TEXT NOT NULL DEFAULT 'sonar-preview' CHECK (utm_campaign = 'sonar-preview'),
  utm_content TEXT NOT NULL,
  release_evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sns_post_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sns_post_tracking FROM anon, authenticated;
GRANT SELECT, INSERT ON sns_post_tracking TO service_role;
COMMIT;
