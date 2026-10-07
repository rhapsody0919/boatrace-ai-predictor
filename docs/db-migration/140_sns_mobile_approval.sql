-- 135/137/139が前提。適用はオーナーのみ。送信の停止設定は変更しない。
BEGIN;
CREATE FUNCTION public.sns_mobile_revision(d public.sns_drafts) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'id',d.id,'group',d.content_group_id,'platform',d.platform,'language',d.language,
 'title',d.title,'caption',d.caption_text,'hashtags',d.hashtags,
 'video',d.video_storage_path,'cover',d.cover_image_path,'source',d.source_data,
 'risk',d.risk_flags,'blocked',d.publish_blocked,'holds',d.publication_hold_reasons,
 'bundle',d.bundle_import_id,'bundle_version',d.bundle_version_hash,'status',d.status,
 'scheduled',d.scheduled_at)::text,'UTF8')),'hex');
$$;
CREATE FUNCTION public.read_sns_mobile_race(p_group_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=public AS $$
BEGIN
 -- 1group最大20件。版計算・媒体読込の前に、21件だけ見て超過を拒否する。
 IF (SELECT count(*) FROM (SELECT id FROM sns_drafts WHERE content_group_id=p_group_id
   AND platform IN ('x','youtube') AND language='ja' AND status<>'archived' LIMIT 21) bounded)>20 THEN
  RAISE EXCEPTION 'レースの下書きが取得上限を超えました';
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('draft',to_jsonb(d),'revision',sns_mobile_revision(d),
 'job', (SELECT to_jsonb(j) - 'snapshot_text' - 'snapshot' FROM sns_x_send_jobs j WHERE j.draft_id=d.id)) ORDER BY d.platform,d.id),'[]'::jsonb)
 FROM sns_drafts d WHERE d.content_group_id=p_group_id AND d.platform IN ('x','youtube') AND d.language='ja' AND d.status<>'archived');
END;
$$;
CREATE FUNCTION public.approve_sns_mobile_channel(p_draft_id UUID,p_approver_id UUID,p_revision TEXT,
 p_snapshot JSONB,p_scheduled_at TIMESTAMPTZ,p_review_seconds INTEGER) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; result JSONB;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_draft_id FOR UPDATE;
 IF d.id IS NULL OR sns_mobile_revision(d) IS DISTINCT FROM p_revision THEN
  RAISE EXCEPTION '確認した版が変わりました';
 END IF;
 IF p_review_seconds IS NULL OR p_review_seconds NOT BETWEEN 0 AND 86400 THEN RAISE EXCEPTION 'レビュー時間が不正です'; END IF;
 -- 詳細のgateはAPIでも検査。行ロック下でQAと公開状態を再検査する。
 IF d.source_data->'qa'->'pass' IS DISTINCT FROM 'true'::jsonb
 OR d.source_data->'qa'->'numeric_claims_match' IS DISTINCT FROM 'true'::jsonb
 OR d.source_data->'release_evidence'->>'status' IS DISTINCT FROM 'released'
 OR coalesce(d.source_data->'release_evidence'->>'url','')=''
 OR jsonb_array_length(coalesce(d.risk_flags,'[]'::jsonb))>0
 OR jsonb_array_length(coalesce(d.source_data->'source_manifest','[]'::jsonb))=0
 OR jsonb_array_length(coalesce(d.source_data->'bundle'->'claims','[]'::jsonb))=0
 OR (d.platform='youtube' AND coalesce(d.video_storage_path,'')='') THEN
  RAISE EXCEPTION 'QA・出典・公開証拠・動画を確認してください';
 END IF;
 result:=approve_sns_x_send(p_draft_id,p_approver_id,p_snapshot,p_scheduled_at);
 INSERT INTO sns_mobile_reviews(draft_id,approver_id,revision,review_seconds) VALUES(d.id,p_approver_id,p_revision,p_review_seconds);
 RETURN result;
END;
$$;
CREATE TABLE public.sns_mobile_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),draft_id UUID NOT NULL REFERENCES sns_drafts(id),
 approver_id UUID NOT NULL REFERENCES sns_approvers(id),revision TEXT NOT NULL,
 review_seconds INTEGER NOT NULL CHECK(review_seconds BETWEEN 0 AND 86400), reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sns_mobile_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sns_mobile_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.sns_mobile_reviews TO service_role;
REVOKE ALL ON FUNCTION public.sns_mobile_revision(public.sns_drafts),public.read_sns_mobile_race(UUID),public.approve_sns_mobile_channel(UUID,UUID,TEXT,JSONB,TIMESTAMPTZ,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sns_mobile_revision(public.sns_drafts),public.read_sns_mobile_race(UUID),public.approve_sns_mobile_channel(UUID,UUID,TEXT,JSONB,TIMESTAMPTZ,INTEGER) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_sns_x_approval() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.sns_x_send_jobs; changed BOOLEAN;
BEGIN
  IF OLD.platform NOT IN ('x','youtube') THEN RETURN NEW; END IF;
  changed := ROW(NEW.title, NEW.caption_text, NEW.hashtags, NEW.video_storage_path, NEW.cover_image_path,
    NEW.platform, NEW.language, NEW.source_data, NEW.publish_blocked, NEW.publication_hold_reasons, NEW.risk_flags)
    IS DISTINCT FROM ROW(OLD.title, OLD.caption_text, OLD.hashtags, OLD.video_storage_path, OLD.cover_image_path,
    OLD.platform, OLD.language, OLD.source_data, OLD.publish_blocked, OLD.publication_hold_reasons, OLD.risk_flags);
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE draft_id=OLD.id;
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



COMMIT;
