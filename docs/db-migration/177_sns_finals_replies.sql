-- 177: 優勝戦の思考投稿（finals_image、176）の本投稿へのリプ2つ（投票のリプ・展示後のリプ）を自動送信の item にし、
-- リプの子の枠を親の claim で先に取る（hq FT02、オーナー 2026-10-26: daily_limit_x=8＝全貌4・/today 1・優勝戦3）。
-- push は scripts/sns/push-finals-image.js（本投稿の bundle に poll・poll_text、展示後のリプは format=finals_reply の別の bundle）。
-- 子は本投稿の job を deadline_queue.parent_job_id に持つ（/today の reply・全貌の Shorts と同じ。runner は親が posted の子だけを選ぶ）。
-- 子の item も kind='finals_image'（期限は締切の5分前・許可 finals_image_enabled を3本に共通で見る。176 のまま効く）で、variant だけを分ける。
-- 変えるもの:
--   1. sns_auto_send_items の variant に finals_poll（投票のリプ）・finals_reply（展示後のリプ）。どちらも kind=finals_image・X だけ。
--      一意の索引 (race_id, channel, variant) は変えない（種類ごとに1レース1件の生きた item）
--   2. transition_sns_send_139（土台は 176）: 通り道 B でない X の claim・begin_post で、リプの子（素材のスレッドでない、
--      まだ claim していない子）の枠を v_need に足す。親は自分の子の分も空きが無ければ claim できない（親だけ送って子が止まる穴を塞ぐ。
--      /today の reply にも効く）。他の親の claim 済みの子の枠も取っておく。YouTube（全貌の Shorts）は変えない
--   3. approve_sns_x_send（土台は 160）: 投票は下書きの source_data.x_poll を createXSnapshot が snapshot.poll に写す（承認の hash に入る）。
--      承認の関数が snapshot.poll と x_poll の一致、投票と媒体が同居しないことを照合する（本文・媒体と同じく。system-architect の P2）
-- 検証: scripts/maintenance/verify-sns-finals-image.js（PGlite、外部接続なし）
-- 適用の順: コード（push-finals-image.js・snsXSend.js・xApiAdapter.js・snsClaimCheck.js）を先にデプロイしてから当てる。
--   当てる前は variant の CHECK が子の item を拒むので、push は本投稿の行を作った後に落ち、本投稿も投票のリプも送らない側に倒れる
--   （許可 finals_image_enabled が off の間は push が何も書かない）。db-apply は master の HEAD の SQL を当てる
--
-- 適用前の確認（読み取り）:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('sns_auto_send_items_variant_check','sns_auto_send_items_variant_scope');
--   期待: 2行（variant は main・shorts・finals、finals は kind=finals_image・x）
--   SELECT proname, md5(prosrc) FROM pg_proc WHERE proname IN ('transition_sns_send_139','approve_sns_x_send') ORDER BY 1;
--   期待: approve_sns_x_send 88959a394d532b76a5cde1253372f510（160 の本文）・transition_sns_send_139 5ecba0fb8901801f6332bf1ec41941ca（176 の本文）
--   SELECT count(*) FROM public.sns_x_send_jobs j JOIN public.sns_drafts d ON d.id=j.draft_id
--     WHERE j.parent_job_id IS NOT NULL AND j.channel='x' AND j.state='queued' AND d.bundle_import_id IS NULL;  今 claim を待つリプの子の数（当てた直後から枠を取る）
--
-- 適用後の確認（読み取り）:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sns_auto_send_items_variant_scope';  期待: finals_poll・finals_reply の枝
--   SELECT prosrc LIKE '%v_children%' FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: true
--   SELECT prosrc LIKE '%承認中に投票が変わりました%' FROM pg_proc WHERE proname = 'approve_sns_x_send';  期待: true
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--
-- 許可（finals_image_enabled=true）を入れるのは、このコードのマージのコミットが Vercel の本番（cron sns-send）に入り READY だと確かめた後だけ。
--   push（hq の Mac）と送り手（Vercel）は別々にデプロイされ、古い送り手は snapshot.poll を知らずに本文だけのリプを送る（system-architect の P2）
-- 止める: UPDATE public.sns_auto_send_control SET finals_image_enabled = false WHERE channel = 'x';（3本とも止まる）
--
-- 戻し方:
--   1. 許可を false にする（上の「止める」）
--   2. 関数を戻す: transition_sns_send_139 は 176_sns_finals_image_items.sql の CREATE OR REPLACE と REVOKE、
--      approve_sns_x_send は 160_sns_x_multiple_images.sql の CREATE OR REPLACE と REVOKE・GRANT をそのまま実行
--   3. CHECK は残してよい（finals_poll・finals_reply の item が無ければ今までと同じ意味）。戻すのは
--      SELECT count(*) FROM public.sns_auto_send_items WHERE variant IN ('finals_poll','finals_reply');  が0のときだけ
BEGIN;

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_check;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_check
  CHECK (variant IN ('main', 'shorts', 'finals', 'finals_poll', 'finals_reply'));
ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_scope;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_scope CHECK (
  (variant = 'main' AND kind <> 'finals_image')
  OR (variant = 'shorts' AND kind = 'full_picture' AND channel = 'youtube')
  OR (variant IN ('finals', 'finals_poll', 'finals_reply') AND kind = 'finals_image' AND channel = 'x'));

-- 置き換え1（160）: approve_sns_x_send。変更は投票（snapshot.poll と下書きの x_poll）の照合の1つの IF だけ
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
  -- 177: 投票（下書きの source_data.x_poll）は snapshot.poll と一致すること（本文・媒体と同じく、承認する中身を下書きと照合する）。
  -- 投票と媒体は X で同じ投稿に載せられないので、投票のある snapshot は媒体0件だけ
  IF p_snapshot->'poll' IS DISTINCT FROM (CASE WHEN d.platform='x' AND d.source_data ? 'x_poll' THEN
      jsonb_build_object('options',d.source_data->'x_poll'->'options','closes_at',d.source_data->'x_poll'->'closes_at') END)
    OR (p_snapshot ? 'poll' AND jsonb_array_length(p_snapshot->'media')<>0) THEN
    RAISE EXCEPTION '承認中に投票が変わりました';
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

-- 置き換え2（176）: transition_sns_send_139。変更は v_children の宣言と、リプの子の枠を v_need に足す1つの IF だけ
CREATE OR REPLACE FUNCTION public.transition_sns_send_139(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
  v_limit INTEGER; v_need INTEGER := 1; v_ceiling BIGINT; v_rest BIGINT := 0; v_a_pending INTEGER := 0;
  v_kind TEXT; v_expiry_min INTEGER; v_children INTEGER := 0;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
  -- 176: 優勝戦の画像（item の kind=finals_image）は期限が締切の5分前（他は今までどおり sns_x_send_control.expiry_minutes）
  SELECT kind INTO v_kind FROM public.sns_auto_send_items WHERE id=j.auto_item_id;
  v_expiry_min := CASE WHEN v_kind='finals_image' THEN 5 ELSE c.expiry_minutes END;
  v_limit := CASE WHEN j.channel='youtube' THEN coalesce(c.daily_limit_youtube,c.daily_limit) ELSE coalesce(c.daily_limit_x,c.daily_limit) END;
  v_ceiling := CASE WHEN j.channel='youtube' THEN 0
    WHEN d.thread_index=0 THEN coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd)
    ELSE coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd) END;
  IF p_action IN ('claim','begin_post') AND j.channel='x' AND d.thread_index=0 AND d.bundle_import_id IS NOT NULL THEN
    SELECT count(*) INTO v_need FROM public.sns_drafts WHERE bundle_import_id=d.bundle_import_id AND platform='x' AND status<>'archived';
    v_need := greatest(v_need,1);
    v_rest := (v_need-1)*coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd);
  END IF;
  -- 通り道 B（企画・承認）は、今日まだ送っていない A（定型・自動）の予定の本数を先に枠から引く（A を先に入れる。158、plan §8）。
  -- A の予定 = 今日が締切の A の item（検査中・検査を通ったもの: checking・manual・notifying・notified）の X の下書きのうち、
  -- まだ claim していないもの。検査中も数えるのは、朝に A が検査を通る前に B が枠を使い切らないため（落ちた A は held_manual になり外れる）。
  -- claim のときだけ引く。begin_post でやり直すと、間に A が増えたときに claim 済みの B が予約額を使ったまま held になる
  IF p_action='claim' AND j.channel='x' AND d.send_lane='B' THEN
    SELECT count(*) INTO v_a_pending FROM public.sns_drafts ad
      JOIN public.sns_auto_send_items ai ON ai.channel='x' AND (
        (ai.kind='race' AND ad.bundle_import_id=ai.bundle_import_id) OR (ai.kind IN ('digest','finals_image') AND ad.id=ai.draft_id))
      LEFT JOIN public.sns_x_send_jobs aj ON aj.draft_id=ad.id
      WHERE ad.send_lane='A' AND ad.platform='x' AND ad.status NOT IN ('posted','archived')
        AND ai.state IN ('checking','manual','notifying','notified')
        AND (ai.deadline_at AT TIME ZONE 'Asia/Tokyo')::date=(now() AT TIME ZONE 'Asia/Tokyo')::date
        AND (aj.id IS NULL OR (aj.state='queued' AND aj.attempts=0));
    v_need := v_need + v_a_pending;
  END IF;
  -- 177: 通り道 B でない X の claim・begin_post は、リプの子の枠を先に取る。子＝parent_job_id で親につながる、まだ claim していない
  -- （queued・attempts=0）X の job のうち、素材のスレッドでないもの（下書きの bundle_import_id が NULL。スレッドは上の v_need が兄弟で数える）。
  --   自分の子: 親（自分）の claim で子の分の空きも確かめる（/today の reply で親だけ通って子が上限で止まった穴、#1883）
  --   他の親の子: 親が今日 claim 済み（sending・reconcile・posted）で、子がまだ claim していないもの（その間に他の job が子の枠を使わない）。
  --     数えるのは自分が子でないときだけ（子どうしは先に claim した方が通る。子どうしで互いの枠を取り合って両方止まらないように）
  -- 通り道 B は、上の v_a_pending が A の子（item のある下書き）を数えるので足さない（二重に数えない）
  IF p_action IN ('claim','begin_post') AND j.channel='x' AND d.send_lane IS DISTINCT FROM 'B' THEN
    SELECT count(*) INTO v_children FROM public.sns_x_send_jobs cj
      JOIN public.sns_drafts cd ON cd.id=cj.draft_id
      LEFT JOIN public.sns_x_send_jobs pj ON pj.id=cj.parent_job_id
      WHERE cj.parent_job_id IS NOT NULL AND cj.channel='x' AND cj.state='queued' AND cj.attempts=0 AND cj.id<>j.id
        AND cd.bundle_import_id IS NULL AND cj.expires_at>now()
        AND (cj.parent_job_id=j.id OR (j.parent_job_id IS NULL AND pj.state IN ('sending','reconcile','posted')
          AND (now() AT TIME ZONE 'Asia/Tokyo')::date = ANY(pj.attempt_dates)));
    v_need := v_need + v_children;
  END IF;
  IF p_action IN ('claim','begin_post','check') AND j.state IN ('queued','sending') THEN
    IF j.expires_at IS NULL THEN reason:='deadline_missing';
    ELSIF now()>=j.expires_at THEN reason:='deadline_expired';
    ELSIF c.timing_approved IS NOT TRUE THEN reason:='timing_pending_owner';
    -- 176: 優勝戦の画像は、自動送信の許可（sns_auto_send_control の x の行の finals_image_enabled、既定 false）が true のときだけ進める
    ELSIF v_kind='finals_image' AND (SELECT finals_image_enabled FROM public.sns_auto_send_control WHERE channel='x') IS NOT TRUE THEN reason:='finals_image_disabled';
    ELSIF j.expires_at IS DISTINCT FROM (j.snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>v_expiry_min) THEN reason:='deadline_policy_changed';
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

REVOKE ALL ON FUNCTION public.transition_sns_send_139(UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
