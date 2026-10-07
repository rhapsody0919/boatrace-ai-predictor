-- 既存YouTube/ブログ承認の排他と外部成功の記録。適用はオーナーのみ。
BEGIN;
ALTER TABLE public.sns_drafts
  ADD COLUMN external_operation_state text CHECK (external_operation_state IN ('reconcile', 'external_done', 'done')),
  ADD COLUMN external_operation_token uuid,
  ADD COLUMN external_operation_result jsonb;

CREATE FUNCTION public.sns_claim_external(p_id uuid, p_expected jsonb, p_token uuid, p_approver uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sns_drafts;
BEGIN
  SELECT * INTO d FROM sns_drafts WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR d.status <> 'pending_review' OR d.external_operation_state IS NOT NULL
     OR to_jsonb(d) <> p_expected OR d.platform NOT IN ('youtube', 'blog')
     OR coalesce((to_jsonb(d)->>'publish_blocked')::boolean, false)
     OR to_jsonb(d)->>'bundle_import_id' IS NOT NULL
     OR to_jsonb(d)->>'bundle_version_hash' IS NOT NULL
     OR coalesce(jsonb_array_length(to_jsonb(d)->'publication_hold_reasons'), 0) > 0 THEN
    RAISE EXCEPTION '下書きが変更されたか、送信中・要照合です';
  END IF;
  UPDATE sns_drafts SET external_operation_state = 'reconcile', external_operation_token = p_token,
    approver_id = p_approver, approved_at = now() WHERE id = p_id RETURNING * INTO d;
  RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.sns_record_external(p_id uuid, p_token uuid, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sns_drafts;
BEGIN
  UPDATE sns_drafts SET external_operation_state = 'external_done', external_operation_result = p_result
    WHERE id = p_id AND external_operation_token = p_token AND external_operation_state = 'reconcile'
    RETURNING * INTO d;
  IF d.id IS NULL THEN RAISE EXCEPTION '外部結果の記録対象が一致しません'; END IF;
  RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.sns_finish_external(p_id uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sns_drafts;
BEGIN
  UPDATE sns_drafts SET status = 'posted', external_operation_state = 'done',
    posted_at = (external_operation_result->>'posted_at')::timestamptz,
    source_data = coalesce(source_data, '{}'::jsonb) || coalesce(external_operation_result->'source_data', '{}'::jsonb)
    WHERE id = p_id AND external_operation_token = p_token AND external_operation_state = 'external_done'
    RETURNING * INTO d;
  IF d.id IS NULL THEN
    SELECT * INTO d FROM sns_drafts WHERE id = p_id AND external_operation_token = p_token AND external_operation_state = 'done';
    IF d.id IS NULL THEN RAISE EXCEPTION '外部完了の反映対象が一致しません'; END IF;
  END IF;
  RETURN to_jsonb(d);
END $$;

-- 既存の別API/生成処理からも送信中・要照合の内容や状態を上書きさせない。
CREATE FUNCTION public.sns_guard_external() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.external_operation_state IN ('reconcile', 'external_done') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '送信中・要照合の下書きは削除できません'; END IF;
    IF NEW.external_operation_state IS NULL
       OR NEW.external_operation_token IS DISTINCT FROM OLD.external_operation_token
       OR NOT (NEW.external_operation_state = OLD.external_operation_state
         OR (OLD.external_operation_state = 'reconcile' AND NEW.external_operation_state = 'external_done')
         OR (OLD.external_operation_state = 'external_done' AND NEW.external_operation_state = 'done' AND NEW.status = 'posted'))
       OR (NEW.external_operation_state <> 'done' AND
         (to_jsonb(NEW) - ARRAY['external_operation_state','external_operation_result']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['external_operation_state','external_operation_result'])) THEN
      RAISE EXCEPTION '送信中・要照合の下書きは変更できません';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sns_guard_external BEFORE UPDATE OR DELETE ON public.sns_drafts
FOR EACH ROW EXECUTE FUNCTION public.sns_guard_external();

REVOKE ALL ON FUNCTION public.sns_claim_external(uuid,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sns_record_external(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sns_finish_external(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sns_guard_external() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sns_claim_external(uuid,jsonb,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sns_record_external(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sns_finish_external(uuid,uuid) TO service_role;

CREATE FUNCTION public.sns_update_external_warning(p_id uuid, p_token uuid, p_warning text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sns_drafts;
BEGIN
  UPDATE sns_drafts SET external_operation_result = external_operation_result || jsonb_build_object('thumbnailWarning', p_warning)
    || jsonb_build_object('source_data', (external_operation_result->'source_data') ||
      CASE WHEN p_warning IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('youtube_thumbnail_error',p_warning) END)
    WHERE id = p_id AND external_operation_token = p_token AND external_operation_state = 'external_done'
    RETURNING * INTO d;
  IF d.id IS NULL THEN RAISE EXCEPTION 'サムネ結果の記録対象が一致しません'; END IF;
  RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION public.sns_update_external_warning(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sns_update_external_warning(uuid,uuid,text) TO service_role;

COMMIT;
