-- 035/042/135/137が前提。138は別の依頼4。適用・再開はオーナーのみ。
BEGIN;
ALTER TABLE public.sns_x_send_control
 ADD COLUMN timing_approved BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN schedule_minutes INTEGER NOT NULL DEFAULT 90 CHECK(schedule_minutes>0),
 ADD COLUMN expiry_minutes INTEGER NOT NULL DEFAULT 30 CHECK(expiry_minutes>0),
 ADD COLUMN max_source_age_seconds INTEGER CHECK(max_source_age_seconds>0),
 ADD COLUMN daily_limit INTEGER CHECK(daily_limit>0),
 ADD COLUMN daily_baseline_date DATE,
 ADD COLUMN daily_external_count INTEGER NOT NULL DEFAULT 0 CHECK(daily_external_count>=0);
ALTER TABLE public.sns_x_send_jobs DROP CONSTRAINT sns_x_send_jobs_state_check;
ALTER TABLE public.sns_x_send_jobs
 ADD CONSTRAINT sns_x_send_jobs_state_check CHECK(state IN ('queued','sending','reconcile','posted','failed','cancelled','held')),
 ADD COLUMN channel TEXT NOT NULL DEFAULT 'x' CHECK(channel IN ('x','youtube')),
 ADD COLUMN expires_at TIMESTAMPTZ,
 ADD COLUMN draft_revision TEXT,
 ADD COLUMN locked_at TIMESTAMPTZ,
 ADD COLUMN attempt_dates DATE[] NOT NULL DEFAULT ARRAY[]::date[],
 ADD COLUMN lease_until TIMESTAMPTZ,
 ADD COLUMN parent_job_id UUID REFERENCES public.sns_x_send_jobs(id);
ALTER TABLE public.sns_x_send_control ADD CONSTRAINT sns_queue_timing_order CHECK(schedule_minutes>expiry_minutes);
CREATE INDEX sns_send_deadline_order ON public.sns_x_send_jobs(expires_at,scheduled_at);
CREATE OR REPLACE FUNCTION public.guard_sns_x_approval() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.sns_x_send_jobs; changed BOOLEAN;
BEGIN
  IF OLD.platform NOT IN ('x','youtube') THEN RETURN NEW; END IF;
  changed := ROW(NEW.title, NEW.caption_text, NEW.hashtags, NEW.video_storage_path, NEW.cover_image_path,
    NEW.platform, NEW.language, NEW.source_data, NEW.publish_blocked, NEW.publication_hold_reasons)
    IS DISTINCT FROM ROW(OLD.title, OLD.caption_text, OLD.hashtags, OLD.video_storage_path, OLD.cover_image_path,
    OLD.platform, OLD.language, OLD.source_data, OLD.publish_blocked, OLD.publication_hold_reasons);
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


-- snapshotは認証済みサーバーが媒体実バイトから作る。ブラウザ提供hashは使わない。
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
    IF jsonb_array_length(p_snapshot->'media')<>1 OR p_snapshot->'media'->0->>'path' IS DISTINCT FROM media_path
      OR coalesce(p_snapshot->'media'->0->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR coalesce((p_snapshot->'media'->0->>'size')::bigint,0) NOT BETWEEN 1 AND 33554432 THEN
      RAISE EXCEPTION '媒体のhash・サイズが不正です';
    END IF;
  END IF;
  h := encode(sha256(convert_to(p_snapshot::text,'UTF8')),'hex');
  INSERT INTO public.sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at)
    VALUES (d.id,'queued',p_snapshot,p_snapshot::text,h,p_approver_id,now(),coalesce(p_scheduled_at,(p_snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>(SELECT schedule_minutes FROM public.sns_x_send_control WHERE id=true)),now()))
    ON CONFLICT(draft_id) DO UPDATE SET state='queued',snapshot=EXCLUDED.snapshot,snapshot_text=EXCLUDED.snapshot_text,
      approved_hash=EXCLUDED.approved_hash,approver_id=EXCLUDED.approver_id,approved_at=EXCLUDED.approved_at,
      scheduled_at=EXCLUDED.scheduled_at,error_code=NULL,updated_at=now() RETURNING * INTO j;
  UPDATE public.sns_x_send_jobs SET channel=d.platform, draft_revision=h,
    expires_at=(p_snapshot->'queue'->>'expires_at')::timestamptz,
    parent_job_id=(p_snapshot->'queue'->>'parent_job_id')::uuid, locked_at=NULL, lease_until=NULL
    WHERE id=j.id RETURNING * INTO j;
  UPDATE public.sns_drafts SET status='approved',approver_id=p_approver_id,approved_at=j.approved_at,
    x_approved_hash=h,scheduled_at=j.scheduled_at WHERE id=d.id;
  RETURN to_jsonb(j);
END;
$$;

-- draft→control→jobの順でロック。予算を一括予約し、同時workerの二重claimを防ぐ。
CREATE OR REPLACE FUNCTION public.transition_sns_x_send(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
  IF p_action IN ('claim','begin_post','check') AND j.state IN ('queued','sending') THEN
    IF j.expires_at IS NULL THEN reason:='deadline_missing';
    ELSIF now()>=j.expires_at THEN reason:='deadline_expired';
    ELSIF c.timing_approved IS NOT TRUE THEN reason:='timing_pending_owner';
    ELSIF j.expires_at IS DISTINCT FROM (j.snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>c.expiry_minutes) THEN reason:='deadline_policy_changed';
    ELSIF (j.snapshot->'queue'->>'source_observed_at')::timestamptz IS NULL OR c.max_source_age_seconds IS NULL THEN reason:='freshness_unknown';
    ELSIF (j.snapshot->'queue'->>'source_observed_at')::timestamptz>now() OR
      (j.snapshot->'queue'->>'source_observed_at')::timestamptz + make_interval(secs=>c.max_source_age_seconds)<=now() THEN reason:='source_stale';
    ELSIF j.parent_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sns_x_send_jobs p
      WHERE p.id=j.parent_job_id AND p.channel=j.channel AND p.state='posted' AND p.external_post_id IS NOT NULL) THEN reason:='parent_not_posted';
    ELSIF p_action<>'claim' AND (j.lease_until IS NULL OR now()>=j.lease_until) THEN reason:='lease_expired';
    END IF;
    IF reason IS NOT NULL THEN
      UPDATE public.sns_x_send_jobs SET state='held',error_code=reason,updated_at=now() WHERE id=j.id RETURNING * INTO j;
      RETURN to_jsonb(j);
    END IF;
  END IF;
  IF p_action IN ('claim','begin_post','check') THEN
    IF c.paused OR c.period_start IS NULL OR c.period_end IS NULL OR now()<c.period_start OR now()>=c.period_end
      OR c.attempt_ceiling_microusd IS NULL THEN RAISE EXCEPTION 'X送信は停止中・費用未確認です'; END IF;
    IF d.status<>'approved' OR d.publish_blocked OR d.bundle_import_id IS NOT NULL
      OR jsonb_array_length(d.publication_hold_reasons)>0 OR d.x_approved_hash IS DISTINCT FROM j.approved_hash
      OR d.approver_id IS DISTINCT FROM j.approver_id OR d.approved_at IS DISTINCT FROM j.approved_at THEN
      RAISE EXCEPTION '再承認が必要です'; END IF;
  END IF;
  IF p_action='begin_post' AND j.state<>'sending' THEN RAISE EXCEPTION '送信開始できません'; END IF;
  IF p_action IN ('claim','begin_post') THEN
    IF c.daily_limit IS NULL OR c.daily_limit<1 OR c.daily_baseline_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
      RAISE EXCEPTION '日次全体上限・他経路の本数が未確認です';
    END IF;
    SELECT count(*) INTO day_count FROM public.sns_x_send_jobs jobs,
      LATERAL unnest(jobs.attempt_dates) attempt(day) WHERE jobs.channel=j.channel
      AND attempt.day=(now() AT TIME ZONE 'Asia/Tokyo')::date;
    IF day_count+c.daily_external_count >= c.daily_limit + (CASE WHEN p_action='begin_post' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION '日次全体上限です';
    END IF;
    -- 日付をまたいだ枠の移動は未承認。外部POST前に保留して再承認を要求する。
    IF p_action='begin_post' AND (j.locked_at AT TIME ZONE 'Asia/Tokyo')::date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
      UPDATE public.sns_x_send_jobs SET state='held',error_code='daily_claim_date_changed',updated_at=now() WHERE id=j.id RETURNING * INTO j;
      RETURN to_jsonb(j);
    END IF;
  END IF;
  IF p_action='claim' THEN
    IF j.state<>'queued' OR j.scheduled_at>now() THEN RAISE EXCEPTION 'claimできません'; END IF;
    j.attempt_dates:=array_append(j.attempt_dates,(now() AT TIME ZONE 'Asia/Tokyo')::date);
    j.locked_at:=now(); j.lease_until:=now()+interval '5 minutes';
    IF c.reserved_microusd+c.attempt_ceiling_microusd>c.budget_microusd THEN RAISE EXCEPTION '月額上限です'; END IF;
    UPDATE public.sns_x_send_control SET reserved_microusd=reserved_microusd+attempt_ceiling_microusd WHERE id=true;
    j.budget_period_start:=c.period_start;
    j.state:='sending'; j.attempts:=j.attempts+1;
    j.reserved_microusd:=j.reserved_microusd+c.attempt_ceiling_microusd;
  ELSIF p_action='check' THEN
    IF j.state<>'sending' OR j.budget_period_start IS DISTINCT FROM c.period_start THEN RAISE EXCEPTION '送信を継続できません'; END IF;
  ELSIF p_action='begin_post' THEN
    IF j.state<>'sending' OR j.budget_period_start IS DISTINCT FROM c.period_start THEN RAISE EXCEPTION '送信開始できません'; END IF;
    -- このコミットの後に外部POSTを実行。結果不明はこのまま停止する。
    j.state:='reconcile'; j.error_code:='post_outcome_unknown';
  ELSIF p_action='hold' THEN
    IF j.state NOT IN ('queued','sending') THEN RAISE EXCEPTION '保留対象ではありません'; END IF;
    j.state:='held'; j.error_code:=CASE WHEN p_result->>'reason' ~ '^[a-z_]{1,64}$' THEN p_result->>'reason' ELSE 'preflight_failed' END;
  ELSIF p_action='fail' THEN
    IF j.state<>'sending' THEN RAISE EXCEPTION '要照合を失敗へ戻せません'; END IF;
    j.state:='failed'; j.error_code:='pre_post_failed';
  ELSIF p_action='cancel' THEN
    IF j.state<>'queued' THEN RAISE EXCEPTION '待機中のjobだけ取消できます'; END IF;
    j.state:='cancelled'; j.error_code:='owner_cancelled';
  ELSIF p_action='recover' THEN
    IF j.state<>'sending' THEN RAISE EXCEPTION '回復対象ではありません'; END IF;
    j.state:='reconcile'; j.error_code:='worker_interrupted';
  ELSIF p_action='complete' THEN
    IF j.state<>'reconcile' OR (j.external_post_id IS NOT NULL AND j.external_post_id IS DISTINCT FROM p_result->>'id') OR (j.channel='x' AND coalesce(p_result->>'id','') !~ '^[0-9]{1,19}$') OR (j.channel='youtube' AND coalesce(p_result->>'id','') !~ '^[A-Za-z0-9_-]{11}$')
      OR p_result->>'posted_at' IS NULL THEN RAISE EXCEPTION '照合結果が不正です'; END IF;
    j.state:='posted'; j.error_code:=NULL; j.external_post_id:=p_result->>'id';
    j.external_post_url:=CASE WHEN j.channel='x' THEN 'https://x.com/i/status/' ELSE 'https://www.youtube.com/watch?v=' END || j.external_post_id;
    j.posted_at:=(p_result->>'posted_at')::timestamptz;
  ELSE RAISE EXCEPTION '不正な操作です'; END IF;
  UPDATE public.sns_x_send_jobs SET attempt_dates=j.attempt_dates,locked_at=j.locked_at,lease_until=j.lease_until,state=j.state,attempts=j.attempts,reserved_microusd=j.reserved_microusd,
    budget_period_start=j.budget_period_start,error_code=j.error_code,external_post_id=j.external_post_id,external_post_url=j.external_post_url,
    posted_at=j.posted_at,updated_at=now() WHERE id=j.id RETURNING * INTO j;
  IF p_action='complete' THEN UPDATE public.sns_drafts SET status='posted',posted_at=j.posted_at WHERE id=d.id; END IF;
  RETURN to_jsonb(j);
END;
$$;
-- 将来のworker起動時に明示的に実行する。要照合は失効でも解除しない。
CREATE FUNCTION public.sweep_sns_deadline_queue() RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 UPDATE public.sns_x_send_jobs SET state='held',error_code='deadline_expired',updated_at=now()
 WHERE state='queued' AND expires_at<=now();
 UPDATE public.sns_x_send_jobs SET state='reconcile',error_code='worker_interrupted',updated_at=now()
 WHERE state='sending' AND lease_until<=now();
END;
$$;
REVOKE ALL ON FUNCTION public.sweep_sns_deadline_queue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_sns_deadline_queue() TO service_role;
COMMIT;
