-- 196: X の投稿を消した記録（BOA-1279、オーナー 2026-11-04「架空の選手の投稿は削除」）
-- 消す口（api/admin/sns-hub/delete-x-post.js・scripts/sns/delete-x-post.js）が X で消した後に mark_sns_x_post_deleted を呼び、
-- sns_x_send_jobs に deleted_at・deleted_reason を入れ、その投稿の計測（sns_metric_jobs の x-api の pending）を
-- missing・last_error='post_deleted' で閉じる（以後、取り込みの cron が読まない）。
-- state は posted のまま変えない: 日の上限（attempt_dates と state IN (sending,reconcile,posted)）・同じレースの未送信の検査・
-- 返信の親（state='posted'）は posted を数える。X も消した投稿を作った回数に数える（消しても上限は戻らない）。
-- 列を2つと関数を1つ足すだけで、既存の関数・トリガーは変えない（列の UPDATE は state を変えないので
-- sns_metric_jobs_on_posted（AFTER UPDATE OF state）は発火しない）。
-- コードは 196 が無いと消す前に止まる（読んだ job に deleted_at が無ければ「196 が未適用」で X を呼ばない）。
-- 適用はオーナーの db-apply（時間帯の制約なし。ALTER TABLE の間 sns_x_send_jobs に ACCESS EXCLUSIVE のロックが一瞬。
-- 既定値の無い NULL の列なので書き直しは無い）。lock_timeout は10秒。
--
-- 適用前の確認（期待値 0 と NULL）:
--   SELECT (SELECT count(*) FROM information_schema.columns
--            WHERE table_schema = 'public' AND table_name = 'sns_x_send_jobs'
--              AND column_name IN ('deleted_at', 'deleted_reason')) AS deleted_columns,
--          to_regprocedure('public.mark_sns_x_post_deleted(uuid,text,text)') AS mark_fn;
--
-- 適用後の確認（期待値 2・false・false・true）:
--   SELECT (SELECT count(*) FROM information_schema.columns
--            WHERE table_schema = 'public' AND table_name = 'sns_x_send_jobs'
--              AND column_name IN ('deleted_at', 'deleted_reason')) AS deleted_columns,
--          has_function_privilege('anon', 'public.mark_sns_x_post_deleted(uuid,text,text)', 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', 'public.mark_sns_x_post_deleted(uuid,text,text)', 'EXECUTE') AS auth_exec,
--          has_function_privilege('service_role', 'public.mark_sns_x_post_deleted(uuid,text,text)', 'EXECUTE') AS service_exec;
--
-- 消した投稿の読み方:
--   SELECT id, external_post_id, posted_at, deleted_at, deleted_reason
--     FROM public.sns_x_send_jobs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;
--
-- 戻し方（閉じた計測の job は戻さない。消した投稿は X に戻らない）:
--   DROP FUNCTION public.mark_sns_x_post_deleted(uuid, text, text);
--   ALTER TABLE public.sns_x_send_jobs DROP COLUMN deleted_reason, DROP COLUMN deleted_at;
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.sns_x_send_jobs
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_reason text,
  ADD CONSTRAINT sns_x_send_jobs_deleted_pair
    CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL)),
  ADD CONSTRAINT sns_x_send_jobs_deleted_reason_len
    CHECK (deleted_reason IS NULL OR char_length(deleted_reason) BETWEEN 1 AND 200),
  ADD CONSTRAINT sns_x_send_jobs_deleted_posted
    CHECK (deleted_at IS NULL OR (state = 'posted' AND channel = 'x'));

-- 消した記録を付ける（何度呼んでも同じ。2回目以降は最初の時刻・理由のまま、計測の pending が残っていれば閉じる）
CREATE FUNCTION public.mark_sns_x_post_deleted(p_job_id uuid, p_tweet_id text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  j public.sns_x_send_jobs;
  v_closed integer;
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 200 OR p_reason ~ '[\r\n]' THEN
    RAISE EXCEPTION 'delete_reason_invalid';
  END IF;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'delete_job_not_found'; END IF;
  IF j.channel <> 'x' OR j.state <> 'posted' OR j.external_post_id IS DISTINCT FROM p_tweet_id THEN
    RAISE EXCEPTION 'delete_job_mismatch';
  END IF;
  IF j.deleted_at IS NULL THEN
    UPDATE public.sns_x_send_jobs
       SET deleted_at = now(), deleted_reason = btrim(p_reason), updated_at = now()
     WHERE id = j.id
     RETURNING * INTO j;
  END IF;
  UPDATE public.sns_metric_jobs
     SET state = 'missing', last_error = 'post_deleted', done_at = now()
   WHERE draft_id = j.draft_id AND source = 'x-api' AND state = 'pending';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RETURN jsonb_build_object(
    'job_id', j.id, 'tweet_id', j.external_post_id, 'deleted_at', j.deleted_at,
    'deleted_reason', j.deleted_reason, 'metric_jobs_closed', v_closed);
END $$;

REVOKE ALL ON FUNCTION public.mark_sns_x_post_deleted(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sns_x_post_deleted(uuid, text, text) TO service_role;

COMMIT;
