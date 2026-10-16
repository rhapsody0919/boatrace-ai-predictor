-- 160: /today の X 投稿に画像を最大4枚付ける（sns-pdca-loop tasks 19b、2026-10-16 ユーザー決定）
-- 画像は対象レースの龍神ソナーの図。下書きの source_data.image_paths（1〜4枚、先頭は cover_image_path）を、承認の媒体の照合に使う。
-- 設計: docs/design/sns-pdca-loop/plan.md §8。番号は hq が予約（2026-10-16）。適用はオーナーのみ。手順は 160-runbook.md。
-- 置き換える関数（approve_sns_x_send）の土台は 158 の定義（2026-10-16 に本番の md5(pg_get_functiondef) が 72126a0f… で 158 と一致することを確認）。
-- 変えるのは X の媒体の照合だけ。image_paths の無い下書き（今までの X・YouTube）は今までどおり。
-- 承認の後に image_paths が変わったら、148 のトリガー（source_data の変化）が承認を外す。個別承認の版（140 sns_mobile_revision）も source_data を含む
-- 検証: scripts/maintenance/verify-sns-today-plan.js（PGlite、外部接続なし）
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_sns_x_send(p_draft_id UUID, p_approver_id UUID,
  p_snapshot JSONB, p_scheduled_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; h TEXT; txt TEXT; media_path TEXT;
  ac public.sns_auto_send_control; it public.sns_auto_send_items; imgs JSONB; i INTEGER;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=p_draft_id FOR UPDATE;
  IF NOT FOUND OR d.platform NOT IN ('x','youtube') OR d.language <> 'ja' OR d.status NOT IN ('pending_review','approved')
    OR d.source_data->>'dataCardUrl' IS NOT NULL OR d.publish_blocked OR NOT public.sns_bundle_send_allowed(d) OR jsonb_array_length(d.publication_hold_reasons)>0 THEN
    RAISE EXCEPTION 'この下書きはX送信を承認できません';
  END IF;
  SELECT * INTO ac FROM public.sns_auto_send_control WHERE channel=d.platform;
  -- 素材のレース（race）は bundle とチャネルで、/today（digest）は下書きの ID で item を引く（158）
  IF d.bundle_import_id IS NOT NULL THEN
    SELECT * INTO it FROM public.sns_auto_send_items WHERE bundle_import_id=d.bundle_import_id AND channel=d.platform FOR SHARE;
  ELSE
    SELECT * INTO it FROM public.sns_auto_send_items WHERE draft_id=d.id FOR SHARE;
  END IF;
  IF ac.auto_approver_id IS NOT NULL AND p_approver_id = ac.auto_approver_id THEN
    IF ac.mode IS DISTINCT FROM 'auto' OR it.id IS NULL OR it.state IS DISTINCT FROM 'notified' THEN
      RAISE EXCEPTION '自動送信の条件（自動モード・事前通知済み）を満たしていません';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.sns_approvers WHERE id=p_approver_id AND display_name='本人') THEN
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
  -- X の画像の複数枚（160）: source_data.image_paths（1〜4枚、先頭は cover_image_path）があれば、媒体はその順にそろった画像だけ
  IF d.platform='x' AND d.source_data ? 'image_paths' THEN
    imgs := d.source_data->'image_paths';
    IF jsonb_typeof(imgs) IS DISTINCT FROM 'array' OR jsonb_array_length(imgs) NOT BETWEEN 1 AND 4
      OR d.video_storage_path IS NOT NULL OR imgs->>0 IS DISTINCT FROM d.cover_image_path
      OR jsonb_array_length(p_snapshot->'media') <> jsonb_array_length(imgs) THEN
      RAISE EXCEPTION '画像の数・並びが不正です';
    END IF;
    FOR i IN 0 .. jsonb_array_length(imgs) - 1 LOOP
      IF jsonb_typeof(imgs->i) IS DISTINCT FROM 'string' OR p_snapshot->'media'->i->>'path' IS DISTINCT FROM imgs->>i
        OR coalesce(p_snapshot->'media'->i->>'type','') NOT IN ('image/png','image/jpeg')
        OR coalesce(p_snapshot->'media'->i->>'sha256','') !~ '^[a-f0-9]{64}$'
        OR coalesce((p_snapshot->'media'->i->>'size')::bigint,0) NOT BETWEEN 1 AND 5000000 THEN
        RAISE EXCEPTION '媒体のhash・サイズが不正です';
      END IF;
    END LOOP;
  ELSIF media_path IS NULL THEN
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
    youtube_stage=NULL, external_post_id=NULL, auto_item_id=it.id
    WHERE id=j.id RETURNING * INTO j;
  UPDATE public.sns_drafts SET status='approved',approver_id=p_approver_id,approved_at=j.approved_at,
    x_approved_hash=h,scheduled_at=j.scheduled_at WHERE id=d.id;
  RETURN to_jsonb(j);
END;
$$;


REVOKE ALL ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) TO service_role;

COMMIT;
