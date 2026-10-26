-- 179: X の日の枠（sns_x_send_control.daily_limit_x）を出し物（item の kind）ごとに取り置く。先に送る出し物が他の出し物の
-- 取り置きの残りを使わない（hq の per-type-workflow-review 10/27 P0-2、取り置きの数の正本は hq の config/x-slots.json）。
-- 設計: docs/design/x-daily-slots/plan.md
-- 変えるもの:
--   1. 表 sns_x_kind_reserves（kind・daily_count・weekdays）。初期は full_picture 4・digest（/today）1・finals_image（優勝戦）3＝合計8。
--      本番の daily_limit_x は 9（2026-10-27 読み取り）なので、取り置かれていない残りは1。数字で見たらの行（月水金に1）は、その取り込み
--      （push-research-image.js）の PR で kind を決めて入れる。入れると月水金は合計9＝上限で残りが0になる
--   2. 関数 sns_x_slot_room(kind, need, with_queued, job_id, draft_id): 出し物 k が need 本を足せるか。
--      他経路 + B_k + Σ_{j≠k} max(r_j, B_j) + need ≤ daily_limit_x（r=今日の取り置き、B=今日の試行＋まだ claim していない分）。
--      claim（with_queued=false）と取り込みの確かめ（true、rpc）で同じ式を使う
--   3. transition_sns_send_139（土台は 177）: X の claim で 2 を確かめ、越えるなら held（error_code=kind_slot_full）。177 の検査はそのまま残す
-- 検証: scripts/maintenance/verify-sns-x-slots.js（PGlite、外部接続なし）
-- 適用の順: コードが先でも後でもよい。適用前は取り込みの rpc が 404 で今のまま送る（claim も 177 のまま）。db-apply は master の HEAD の SQL を当てる
--
-- 適用前の確認（読み取り）:
--   SELECT md5(prosrc) FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: d70f142b2f3545d5660464b6c66aec59（177 の本文）
--   SELECT daily_limit_x, daily_external_count FROM public.sns_x_send_control;  期待: 9・0（取り置きの合計8以上。8未満なら初期の行を直してから当てる。
--     当てる直前に読み直す。PR を書いた時点の値で決めない）
--   177 のヘッダーの「今 claim を待つリプの子の数」が0であること（claim 済みの親の子が 179 の式で止まらないように）。優勝戦の時間帯（16:30〜20:45）は避ける
--   SELECT to_regclass('public.sns_x_kind_reserves'), to_regprocedure('public.sns_x_slot_room(text,integer,boolean,uuid,uuid)');  期待: どちらも NULL
--
-- 適用後の確認（読み取り）:
--   SELECT * FROM public.sns_x_kind_reserves ORDER BY kind;  期待: digest 1・finals_image 3・full_picture 4（weekdays は NULL）
--   SELECT prosrc LIKE '%kind_slot_full%' FROM pg_proc WHERE proname = 'transition_sns_send_139';  期待: true
--   SELECT public.sns_x_slot_room('finals_image', 2, true, NULL, NULL);  期待: 今日の基準があれば ok と数の内訳
--   node --env-file=.env.local scripts/maintenance/verify-rpc-output-keys.js
--
-- 取り置きを変える（オーナー、SQL Editor）: UPDATE public.sns_x_kind_reserves SET daily_count = 2 WHERE kind = 'digest';
--   曜日つき: INSERT INTO public.sns_x_kind_reserves(kind, daily_count, weekdays, note) VALUES ('<kind>', 1, '{1,3,5}', '数字で見たら（月水金）');
--   合計（その曜日の取り置き）は daily_limit_x 以下に保つ（越えると後から送る出し物が止まる）。hq の config との照合は scripts/sns/x-slots-check.js
--
-- 戻し方（この順を守る。transition の中の sns_x_slot_room の呼び出しは pg_depend に出ないので、先に DROP すると X の claim が全部例外になる）:
--   1. 関数を戻す: 177_sns_finals_replies.sql の transition_sns_send_139 の CREATE OR REPLACE と REVOKE をそのまま実行
--   2. 表と sns_x_slot_room は残してよい（呼ばれなければ効かない）。消すなら
--      DROP FUNCTION public.sns_x_slot_room(TEXT,INTEGER,BOOLEAN,UUID,UUID); DROP TABLE public.sns_x_kind_reserves;
BEGIN;

CREATE TABLE public.sns_x_kind_reserves (
  kind TEXT PRIMARY KEY CHECK (kind ~ '^[a-z][a-z_]{0,39}$'),       -- sns_auto_send_items.kind と同じ値
  daily_count INTEGER NOT NULL CHECK (daily_count BETWEEN 0 AND 100), -- 取り置きの本数（スレッド・リプも1本ずつ）
  weekdays SMALLINT[] CHECK (weekdays IS NULL OR (cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[])),               -- ISO の曜日（1=月〜7=日、JST）。NULL は毎日
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sns_x_kind_reserves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_x_kind_reserves FROM PUBLIC, anon, authenticated;
-- 書くのはオーナー（SQL Editor）だけ。service_role（送り手・取り込み）は読むだけ
GRANT SELECT ON public.sns_x_kind_reserves TO service_role;
INSERT INTO public.sns_x_kind_reserves(kind, daily_count, note) VALUES
  ('full_picture', 4, '全貌（X の1本/レース）'),
  ('digest', 1, '/today（返信の型は親と返信の2本）'),
  ('finals_image', 3, '優勝戦（本投稿・投票のリプ・展示後のリプ）');

-- 出し物 p_kind が p_need 本を足せるか。JST の今日について数える。
--   r_j: 今日の取り置き（曜日が外れれば0。表に無い kind・item の無い job（通り道 B、kind=''）は0）
--   B_j: 今日の X の試行（attempt_dates）＋まだ claim していない分。job の出し物は item の kind、item の無い子は親の item の kind
--     p_with_queued=false（claim）: 親が今日 claim 済み（sending・reconcile・posted）の、まだ claim していない X の子（177 の「他の親の子」）
--     p_with_queued=true（取り込み）: 今日が期限の X の queued（attempts=0・期限の前）全部
--     どちらも p_job_id の job とその子は数えない（p_need に入れる）。p_draft_id（取り込みの作り直し）はその下書きの job とその子を数えない
--     （/today の作り直しで前の版の job が queued のまま残っていても二重に数えない。system-architect の P2）
--   ok: 他経路 + B_k + Σ_{j≠k} max(r_j, B_j) + p_need ≤ daily_limit_x
-- 基準の日（daily_baseline_date）が今日でなければ ok=false・reason=baseline_unconfirmed（claim は 177 の例外に任せる）
CREATE FUNCTION public.sns_x_slot_room(p_kind TEXT, p_need INTEGER, p_with_queued BOOLEAN DEFAULT true, p_job_id UUID DEFAULT NULL,
  p_draft_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE c public.sns_x_send_control; v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_dow INTEGER := extract(isodow FROM now() AT TIME ZONE 'Asia/Tokyo')::integer; v_limit INTEGER; v_ext INTEGER;
  v_reserve INTEGER; v_booked INTEGER; v_others INTEGER; v_held INTEGER; v_total INTEGER; v_reserved_total INTEGER;
BEGIN
  IF p_need IS NULL OR p_need < 0 THEN RAISE EXCEPTION '本数が不正です'; END IF;
  -- 出し物の無い job（通り道 B）は ''。NULL だと kind<>p_kind が NULL になり他の出し物を0と数えるので拒む
  IF p_kind IS NULL THEN RAISE EXCEPTION '出し物（kind）が無い'; END IF;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true;
  v_limit := coalesce(c.daily_limit_x, c.daily_limit);
  v_ext := coalesce(c.daily_external_count, 0);
  IF v_limit IS NULL OR v_limit < 1 OR c.daily_baseline_date IS DISTINCT FROM v_today THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'baseline_unconfirmed', 'kind', p_kind, 'need', p_need);
  END IF;
  WITH res AS (
    SELECT kind, CASE WHEN weekdays IS NULL OR v_dow = ANY(weekdays) THEN daily_count ELSE 0 END AS r
      FROM public.sns_x_kind_reserves),
  jk AS (
    SELECT j.id, j.state, j.attempts, j.attempt_dates, j.attempt_channels, j.parent_job_id, j.expires_at, j.draft_id,
      p.draft_id AS parent_draft_id,
      coalesce(i.kind, pi.kind, '') AS kind
    FROM public.sns_x_send_jobs j
    LEFT JOIN public.sns_auto_send_items i ON i.id=j.auto_item_id
    LEFT JOIN public.sns_x_send_jobs p ON p.id=j.parent_job_id
    LEFT JOIN public.sns_auto_send_items pi ON pi.id=p.auto_item_id
    WHERE j.channel='x'),
  used AS (
    SELECT jk.kind, count(*) AS n FROM jk, LATERAL unnest(jk.attempt_dates, jk.attempt_channels) a(day, ch)
      WHERE a.ch='x' AND a.day=v_today GROUP BY jk.kind),
  waiting AS (
    SELECT jk.kind, count(*) AS n FROM jk
      JOIN public.sns_drafts d ON d.id=jk.draft_id
      LEFT JOIN public.sns_x_send_jobs pj ON pj.id=jk.parent_job_id
      WHERE jk.state='queued' AND jk.attempts=0 AND jk.expires_at>now()
        AND (p_job_id IS NULL OR (jk.id<>p_job_id AND jk.parent_job_id IS DISTINCT FROM p_job_id))
        AND (p_draft_id IS NULL OR (jk.draft_id<>p_draft_id AND jk.parent_draft_id IS DISTINCT FROM p_draft_id))
        AND CASE WHEN p_with_queued THEN (jk.expires_at AT TIME ZONE 'Asia/Tokyo')::date = v_today
          ELSE jk.parent_job_id IS NOT NULL AND d.bundle_import_id IS NULL
            AND pj.state IN ('sending','reconcile','posted') AND v_today = ANY(pj.attempt_dates) END
      GROUP BY jk.kind),
  kinds AS (SELECT kind FROM res UNION SELECT kind FROM used UNION SELECT kind FROM waiting),
  booked AS (
    SELECT k.kind, coalesce(res.r, 0) AS r, coalesce(used.n, 0) + coalesce(waiting.n, 0) AS b
      FROM kinds k LEFT JOIN res USING (kind) LEFT JOIN used USING (kind) LEFT JOIN waiting USING (kind))
  SELECT coalesce(sum(r) FILTER (WHERE kind=p_kind), 0), coalesce(sum(b) FILTER (WHERE kind=p_kind), 0),
    coalesce(sum(b) FILTER (WHERE kind<>p_kind), 0), coalesce(sum(greatest(r-b, 0)) FILTER (WHERE kind<>p_kind), 0),
    coalesce(sum(r), 0)
    INTO v_reserve, v_booked, v_others, v_held, v_reserved_total FROM booked;
  v_total := v_ext + v_booked + v_others + v_held + p_need;
  RETURN jsonb_build_object('ok', v_total <= v_limit,
    'reason', CASE WHEN v_total <= v_limit THEN NULL ELSE 'kind_slot_full' END,
    'kind', p_kind, 'need', p_need, 'limit', v_limit, 'reserve', v_reserve, 'booked', v_booked,
    'others_booked', v_others, 'held_for_others', v_held, 'external', v_ext,
    -- 今日の取り置きの合計。他経路と足して上限を越える日は、取り置きの中でも後から来た出し物が止まる（呼ぶ側が知らせる）
    'reserved_total', v_reserved_total, 'over_reserved', v_reserved_total + v_ext > v_limit,
    'room', v_limit - (v_total - p_need));
END;
$$;
REVOKE ALL ON FUNCTION public.sns_x_slot_room(TEXT,INTEGER,BOOLEAN,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sns_x_slot_room(TEXT,INTEGER,BOOLEAN,UUID,UUID) TO service_role;

-- 置き換え（177）: transition_sns_send_139。変更は v_base・v_own・v_room の宣言、v_base の代入、177 の子の数え方で自分の子（v_own）も
-- 数えること、claim の取り置きの確かめ（kind_slot_full で held）の1つの IF だけ
CREATE OR REPLACE FUNCTION public.transition_sns_send_139(p_job_id UUID, p_action TEXT, p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
  v_limit INTEGER; v_need INTEGER := 1; v_ceiling BIGINT; v_rest BIGINT := 0; v_a_pending INTEGER := 0;
  v_kind TEXT; v_expiry_min INTEGER; v_children INTEGER := 0;
  v_base INTEGER; v_own INTEGER := 0; v_room JSONB;
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
  -- 179: 自分の本数（素材のスレッドの兄弟を含む）。出し物の取り置きの n はこれと自分の子
  v_base := v_need;
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
  -- 177: 通り道 B でない X の claim は、リプの子の枠を先に取る。子＝parent_job_id で親につながる、まだ claim していない
  -- （queued・attempts=0）X の job のうち、素材のスレッドでないもの（下書きの bundle_import_id が NULL。スレッドは上の v_need が兄弟で数える）。
  --   自分の子: 親（自分）の claim で子の分の空きも確かめる（/today の reply で親だけ通って子が上限で止まった穴、#1883）
  --   他の親の子: 親が今日 claim 済み（sending・reconcile・posted）で、子がまだ claim していないもの（その間に他の job が子の枠を使わない）。
  --     数えるのは自分が子でないときだけ（子どうしは先に claim した方が通る。子どうしで互いの枠を取り合って両方止まらないように）
  -- 通り道 B は、上の v_a_pending が A の子（item のある下書き）を数えるので足さない（二重に数えない）
  -- claim のときだけ数える（v_a_pending と同じ。begin_post で数え直すと、間に他の親の子が増えたときに claim 済みの job が
  -- 予約額を使ったまま「日次全体上限です」で止まる。/code-review の指摘）。月の予算も子の分（URL つきの額）の空きを確かめる
  IF p_action='claim' AND j.channel='x' AND d.send_lane IS DISTINCT FROM 'B' THEN
    SELECT count(*), count(*) FILTER (WHERE cj.parent_job_id=j.id) INTO v_children, v_own FROM public.sns_x_send_jobs cj
      JOIN public.sns_drafts cd ON cd.id=cj.draft_id
      LEFT JOIN public.sns_x_send_jobs pj ON pj.id=cj.parent_job_id
      WHERE cj.parent_job_id IS NOT NULL AND cj.channel='x' AND cj.state='queued' AND cj.attempts=0 AND cj.id<>j.id
        AND cd.bundle_import_id IS NULL AND cj.expires_at>now()
        AND (cj.parent_job_id=j.id OR (j.parent_job_id IS NULL AND pj.state IN ('sending','reconcile','posted')
          AND (now() AT TIME ZONE 'Asia/Tokyo')::date = ANY(pj.attempt_dates)));
    v_need := v_need + v_children;
    v_rest := v_rest + v_children*coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd);
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
  -- 179: 出し物ごとの取り置き（sns_x_kind_reserves）。claim のときだけ、自分（スレッドの兄弟を含む）と自分の子の本数を足したとき、
  -- 他の出し物の取り置きの残りを使わないかを sns_x_slot_room で確かめる（同じ式を取り込みも使う）。止めるときは例外にせず held にする
  -- （取り置きは後から空かない。例外だと queued のまま runner が2分ごとに Slack に知らせ続ける）。基準の日が未確認なら下の例外に任せる
  IF p_action='claim' AND j.channel='x' AND j.state='queued' AND j.scheduled_at<=now() THEN
    -- 出し物は item の kind、item の無い子は親の item の kind（sns_x_slot_room の数え方と同じ）
    v_room := public.sns_x_slot_room(coalesce(v_kind, (SELECT pi.kind FROM public.sns_x_send_jobs p
      JOIN public.sns_auto_send_items pi ON pi.id=p.auto_item_id WHERE p.id=j.parent_job_id), ''), v_base + v_own, false, j.id);
    IF v_room->>'reason' = 'kind_slot_full' THEN
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
