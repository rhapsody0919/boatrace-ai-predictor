-- 196: 処理待ちで非公開のまま残した YouTube の job を、期限の前に公開へ進める遷移（youtube_resume、BOA-1283）
-- 起きたこと: Shorts「節の機力」（job 926ef626、動画 sRLtGyhpw6M、2026-11-03 21:30 JST）は、アップロードの後の処理の確認3回（約1分）で
--   processingStatus が processing のまま youtube_retained_processing で残り、186 の後は期限（22:30）まで誰も見直さず、期限の後に非公開で閉じた。
--   YouTube 側では処理は済んでいた（2026-11-04 の読み取りで uploadStatus=processed・processingStatus=succeeded・private）。
--   同じ日の全貌の完全版3本は、どれも2回目の確認（約30秒）で succeeded になって公開された
-- 変えるもの: transition_sns_x_send（土台は 186 の本文。本番の md5(prosrc) 06bd2a81976f9d0fa9d5f337899f5e5d と一致、2026-11-04 読み取り）に
--   新しい操作 youtube_resume を足すだけ。ほかの分岐は 186 のまま。
--   youtube_resume: 要照合・private_retained で残した理由が処理待ち（youtube_retained_processing）か検査の枠（youtube_retained_budget）、
--   または ready（error_code なし。公開の段の途中で実行が切れた job）・
--   外部 ID がある・now() < expires_at・リースが切れている・試行のクォータの日が今の太平洋時間の日・videos.update をまだ呼んでいない・
--   カバーのある job は thumbnails.set を台帳に記録済み（thumbnails.set の前の検査で budget になった job をカバー無しで公開しない）・
--   同じ試行の youtube_lookup（videos.list の読み取り、クォータは sns_youtube_quota_reads に1）が10分以内にあり、
--   結果が自分の動画で非公開・ID 一致・processingStatus=succeeded のときだけ、youtube_stage を ready にし error_code を空にし、リースを5分付ける。
--   公開は今までどおり youtube_publish_begin（承認・期限・日の上限・クォータの検査）→ videos.update → videos.list → complete
--   （youtube_poll の3回の上限・general_reserved=104 の CHECK は変えない。見直しの読み取りは quota_reads に数える）
-- 検証: scripts/maintenance/verify-sns-send-runner.js（PGlite、外部接続なし）
-- 適用の順: コードとどちらが先でもよい（196 の前の DB は youtube_resume を「不正な操作です」で拒否し、コードは youtube_retain（理由 error）で見直しから外す。
--   job は非公開のまま残って期限の後に閉じる。今と同じ）
--
-- 適用前の確認（読み取り）:
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'transition_sns_x_send';  期待: 06bd2a81976f9d0fa9d5f337899f5e5d（186 の本文。下の DO も確かめる）
--
-- 適用後の確認（読み取り）:
--   SELECT prosrc LIKE '%youtube_resume%' FROM pg_proc WHERE proname = 'transition_sns_x_send';  期待: true
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--
-- 戻し方: 186_sns_youtube_close_private.sql の transition_sns_x_send の CREATE OR REPLACE と REVOKE・GRANT をそのまま実行（先頭の DO は外す）。
--   ready に戻った job は今までどおり公開の段に進むか、失敗すれば youtube_retain で非公開に残る
BEGIN;

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'transition_sns_x_send') IS DISTINCT FROM '06bd2a81976f9d0fa9d5f337899f5e5d' THEN
    RAISE EXCEPTION '196: transition_sns_x_send の本文が 186 と違う（先に差を確かめる）';
  END IF;
END $$;

-- 置き換え（186）: transition_sns_x_send。変更は youtube_resume の分岐だけ
CREATE OR REPLACE FUNCTION public.transition_sns_x_send(p_job_id UUID,p_action TEXT,p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.sns_drafts; c public.sns_x_send_control; j public.sns_x_send_jobs;
 q public.sns_youtube_quota_control; a public.sns_youtube_quota_attempts;
 r JSONB; v_day DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
 upload_total BIGINT; general_total BIGINT; day_count INTEGER; method TEXT;
 ac public.sns_auto_send_control; it public.sns_auto_send_items; v_auto BOOLEAN;
BEGIN
 SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
 SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
 SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
 SELECT * INTO ac FROM public.sns_auto_send_control WHERE channel=j.channel;
 IF j.auto_item_id IS NOT NULL THEN
   -- 止める操作（stop_sns_auto_item の FOR UPDATE）と直列にする。止めた後の外部呼び出しを許さない。
   SELECT * INTO it FROM public.sns_auto_send_items WHERE id=j.auto_item_id FOR SHARE;
 END IF;
 v_auto := ac.auto_approver_id IS NOT NULL AND j.approver_id = ac.auto_approver_id;
 IF p_action IN ('claim','check','begin_post','youtube_call','youtube_publish_begin') AND (j.auto_item_id IS NOT NULL OR v_auto)
   AND (it.id IS NULL OR it.state='stopped' OR (v_auto AND (it.state IS DISTINCT FROM 'notified' OR ac.mode IS DISTINCT FROM 'auto'))) THEN
   IF j.state IN ('queued','sending') THEN
     UPDATE public.sns_x_send_jobs SET state='held',error_code='auto_stopped',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     -- 止めた時点で sending だった job は stop_sns_auto_item が下書きを飛ばすので、ここで公開保留に戻す
     -- （148 のガードが承認を外し held の job を取り消す。理由は auto_stopped を残す）
     IF it.state='stopped' AND coalesce(d.external_operation_state,'done')='done' THEN
       UPDATE public.sns_drafts SET publish_blocked=true, publication_hold_reasons='["auto_stopped"]'::jsonb,
         status=CASE WHEN status IN ('approved','ready_to_post') THEN 'pending_review' ELSE status END
         WHERE id=d.id;
       UPDATE public.sns_x_send_jobs SET error_code='auto_stopped' WHERE id=j.id RETURNING * INTO j;
     END IF;
     RETURN to_jsonb(j);
   END IF;
   RAISE EXCEPTION 'auto_stopped';
 END IF;
 IF p_action='claim' AND ac.dry_run IS NOT FALSE THEN RAISE EXCEPTION 'dry_run'; END IF;
 IF p_action='claim' AND v_auto AND now()<it.veto_until THEN RAISE EXCEPTION 'veto_window_open'; END IF;
 IF j.channel='youtube' AND p_action='complete' AND (
   p_result->>'confirmed' IS DISTINCT FROM 'true' OR p_result->>'privacyStatus' IS DISTINCT FROM 'public'
   OR NOT (EXISTS (SELECT 1 FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts AND 'videos.list'=ANY(calls))
     OR EXISTS (SELECT 1 FROM public.sns_youtube_quota_reads WHERE job_id=j.id AND attempt=j.attempts))
 ) THEN RAISE EXCEPTION '公開結果の確認が必要です'; END IF;
 IF j.channel='youtube' AND p_action='youtube_retain' THEN
   IF j.state<>'reconcile' OR j.external_post_id IS NULL OR j.youtube_stage='update_started' THEN RAISE EXCEPTION '非公開残置を確定できません'; END IF;
   -- 186: 残した理由。試行のクォータの日が今の太平洋時間の日と違えば日付の境目（BOA-973）を優先する
   -- 理由が無い・知らない値は今までの youtube_private_retained のまま
   UPDATE public.sns_x_send_jobs SET youtube_stage='private_retained',error_code='youtube_private_retained',updated_at=now() WHERE id=j.id RETURNING * INTO j;
   IF EXISTS (SELECT 1 FROM public.sns_youtube_quota_attempts qa WHERE qa.job_id=j.id AND qa.attempt=j.attempts AND qa.quota_day IS DISTINCT FROM v_day) THEN
     UPDATE public.sns_x_send_jobs SET error_code='youtube_retained_pt_day' WHERE id=j.id RETURNING * INTO j;
   ELSIF p_result->>'reason' IN ('budget','processing','check_failed','error') THEN
     UPDATE public.sns_x_send_jobs SET error_code='youtube_retained_'||(p_result->>'reason') WHERE id=j.id RETURNING * INTO j;
   END IF;
   RETURN to_jsonb(j);
 END IF;
 -- 186: 非公開のまま残した job を、公開しないで閉じる。期限の後（公開に進む道が無い）・リース切れ（実行中の worker がいない）・
 -- 10分以内の読み取り（youtube_lookup）で自分の非公開の動画と確かめたものだけ。まだ claim していない子は held（parent_closed）
 IF j.channel='youtube' AND p_action='youtube_close_private' THEN
   IF j.state<>'reconcile' OR j.youtube_stage IS DISTINCT FROM 'private_retained' OR j.external_post_id IS NULL
     OR j.expires_at IS NULL OR now()<j.expires_at OR (j.lease_until IS NOT NULL AND now()<j.lease_until) THEN
     RAISE EXCEPTION 'youtube_close_not_allowed';
   END IF;
   IF NOT EXISTS (SELECT 1 FROM public.sns_youtube_quota_reads WHERE job_id=j.id AND attempt=j.attempts AND created_at>=now()-interval '10 minutes') THEN
     RAISE EXCEPTION 'youtube_close_lookup_missing';
   END IF;
   -- 非公開: 自分の動画で privacyStatus=private・ID 一致。削除済み: videos.list が成功して items が空（found=false。2026-10-27、
   -- 0853d7d9・0883093d の動画はオーナーが Studio で消した）。どちらでもなければ（public・unlisted・他人の動画）閉じない
   IF NOT ((p_result->>'owned' IS NOT DISTINCT FROM 'true' AND p_result->>'privacyStatus' IS NOT DISTINCT FROM 'private'
       AND p_result->>'id' IS NOT DISTINCT FROM j.external_post_id)
     OR p_result->>'found' IS NOT DISTINCT FROM 'false') THEN
     RAISE EXCEPTION 'youtube_close_not_private';
   END IF;
   UPDATE public.sns_x_send_jobs SET state='held',error_code='parent_closed',updated_at=now()
     WHERE parent_job_id=j.id AND state='queued' AND attempts=0;
   UPDATE public.sns_x_send_jobs SET state='cancelled',lease_until=NULL,updated_at=now(),
     error_code=CASE WHEN p_result->>'found' IS NOT DISTINCT FROM 'false' THEN 'youtube_closed_deleted' ELSE 'youtube_closed_private' END
     WHERE id=j.id RETURNING * INTO j;
   RETURN to_jsonb(j);
 END IF;
 -- 196: 処理待ち（または検査の枠）で非公開のまま残した job を、期限の前に公開の段へ戻す（BOA-1283）。
 -- 期限の前・リース切れ・10分以内の youtube_lookup で、自分の非公開の動画で処理が済んだ（processingStatus=succeeded）と確かめたものだけ。
 -- 段を ready に戻すだけで、公開は今までどおり youtube_publish_begin（承認・期限・枠の検査）→ videos.update の順に進む
 IF j.channel='youtube' AND p_action='youtube_resume' THEN
   -- ready（error_code なし）は、公開の段の途中で実行が切れてリースも切れた job（閉じる道は private_retained しか拾わない）
   IF j.state<>'reconcile' OR j.external_post_id IS NULL
     OR NOT ((j.youtube_stage='private_retained' AND j.error_code IN ('youtube_retained_processing','youtube_retained_budget'))
       OR (j.youtube_stage='ready' AND j.error_code IS NULL))
     OR j.expires_at IS NULL OR now()>=j.expires_at OR (j.lease_until IS NOT NULL AND now()<j.lease_until) THEN
     RAISE EXCEPTION 'youtube_resume_not_allowed';
   END IF;
   SELECT * INTO a FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts;
   -- カバーのある job は thumbnails.set を呼んだ（台帳に記録した）後だけ。thumbnails.set の前の検査で budget になった job をカバー無しで公開しない
   IF a.job_id IS NULL OR a.quota_day IS DISTINCT FROM v_day OR 'videos.update'=ANY(a.calls)
     OR (jsonb_array_length(j.snapshot->'media')=2 AND NOT 'thumbnails.set'=ANY(a.calls)) THEN RAISE EXCEPTION 'youtube_resume_not_allowed'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.sns_youtube_quota_reads WHERE job_id=j.id AND attempt=j.attempts AND created_at>=now()-interval '10 minutes') THEN
     RAISE EXCEPTION 'youtube_resume_lookup_missing';
   END IF;
   IF p_result->>'owned' IS DISTINCT FROM 'true' OR p_result->>'privacyStatus' IS DISTINCT FROM 'private'
     OR p_result->>'id' IS DISTINCT FROM j.external_post_id OR p_result->>'processingStatus' IS DISTINCT FROM 'succeeded' THEN
     RAISE EXCEPTION 'youtube_resume_not_processed';
   END IF;
   -- リースを付ける（公開の段の検査の間に別の見直しと重ねない。切れたら ready のまま次の見直しが拾う）
   UPDATE public.sns_x_send_jobs SET youtube_stage='ready',error_code=NULL,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
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
     OR d.status<>'approved' OR d.publish_blocked OR NOT public.sns_bundle_send_allowed(d)
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
   IF coalesce(c.daily_limit_youtube,c.daily_limit) IS NULL OR day_count+c.daily_external_count>coalesce(c.daily_limit_youtube,c.daily_limit) THEN RAISE EXCEPTION 'youtube_daily_limit'; END IF;
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
 -- 置き換え6: item の下書きが全部 posted になったら item を sent にする（X はスレッドの全件）。
 IF p_action='complete' AND j.auto_item_id IS NOT NULL AND r->>'state'='posted' THEN
   UPDATE public.sns_auto_send_items i SET state='sent',updated_at=now()
   WHERE i.id=j.auto_item_id AND i.state IN ('manual','notified') AND NOT EXISTS (
     SELECT 1 FROM public.sns_drafts dd LEFT JOIN public.sns_x_send_jobs jj ON jj.draft_id=dd.id
     WHERE dd.bundle_import_id=i.bundle_import_id AND dd.platform=i.channel AND dd.status<>'archived'
       AND jj.state IS DISTINCT FROM 'posted');
 END IF;
 RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) TO service_role;

COMMIT;
