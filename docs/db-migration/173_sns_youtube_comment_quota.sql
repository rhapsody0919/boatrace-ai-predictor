-- 173: 全貌の YouTube 完全版のチャンネルのコメント（commentThreads.insert、50単位）を YouTube のクォータの台帳に載せる（hq 契約 10/24 C3）。
-- 146 の sns_youtube_quota_reads に method='commentThreads.insert'・units=50 の行を足せるようにし、記録する関数を足す。
-- reads の units は transition_sns_x_send の claim・lookup・poll・call で method を絞らずに日の合計 general_total へ入るので、
-- transition_sns_x_send（153、本番で md5 照合済み）と claim の予約104 は変えない（system-architect 2026-10-24、案A）。
-- 呼ぶ順: この関数で台帳に行を入れてから commentThreads.insert を呼ぶ。部分一意索引で1動画1件、失敗・結果不明でもやり直さない（重複コメントより安全）。
-- 注意（P3）: 153 の complete の公開確認は reads の EXISTS を method で絞っていない。posted は終わりの状態で、この関数は posted の job だけに行を足すので今は効かない。
-- posted から戻す遷移を作るときは、その EXISTS に method='videos.list' を足すこと。
-- 前提: 146・153 が適用済み。適用前でもコードは環境変数のフラグ（既定は無効）で閉じているので、今の送信は変わらない。

-- 事前の確認（読み取り）: 列に付けた CHECK は自動名なので決め打ちしない。期待は attempt>0・method='videos.list'・units=1 の3本
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid='public.sns_youtube_quota_reads'::regclass AND contype='c' ORDER BY 1;

DO $$
DECLARE r RECORD; n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.sns_youtube_quota_reads'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%method%' OR pg_get_constraintdef(oid) LIKE '%units%')
  LOOP
    n := n + 1;
  END LOOP;
  IF n <> 2 THEN
    RAISE EXCEPTION 'sns_youtube_quota_reads の method・units の CHECK が2本ではない（%本）。適用を止める', n;
  END IF;
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.sns_youtube_quota_reads'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%method%' OR pg_get_constraintdef(oid) LIKE '%units%')
  LOOP
    EXECUTE format('ALTER TABLE public.sns_youtube_quota_reads DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- DEFAULT（'videos.list'・1）は残す（lookup の INSERT はこの2列を省く）
ALTER TABLE public.sns_youtube_quota_reads ADD CONSTRAINT sns_youtube_quota_reads_method_units
  CHECK ((method = 'videos.list' AND units = 1) OR (method = 'commentThreads.insert' AND units = 50));
CREATE UNIQUE INDEX sns_youtube_quota_reads_one_comment ON public.sns_youtube_quota_reads(job_id)
  WHERE method = 'commentThreads.insert';

-- 完全版のコメントの枠を台帳に入れる。成功したら呼んでよい。止める条件:
-- 全体の停止（sns_x_send_control.paused）・自動送信の item が stopped・YouTube 以外・公開前（posted 以外）・Shorts（parent_job_id あり、item の variant が main 以外）
-- ・台帳の未確認・日の上限。ロックの順は既存の関数と同じ（sns_x_send_control → jobs → quota_control）
CREATE OR REPLACE FUNCTION public.record_sns_youtube_comment(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.sns_x_send_control;
  j public.sns_x_send_jobs;
  q public.sns_youtube_quota_control;
  v_state TEXT;
  v_variant TEXT;
  v_day DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  general_total INTEGER;
BEGIN
  SELECT * INTO c FROM public.sns_x_send_control WHERE id = true FOR SHARE;
  IF c.paused IS NOT FALSE THEN RAISE EXCEPTION 'paused'; END IF;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id = p_job_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job が無い'; END IF;
  IF j.channel <> 'youtube' OR j.state <> 'posted' OR j.external_post_id IS NULL THEN RAISE EXCEPTION '公開済みの YouTube の job ではない'; END IF;
  IF j.parent_job_id IS NOT NULL THEN RAISE EXCEPTION '完全版の job ではない（Shorts）'; END IF;
  IF j.auto_item_id IS NOT NULL THEN
    SELECT state, variant INTO v_state, v_variant FROM public.sns_auto_send_items WHERE id = j.auto_item_id;
    IF v_state = 'stopped' THEN RAISE EXCEPTION 'auto_stopped'; END IF;
    IF v_variant IS DISTINCT FROM 'main' THEN RAISE EXCEPTION '完全版の job ではない（Shorts）'; END IF;
  END IF;
  SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id = true FOR UPDATE;
  IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
  SELECT coalesce(sum(general_reserved), 0) INTO general_total FROM public.sns_youtube_quota_attempts WHERE quota_day = v_day;
  general_total := general_total + (SELECT coalesce(sum(units), 0) FROM public.sns_youtube_quota_reads WHERE quota_day = v_day);
  IF general_total + q.external_general + 50 > q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
  INSERT INTO public.sns_youtube_quota_reads(job_id, attempt, quota_day, method, units)
    VALUES (j.id, j.attempts, v_day, 'commentThreads.insert', 50);
  RETURN jsonb_build_object('job_id', j.id, 'quota_day', v_day, 'units', 50);
END $$;
REVOKE ALL ON FUNCTION public.record_sns_youtube_comment(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sns_youtube_comment(UUID) TO service_role;

-- 事後の確認（読み取り）:
-- 1) 上の pg_constraint の SELECT が attempt>0 と sns_youtube_quota_reads_method_units の2本
-- 2) SELECT method, units, count(*) FROM public.sns_youtube_quota_reads GROUP BY 1,2;  → videos.list・1 だけ
-- 3) SELECT has_function_privilege('anon','public.record_sns_youtube_comment(uuid)','EXECUTE'), has_function_privilege('authenticated','public.record_sns_youtube_comment(uuid)','EXECUTE');  → false・false
-- 戻し方: DROP FUNCTION public.record_sns_youtube_comment(UUID); DROP INDEX public.sns_youtube_quota_reads_one_comment;
--   DELETE FROM public.sns_youtube_quota_reads WHERE method='commentThreads.insert';
--   ALTER TABLE public.sns_youtube_quota_reads DROP CONSTRAINT sns_youtube_quota_reads_method_units,
--     ADD CHECK (method='videos.list'), ADD CHECK (units=1);
