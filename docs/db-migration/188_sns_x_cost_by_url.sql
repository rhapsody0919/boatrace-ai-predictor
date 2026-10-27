-- 188: X の送信の月の予約を、送る文に URL があるかで決める（URL あり ceiling_x_url、無し ceiling_x_plain）。あわせて2つの額を
-- X API の料金表の値にする（Post: Create $0.015、Post: Create (with URL) $0.200。https://docs.x.com/x-api/getting-started/pricing、
-- 2026-10-27 に確認。表は「Prices are subject to change」で、正は Developer Console の表示。媒体の upload の行は表に無い）。
-- 182 までは X のスレッドの親（thread_index=0）を全部 URL つきとして $0.25、子を $0.03 で予約し、月の切り替えまで戻さない。
-- URL の無い投稿（優勝戦の思考・数字で見たら・投票のリプ・展示後のリプ）も $0.25 で数えていて、月 $20 を早く使い切る見込みだった
-- （2026-10-27 の今月: X 20本で 5,278,000、直近7日19本。Orchestrate の依頼「費用を正しく数える直し」）
-- 変えるもの:
--   1. 関数 sns_x_post_has_url(text): X が URL として数えそうな文字列（https?:// か www. か、よく使う TLD のドメイン）があるか。
--      X の判定の正確な規則は料金表に無いので、多めに URL と見る（取り逃すと予約が実額より少なくなる）
--   2. transition_sns_send_139（土台は 182）: v_ceiling を自分の送る文（snapshot の text）の URL の有無で決める。素材のスレッドの兄弟
--      （v_rest）と、まだ claim していない自分の子（177 の v_children）も、それぞれの文で数える。ほかは 182 のまま
--   3. sns_x_send_control の ceiling_x_url_microusd 250000 → 200000、ceiling_x_plain_microusd 30000 → 15000（今の値が 250000・30000
--      のときだけ。違えばオーナーが別に決めた値なので触らず NOTICE）。attempt_ceiling_microusd（費用未確認の判定と、列が NULL のときの
--      代わり）は変えない。予算（budget_microusd）は変えない（予算の線はオーナー）
-- 検証: scripts/maintenance/verify-sns-x-cost-by-url.js（PGlite、外部接続なし）
-- 適用の順: コードの変更は無い。182 の後（下の DO が transition の本文の md5 を確かめ、違えば全体を戻す）
-- 適用の時刻: X を送らない時間（22:00〜07:00 JST か 10:00〜13:00 JST）。/today 8:00〜9:30、全貌の X 14:30〜21:15 頃、優勝戦 16:30〜20:45、
--   数字で見たら 月水金 19:00〜20:00 を避ける。sns_x_send_control の行を FOR UPDATE で取る claim と短く重なるだけ
--
-- 適用前の確認（読み取り）:
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: c2b4835c416ff6e824a43fe9025c6518（182 の本文）
--   SELECT ceiling_x_url_microusd, ceiling_x_plain_microusd, attempt_ceiling_microusd, budget_microusd, reserved_microusd FROM public.sns_x_send_control;
--     期待: 250000・30000・250000（budget・reserved は控える）
--   SELECT to_regprocedure('public.sns_x_post_has_url(text)');  期待: NULL
--
-- 適用後の確認（読み取り）:
--   SELECT prosrc LIKE '%sns_x_post_has_url%' FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: true
--   SELECT ceiling_x_url_microusd, ceiling_x_plain_microusd FROM public.sns_x_send_control;  期待: 200000・15000
--   SELECT public.sns_x_post_has_url('今日の一覧はこちら：https://www.boat-ai.jp/today'), public.sns_x_post_has_url('優勝戦の思考の順');  期待: true・false
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--
-- 戻し方: 182_sns_x_kind_reserves.sql の transition_sns_send_139 の CREATE OR REPLACE と REVOKE（144〜316 行）だけを実行し、
--   UPDATE public.sns_x_send_control SET ceiling_x_url_microusd = 250000, ceiling_x_plain_microusd = 30000 WHERE id = true;
--   sns_x_post_has_url は残してよい（呼ばれなければ効かない）。消すなら関数を戻した後に DROP FUNCTION public.sns_x_post_has_url(TEXT);
BEGIN;

DO $$
BEGIN
  -- 土台は 182 の transition（出し物ごとの取り置き）。本文が違えば（別のレーンが 182 の後に変えた等）置き換えで消してしまうので止める
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'transition_sns_send_139' AND md5(prosrc) = 'c2b4835c416ff6e824a43fe9025c6518') THEN
    RAISE EXCEPTION '188: transition_sns_send_139 が 182 の本文でない（md5 が違う）';
  END IF;
END $$;

-- X が URL として数えそうな文字列があるか。多めに真にする（偽にすると予約が実額より少なくなる）
CREATE FUNCTION public.sns_x_post_has_url(p_text TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT coalesce(p_text, '') ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|jp|io|co|me|ly|gl|app|dev|info|tv|ai|link|site)(?![a-z0-9]))';
$$;

REVOKE ALL ON FUNCTION public.sns_x_post_has_url(TEXT) FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF (SELECT ceiling_x_url_microusd = 250000 AND ceiling_x_plain_microusd = 30000 FROM public.sns_x_send_control WHERE id = true) THEN
    UPDATE public.sns_x_send_control SET ceiling_x_url_microusd = 200000, ceiling_x_plain_microusd = 15000 WHERE id = true;
  ELSE
    RAISE NOTICE '188: ceiling_x_url・ceiling_x_plain が 250000・30000 でないので変えない';
  END IF;
END $$;

-- 置き換え（182）: transition_sns_send_139。変更は v_ceiling・素材のスレッドの兄弟の v_rest・自分の子の v_rest だけ
CREATE OR REPLACE FUNCTION public.transition_sns_send_139(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
  v_limit INTEGER; v_need INTEGER := 1; v_ceiling BIGINT; v_rest BIGINT := 0; v_a_pending INTEGER := 0;
  v_kind TEXT; v_expiry_min INTEGER; v_children INTEGER := 0;
  v_base INTEGER; v_own INTEGER := 0; v_room JSONB; v_max_age INTEGER; v_child_cost BIGINT := 0;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
  -- 176: 優勝戦の画像（item の kind=finals_image）は期限が締切の5分前（他は今までどおり sns_x_send_control.expiry_minutes）
  SELECT kind INTO v_kind FROM public.sns_auto_send_items WHERE id=j.auto_item_id;
  v_expiry_min := CASE WHEN v_kind='finals_image' THEN 5 WHEN v_kind='research_image' THEN 60 ELSE c.expiry_minutes END;
  -- 180: 「数字で見たら」（research_image）は期限が締切の60分前（締切＝送る時刻＋120分なので、送る時刻から60分）、
  -- 根拠の鮮度は集計の時刻から24時間（直近1年の集計なので、他の kind の max_source_age_seconds（本番 14400）は当てない）
  v_max_age := CASE WHEN v_kind='research_image' THEN 86400 ELSE c.max_source_age_seconds END;
  v_limit := CASE WHEN j.channel='youtube' THEN coalesce(c.daily_limit_youtube,c.daily_limit) ELSE coalesce(c.daily_limit_x,c.daily_limit) END;
  -- 188: X の予約は、送る文に URL があれば ceiling_x_url、無ければ ceiling_x_plain（X の料金は Post: Create の URL の有無で変わる）。
  -- 182 まではスレッドの親（thread_index=0）を全部 URL つきとして数えていた
  v_ceiling := CASE WHEN j.channel='youtube' THEN 0
    WHEN public.sns_x_post_has_url(j.snapshot->>'text') THEN coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd)
    ELSE coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd) END;
  IF p_action IN ('claim','begin_post') AND j.channel='x' AND d.thread_index=0 AND d.bundle_import_id IS NOT NULL THEN
    SELECT count(*), coalesce(sum(CASE WHEN public.sns_x_post_has_url(sd.caption_text) THEN coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd)
        ELSE coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd) END) FILTER (WHERE sd.id<>d.id),0)
      INTO v_need, v_rest FROM public.sns_drafts sd WHERE sd.bundle_import_id=d.bundle_import_id AND sd.platform='x' AND sd.status<>'archived';
    v_need := greatest(v_need,1);
  END IF;
  -- 182: 自分の本数（素材のスレッドの兄弟を含む）。出し物の取り置きの n はこれと自分の子
  v_base := v_need;
  -- 通り道 B（企画・承認）は、今日まだ送っていない A（定型・自動）の予定の本数を先に枠から引く（A を先に入れる。158、plan §8）。
  -- A の予定 = 今日が締切の A の item（検査中・検査を通ったもの: checking・manual・notifying・notified）の X の下書きのうち、
  -- まだ claim していないもの。検査中も数えるのは、朝に A が検査を通る前に B が枠を使い切らないため（落ちた A は held_manual になり外れる）。
  -- claim のときだけ引く。begin_post でやり直すと、間に A が増えたときに claim 済みの B が予約額を使ったまま held になる
  IF p_action='claim' AND j.channel='x' AND d.send_lane='B' THEN
    SELECT count(*) INTO v_a_pending FROM public.sns_drafts ad
      JOIN public.sns_auto_send_items ai ON ai.channel='x' AND (
        (ai.kind='race' AND ad.bundle_import_id=ai.bundle_import_id) OR (ai.kind IN ('digest','finals_image','research_image') AND ad.id=ai.draft_id))
      LEFT JOIN public.sns_x_send_jobs aj ON aj.draft_id=ad.id
      WHERE ad.send_lane='A' AND ad.platform='x' AND ad.status NOT IN ('posted','archived')
        AND ai.state IN ('checking','manual','notifying','notified')
        AND (ai.deadline_at AT TIME ZONE 'Asia/Tokyo')::date=(now() AT TIME ZONE 'Asia/Tokyo')::date
        AND (aj.id IS NULL OR (aj.state='queued' AND aj.attempts=0));
    v_need := v_need + v_a_pending;
  END IF;
  -- 177: 通り道 B でない X の claim は、リプの子の枠を先に取る。子＝parent_job_id で親につながる、まだ claim していない
  -- （queued・attempts=0）X の job のうち、素材のスレッドでないもの（下書きの bundle_import_id が NULL。スレッドは上の v_need が兄弟で数える）。
  --   自分の子: 親（自分）の claim で子の分の空きも確かめる（/today の reply で親だけ通って子が上限で止まった穴、#1883）
  --   他の親の子: 親が今日 claim 済み（sending・reconcile・posted）で、子がまだ claim していないもの（その間に他の job が子の枠を使わない）。
  --     数えるのは自分が子でないときだけ（子どうしは先に claim した方が通る。子どうしで互いの枠を取り合って両方止まらないように）
  -- 通り道 B は、上の v_a_pending が A の子（item のある下書き）を数えるので足さない（二重に数えない）
  -- claim のときだけ数える（v_a_pending と同じ。begin_post で数え直すと、間に他の親の子が増えたときに claim 済みの job が
  -- 予約額を使ったまま「日次全体上限です」で止まる。/code-review の指摘）。月の予算も子の分（URL つきの額）の空きを確かめる
  IF p_action='claim' AND j.channel='x' AND d.send_lane IS DISTINCT FROM 'B' THEN
    SELECT count(*), count(*) FILTER (WHERE cj.parent_job_id=j.id),
        coalesce(sum(CASE WHEN public.sns_x_post_has_url(cj.snapshot->>'text') THEN coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd)
          ELSE coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd) END),0)
      INTO v_children, v_own, v_child_cost FROM public.sns_x_send_jobs cj
      JOIN public.sns_drafts cd ON cd.id=cj.draft_id
      LEFT JOIN public.sns_x_send_jobs pj ON pj.id=cj.parent_job_id
      WHERE cj.parent_job_id IS NOT NULL AND cj.channel='x' AND cj.state='queued' AND cj.attempts=0 AND cj.id<>j.id
        AND cd.bundle_import_id IS NULL AND cj.expires_at>now()
        AND (cj.parent_job_id=j.id OR (j.parent_job_id IS NULL AND pj.state IN ('sending','reconcile','posted')
          AND (now() AT TIME ZONE 'Asia/Tokyo')::date = ANY(pj.attempt_dates)));
    v_need := v_need + v_children;
    v_rest := v_rest + v_child_cost;
  END IF;
  IF p_action IN ('claim','begin_post','check') AND j.state IN ('queued','sending') THEN
    IF j.expires_at IS NULL THEN reason:='deadline_missing';
    ELSIF now()>=j.expires_at THEN reason:='deadline_expired';
    ELSIF c.timing_approved IS NOT TRUE THEN reason:='timing_pending_owner';
    -- 176: 優勝戦の画像は、自動送信の許可（sns_auto_send_control の x の行の finals_image_enabled、既定 false）が true のときだけ進める
    ELSIF v_kind='finals_image' AND (SELECT finals_image_enabled FROM public.sns_auto_send_control WHERE channel='x') IS NOT TRUE THEN reason:='finals_image_disabled';
    -- 180: 「数字で見たら」は、自動送信の許可（x の行の research_image_enabled、179、既定 false）が true のときだけ進める
    ELSIF v_kind='research_image' AND (SELECT research_image_enabled FROM public.sns_auto_send_control WHERE channel='x') IS NOT TRUE THEN reason:='research_image_disabled';
    ELSIF j.expires_at IS DISTINCT FROM (j.snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>v_expiry_min) THEN reason:='deadline_policy_changed';
    ELSIF (j.snapshot->'queue'->>'source_observed_at')::timestamptz IS NULL OR v_max_age IS NULL THEN reason:='freshness_unknown';
    ELSIF (j.snapshot->'queue'->>'source_observed_at')::timestamptz>now() OR
      (j.snapshot->'queue'->>'source_observed_at')::timestamptz + make_interval(secs=>v_max_age)<=now() THEN reason:='source_stale';
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
  -- 182: 通り道 B は 177 の子の数えを通らないので、自分の子（v_own）をここで数える（B の親が子の分を取らずに通る穴。/code-review の指摘）
  IF p_action='claim' AND j.channel='x' AND d.send_lane='B' THEN
    SELECT count(*) INTO v_own FROM public.sns_x_send_jobs cj JOIN public.sns_drafts cd ON cd.id=cj.draft_id
      WHERE cj.parent_job_id=j.id AND cj.channel='x' AND cj.state='queued' AND cj.attempts=0
        AND cd.bundle_import_id IS NULL AND cj.expires_at>now();
  END IF;
  -- 182: 出し物ごとの取り置き（sns_x_kind_reserves）。claim のときだけ、自分（スレッドの兄弟を含む）と自分の子の本数を足したとき、
  -- 他の出し物の取り置きの残りを使わないかを sns_x_slot_room で確かめる（同じ式を取り込みも使う）。止めるときは例外にせず held にする
  -- （取り置きは後から空かない。例外だと queued のまま runner が2分ごとに Slack に知らせ続ける）。基準の日が未確認なら下の例外に任せる
  IF p_action='claim' AND j.channel='x' AND j.state='queued' AND j.scheduled_at<=now() THEN
    -- 出し物は item の kind、item の無い子は親の item の kind（sns_x_slot_room の数え方と同じ）
    v_room := public.sns_x_slot_room(coalesce(v_kind, (SELECT pi.kind FROM public.sns_x_send_jobs p
      JOIN public.sns_auto_send_items pi ON pi.id=p.auto_item_id WHERE p.id=j.parent_job_id), ''), v_base + v_own, false, j.id);
    IF v_room->>'reason' = 'kind_slot_full' THEN
      -- まだ claim していない自分の子も止める（親を止めた後に queued のまま残ると、期限まで親待ちの警告が出続け、取り込みの数えにも残る）
      UPDATE public.sns_x_send_jobs SET state='held',error_code='kind_slot_full',updated_at=now()
        WHERE parent_job_id=j.id AND state='queued' AND attempts=0;
      UPDATE public.sns_x_send_jobs SET state='held',error_code='kind_slot_full',updated_at=now() WHERE id=j.id RETURNING * INTO j;
      RETURN to_jsonb(j);
    END IF;
  END IF;
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
