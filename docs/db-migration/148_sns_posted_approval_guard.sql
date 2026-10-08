-- 142までが前提。140の承認対象（risk_flagsを含む）を維持する。適用はオーナーのみ。
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_sns_x_approval() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.sns_x_send_jobs; changed BOOLEAN;
BEGIN
  IF OLD.platform NOT IN ('x','youtube') THEN RETURN NEW; END IF;
  changed := ROW(NEW.title, NEW.caption_text, NEW.hashtags, NEW.video_storage_path, NEW.cover_image_path,
    NEW.platform, NEW.language, NEW.source_data, NEW.publish_blocked, NEW.publication_hold_reasons, NEW.risk_flags)
    IS DISTINCT FROM ROW(OLD.title, OLD.caption_text, OLD.hashtags, OLD.video_storage_path, OLD.cover_image_path,
    OLD.platform, OLD.language, OLD.source_data, OLD.publish_blocked, OLD.publication_hold_reasons, OLD.risk_flags);
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE draft_id=OLD.id;
  IF changed AND (OLD.status='posted' OR j.state='posted') THEN
    RAISE EXCEPTION '投稿済みの下書きは本文・媒体・承認対象を変更できません';
  END IF;
  IF (changed OR NEW.status IS DISTINCT FROM OLD.status) AND j.state IN ('sending','reconcile') THEN
    RAISE EXCEPTION 'X送信中・要照合の下書きは照合完了まで変更できません';
  END IF;
  IF changed THEN
    NEW.x_approved_hash := NULL;
    NEW.approver_id := NULL; NEW.approved_at := NULL;
    IF OLD.status IN ('approved','ready_to_post') THEN NEW.status := 'pending_review'; END IF;
  END IF;
  IF changed OR NEW.status NOT IN ('approved','ready_to_post') THEN
    UPDATE public.sns_x_send_jobs SET state='cancelled', error_code='approval_invalidated', updated_at=now()
      WHERE draft_id=OLD.id AND state IN ('queued','held');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_sns_x_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_sns_x_approval() TO service_role;
COMMIT;
