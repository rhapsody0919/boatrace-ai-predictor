-- 135が前提。136（観測）には依存しない。適用はオーナーのみ。
BEGIN;
ALTER TABLE public.sns_drafts ADD COLUMN IF NOT EXISTS x_approved_hash TEXT;
CREATE TABLE public.sns_x_send_control (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  paused BOOLEAN NOT NULL DEFAULT true,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  budget_microusd BIGINT NOT NULL DEFAULT 10000000 CHECK (budget_microusd BETWEEN 1 AND 10000000),
  reserved_microusd BIGINT NOT NULL DEFAULT 0 CHECK (reserved_microusd >= 0),
  -- 全upload・最大poll・投稿・照合分まで含む上限。未確認ならNULLで停止。
  attempt_ceiling_microusd BIGINT CHECK (attempt_ceiling_microusd > 0),
  CHECK (period_end > period_start)
);
INSERT INTO public.sns_x_send_control(id) VALUES (true);
CREATE TABLE public.sns_x_send_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL UNIQUE REFERENCES public.sns_drafts(id),
  state TEXT NOT NULL CHECK (state IN ('queued','sending','reconcile','posted','failed','cancelled')),
  snapshot JSONB NOT NULL,
  snapshot_text TEXT NOT NULL,
  approved_hash TEXT NOT NULL,
  approver_id UUID NOT NULL REFERENCES public.sns_approvers(id),
  approved_at TIMESTAMPTZ NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reserved_microusd BIGINT NOT NULL DEFAULT 0,
  budget_period_start TIMESTAMPTZ,
  error_code TEXT,
  external_post_id TEXT UNIQUE,
  external_post_url TEXT,
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sns_x_send_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_x_send_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_x_send_control, public.sns_x_send_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sns_x_send_control, public.sns_x_send_jobs TO service_role;

-- 全編集経路に適用。送信中/要照合は手動投稿記録・アーカイブも止める。
CREATE FUNCTION public.guard_sns_x_approval() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.sns_x_send_jobs; changed BOOLEAN;
BEGIN
  IF OLD.platform <> 'x' THEN RETURN NEW; END IF;
  changed := ROW(NEW.caption_text, NEW.hashtags, NEW.video_storage_path, NEW.cover_image_path,
    NEW.platform, NEW.language, NEW.source_data, NEW.publish_blocked, NEW.publication_hold_reasons)
    IS DISTINCT FROM ROW(OLD.caption_text, OLD.hashtags, OLD.video_storage_path, OLD.cover_image_path,
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
      WHERE draft_id=OLD.id AND state='queued';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_sns_x_approval BEFORE UPDATE ON public.sns_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sns_x_approval();

-- snapshotは認証済みサーバーが媒体実バイトから作る。ブラウザ提供hashは使わない。
CREATE FUNCTION public.approve_sns_x_send(p_draft_id UUID, p_approver_id UUID,
  p_snapshot JSONB, p_scheduled_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; h TEXT; txt TEXT; media_path TEXT;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=p_draft_id FOR UPDATE;
  IF NOT FOUND OR d.platform <> 'x' OR d.language <> 'ja' OR d.status NOT IN ('pending_review','approved')
    OR d.source_data->>'dataCardUrl' IS NOT NULL OR d.publish_blocked OR d.bundle_import_id IS NOT NULL OR jsonb_array_length(d.publication_hold_reasons)>0 THEN
    RAISE EXCEPTION 'この下書きはX送信を承認できません';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sns_approvers WHERE id=p_approver_id AND display_name='本人') THEN
    RAISE EXCEPTION '本人の個別承認が必要です';
  END IF;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE draft_id=d.id FOR UPDATE;
  IF j.state IN ('sending','reconcile','posted') THEN RAISE EXCEPTION '送信中・要照合・送信済みです'; END IF;
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
    VALUES (d.id,'queued',p_snapshot,p_snapshot::text,h,p_approver_id,now(),coalesce(p_scheduled_at,now()))
    ON CONFLICT(draft_id) DO UPDATE SET state='queued',snapshot=EXCLUDED.snapshot,snapshot_text=EXCLUDED.snapshot_text,
      approved_hash=EXCLUDED.approved_hash,approver_id=EXCLUDED.approver_id,approved_at=EXCLUDED.approved_at,
      scheduled_at=EXCLUDED.scheduled_at,error_code=NULL,updated_at=now() RETURNING * INTO j;
  UPDATE public.sns_drafts SET status='approved',approver_id=p_approver_id,approved_at=j.approved_at,
    x_approved_hash=h,scheduled_at=j.scheduled_at WHERE id=d.id;
  RETURN to_jsonb(j);
END;
$$;

-- draft→control→jobの順でロック。予算を一括予約し、同時workerの二重claimを防ぐ。
CREATE FUNCTION public.transition_sns_x_send(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
  IF p_action IN ('claim','begin_post','check') THEN
    IF c.paused OR c.period_start IS NULL OR c.period_end IS NULL OR now()<c.period_start OR now()>=c.period_end
      OR c.attempt_ceiling_microusd IS NULL THEN RAISE EXCEPTION 'X送信は停止中・費用未確認です'; END IF;
    IF d.status<>'approved' OR d.publish_blocked OR d.bundle_import_id IS NOT NULL
      OR jsonb_array_length(d.publication_hold_reasons)>0 OR d.x_approved_hash IS DISTINCT FROM j.approved_hash
      OR d.approver_id IS DISTINCT FROM j.approver_id OR d.approved_at IS DISTINCT FROM j.approved_at THEN
      RAISE EXCEPTION '再承認が必要です'; END IF;
  END IF;
  IF p_action='claim' THEN
    IF j.state<>'queued' OR j.scheduled_at>now() THEN RAISE EXCEPTION 'claimできません'; END IF;
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
    IF j.state<>'reconcile' OR coalesce(p_result->>'id','') !~ '^[0-9]{1,19}$'
      OR p_result->>'posted_at' IS NULL THEN RAISE EXCEPTION '照合結果が不正です'; END IF;
    j.state:='posted'; j.error_code:=NULL; j.external_post_id:=p_result->>'id';
    j.external_post_url:='https://x.com/i/status/' || j.external_post_id;
    j.posted_at:=(p_result->>'posted_at')::timestamptz;
  ELSE RAISE EXCEPTION '不正な操作です'; END IF;
  UPDATE public.sns_x_send_jobs SET state=j.state,attempts=j.attempts,reserved_microusd=j.reserved_microusd,
    budget_period_start=j.budget_period_start,error_code=j.error_code,external_post_id=j.external_post_id,external_post_url=j.external_post_url,
    posted_at=j.posted_at,updated_at=now() WHERE id=j.id RETURNING * INTO j;
  IF p_action='complete' THEN UPDATE public.sns_drafts SET status='posted',posted_at=j.posted_at WHERE id=d.id; END IF;
  RETURN to_jsonb(j);
END;
$$;
-- 1関数1文で書く（verify-migration-rls.js は1文につき先頭の関数名だけを読むため）
REVOKE ALL ON FUNCTION public.guard_sns_x_approval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) TO service_role;
COMMIT;
