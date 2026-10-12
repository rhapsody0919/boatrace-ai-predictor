-- 148: 投稿済みSNS下書きの承認対象編集を拒否し承認記録を保護（依頼11）
--
-- ⚠️ この案は「本番へ未適用」。適用は db-apply ワークフロー（docs/operation/db-apply.md）で行う。
--
-- 背景:
--   X・YouTubeの下書きが一度でも投稿された（draft.posted_atが非NULL、またはjob.stateが'posted'）後は、
--   本文・タグ・媒体・risk_flags等の承認対象項目の編集を拒否し、承認者・承認日時・承認hashと送信済みjobを
--   保持する（アーカイブ後も保護対象。手動投稿などjobの無いposted下書きも対象）。140で新設した
--   guard_sns_x_approvalトリガー関数（送信中・要照合時の編集拒否、承認hash/承認者のリセット、
--   未送信jobの取消）はそのまま維持し、今回の投稿済みチェックを追加する。
--
-- 変更:
--   public.guard_sns_x_approval() をCREATE OR REPLACEで置換する。トリガー本体（140で
--   `BEFORE UPDATE ON public.sns_drafts`に設定済み）・権限（REVOKE ALL FROM PUBLIC,anon,authenticated、
--   GRANT EXECUTE TO service_role）は140から変更しない。新規テーブル・新規トリガー・新規列は無い。
--
-- 再実行可能性: CREATE OR REPLACE FUNCTIONのみで、CREATE TRIGGERは無い（140のトリガーが
--   そのまま新しい関数定義を使う）。db-apply で同じファイルを再実行しても失敗しない。
--
-- 前提: 140（guard_sns_x_approval・sns_x_send_jobsを新設）。135/137/139も間接的に必要（jobの列を参照）。
--
-- 適用後の確認（読み取りのみ。SQL Editor または Supabase MCPの読み取りで実行する）:
--   SELECT pg_get_functiondef('public.guard_sns_x_approval()'::regprocedure) LIKE '%posted_at IS NOT NULL%' AS has_posted_at_check;
--   → true
--
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid='public.sns_drafts'::regclass AND tgfoid='public.guard_sns_x_approval()'::regprocedure;
--   → 140で設定済みのトリガー行（tgenabled='O'）
--
--   SELECT has_function_privilege('anon','public.guard_sns_x_approval()','EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated','public.guard_sns_x_approval()','EXECUTE') AS auth_exec;
--   → 両方 false
--
-- 検証: scripts/maintenance/verify-sns-approval-posted.js（PGlite、外部接続なし、X/YouTube両platform）

BEGIN;
CREATE OR REPLACE FUNCTION public.guard_sns_x_approval() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE j public.sns_x_send_jobs; changed BOOLEAN;
BEGIN
  IF OLD.platform NOT IN ('x','youtube') THEN RETURN NEW; END IF;
  changed := ROW(NEW.title, NEW.caption_text, NEW.hashtags, NEW.video_storage_path, NEW.cover_image_path,
    NEW.platform, NEW.language, NEW.source_data, NEW.publish_blocked, NEW.publication_hold_reasons, NEW.risk_flags)
    IS DISTINCT FROM ROW(OLD.title, OLD.caption_text, OLD.hashtags, OLD.video_storage_path, OLD.cover_image_path,
    OLD.platform, OLD.language, OLD.source_data, OLD.publish_blocked, OLD.publication_hold_reasons, OLD.risk_flags);
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE draft_id=OLD.id;
  IF changed AND (OLD.posted_at IS NOT NULL OR j.state='posted') THEN
    RAISE EXCEPTION '投稿済みの下書きは本文・媒体・承認対象を変更できません';
  END IF;
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
      WHERE draft_id=OLD.id AND state IN ('queued','held');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_sns_x_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_sns_x_approval() TO service_role;
COMMIT;
