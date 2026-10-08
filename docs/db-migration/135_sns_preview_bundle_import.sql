-- v0専用のローカル保留取り込み。134との適用順は取り込み側で確認する。
-- 正式公開素材の契約・解除経路は別依頼。ここでは解除を提供しない。
BEGIN;

CREATE TABLE IF NOT EXISTS public.sns_bundle_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_hash TEXT NOT NULL UNIQUE CHECK (version_hash ~ '^[a-f0-9]{64}$'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'ryujin-preview/0'),
  bundle JSONB NOT NULL,
  source_manifest JSONB NOT NULL,
  qa JSONB NOT NULL,
  release_evidence JSONB NOT NULL,
  missing_files JSONB NOT NULL,
  hold_reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sns_bundle_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sns_bundle_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sns_bundle_imports TO service_role;

ALTER TABLE public.sns_drafts
  ADD COLUMN IF NOT EXISTS bundle_import_id UUID REFERENCES public.sns_bundle_imports(id),
  ADD COLUMN IF NOT EXISTS bundle_version_hash TEXT,
  ADD COLUMN IF NOT EXISTS publish_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publication_hold_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS sns_drafts_bundle_version_channel_language
  ON public.sns_drafts(bundle_version_hash, platform, language)
  WHERE bundle_version_hash IS NOT NULL;

-- topic由来のgroupはsns_topics.id、bundle由来はsns_bundle_imports.id。
-- bundle_import_idを明示して生成元を区別し、topic/targetやRoutineは作らない。
CREATE OR REPLACE FUNCTION public.guard_sns_preview_bundle_draft()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  imported public.sns_bundle_imports%ROWTYPE;
  parent public.sns_drafts%ROWTYPE;
BEGIN
  -- 修正パイプラインがparentを設定する場合も公開不可を引き継ぐ。
  IF NEW.parent_draft_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.sns_drafts WHERE id = NEW.parent_draft_id;
    IF parent.bundle_import_id IS NOT NULL THEN
      NEW.bundle_import_id := parent.bundle_import_id;
      NEW.bundle_version_hash := parent.bundle_version_hash;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.bundle_import_id IS NOT NULL THEN
    IF NEW.bundle_import_id IS DISTINCT FROM OLD.bundle_import_id OR
       NEW.bundle_version_hash IS DISTINCT FROM OLD.bundle_version_hash THEN
      RAISE EXCEPTION 'v0の素材由来は変更できません';
    END IF;
  END IF;
  IF NEW.bundle_import_id IS NOT NULL THEN
    SELECT * INTO imported FROM public.sns_bundle_imports WHERE id = NEW.bundle_import_id;
    IF NOT FOUND OR NEW.bundle_version_hash IS DISTINCT FROM imported.version_hash OR
       NEW.content_group_id IS DISTINCT FROM imported.id THEN
      RAISE EXCEPTION 'bundleの版・groupの対応が不正です';
    END IF;
    IF NOT NEW.publish_blocked OR NEW.status IN ('approved', 'ready_to_post', 'posted') THEN
      RAISE EXCEPTION 'v0素材は公開不可です';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.sns_bundle_imports WHERE id = NEW.content_group_id) THEN
    RAISE EXCEPTION 'bundle由来のgroupにはbundle_import_idが必要です';
  ELSIF NEW.bundle_version_hash IS NOT NULL THEN
    RAISE EXCEPTION 'bundle_import_idが必要です';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_sns_preview_bundle_draft() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_sns_preview_bundle_draft ON public.sns_drafts;
CREATE TRIGGER guard_sns_preview_bundle_draft BEFORE INSERT OR UPDATE ON public.sns_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sns_preview_bundle_draft();

-- 同じ版の並行取り込みを行ロックで直列化し、2チャネルを一括登録する。
-- SECURITY INVOKER: service_role以外に実行権限を与えない。
CREATE OR REPLACE FUNCTION public.import_sns_preview_bundle(
  p_version_hash TEXT, p_schema_version TEXT, p_bundle JSONB, p_qa JSONB,
  p_manifest JSONB, p_missing JSONB, p_hold_reasons JSONB, p_risk_flags JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  group_id UUID;
  channel TEXT;
  draft_id UUID;
  created BOOLEAN;
  results JSONB := '[]'::jsonb;
  video_path TEXT;
  cover_path TEXT;
BEGIN
  IF p_schema_version <> 'ryujin-preview/0' OR p_bundle->>'schema_version' IS DISTINCT FROM p_schema_version THEN
    RAISE EXCEPTION '未対応のschema_versionです';
  END IF;
  INSERT INTO public.sns_bundle_imports(version_hash, schema_version, bundle,
    source_manifest, qa, release_evidence, missing_files, hold_reasons)
  VALUES (p_version_hash, p_schema_version, p_bundle, p_manifest, p_qa,
    jsonb_build_object('release_status', NULL, 'release_notice', NULL,
      'snapshot_at', NULL, 'ui_version', NULL, 'destination_url', NULL,
      'missing_reason', 'v0では正式公開情報が未提供・確認条件が未確定'),
    p_missing, p_hold_reasons)
  ON CONFLICT (version_hash) DO NOTHING;
  SELECT id INTO group_id FROM public.sns_bundle_imports WHERE version_hash = p_version_hash FOR UPDATE;
  SELECT entry->>'storage_path' INTO video_path FROM jsonb_array_elements(p_manifest) entry WHERE entry->>'name' = 'draft.mp4';
  SELECT entry->>'storage_path' INTO cover_path FROM jsonb_array_elements(p_manifest) entry WHERE entry->>'name' = 'scene-1.png';
  FOREACH channel IN ARRAY ARRAY['x', 'youtube'] LOOP
    draft_id := NULL;
    INSERT INTO public.sns_drafts(content_group_id, bundle_import_id, bundle_version_hash,
      format, template_variant_id, language, platform, status, title, caption_text,
      video_storage_path, cover_image_path, source_data, publish_blocked, publication_hold_reasons, risk_flags)
    VALUES (group_id, group_id, p_version_hash, p_bundle->>'format', NULL, 'ja', channel,
      'pending_review', p_bundle->>'title',
      CASE WHEN channel = 'x' THEN p_bundle->>'x_text' ELSE p_bundle->>'script' END,
      video_path, cover_path,
      jsonb_build_object('bundle_origin', 'local-preview', 'schema_version', p_schema_version,
        'race_id', p_bundle->>'race_id', 'stage', p_bundle->>'stage',
        'local_template_variant_id', p_bundle->>'template_variant_id',
        'bundle', p_bundle, 'source_manifest', p_manifest, 'qa', p_qa),
      true, p_hold_reasons, COALESCE(p_risk_flags->channel, '[]'::jsonb))
    ON CONFLICT (bundle_version_hash, platform, language) WHERE bundle_version_hash IS NOT NULL DO NOTHING
    RETURNING id INTO draft_id;
    created := draft_id IS NOT NULL;
    IF NOT created THEN
      SELECT id INTO draft_id FROM public.sns_drafts WHERE bundle_version_hash = p_version_hash AND platform = channel AND language = 'ja';
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('id', draft_id, 'platform', channel,
      'result', CASE WHEN created THEN 'created' ELSE 'duplicate' END));
  END LOOP;
  RETURN jsonb_build_object('content_group_id', group_id, 'version_hash', p_version_hash,
    'drafts', results, 'publish_blocked', true, 'hold_reasons', p_hold_reasons);
END;
$$;
REVOKE ALL ON FUNCTION public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO service_role;
COMMIT;
