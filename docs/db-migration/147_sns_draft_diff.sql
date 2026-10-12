-- 147: SNS下書きの直前版・承認版との差分補助情報（依頼15・15b）
--
-- ⚠️ この案は「本番へ未適用」。適用は db-apply ワークフロー（docs/operation/db-apply.md）で行う。
--
-- 背景:
--   SnsHubAdmin・スマホ承認画面のどちらでも、下書きを開いたときに「直前の表示内容」「承認済みの版」との
--   差分（削除「−」取り消し線・追加「＋」下線、媒体差し替えはSHA256 hashの前後比較）を見られるようにする。
--   新しい版ID・採番・版テーブルは作らない。既存の parent_draft_id（版の親子関係）と
--   sns_mobile_revision（表示中の版の識別）にそのまま乗せる。140（スマホ個別承認）が前提。
--
-- 列（sns_drafts に追加、3列とも読み書きは service_role のみ）:
--   diff_current   直前にクライアントへ返した表示内容のスナップショット（content・media・revision・draft_id）。
--                   save_sns_draft_diff() が画面からの表示直後に書き込む。
--   diff_previous  diff_current が上書きされる直前の値（1つ前の表示内容）。差分表示の「直前版」側。
--   diff_approved  承認（approved_at が NULL→非NULL に変わった瞬間）時点の内容・媒体hash。
--                   guard_sns_diff_approval トリガーが sns_drafts の UPDATE ごとに自動で設定する。
--                   承認版hashは、承認直前に再照合された送信snapshot（sns_x_send_jobs.snapshot、
--                   approved_hash/approved_at が一致する行）から取る。表示時点の古いhashは流用しない。
--
-- トリガーの安全性（#1363 のアプリコードのマージ前に、このSQLだけ先に適用されても壊れない理由）:
--   guard_sns_diff_approval は BEFORE UPDATE トリガーで、diff_approved という「新規列への書き込み」
--   だけを行う。既存のどのSELECT文もdiff_approved列を参照していない（#1363のコードがマージされるまでは
--   読み手がいない）ため、先に適用しても既存の承認フロー（approve_sns_x_send・approve_sns_mobile_channel
--   等）の挙動・応答を変えない。関数本体はRAISE EXCEPTIONを一切持たず、対象のsns_x_send_jobsの行が
--   0件でもNULLを代入するだけで終わる（例外もロールバックも起きない）。そのため適用順序は
--   「SQL147を先に適用→#1363をマージ」でも「#1363をマージ→SQL147を適用」でも安全に成立する。
--
-- 権限: 4関数とも REVOKE ALL FROM PUBLIC,anon,authenticated。GRANT EXECUTE は service_role のみ。
--   既存テーブルへの列追加のみで、新規テーブル・新規RLSポリシーは無い（既存のsns_draftsのRLSをそのまま使う）。
--
-- 再実行可能性: ALTER TABLE は IF NOT EXISTS、CREATE FUNCTION は OR REPLACE、
--   CREATE TRIGGER は DROP TRIGGER IF EXISTS と対にしており、db-apply で同じファイルを再実行しても失敗しない。
--
-- 適用後の確認（読み取りのみ。SQL Editor または Supabase MCPの読み取りで実行する）:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='sns_drafts'
--      AND column_name IN ('diff_current','diff_previous','diff_approved');
--   → 3行（diff_current, diff_previous, diff_approved）
--
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='public.sns_drafts'::regclass AND tgname='sns_diff_approval';
--   → sns_diff_approval の1行
--
--   SELECT has_function_privilege('anon','public.read_sns_draft_diff(uuid)','EXECUTE') AS anon_read,
--          has_function_privilege('authenticated','public.read_sns_draft_diff(uuid)','EXECUTE') AS auth_read,
--          has_function_privilege('anon','public.save_sns_draft_diff(uuid,text,jsonb)','EXECUTE') AS anon_save,
--          has_function_privilege('authenticated','public.save_sns_draft_diff(uuid,text,jsonb)','EXECUTE') AS auth_save;
--   → 4列すべて false
--
-- 検証: scripts/maintenance/snsDraftDiff.js（verify-sns-bundle-import.js から読み込み、PGlite・外部接続なし）
--   140（sns_mobile_revision・sns_x_send_jobs.snapshot/approved_hash/approved_at）が前提。

BEGIN;

ALTER TABLE public.sns_drafts ADD COLUMN IF NOT EXISTS diff_current JSONB;
ALTER TABLE public.sns_drafts ADD COLUMN IF NOT EXISTS diff_previous JSONB;
ALTER TABLE public.sns_drafts ADD COLUMN IF NOT EXISTS diff_approved JSONB;

CREATE OR REPLACE FUNCTION public.sns_diff_content(d public.sns_drafts) RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_build_object('title',d.title,'caption_text',d.caption_text,'hashtags',d.hashtags,
 'source_data',coalesce(d.source_data,'{}'::jsonb)-'dataCardUrl',
 'video_storage_path',d.video_storage_path,'cover_image_path',d.cover_image_path);
$$;

CREATE OR REPLACE FUNCTION public.guard_sns_diff_approval() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE approved_snapshot JSONB; approved_media JSONB;
BEGIN
 IF NEW.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
  -- 承認時に再照合された送信snapshotのhashだけを使う。表示時の古いhashは流用しない。
  SELECT snapshot INTO approved_snapshot FROM sns_x_send_jobs WHERE draft_id=NEW.id
   AND approved_hash=NEW.x_approved_hash AND approved_at=NEW.approved_at;
  IF approved_snapshot IS NOT NULL THEN
   SELECT coalesce(jsonb_object_agg(paths.kind,jsonb_build_object('path',paths.path,'sha256',m->>'sha256')),'{}'::jsonb)
   INTO approved_media FROM (VALUES ('video',NEW.video_storage_path),('cover',NEW.cover_image_path),
    ('dataCard',NEW.source_data->>'dataCardPath')) paths(kind,path)
   JOIN LATERAL jsonb_array_elements(approved_snapshot->'media') m ON m->>'path'=paths.path;
  END IF;
  NEW.diff_approved:=jsonb_build_object('content',sns_diff_content(NEW),'media',approved_media,
   'draft_id',NEW.id,'approved_at',NEW.approved_at);
 END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sns_diff_approval ON public.sns_drafts;
CREATE TRIGGER sns_diff_approval BEFORE UPDATE ON public.sns_drafts
FOR EACH ROW EXECUTE FUNCTION public.guard_sns_diff_approval();

CREATE OR REPLACE FUNCTION public.read_sns_draft_diff(p_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE d public.sns_drafts; previous JSONB; approved JSONB; ancestor public.sns_drafts;
 visited UUID[]:=ARRAY[p_id]; cursor_id UUID; depth INTEGER:=0;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_id;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 previous:=d.diff_previous; approved:=d.diff_approved; cursor_id:=d.parent_draft_id;
 WHILE cursor_id IS NOT NULL LOOP
  IF cursor_id=ANY(visited) OR depth>=100 THEN RAISE EXCEPTION '版の履歴を確認できません'; END IF;
  visited:=array_append(visited,cursor_id); depth:=depth+1;
  SELECT * INTO ancestor FROM sns_drafts WHERE id=cursor_id;
  IF ancestor.id IS NULL OR ancestor.platform IS DISTINCT FROM d.platform OR ancestor.language IS DISTINCT FROM d.language
   OR ancestor.content_group_id IS DISTINCT FROM d.content_group_id THEN RAISE EXCEPTION '版の系統が一致しません'; END IF;
  IF previous IS NULL AND depth=1 THEN
   previous:=CASE WHEN ancestor.diff_current->'content'=sns_diff_content(ancestor) THEN ancestor.diff_current
    ELSE jsonb_build_object('content',sns_diff_content(ancestor),'media',NULL) END;
   previous:=previous || jsonb_build_object('origin','parent_draft_id','draft_id',ancestor.id);
  END IF;
  IF approved IS NULL THEN approved:=ancestor.diff_approved; END IF;
  cursor_id:=ancestor.parent_draft_id;
 END LOOP;
 RETURN jsonb_build_object('draft',to_jsonb(d)-'diff_current'-'diff_previous'-'diff_approved',
 'revision',sns_mobile_revision(d),'current',d.diff_current,'previous',previous,'approved',approved);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_sns_draft_diff(p_id UUID,p_revision TEXT,p_snapshot JSONB) RETURNS JSONB
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE d public.sns_drafts; previous JSONB;
BEGIN
 SELECT * INTO d FROM sns_drafts WHERE id=p_id FOR UPDATE;
 IF d.id IS NULL OR sns_mobile_revision(d) IS DISTINCT FROM p_revision OR p_snapshot->'content' IS DISTINCT FROM sns_diff_content(d)
  OR jsonb_typeof(p_snapshot->'media') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '表示した版が変わりました'; END IF;
 previous:=d.diff_previous;
 IF d.diff_current IS NOT NULL AND (d.diff_current->'content' IS DISTINCT FROM p_snapshot->'content'
  OR d.diff_current->'media' IS DISTINCT FROM p_snapshot->'media') THEN
  previous:=d.diff_current || jsonb_build_object('origin','last_displayed','draft_id',d.id);
 END IF;
 UPDATE sns_drafts SET diff_current=p_snapshot || jsonb_build_object('revision',p_revision,'draft_id',p_id),diff_previous=previous WHERE id=p_id;
 RETURN read_sns_draft_diff(p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sns_diff_content(public.sns_drafts) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_sns_diff_approval() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_sns_draft_diff(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_sns_draft_diff(UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sns_diff_content(public.sns_drafts) TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_sns_diff_approval() TO service_role;
GRANT EXECUTE ON FUNCTION public.read_sns_draft_diff(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_sns_draft_diff(UUID,TEXT,JSONB) TO service_role;

COMMIT;
