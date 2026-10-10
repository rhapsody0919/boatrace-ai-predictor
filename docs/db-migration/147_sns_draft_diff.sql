-- 140が前提。版管理は既存parent_draft_id / sns_mobile_revisionを利用する。
BEGIN;
ALTER TABLE public.sns_drafts ADD COLUMN diff_current JSONB;
ALTER TABLE public.sns_drafts ADD COLUMN diff_previous JSONB;
ALTER TABLE public.sns_drafts ADD COLUMN diff_approved JSONB;
CREATE FUNCTION public.sns_diff_content(d public.sns_drafts) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_build_object('title',d.title,'caption_text',d.caption_text,'hashtags',d.hashtags,
 'source_data',coalesce(d.source_data,'{}'::jsonb)-'dataCardUrl',
 'video_storage_path',d.video_storage_path,'cover_image_path',d.cover_image_path);
$$;
CREATE FUNCTION public.guard_sns_diff_approval() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE approved_snapshot JSONB; approved_media JSONB;
BEGIN
 IF NEW.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
  -- 承認時に再照合された送信snapshotのhashだけを使う。表示時の古いhashは流用しない。
  SELECT snapshot INTO approved_snapshot FROM sns_x_send_jobs WHERE draft_id=NEW.id
   AND approved_hash=NEW.x_approved_hash AND approved_at=NEW.approved_at;
  IF approved_snapshot IS NOT NULL THEN
   SELECT coalesce(jsonb_object_agg(paths.kind,jsonb_build_object('path',paths.path,'sha256',m->>'sha256')),'{}'::jsonb)
   INTO approved_media FROM (VALUES ('video',NEW.video_storage_path),('cover',NEW.cover_image_path),
    ('dataCard',NEW.source_data->>'dataCardPath')) paths(kind,path)
   JOIN LATERAL jsonb_array_elements(approved_snapshot->'media') m ON m->>'path'=paths.path;
  END IF;
  NEW.diff_approved:=jsonb_build_object('content',sns_diff_content(NEW),'media',approved_media,
   'draft_id',NEW.id,'approved_at',NEW.approved_at);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER sns_diff_approval BEFORE UPDATE ON public.sns_drafts
FOR EACH ROW EXECUTE FUNCTION public.guard_sns_diff_approval();
CREATE FUNCTION public.read_sns_draft_diff(p_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE d public.sns_drafts; previous JSONB; approved JSONB; ancestor public.sns_drafts;
 visited UUID[]:=ARRAY[p_id]; cursor_id UUID; depth INTEGER:=0;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_id;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 previous:=d.diff_previous; approved:=d.diff_approved; cursor_id:=d.parent_draft_id;
 WHILE cursor_id IS NOT NULL LOOP
  IF cursor_id=ANY(visited) OR depth>=100 THEN RAISE EXCEPTION '版の履歴を確認できません'; END IF;
  visited:=array_append(visited,cursor_id); depth:=depth+1;
  SELECT * INTO ancestor FROM sns_drafts WHERE id=cursor_id;
  IF ancestor.id IS NULL OR ancestor.platform IS DISTINCT FROM d.platform OR ancestor.language IS DISTINCT FROM d.language
   OR ancestor.content_group_id IS DISTINCT FROM d.content_group_id THEN RAISE EXCEPTION '版の系統が一致しません'; END IF;
  IF previous IS NULL AND depth=1 THEN
   previous:=CASE WHEN ancestor.diff_current->'content'=sns_diff_content(ancestor) THEN ancestor.diff_current
    ELSE jsonb_build_object('content',sns_diff_content(ancestor),'media',NULL) END;
   previous:=previous || jsonb_build_object('origin','parent_draft_id','draft_id',ancestor.id);
  END IF;
  IF approved IS NULL THEN approved:=ancestor.diff_approved; END IF;
  cursor_id:=ancestor.parent_draft_id;
 END LOOP;
 RETURN jsonb_build_object('draft',to_jsonb(d)-'diff_current'-'diff_previous'-'diff_approved',
 'revision',sns_mobile_revision(d),'current',d.diff_current,'previous',previous,'approved',approved);
END;
$$;
CREATE FUNCTION public.save_sns_draft_diff(p_id UUID,p_revision TEXT,p_snapshot JSONB) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; previous JSONB;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL OR sns_mobile_revision(d) IS DISTINCT FROM p_revision OR p_snapshot->'content' IS DISTINCT FROM sns_diff_content(d)
  OR jsonb_typeof(p_snapshot->'media') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '表示した版が変わりました'; END IF;
 previous:=d.diff_previous;
 IF d.diff_current IS NOT NULL AND (d.diff_current->'content' IS DISTINCT FROM p_snapshot->'content'
  OR d.diff_current->'media' IS DISTINCT FROM p_snapshot->'media') THEN
  previous:=d.diff_current || jsonb_build_object('origin','last_displayed','draft_id',d.id);
 END IF;
 UPDATE sns_drafts SET diff_current=p_snapshot || jsonb_build_object('revision',p_revision,'draft_id',p_id),diff_previous=previous WHERE id=p_id;
 RETURN read_sns_draft_diff(p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.sns_diff_content(public.sns_drafts) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_sns_diff_approval() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_sns_draft_diff(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_sns_draft_diff(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sns_diff_content(public.sns_drafts) TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_sns_diff_approval() TO service_role;
GRANT EXECUTE ON FUNCTION public.read_sns_draft_diff(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_sns_draft_diff(UUID,TEXT,JSONB) TO service_role;
COMMIT;
