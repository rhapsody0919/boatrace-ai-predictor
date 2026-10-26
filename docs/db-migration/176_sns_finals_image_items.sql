-- 176: 優勝戦の「思考の順」の画像投稿（format=finals_image、X だけ、画像4枚で1投稿）を自動送信の item にする（hq FT02、2026-10-26）
-- hq の作り手が出すフォルダを scripts/sns/push-finals-image.js が受け取り、X の下書き（source_data.image_paths に4枚）と
-- item（kind='finals_image'・variant='finals'、下書きに直接ひもづく）を作り、自動送信の承認者で承認する（approve_sns_x_send は 160 のまま）。
-- 送る時刻は今すぐ、期限は締切の5分前（全貌の 60分の遅らせ・30分の期限は当てない）。
-- 自動送信の許可は sns_auto_send_control の x の行の finals_image_enabled（既定 false）。オーナーの yes まで false のまま。
-- false の間は push が何も書かず、送り手（transition_sns_send_139）も claim・check・begin_post で held（finals_image_disabled）にする。
-- 変えるもの:
--   1. sns_auto_send_items: kind に finals_image、kind_source に finals_image の枝（X だけ）、variant に finals（finals_image だけ）
--      一意の索引 sns_auto_send_items_race_channel (race_id, channel, variant) は変えない。finals は1レース1件の生きた item に限られ、
--      同じ優勝戦の全貌（full_picture・x・main）とは両立する。sent は索引に残るので、送った後の2本目も入らない
--   2. sns_auto_send_control.finals_image_enabled（BOOLEAN NOT NULL DEFAULT false）
--   3. transition_sns_send_139（土台は 158）: finals_image の job の期限を締切の5分前で照合し、許可が false なら held
-- 検証: scripts/maintenance/verify-sns-finals-image.js（PGlite、外部接続なし）
-- 適用の順: コード（push-finals-image.js・snsClaimCheck.js の finals_image の枝）を先にデプロイしてから当てる（どちらの順でも送らない側に倒れる:
--   列が無い間は push が off として扱い、kind の CHECK が item を拒む）。db-apply は master の HEAD の SQL を当てる
--
-- 適用前の確認（読み取り）:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.sns_auto_send_items'::regclass
--     AND conname IN ('sns_auto_send_items_kind_check','sns_auto_send_items_kind_source','sns_auto_send_items_variant_check','sns_auto_send_items_variant_scope');
--   期待: 4行（kind は race・digest・full_picture、variant は main・shorts）
--   SELECT md5(pg_get_functiondef('public.transition_sns_send_139(uuid,text,jsonb)'::regprocedure));  158 を当てた後から変わっていないこと
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'sns_auto_send_control' AND column_name = 'finals_image_enabled';  期待: 0
--
-- 適用後の確認（読み取り）:
--   SELECT channel, finals_image_enabled FROM public.sns_auto_send_control ORDER BY 1;  期待: x false・youtube false
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sns_auto_send_items_kind_source';  期待: finals_image の枝
--   SELECT prosrc LIKE '%finals_image_disabled%' FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: true
--
-- 自動送信を許す（オーナーの yes の後だけ）: UPDATE public.sns_auto_send_control SET finals_image_enabled = true WHERE channel = 'x';
-- 止める: UPDATE public.sns_auto_send_control SET finals_image_enabled = false WHERE channel = 'x';
--
-- 戻し方:
--   1. 許可を false にする（上の「止める」）。送っていない finals_image の job は claim で held になる
--   2. 関数を 158 の定義に戻す（158_sns_lanes_digest_period.sql の「置き換え2」の CREATE OR REPLACE をそのまま実行し、158 の REVOKE を当てる）
--   3. 列・CHECK は残してよい（finals_image の item が無ければ今までと同じ意味）。消すのは finals_image の item が0件のときだけ:
--      SELECT count(*) FROM public.sns_auto_send_items WHERE kind = 'finals_image';  期待: 0。1件以上なら 2 で止める
BEGIN;

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_check;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_kind_check
  CHECK (kind IN ('race', 'digest', 'full_picture', 'finals_image'));

ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_kind_source;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_kind_source CHECK (
  (kind = 'race' AND bundle_import_id IS NOT NULL AND draft_id IS NULL)
  OR (kind = 'digest' AND bundle_import_id IS NULL AND draft_id IS NOT NULL AND channel = 'x')
  OR (kind = 'full_picture' AND bundle_import_id IS NULL AND draft_id IS NOT NULL)
  OR (kind = 'finals_image' AND bundle_import_id IS NULL AND draft_id IS NOT NULL AND channel = 'x'));

-- 172 の列の CHECK（名前は ADD COLUMN の自動の名前）。名前が違えばここで止まり、全体が戻る
ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_check;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_check
  CHECK (variant IN ('main', 'shorts', 'finals'));
ALTER TABLE public.sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_variant_scope;
ALTER TABLE public.sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_variant_scope CHECK (
  (variant = 'main' AND kind <> 'finals_image')
  OR (variant = 'shorts' AND kind = 'full_picture' AND channel = 'youtube')
  OR (variant = 'finals' AND kind = 'finals_image' AND channel = 'x'));

ALTER TABLE public.sns_auto_send_control ADD COLUMN finals_image_enabled BOOLEAN NOT NULL DEFAULT false;
-- 意味を持つのは x の行だけ（youtube の行を誤って true にできないようにする。system-architect の P2）
ALTER TABLE public.sns_auto_send_control ADD CONSTRAINT sns_auto_send_control_finals_image_x_only
  CHECK (channel = 'x' OR finals_image_enabled = false);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sns_auto_send_items WHERE variant NOT IN ('main', 'shorts') OR kind = 'finals_image') THEN
    RAISE EXCEPTION '176: 既存の item に finals の行がある';
  END IF;
END $$;

-- 置き換え（158）: transition_sns_send_139。変更は v_kind・v_expiry_min と、finals_image_disabled・期限の照合の2行と、
-- B の通り道が先に引く A の予定（v_a_pending）に finals_image を足すことだけ（期限の5分は push-finals-image.js の EXPIRES_BEFORE_MIN と同じ値）
CREATE OR REPLACE FUNCTION public.transition_sns_send_139(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
  v_limit INTEGER; v_need INTEGER := 1; v_ceiling BIGINT; v_rest BIGINT := 0; v_a_pending INTEGER := 0;
  v_kind TEXT; v_expiry_min INTEGER;
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
