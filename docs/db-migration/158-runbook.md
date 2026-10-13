# 158 の適用手順（sns-pdca-loop: 通り道 A・B、/today の X 投稿、月の切り替えの自動化）

マイグレーション158（自動送信の item に種類 race・digest を足す、下書きに通り道 send_lane、UTM の campaign に today_digest、月の切り替えの自動化 `roll_sns_x_send_period`、既存の3関数の置き換え）の本番適用の手順。設計は `docs/design/sns-pdca-loop/plan.md` §4・§8。

適用しても**送信は始まらない**（153・154 と同じく、sns_send は shadow、dry_run=true のまま）。

## 置き換える関数の土台
`approve_sns_x_send`・`transition_sns_send_139`・`stop_sns_auto_item` は 153 の定義を土台にした。2026-10-13 に本番の md5 を読み取りで取得し、153・154 を PGlite に入れた結果と一致することを確認した。手順1でもう一度確かめ、違っていたら適用しない。

## 既存のデータへの影響（2026-10-13 時点）
- `sns_auto_send_items`: 0行。新しい列 `kind` は既定 'race'、`draft_id` は NULL で、新しい CHECK に合う
- `sns_drafts.send_lane`: 既存の行は NULL（今までの個別承認の下書き。通り道 B の枠の計算には入らない）
- `sns_post_tracking`: campaign の CHECK を広げるだけ

## 手順1（実行前の確認・読み取りのみ）
```sql
-- 期待値: 3行とも ok=true
SELECT p.proname, md5(pg_get_functiondef(p.oid)) = x.h AS ok
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN (VALUES ('approve_sns_x_send', 'b33a3ce36ae4dc6ad72541528d4d5141'),
             ('stop_sns_auto_item', '6256d23dafbfa477df9c4364ba67b478'),
             ('transition_sns_send_139', '9afa26357d86e2d56494b9ac17028388')) x(name, h) ON x.name = p.proname
WHERE n.nspname = 'public' ORDER BY 1;

-- 期待値: items が 0、send_lane の列が 0、roll が NULL
SELECT (SELECT count(*) FROM public.sns_auto_send_items) AS items,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'sns_drafts' AND column_name = 'send_lane') AS send_lane,
       to_regprocedure('public.roll_sns_x_send_period()') AS roll;
```

## 手順2（本体）
`docs/db-migration/158_sns_lanes_digest_period.sql` の全文を1回で実行する（BEGIN〜COMMIT）。

## 手順3（実行後の確認・読み取りのみ。Claude が行う）
```sql
-- 期待値: 4行とも ok=true
SELECT p.proname, md5(pg_get_functiondef(p.oid)) = x.h AS ok
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN (VALUES ('approve_sns_x_send', '72126a0fd13dd053827ffef57bc55232'),
             ('roll_sns_x_send_period', '7f20419b7fdc2d24b12f147bd2b21c70'),
             ('stop_sns_auto_item', '8f6be3f0fe42849e368eca9b0741c79f'),
             ('transition_sns_send_139', '92f75a55cd05b12d4bef689981cf3bdd')) x(name, h) ON x.name = p.proname
WHERE n.nspname = 'public' ORDER BY 1;

-- 期待値: anon_roll・auth_roll は false、sr_roll は true
SELECT has_function_privilege('anon', 'public.roll_sns_x_send_period()', 'EXECUTE') AS anon_roll,
       has_function_privilege('authenticated', 'public.roll_sns_x_send_period()', 'EXECUTE') AS auth_roll,
       has_function_privilege('service_role', 'public.roll_sns_x_send_period()', 'EXECUTE') AS sr_roll;
```

## 戻し方
digest の item・send_lane を入れた下書き・today_digest の UTM の行が無い間だけ使える。

```sql
BEGIN;
-- 置き換えた3関数を 153 の定義に戻す（下の「置き換える前の定義」をここで実行する）
DROP FUNCTION IF EXISTS public.roll_sns_x_send_period();
ALTER TABLE public.sns_post_tracking DROP CONSTRAINT sns_post_tracking_utm_campaign_check;
ALTER TABLE public.sns_post_tracking ADD CONSTRAINT sns_post_tracking_utm_campaign_check
  CHECK (utm_campaign IN ('sonar-preview', 'race-full'));
ALTER TABLE public.sns_drafts DROP COLUMN send_lane;
DROP INDEX public.sns_auto_send_items_digest_draft;
ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_source;
ALTER TABLE public.sns_auto_send_items ALTER COLUMN bundle_import_id SET NOT NULL;
ALTER TABLE public.sns_auto_send_items DROP COLUMN draft_id, DROP COLUMN kind;
COMMIT;
```
関数を戻してから列を落とす（158 の関数が send_lane・kind・draft_id を参照しているため）。戻した後、手順1の md5 が3行とも true になることを確かめる。

### 置き換える前の定義（153、本番と md5 一致）
```sql
CREATE OR REPLACE FUNCTION public.approve_sns_x_send(p_draft_id UUID, p_approver_id UUID,
  p_snapshot JSONB, p_scheduled_at TIMESTAMPTZ DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; h TEXT; txt TEXT; media_path TEXT;
  ac public.sns_auto_send_control; it public.sns_auto_send_items;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=p_draft_id FOR UPDATE;
  IF NOT FOUND OR d.platform NOT IN ('x','youtube') OR d.language <> 'ja' OR d.status NOT IN ('pending_review','approved')
    OR d.source_data->>'dataCardUrl' IS NOT NULL OR d.publish_blocked OR NOT public.sns_bundle_send_allowed(d) OR jsonb_array_length(d.publication_hold_reasons)>0 THEN
    RAISE EXCEPTION 'この下書きはX送信を承認できません';
  END IF;
  SELECT * INTO ac FROM public.sns_auto_send_control WHERE channel=d.platform;
  IF d.bundle_import_id IS NOT NULL THEN
    SELECT * INTO it FROM public.sns_auto_send_items WHERE bundle_import_id=d.bundle_import_id AND channel=d.platform FOR SHARE;
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
    youtube_stage=NULL, external_post_id=NULL, auto_item_id=it.id
    WHERE id=j.id RETURNING * INTO j;
  UPDATE public.sns_drafts SET status='approved',approver_id=p_approver_id,approved_at=j.approved_at,
    x_approved_hash=h,scheduled_at=j.scheduled_at WHERE id=d.id;
  RETURN to_jsonb(j);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_sns_send_139(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
  v_limit INTEGER; v_need INTEGER := 1; v_ceiling BIGINT; v_rest BIGINT := 0;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
  v_limit := CASE WHEN j.channel='youtube' THEN coalesce(c.daily_limit_youtube,c.daily_limit) ELSE coalesce(c.daily_limit_x,c.daily_limit) END;
  v_ceiling := CASE WHEN j.channel='youtube' THEN 0
    WHEN d.thread_index=0 THEN coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd)
    ELSE coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd) END;
  IF p_action IN ('claim','begin_post') AND j.channel='x' AND d.thread_index=0 AND d.bundle_import_id IS NOT NULL THEN
    SELECT count(*) INTO v_need FROM public.sns_drafts WHERE bundle_import_id=d.bundle_import_id AND platform='x' AND status<>'archived';
    v_need := greatest(v_need,1);
    v_rest := (v_need-1)*coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd);
  END IF;
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
      OR c.attempt_ceiling_microusd IS NULL OR v_ceiling IS NULL THEN RAISE EXCEPTION 'X送信は停止中・費用未確認です'; END IF;
    IF d.status<>'approved' OR d.publish_blocked OR NOT public.sns_bundle_send_allowed(d)
      OR jsonb_array_length(d.publication_hold_reasons)>0 OR d.x_approved_hash IS DISTINCT FROM j.approved_hash
      OR d.approver_id IS DISTINCT FROM j.approver_id OR d.approved_at IS DISTINCT FROM j.approved_at THEN
      RAISE EXCEPTION '再承認が必要です'; END IF;
  END IF;
  IF p_action='begin_post' AND j.state<>'sending' THEN RAISE EXCEPTION '送信開始できません'; END IF;
  IF p_action IN ('claim','begin_post') THEN
    IF v_limit IS NULL OR v_limit<1 OR c.daily_baseline_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
      RAISE EXCEPTION '日次全体上限・他経路の本数が未確認です';
    END IF;
    SELECT count(*) INTO day_count FROM public.sns_x_send_jobs jobs,
      LATERAL unnest(jobs.attempt_dates,jobs.attempt_channels) attempt(day,channel) WHERE attempt.channel=j.channel
      AND attempt.day=(now() AT TIME ZONE 'Asia/Tokyo')::date;
    IF day_count+c.daily_external_count+v_need > v_limit + (CASE WHEN p_action='begin_post' THEN 1 ELSE 0 END) THEN
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
    j.attempt_channels:=array_append(j.attempt_channels,j.channel);
    j.locked_at:=now(); j.lease_until:=now()+interval '5 minutes';
    IF c.reserved_microusd+v_ceiling+v_rest>c.budget_microusd THEN RAISE EXCEPTION '月額上限です'; END IF;
    UPDATE public.sns_x_send_control SET reserved_microusd=reserved_microusd+v_ceiling WHERE id=true;
    j.budget_period_start:=c.period_start;
    j.state:='sending'; j.attempts:=j.attempts+1;
    j.reserved_microusd:=j.reserved_microusd+v_ceiling;
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
  UPDATE public.sns_x_send_jobs SET attempt_dates=j.attempt_dates,attempt_channels=j.attempt_channels,locked_at=j.locked_at,lease_until=j.lease_until,state=j.state,attempts=j.attempts,reserved_microusd=j.reserved_microusd,
    budget_period_start=j.budget_period_start,error_code=j.error_code,external_post_id=j.external_post_id,external_post_url=j.external_post_url,
    posted_at=j.posted_at,updated_at=now() WHERE id=j.id RETURNING * INTO j;
  IF p_action='complete' THEN UPDATE public.sns_drafts SET status='posted',posted_at=j.posted_at WHERE id=d.id; END IF;
  RETURN to_jsonb(j);
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_sns_auto_item(p_item_id UUID, p_via TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_item public.sns_auto_send_items;
  v_started INTEGER;
BEGIN
  SELECT * INTO v_item FROM public.sns_auto_send_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  PERFORM 1 FROM public.sns_drafts WHERE bundle_import_id = v_item.bundle_import_id AND platform = v_item.channel
    ORDER BY id FOR UPDATE;
  SELECT * INTO v_item FROM public.sns_auto_send_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.state = 'stopped' THEN RETURN jsonb_build_object('state', 'stopped', 'already', true); END IF;
  -- 送信が始まっていた件数: 送信の job が sending・reconcile・posted、または 138 の手動の外部操作の途中・完了の下書き
  SELECT count(*) INTO v_started FROM public.sns_drafts d
    WHERE d.bundle_import_id = v_item.bundle_import_id AND d.platform = v_item.channel
      AND (d.external_operation_state IN ('reconcile', 'external_done')
        OR EXISTS (SELECT 1 FROM public.sns_x_send_jobs jj WHERE jj.draft_id = d.id AND jj.state IN ('sending', 'reconcile', 'posted')));
  IF v_item.state = 'sent' THEN RETURN jsonb_build_object('state', 'sent', 'already_started', v_started); END IF;
  UPDATE public.sns_auto_send_items
    SET state = 'stopped', stopped_at = now(), stopped_via = p_via, updated_at = now()
    WHERE id = p_item_id;
  UPDATE public.sns_drafts d
    SET publish_blocked = true, publication_hold_reasons = '["auto_stopped"]'::jsonb,
        status = CASE WHEN d.status IN ('approved', 'ready_to_post') THEN 'pending_review' ELSE d.status END
    WHERE d.bundle_import_id = v_item.bundle_import_id AND d.platform = v_item.channel
      AND d.status NOT IN ('posted', 'archived') AND d.posted_at IS NULL
      -- 138 の外部操作の途中・完了の下書きは sns_guard_external が変更を拒否するので触らない（止める操作ごと失敗させない）
      AND (d.external_operation_state IS NULL OR d.external_operation_state = 'done')
      AND NOT EXISTS (SELECT 1 FROM public.sns_x_send_jobs jj WHERE jj.draft_id = d.id AND jj.state IN ('sending', 'reconcile', 'posted'));
  RETURN jsonb_build_object('state', 'stopped', 'already_started', v_started);
END $$;
```
