-- 139最新(F01-R)・140・141の累積上。適用・有効化はオーナーのみ。
BEGIN;
ALTER TABLE public.sns_x_send_jobs ADD COLUMN youtube_stage TEXT CHECK(youtube_stage IN ('uploaded','ready','publishing','update_started','private_retained'));
CREATE TABLE public.sns_youtube_quota_control (
 id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),
 verified BOOLEAN NOT NULL DEFAULT false,
 baseline_day DATE,
 upload_limit INTEGER CHECK(upload_limit>0),
 general_limit INTEGER CHECK(general_limit>0),
 external_uploads INTEGER NOT NULL DEFAULT 0 CHECK(external_uploads>=0),
 external_general INTEGER NOT NULL DEFAULT 0 CHECK(external_general>=0)
);
INSERT INTO public.sns_youtube_quota_control(id) VALUES(true);
-- 予約は消費の保守的上界。失敗・取消・再承認でも返金しない。
CREATE TABLE public.sns_youtube_quota_attempts (
 job_id UUID NOT NULL REFERENCES public.sns_x_send_jobs(id),
 attempt INTEGER NOT NULL CHECK(attempt>0),
 quota_day DATE NOT NULL,
 upload_reserved INTEGER NOT NULL DEFAULT 1 CHECK(upload_reserved=1),
 general_reserved INTEGER NOT NULL DEFAULT 104 CHECK(general_reserved=104),
 processing_polls INTEGER NOT NULL DEFAULT 0 CHECK(processing_polls BETWEEN 0 AND 3),
 calls TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
 upload_calls_started INTEGER NOT NULL DEFAULT 0 CHECK(upload_calls_started BETWEEN 0 AND 1),
 general_units_started INTEGER NOT NULL DEFAULT 0 CHECK(general_units_started BETWEEN 0 AND 104),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,attempt)
);
CREATE INDEX sns_youtube_quota_day ON public.sns_youtube_quota_attempts(quota_day);
CREATE TABLE public.sns_youtube_quota_reads (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id UUID NOT NULL REFERENCES public.sns_x_send_jobs(id),
 attempt INTEGER NOT NULL CHECK(attempt>0),
 quota_day DATE NOT NULL,
 method TEXT NOT NULL DEFAULT 'videos.list' CHECK(method='videos.list'),
 units INTEGER NOT NULL DEFAULT 1 CHECK(units=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sns_youtube_quota_read_day ON public.sns_youtube_quota_reads(quota_day);
ALTER TABLE public.sns_youtube_quota_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_youtube_quota_reads FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sns_youtube_quota_reads TO service_role;
ALTER TABLE public.sns_youtube_quota_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_youtube_quota_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_youtube_quota_control,public.sns_youtube_quota_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sns_youtube_quota_control,public.sns_youtube_quota_attempts TO service_role;
CREATE OR REPLACE FUNCTION public.approve_sns_x_send(p_draft_id UUID, p_approver_id UUID,
  p_snapshot JSONB, p_scheduled_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; h TEXT; txt TEXT; media_path TEXT;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=p_draft_id FOR UPDATE;
  IF NOT FOUND OR d.platform NOT IN ('x','youtube') OR d.language <> 'ja' OR d.status NOT IN ('pending_review','approved')
    OR d.source_data->>'dataCardUrl' IS NOT NULL OR d.publish_blocked OR d.bundle_import_id IS NOT NULL OR jsonb_array_length(d.publication_hold_reasons)>0 THEN
    RAISE EXCEPTION 'この下書きはX送信を承認できません';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sns_approvers WHERE id=p_approver_id AND display_name='本人') THEN
    RAISE EXCEPTION '本人の個別承認が必要です';
  END IF;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE draft_id=d.id FOR UPDATE;
  IF j.state IN ('sending','reconcile','posted') THEN RAISE EXCEPTION '送信中・要照合・送信済みです'; END IF;
  IF p_snapshot->'queue' IS DISTINCT FROM d.source_data->'deadline_queue' THEN
    RAISE EXCEPTION '締切・根拠の版が変わりました';
  END IF;
  IF d.platform='youtube' AND (coalesce(trim(d.title),'')='' OR p_snapshot->>'youtube_title' IS DISTINCT FROM d.title OR d.video_storage_path IS NULL) THEN RAISE EXCEPTION '動画タイトル・媒体の再確認が必要です'; END IF;
  txt := concat_ws(E'\n\n', nullif(d.caption_text,''),
    (SELECT string_agg(tag,' ') FROM unnest(d.hashtags) tag WHERE tag IS NOT NULL AND tag<>''));
  media_path := coalesce(nullif(d.video_storage_path,''),nullif(d.cover_image_path,''));
  IF p_snapshot->>'text' IS DISTINCT FROM txt OR
    p_snapshot->'source' IS DISTINCT FROM jsonb_build_object('caption_text',d.caption_text,'hashtags',d.hashtags,
      'video_storage_path',d.video_storage_path,'cover_image_path',d.cover_image_path,'language',d.language) OR
    jsonb_typeof(p_snapshot->'media') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '承認中に本文・媒体が変わりました';
  END IF;
  IF media_path IS NULL THEN
    IF jsonb_array_length(p_snapshot->'media')<>0 OR length(trim(txt))=0 THEN RAISE EXCEPTION '内容が空です'; END IF;
  ELSE
    IF jsonb_array_length(p_snapshot->'media')<>(CASE WHEN d.platform='youtube' AND d.cover_image_path IS NOT NULL THEN 2 ELSE 1 END) OR p_snapshot->'media'->0->>'path' IS DISTINCT FROM media_path
      OR coalesce(p_snapshot->'media'->0->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR coalesce((p_snapshot->'media'->0->>'size')::bigint,0) NOT BETWEEN 1 AND
        (CASE WHEN d.platform='youtube' THEN 524288000 ELSE 33554432 END) THEN
      RAISE EXCEPTION '媒体のhash・サイズが不正です';
    END IF;
  END IF;
  IF d.platform='youtube' AND (
    p_snapshot->'media'->0->>'type' IS DISTINCT FROM 'video/mp4' OR
    (d.cover_image_path IS NOT NULL AND (
      p_snapshot->'media'->1->>'path' IS DISTINCT FROM d.cover_image_path OR
      coalesce(p_snapshot->'media'->1->>'type','') NOT IN ('image/jpeg','image/png') OR
      coalesce(p_snapshot->'media'->1->>'sha256','') !~ '^[a-f0-9]{64}$' OR
      coalesce((p_snapshot->'media'->1->>'size')::bigint,0) NOT BETWEEN 1 AND 33554432))
  ) THEN RAISE EXCEPTION '動画・カバーの再確認が必要です'; END IF;
  h := encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  INSERT INTO public.sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at)
    VALUES (d.id,'queued',p_snapshot,p_snapshot::text,h,p_approver_id,now(),coalesce(p_scheduled_at,(p_snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>(SELECT schedule_minutes FROM public.sns_x_send_control WHERE id=true)),now()))
    ON CONFLICT(draft_id) DO UPDATE SET state='queued',snapshot=EXCLUDED.snapshot,snapshot_text=EXCLUDED.snapshot_text,
      approved_hash=EXCLUDED.approved_hash,approver_id=EXCLUDED.approver_id,approved_at=EXCLUDED.approved_at,
      scheduled_at=EXCLUDED.scheduled_at,error_code=NULL,updated_at=now() RETURNING * INTO j;
  UPDATE public.sns_x_send_jobs SET channel=d.platform, draft_revision=h,
    expires_at=(p_snapshot->'queue'->>'expires_at')::timestamptz,
    parent_job_id=(p_snapshot->'queue'->>'parent_job_id')::uuid, locked_at=NULL, lease_until=NULL,
    youtube_stage=NULL, external_post_id=NULL
    WHERE id=j.id RETURNING * INTO j;
  UPDATE public.sns_drafts SET status='approved',approver_id=p_approver_id,approved_at=j.approved_at,
    x_approved_hash=h,scheduled_at=j.scheduled_at WHERE id=d.id;
  RETURN to_jsonb(j);
END;
$$;


-- 最新139をそのまま再利用。試行時の媒体・JST日付・期限・leaseを変更しない。
ALTER FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) RENAME TO transition_sns_send_139;
REVOKE ALL ON FUNCTION public.transition_sns_send_139(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.transition_sns_x_send(p_job_id UUID,p_action TEXT,p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.sns_drafts; c public.sns_x_send_control; j public.sns_x_send_jobs;
 q public.sns_youtube_quota_control; a public.sns_youtube_quota_attempts;
 r JSONB; v_day DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
 upload_total BIGINT; general_total BIGINT; day_count INTEGER; method TEXT;
BEGIN
 SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
 SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
 SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
 IF j.channel='youtube' AND p_action='complete' AND (
   p_result->>'confirmed' IS DISTINCT FROM 'true' OR p_result->>'privacyStatus' IS DISTINCT FROM 'public'
   OR NOT (EXISTS (SELECT 1 FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts AND 'videos.list'=ANY(calls))
     OR EXISTS (SELECT 1 FROM public.sns_youtube_quota_reads WHERE job_id=j.id AND attempt=j.attempts))
 ) THEN RAISE EXCEPTION '公開結果の確認が必要です'; END IF;
 IF j.channel='youtube' AND p_action='youtube_retain' THEN
   IF j.state<>'reconcile' OR j.external_post_id IS NULL OR j.youtube_stage='update_started' THEN RAISE EXCEPTION '非公開残置を確定できません'; END IF;
   UPDATE public.sns_x_send_jobs SET youtube_stage='private_retained',error_code='youtube_private_retained',updated_at=now() WHERE id=j.id RETURNING * INTO j;
   RETURN to_jsonb(j);
 END IF;
 IF j.channel='youtube' AND p_action IN ('youtube_poll','youtube_ready') THEN
   IF j.state<>'reconcile' OR j.external_post_id IS NULL OR j.youtube_stage NOT IN ('uploaded','ready') OR j.youtube_stage IS NULL THEN RAISE EXCEPTION '処理確認対象ではありません'; END IF;
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   SELECT * INTO a FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts FOR UPDATE;
   IF p_action='youtube_ready' THEN
     IF a.processing_polls<1 THEN RAISE EXCEPTION '処理確認未記録です'; END IF;
     UPDATE public.sns_x_send_jobs SET youtube_stage='ready',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     RETURN to_jsonb(j);
   END IF;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR a.quota_day IS DISTINCT FROM v_day OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(general_reserved),0) INTO general_total FROM public.sns_youtube_quota_attempts WHERE quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF general_total+q.external_general>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   IF a.processing_polls>=3 THEN RAISE EXCEPTION 'youtube_poll_limit'; END IF;
   UPDATE public.sns_youtube_quota_attempts SET processing_polls=processing_polls+1,general_units_started=general_units_started+1 WHERE job_id=j.id AND attempt=j.attempts;
   RETURN to_jsonb(j);
 END IF;
 IF j.channel='youtube' AND p_action='youtube_lookup' THEN
   IF j.state<>'reconcile' THEN RAISE EXCEPTION '要照合ではありません'; END IF;
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(general_reserved),0) INTO general_total FROM public.sns_youtube_quota_attempts WHERE quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF general_total+q.external_general+1>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   INSERT INTO public.sns_youtube_quota_reads(job_id,attempt,quota_day) VALUES(j.id,j.attempts,v_day);
   RETURN to_jsonb(j);
 END IF;
 IF j.channel='youtube' AND p_action IN ('youtube_call','youtube_uploaded','youtube_publish_begin') THEN
   IF j.state<>'reconcile' THEN RAISE EXCEPTION '要照合ではありません'; END IF;
   IF p_action='youtube_uploaded' THEN
     IF j.youtube_stage IS NOT NULL THEN RAISE EXCEPTION '動画IDは保存済みです'; END IF;
     IF NOT EXISTS (SELECT 1 FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts AND 'videos.insert'=ANY(calls)) THEN RAISE EXCEPTION 'upload開始未記録です'; END IF;
     IF coalesce(p_result->>'id','') !~ '^[A-Za-z0-9_-]{11}$' OR
       (j.external_post_id IS NOT NULL AND j.external_post_id IS DISTINCT FROM p_result->>'id') THEN RAISE EXCEPTION '動画IDが不正です'; END IF;
     UPDATE public.sns_x_send_jobs SET external_post_id=p_result->>'id',youtube_stage='uploaded',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     RETURN to_jsonb(j);
   END IF;
   -- 外部呼出し後はheldへ戻さず要照合のまま停止。
   IF c.paused OR c.timing_approved IS NOT TRUE OR c.period_start IS NULL OR c.period_end IS NULL
     OR now()<c.period_start OR now()>=c.period_end OR j.budget_period_start IS DISTINCT FROM c.period_start OR c.attempt_ceiling_microusd IS NULL
     OR d.status<>'approved' OR d.publish_blocked OR d.bundle_import_id IS NOT NULL
     OR jsonb_array_length(d.publication_hold_reasons)>0 OR d.x_approved_hash IS DISTINCT FROM j.approved_hash
     OR d.approver_id IS DISTINCT FROM j.approver_id OR d.approved_at IS DISTINCT FROM j.approved_at
     OR j.expires_at IS NULL OR now()>=j.expires_at OR (p_action<>'youtube_publish_begin' AND (j.lease_until IS NULL OR now()>=j.lease_until))
     OR j.expires_at IS DISTINCT FROM (j.snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>c.expiry_minutes)
     OR c.max_source_age_seconds IS NULL OR (j.snapshot->'queue'->>'source_observed_at')::timestamptz IS NULL
     OR (j.snapshot->'queue'->>'source_observed_at')::timestamptz>now()
     OR (j.snapshot->'queue'->>'source_observed_at')::timestamptz + make_interval(secs=>c.max_source_age_seconds)<=now()
     OR c.daily_baseline_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date
     OR (j.locked_at AT TIME ZONE 'Asia/Tokyo')::date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date
   THEN RAISE EXCEPTION 'youtube_call_guard'; END IF;
   SELECT count(*) INTO day_count FROM public.sns_x_send_jobs jobs,
     LATERAL unnest(jobs.attempt_dates,jobs.attempt_channels) attempt(day,channel)
     WHERE attempt.channel='youtube' AND attempt.day=(now() AT TIME ZONE 'Asia/Tokyo')::date;
   IF c.daily_limit IS NULL OR day_count+c.daily_external_count>c.daily_limit THEN RAISE EXCEPTION 'youtube_daily_limit'; END IF;
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   SELECT * INTO a FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts FOR UPDATE;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR a.quota_day IS DISTINCT FROM v_day
     OR a.job_id IS NULL OR q.upload_limit IS NULL OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(upload_reserved),0),coalesce(sum(general_reserved),0) INTO upload_total,general_total
     FROM public.sns_youtube_quota_attempts WHERE sns_youtube_quota_attempts.quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF upload_total+q.external_uploads>q.upload_limit OR general_total+q.external_general>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   IF p_action='youtube_publish_begin' THEN
     IF j.youtube_stage IS DISTINCT FROM 'ready' OR 'videos.update'=ANY(a.calls) THEN RAISE EXCEPTION '公開段階を開始できません'; END IF;
     UPDATE public.sns_x_send_jobs SET youtube_stage='publishing',locked_at=now(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     RETURN to_jsonb(j);
   END IF;
   method:=p_result->>'method';
   IF method IS NULL OR method NOT IN ('videos.insert','thumbnails.set','videos.update','videos.list') OR method=ANY(a.calls)
     OR (method='videos.insert' AND cardinality(a.calls)<>0)
     OR (method<>'videos.insert' AND (NOT 'videos.insert'=ANY(a.calls) OR j.external_post_id IS NULL))
     OR (method='thumbnails.set' AND (jsonb_array_length(j.snapshot->'media')<>2 OR j.youtube_stage IS DISTINCT FROM 'uploaded'))
     OR (method='videos.update' AND j.youtube_stage IS DISTINCT FROM 'publishing')
     OR (method='videos.list' AND j.youtube_stage IS DISTINCT FROM 'update_started')
   THEN RAISE EXCEPTION 'youtube_call_not_planned'; END IF;
   UPDATE public.sns_youtube_quota_attempts SET calls=array_append(calls,method),
     upload_calls_started=upload_calls_started+CASE WHEN method='videos.insert' THEN 1 ELSE 0 END,
     general_units_started=general_units_started+CASE WHEN method='videos.list' THEN 1 WHEN method IN ('thumbnails.set','videos.update') THEN 50 ELSE 0 END WHERE job_id=j.id AND attempt=j.attempts;
   IF method='videos.update' THEN UPDATE public.sns_x_send_jobs SET youtube_stage='update_started',updated_at=now() WHERE id=j.id RETURNING * INTO j; END IF;
   RETURN to_jsonb(j);
 END IF;
 r:=public.transition_sns_send_139(p_job_id,p_action,p_result);
 IF j.channel='youtube' AND p_action='claim' AND r->>'state'='sending' THEN
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR q.upload_limit IS NULL OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(upload_reserved),0),coalesce(sum(general_reserved),0) INTO upload_total,general_total
     FROM public.sns_youtube_quota_attempts WHERE sns_youtube_quota_attempts.quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF upload_total+q.external_uploads+1>q.upload_limit OR general_total+q.external_general+104>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   INSERT INTO public.sns_youtube_quota_attempts(job_id,attempt,quota_day) VALUES(j.id,(r->>'attempts')::integer,v_day);
 END IF;
 RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) TO service_role;
COMMIT;

REVOKE ALL ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) TO service_role;
