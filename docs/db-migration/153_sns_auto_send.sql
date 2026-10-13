-- 153: SNS の自動送信（送信モード・事前通知・止める操作・v1 素材の公開保留の解除）
-- 設計: docs/design/sns-pdca-loop/plan.md §1〜§4、ADR 0090・0092・0094
-- 前提: 135・137・139・140・146・147・148（いずれも本番適用済み）。適用はオーナーのみ。手順は 153-runbook.md。
-- 置き換える関数の土台は本番の定義（2026-10-13 に pg_get_functiondef の md5 がリポジトリの 135・139・146・148 と
-- 一致することを確認）。置き換える前の定義（戻し方）は 153-runbook.md に保存した。
-- 検証: scripts/maintenance/verify-sns-auto-send.js（PGlite、外部接続なし）
BEGIN;

-- チャネルごとの送信モード。初期は個別承認・試運転。
CREATE TABLE public.sns_auto_send_control (
  channel TEXT PRIMARY KEY CHECK (channel IN ('x', 'youtube')),
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  dry_run BOOLEAN NOT NULL DEFAULT true,  -- true のあいだはそのチャネルの claim を拒否する（承認・job の作成までは進む）
  live_started_on DATE,             -- 実送信の初日（JST）。L2 の「7日」の起点
  stop_tested_at TIMESTAMPTZ,       -- 止める操作を本番で試した日時（L3 の条件）
  switched_at TIMESTAMPTZ,
  switched_by UUID REFERENCES public.sns_approvers(id),
  auto_approver_id UUID REFERENCES public.sns_approvers(id),  -- 自動送信の承認者（分岐は表示名ではなくこの ID で行う）
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.sns_auto_send_control(channel) VALUES ('x'), ('youtube');

-- 1レース×1チャネルの自動送信の単位（X はスレッド全体で1件）。
CREATE TABLE public.sns_auto_send_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_import_id UUID NOT NULL REFERENCES public.sns_bundle_imports(id),
  channel TEXT NOT NULL CHECK (channel IN ('x', 'youtube')),
  race_id TEXT NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,         -- 公式締切（bundle の値ではなく races から計算）
  notify_by TIMESTAMPTZ NOT NULL,           -- 締切の3時間前
  veto_until TIMESTAMPTZ NOT NULL,          -- 締切の60分前（止められる期限＝送る時刻）
  state TEXT NOT NULL DEFAULT 'checking'
    CHECK (state IN ('checking', 'held_manual', 'manual', 'notifying', 'notified', 'stopped', 'sent')),
  checks JSONB NOT NULL DEFAULT '{}'::jsonb, -- {passed, risk, claims, display, mobile_gate, new_format, dry_run, checked_at}
  held_reason TEXT,
  notified_at TIMESTAMPTZ,
  stop_token_hash TEXT UNIQUE,              -- 止めるリンクの token の SHA-256（hex）
  stopped_at TIMESTAMPTZ,
  stopped_via TEXT CHECK (stopped_via IN ('link', 'admin', 'mode_off', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bundle_import_id, channel),
  CHECK (notify_by < veto_until AND veto_until < deadline_at),
  -- 検査を通っていない item は、下書きの公開保留を外せる状態にならない（下の sns_bundle_send_allowed）
  CHECK (state NOT IN ('manual', 'notifying', 'notified', 'sent') OR checks->'passed' IS NOT DISTINCT FROM 'true'::jsonb),  -- NULL で CHECK が素通りしないよう IS NOT DISTINCT FROM
  CHECK (state NOT IN ('notifying', 'notified') OR stop_token_hash IS NOT NULL),
  CHECK (state <> 'notified' OR notified_at IS NOT NULL),
  CHECK (state <> 'stopped' OR (stopped_at IS NOT NULL AND stopped_via IS NOT NULL))
);
CREATE INDEX sns_auto_send_items_veto ON public.sns_auto_send_items (veto_until) WHERE state = 'notified';
-- 同じレース・同じチャネルの item は1つ（直した素材を入れ直したときは前の item を stopped（superseded）にしてから作る）
CREATE UNIQUE INDEX sns_auto_send_items_race_channel ON public.sns_auto_send_items (race_id, channel)
  WHERE state NOT IN ('stopped', 'held_manual');

-- 誤投稿の記録（L3 の条件・L2 へ戻す条件）。オーナーが管理画面から記録する。
CREATE TABLE public.sns_auto_send_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES public.sns_auto_send_items(id),
  channel TEXT NOT NULL CHECK (channel IN ('x', 'youtube')),
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 予約額を種類別に、日次上限をチャネル別にする（design-reviewer の P0・P1）。
-- 未設定（NULL）なら従来の attempt_ceiling_microusd・daily_limit を使う。
ALTER TABLE public.sns_x_send_control
  ADD COLUMN ceiling_x_url_microusd BIGINT CHECK (ceiling_x_url_microusd > 0),     -- スレッドの親（URL を含む）の1回の上限額
  ADD COLUMN ceiling_x_plain_microusd BIGINT CHECK (ceiling_x_plain_microusd > 0), -- スレッドの子の1回の上限額
  ADD COLUMN daily_limit_x INTEGER CHECK (daily_limit_x > 0),                       -- X の1日の投稿の数（スレッドの各投稿を数える）
  ADD COLUMN daily_limit_youtube INTEGER CHECK (daily_limit_youtube > 0);
-- L3 では優勝戦・準優勝戦をすべて自動で出す（2026-10-13 オーナー決定）。直近30日で月269レース、1レースの X は親＋子5＋取り込みで
-- 最大 約$0.29（予約の上限額では約$0.41）になり、137 の月の上限 $10 では足りない。CHECK の上限を $200 に広げる（実際の額はオーナーが本番 SQL で決める。既定は $10 のまま）
ALTER TABLE public.sns_x_send_control DROP CONSTRAINT sns_x_send_control_budget_microusd_check; -- 名前は本番の pg_constraint で確認済み
ALTER TABLE public.sns_x_send_control ADD CONSTRAINT sns_x_send_control_budget_microusd_check
  CHECK (budget_microusd BETWEEN 1 AND 200000000);

-- job と item の結びつき（item は下書きの配列を持たず、job 側から FK で指す）。
ALTER TABLE public.sns_x_send_jobs ADD COLUMN auto_item_id UUID REFERENCES public.sns_auto_send_items(id);
CREATE INDEX sns_x_send_jobs_auto_item ON public.sns_x_send_jobs (auto_item_id) WHERE auto_item_id IS NOT NULL;

-- X スレッド: 1バンドルに X の下書きを複数作れるよう、スレッドの順番を一意索引に含める。
ALTER TABLE public.sns_drafts ADD COLUMN thread_index SMALLINT NOT NULL DEFAULT 0 CHECK (thread_index BETWEEN 0 AND 5);
DROP INDEX public.sns_drafts_bundle_version_channel_language;
CREATE UNIQUE INDEX sns_drafts_bundle_version_channel_language
  ON public.sns_drafts (bundle_version_hash, platform, language, thread_index)
  WHERE bundle_version_hash IS NOT NULL;

-- v1 を受け付ける（v0 の公開保留は関数側で今のまま）。
ALTER TABLE public.sns_bundle_imports DROP CONSTRAINT sns_bundle_imports_schema_version_check; -- 名前は本番の pg_constraint で確認済み
ALTER TABLE public.sns_bundle_imports ADD CONSTRAINT sns_bundle_imports_schema_version_check
  CHECK (schema_version IN ('ryujin-preview/0', 'ryujin-preview/1'));

-- 自動送信の承認者（既存の「自動承認（品質チェック合格）」とは別に、履歴で区別する）。管理画面の選択肢に出さない。
INSERT INTO public.sns_approvers (display_name, active) VALUES ('自動送信（止められなかった）', false)
  ON CONFLICT (display_name) DO NOTHING;
UPDATE public.sns_auto_send_control SET auto_approver_id =
  (SELECT id FROM public.sns_approvers WHERE display_name = '自動送信（止められなかった）');

-- bundle 由来の下書きを送ってよいか。bundle 由来でなければ true。v0 は常に false。
-- v1 は同じ bundle・同じチャネルの item が検査を通った状態（manual・notifying・notified・sent）のときだけ true。
CREATE FUNCTION public.sns_bundle_send_allowed(d public.sns_drafts) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT d.bundle_import_id IS NULL OR EXISTS (
    SELECT 1 FROM public.sns_bundle_imports b
    JOIN public.sns_auto_send_items i ON i.bundle_import_id = b.id AND i.channel = d.platform
    WHERE b.id = d.bundle_import_id AND b.schema_version = 'ryujin-preview/1'
      AND i.state IN ('manual', 'notifying', 'notified', 'sent'));
$$;

-- 置き換え1（135）: v1 を受け付け、x_thread の本数分の X 下書きを thread_index つきで作る。v0 は今のまま。
-- v1 の x_thread: [{index, text, media?}]（index は 0 から連番、最大6件）。media は source_manifest の name。
-- 取り込み時は v0 と同じく公開保留（publish_blocked=true）。保留を外すのは検査を通した後の送信の側（sns-auto-plan）。
CREATE OR REPLACE FUNCTION public.import_sns_preview_bundle(
  p_version_hash TEXT, p_schema_version TEXT, p_bundle JSONB, p_qa JSONB,
  p_manifest JSONB, p_missing JSONB, p_hold_reasons JSONB, p_risk_flags JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  group_id UUID;
  draft_id UUID;
  created BOOLEAN;
  results JSONB := '[]'::jsonb;
  video_path TEXT;
  cover_path TEXT;
  entries JSONB;
  entry JSONB;
  idx INTEGER;
  media_name TEXT;
  media_path TEXT;
BEGIN
  IF p_schema_version NOT IN ('ryujin-preview/0', 'ryujin-preview/1') OR p_bundle->>'schema_version' IS DISTINCT FROM p_schema_version THEN
    RAISE EXCEPTION '未対応のschema_versionです';
  END IF;
  SELECT entry_->>'storage_path' INTO video_path FROM jsonb_array_elements(p_manifest) entry_ WHERE entry_->>'name' = 'draft.mp4';
  SELECT entry_->>'storage_path' INTO cover_path FROM jsonb_array_elements(p_manifest) entry_ WHERE entry_->>'name' = 'scene-1.png';
  -- 1下書き = 1件の entry。v0 は X・YouTube の2件、v1 は X スレッドの本数＋YouTube の1件。
  IF p_schema_version = 'ryujin-preview/0' THEN
    entries := jsonb_build_array(
      jsonb_build_object('platform', 'x', 'thread_index', 0, 'caption', p_bundle->>'x_text',
        'video', video_path, 'cover', cover_path, 'risk', COALESCE(p_risk_flags->'x', '[]'::jsonb)),
      jsonb_build_object('platform', 'youtube', 'thread_index', 0, 'caption', p_bundle->>'script',
        'video', video_path, 'cover', cover_path, 'risk', COALESCE(p_risk_flags->'youtube', '[]'::jsonb)));
  ELSE
    IF jsonb_typeof(p_bundle->'x_thread') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'x_thread') NOT BETWEEN 1 AND 6
      OR coalesce(p_bundle->>'race_id', '') = '' THEN
      RAISE EXCEPTION 'v1のx_thread・race_idが不正です';
    END IF;
    entries := '[]'::jsonb;
    FOR idx IN 0 .. jsonb_array_length(p_bundle->'x_thread') - 1 LOOP
      entry := p_bundle->'x_thread'->idx;
      IF (entry->>'index')::integer IS DISTINCT FROM idx OR coalesce(trim(entry->>'text'), '') = '' THEN
        RAISE EXCEPTION 'x_threadのindexは0からの連番で、本文が必要です';
      END IF;
      media_name := entry->>'media';
      media_path := NULL;
      IF media_name IS NOT NULL THEN
        SELECT m->>'storage_path' INTO media_path FROM jsonb_array_elements(p_manifest) m WHERE m->>'name' = media_name;
        IF media_path IS NULL THEN RAISE EXCEPTION 'x_threadの媒体がsource_manifestにありません'; END IF;
      END IF;
      entries := entries || jsonb_build_array(jsonb_build_object('platform', 'x', 'thread_index', idx,
        'caption', entry->>'text',
        'video', CASE WHEN media_name ~* '\.mp4$' THEN media_path END,
        'cover', CASE WHEN media_name !~* '\.mp4$' THEN media_path END,
        'risk', COALESCE(p_risk_flags->'x_thread'->idx, p_risk_flags->'x', '[]'::jsonb)));
    END LOOP;
    entries := entries || jsonb_build_array(jsonb_build_object('platform', 'youtube', 'thread_index', 0,
      'caption', p_bundle->>'script', 'video', video_path, 'cover', cover_path,
      'risk', COALESCE(p_risk_flags->'youtube', '[]'::jsonb)));
  END IF;
  INSERT INTO public.sns_bundle_imports(version_hash, schema_version, bundle,
    source_manifest, qa, release_evidence, missing_files, hold_reasons)
  VALUES (p_version_hash, p_schema_version, p_bundle, p_manifest, p_qa,
    jsonb_build_object('release_status', NULL, 'release_notice', NULL,
      'snapshot_at', NULL, 'ui_version', NULL, 'destination_url', NULL,
      'missing_reason', CASE WHEN p_schema_version = 'ryujin-preview/0'
        THEN 'v0では正式公開情報が未提供・確認条件が未確定'
        ELSE 'v1は送信前の検査（リンク先の表示）で下書きごとに確認する' END),
    p_missing, p_hold_reasons)
  ON CONFLICT (version_hash) DO NOTHING;
  SELECT id INTO group_id FROM public.sns_bundle_imports WHERE version_hash = p_version_hash FOR UPDATE;
  FOR entry IN SELECT value FROM jsonb_array_elements(entries) LOOP
    draft_id := NULL;
    INSERT INTO public.sns_drafts(content_group_id, bundle_import_id, bundle_version_hash,
      format, template_variant_id, language, platform, thread_index, status, title, caption_text,
      video_storage_path, cover_image_path, source_data, publish_blocked, publication_hold_reasons, risk_flags)
    VALUES (group_id, group_id, p_version_hash, p_bundle->>'format', NULL, 'ja', entry->>'platform',
      (entry->>'thread_index')::smallint, 'pending_review', p_bundle->>'title', entry->>'caption',
      entry->>'video', entry->>'cover',
      jsonb_build_object('bundle_origin', 'local-preview', 'schema_version', p_schema_version,
        'race_id', p_bundle->>'race_id', 'stage', p_bundle->>'stage',
        'local_template_variant_id', p_bundle->>'template_variant_id',
        'bundle', p_bundle, 'source_manifest', p_manifest, 'qa', p_qa)
        || CASE WHEN p_schema_version = 'ryujin-preview/1'
             THEN jsonb_build_object('thread_index', (entry->>'thread_index')::integer, 'screen_key', p_bundle->>'screen_key')
             ELSE '{}'::jsonb END,
      true, p_hold_reasons, entry->'risk')
    ON CONFLICT (bundle_version_hash, platform, language, thread_index) WHERE bundle_version_hash IS NOT NULL DO NOTHING
    RETURNING id INTO draft_id;
    created := draft_id IS NOT NULL;
    IF NOT created THEN
      SELECT id INTO draft_id FROM public.sns_drafts WHERE bundle_version_hash = p_version_hash
        AND platform = entry->>'platform' AND language = 'ja' AND thread_index = (entry->>'thread_index')::smallint;
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('id', draft_id, 'platform', entry->>'platform',
      'thread_index', (entry->>'thread_index')::integer,
      'result', CASE WHEN created THEN 'created' ELSE 'duplicate' END));
  END LOOP;
  RETURN jsonb_build_object('content_group_id', group_id, 'version_hash', p_version_hash,
    'drafts', results, 'publish_blocked', true, 'hold_reasons', p_hold_reasons);
END;
$$;

-- 置き換え2（135）: v1 は sns_bundle_send_allowed が true のときだけ公開保留を外し・承認・投稿に進める。
-- 送信が始まった・投稿済みの下書き（止めた後に照合が完了する場合を含む）は、item の状態によらず通す。v0 は今のまま。
CREATE OR REPLACE FUNCTION public.guard_sns_preview_bundle_draft()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  imported public.sns_bundle_imports%ROWTYPE;
  parent public.sns_drafts%ROWTYPE;
BEGIN
  -- 修正パイプラインがparentを設定する場合も公開不可を引き継ぐ。
  IF NEW.parent_draft_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.sns_drafts WHERE id = NEW.parent_draft_id;
    IF parent.bundle_import_id IS NOT NULL THEN
      NEW.bundle_import_id := parent.bundle_import_id;
      NEW.bundle_version_hash := parent.bundle_version_hash;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.bundle_import_id IS NOT NULL THEN
    IF NEW.bundle_import_id IS DISTINCT FROM OLD.bundle_import_id OR
       NEW.bundle_version_hash IS DISTINCT FROM OLD.bundle_version_hash OR
       NEW.thread_index IS DISTINCT FROM OLD.thread_index THEN
      RAISE EXCEPTION 'v0の素材由来は変更できません';
    END IF;
  END IF;
  IF NEW.bundle_import_id IS NOT NULL THEN
    SELECT * INTO imported FROM public.sns_bundle_imports WHERE id = NEW.bundle_import_id;
    IF NOT FOUND OR NEW.bundle_version_hash IS DISTINCT FROM imported.version_hash OR
       NEW.content_group_id IS DISTINCT FROM imported.id THEN
      RAISE EXCEPTION 'bundleの版・groupの対応が不正です';
    END IF;
    IF NOT NEW.publish_blocked OR NEW.status IN ('approved', 'ready_to_post', 'posted') THEN
      IF imported.schema_version <> 'ryujin-preview/1' THEN
        RAISE EXCEPTION 'v0素材は公開不可です';
      END IF;
      IF NOT public.sns_bundle_send_allowed(NEW) AND NOT (TG_OP = 'UPDATE' AND (
           OLD.posted_at IS NOT NULL OR OLD.status = 'posted' OR
           EXISTS (SELECT 1 FROM public.sns_x_send_jobs WHERE draft_id = OLD.id AND state IN ('sending', 'reconcile', 'posted')))) THEN
        RAISE EXCEPTION 'v1素材は検査の合格前・止めた後は公開できません';
      END IF;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.sns_bundle_imports WHERE id = NEW.content_group_id) THEN
    RAISE EXCEPTION 'bundle由来のgroupにはbundle_import_idが必要です';
  ELSIF NEW.bundle_version_hash IS NOT NULL THEN
    RAISE EXCEPTION 'bundle_import_idが必要です';
  END IF;
  RETURN NEW;
END;
$$;

-- 置き換え3（146）: 承認。
--  - bundle 由来は sns_bundle_send_allowed が true のときだけ（v0 は今のまま拒否）
--  - 承認者が自動送信の承認者（control.auto_approver_id）なら、チャネルの mode='auto' かつ item.state='notified' のときだけ通す。
--    それ以外は今までどおり「本人」だけ。dry_run はここでは見ない（試運転でも job までは作り、claim で止める）
--  - v1 の job には auto_item_id を入れる（止める操作・許可のリストの対象にするため）
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

-- 置き換え4（139、146 で transition_sns_send_139 に改名済み）:
--  - bundle 由来の拒否を sns_bundle_send_allowed に替える
--  - 予約額を種類別に: YouTube は0、X はスレッドの親（thread_index=0）が ceiling_x_url、子が ceiling_x_plain（未設定なら attempt_ceiling）
--  - 日次上限をチャネル別に: daily_limit_x・daily_limit_youtube（未設定なら daily_limit）
--  - スレッドの親の claim は、スレッド全体の本数と費用が今日の枠・月の残りに収まるときだけ通す（途中で切れないため）
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

-- 置き換え5（146）: 送信の入口。SECURITY DEFINER を維持する。146 からの変更:
--  - 許可のリスト: auto_item_id がある job（または自動送信の承認者の job）は、claim・check・begin_post・youtube_call・
--    youtube_publish_begin のたびに、item が止められていないこと、自動送信の承認者の job なら item.state='notified' かつ
--    チャネルの mode='auto' を確かめる。外れていたら queued・sending は held（auto_stopped）、reconcile（外部呼び出しの途中）は RAISE
--    （YouTube でアップロード済みなら呼び出し側が youtube_retain で非公開のまま残す）
--  - claim は、そのチャネルの dry_run=true なら拒否（job は queued のまま。X の予約・日次の枠・YouTube のクォータを消費しない）
--  - 自動送信の承認者の job の claim は now() >= veto_until を待つ（X・YouTube とも。2026-10-13 ユーザー決定）
--  - youtube_call_guard の bundle 由来の拒否と日次上限を、transition_sns_send_139 と同じ扱いにする
--  - complete で、item の下書きが全部 posted になったら item を sent にする
CREATE OR REPLACE FUNCTION public.transition_sns_x_send(p_job_id UUID,p_action TEXT,p_result JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.sns_drafts; c public.sns_x_send_control; j public.sns_x_send_jobs;
 q public.sns_youtube_quota_control; a public.sns_youtube_quota_attempts;
 r JSONB; v_day DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
 upload_total BIGINT; general_total BIGINT; day_count INTEGER; method TEXT;
 ac public.sns_auto_send_control; it public.sns_auto_send_items; v_auto BOOLEAN;
BEGIN
 SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
 SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
 SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
 SELECT * INTO ac FROM public.sns_auto_send_control WHERE channel=j.channel;
 IF j.auto_item_id IS NOT NULL THEN
   -- 止める操作（stop_sns_auto_item の FOR UPDATE）と直列にする。止めた後の外部呼び出しを許さない。
   SELECT * INTO it FROM public.sns_auto_send_items WHERE id=j.auto_item_id FOR SHARE;
 END IF;
 v_auto := ac.auto_approver_id IS NOT NULL AND j.approver_id = ac.auto_approver_id;
 IF p_action IN ('claim','check','begin_post','youtube_call','youtube_publish_begin') AND (j.auto_item_id IS NOT NULL OR v_auto)
   AND (it.id IS NULL OR it.state='stopped' OR (v_auto AND (it.state IS DISTINCT FROM 'notified' OR ac.mode IS DISTINCT FROM 'auto'))) THEN
   IF j.state IN ('queued','sending') THEN
     UPDATE public.sns_x_send_jobs SET state='held',error_code='auto_stopped',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     -- 止めた時点で sending だった job は stop_sns_auto_item が下書きを飛ばすので、ここで公開保留に戻す
     -- （148 のガードが承認を外し held の job を取り消す。理由は auto_stopped を残す）
     IF it.state='stopped' AND coalesce(d.external_operation_state,'done')='done' THEN
       UPDATE public.sns_drafts SET publish_blocked=true, publication_hold_reasons='["auto_stopped"]'::jsonb,
         status=CASE WHEN status IN ('approved','ready_to_post') THEN 'pending_review' ELSE status END
         WHERE id=d.id;
       UPDATE public.sns_x_send_jobs SET error_code='auto_stopped' WHERE id=j.id RETURNING * INTO j;
     END IF;
     RETURN to_jsonb(j);
   END IF;
   RAISE EXCEPTION 'auto_stopped';
 END IF;
 IF p_action='claim' AND ac.dry_run IS NOT FALSE THEN RAISE EXCEPTION 'dry_run'; END IF;
 IF p_action='claim' AND v_auto AND now()<it.veto_until THEN RAISE EXCEPTION 'veto_window_open'; END IF;
 IF j.channel='youtube' AND p_action='complete' AND (
   p_result->>'confirmed' IS DISTINCT FROM 'true' OR p_result->>'privacyStatus' IS DISTINCT FROM 'public'
   OR NOT (EXISTS (SELECT 1 FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts AND 'videos.list'=ANY(calls))
     OR EXISTS (SELECT 1 FROM public.sns_youtube_quota_reads WHERE job_id=j.id AND attempt=j.attempts))
 ) THEN RAISE EXCEPTION '公開結果の確認が必要です'; END IF;
 IF j.channel='youtube' AND p_action='youtube_retain' THEN
   IF j.state<>'reconcile' OR j.external_post_id IS NULL OR j.youtube_stage='update_started' THEN RAISE EXCEPTION '非公開残置を確定できません'; END IF;
   UPDATE public.sns_x_send_jobs SET youtube_stage='private_retained',error_code='youtube_private_retained',updated_at=now() WHERE id=j.id RETURNING * INTO j;
   RETURN to_jsonb(j);
 END IF;
 IF j.channel='youtube' AND p_action IN ('youtube_poll','youtube_ready') THEN
   IF j.state<>'reconcile' OR j.external_post_id IS NULL OR j.youtube_stage NOT IN ('uploaded','ready') OR j.youtube_stage IS NULL THEN RAISE EXCEPTION '処理確認対象ではありません'; END IF;
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   SELECT * INTO a FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts FOR UPDATE;
   IF p_action='youtube_ready' THEN
     IF a.processing_polls<1 THEN RAISE EXCEPTION '処理確認未記録です'; END IF;
     UPDATE public.sns_x_send_jobs SET youtube_stage='ready',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     RETURN to_jsonb(j);
   END IF;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR a.quota_day IS DISTINCT FROM v_day OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(general_reserved),0) INTO general_total FROM public.sns_youtube_quota_attempts WHERE quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF general_total+q.external_general>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   IF a.processing_polls>=3 THEN RAISE EXCEPTION 'youtube_poll_limit'; END IF;
   UPDATE public.sns_youtube_quota_attempts SET processing_polls=processing_polls+1,general_units_started=general_units_started+1 WHERE job_id=j.id AND attempt=j.attempts;
   RETURN to_jsonb(j);
 END IF;
 IF j.channel='youtube' AND p_action='youtube_lookup' THEN
   IF j.state<>'reconcile' THEN RAISE EXCEPTION '要照合ではありません'; END IF;
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(general_reserved),0) INTO general_total FROM public.sns_youtube_quota_attempts WHERE quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF general_total+q.external_general+1>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   INSERT INTO public.sns_youtube_quota_reads(job_id,attempt,quota_day) VALUES(j.id,j.attempts,v_day);
   RETURN to_jsonb(j);
 END IF;
 IF j.channel='youtube' AND p_action IN ('youtube_call','youtube_uploaded','youtube_publish_begin') THEN
   IF j.state<>'reconcile' THEN RAISE EXCEPTION '要照合ではありません'; END IF;
   IF p_action='youtube_uploaded' THEN
     IF j.youtube_stage IS NOT NULL THEN RAISE EXCEPTION '動画IDは保存済みです'; END IF;
     IF NOT EXISTS (SELECT 1 FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts AND 'videos.insert'=ANY(calls)) THEN RAISE EXCEPTION 'upload開始未記録です'; END IF;
     IF coalesce(p_result->>'id','') !~ '^[A-Za-z0-9_-]{11}$' OR
       (j.external_post_id IS NOT NULL AND j.external_post_id IS DISTINCT FROM p_result->>'id') THEN RAISE EXCEPTION '動画IDが不正です'; END IF;
     UPDATE public.sns_x_send_jobs SET external_post_id=p_result->>'id',youtube_stage='uploaded',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     RETURN to_jsonb(j);
   END IF;
   -- 外部呼出し後はheldへ戻さず要照合のまま停止。
   IF c.paused OR c.timing_approved IS NOT TRUE OR c.period_start IS NULL OR c.period_end IS NULL
     OR now()<c.period_start OR now()>=c.period_end OR j.budget_period_start IS DISTINCT FROM c.period_start OR c.attempt_ceiling_microusd IS NULL
     OR d.status<>'approved' OR d.publish_blocked OR NOT public.sns_bundle_send_allowed(d)
     OR jsonb_array_length(d.publication_hold_reasons)>0 OR d.x_approved_hash IS DISTINCT FROM j.approved_hash
     OR d.approver_id IS DISTINCT FROM j.approver_id OR d.approved_at IS DISTINCT FROM j.approved_at
     OR j.expires_at IS NULL OR now()>=j.expires_at OR (p_action<>'youtube_publish_begin' AND (j.lease_until IS NULL OR now()>=j.lease_until))
     OR j.expires_at IS DISTINCT FROM (j.snapshot->'queue'->>'deadline_at')::timestamptz - make_interval(mins=>c.expiry_minutes)
     OR c.max_source_age_seconds IS NULL OR (j.snapshot->'queue'->>'source_observed_at')::timestamptz IS NULL
     OR (j.snapshot->'queue'->>'source_observed_at')::timestamptz>now()
     OR (j.snapshot->'queue'->>'source_observed_at')::timestamptz + make_interval(secs=>c.max_source_age_seconds)<=now()
     OR c.daily_baseline_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date
     OR (j.locked_at AT TIME ZONE 'Asia/Tokyo')::date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date
   THEN RAISE EXCEPTION 'youtube_call_guard'; END IF;
   SELECT count(*) INTO day_count FROM public.sns_x_send_jobs jobs,
     LATERAL unnest(jobs.attempt_dates,jobs.attempt_channels) attempt(day,channel)
     WHERE attempt.channel='youtube' AND attempt.day=(now() AT TIME ZONE 'Asia/Tokyo')::date;
   IF coalesce(c.daily_limit_youtube,c.daily_limit) IS NULL OR day_count+c.daily_external_count>coalesce(c.daily_limit_youtube,c.daily_limit) THEN RAISE EXCEPTION 'youtube_daily_limit'; END IF;
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   SELECT * INTO a FROM public.sns_youtube_quota_attempts WHERE job_id=j.id AND attempt=j.attempts FOR UPDATE;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR a.quota_day IS DISTINCT FROM v_day
     OR a.job_id IS NULL OR q.upload_limit IS NULL OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(upload_reserved),0),coalesce(sum(general_reserved),0) INTO upload_total,general_total
     FROM public.sns_youtube_quota_attempts WHERE sns_youtube_quota_attempts.quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF upload_total+q.external_uploads>q.upload_limit OR general_total+q.external_general>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   IF p_action='youtube_publish_begin' THEN
     IF j.youtube_stage IS DISTINCT FROM 'ready' OR 'videos.update'=ANY(a.calls) THEN RAISE EXCEPTION '公開段階を開始できません'; END IF;
     UPDATE public.sns_x_send_jobs SET youtube_stage='publishing',locked_at=now(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
     RETURN to_jsonb(j);
   END IF;
   method:=p_result->>'method';
   IF method IS NULL OR method NOT IN ('videos.insert','thumbnails.set','videos.update','videos.list') OR method=ANY(a.calls)
     OR (method='videos.insert' AND cardinality(a.calls)<>0)
     OR (method<>'videos.insert' AND (NOT 'videos.insert'=ANY(a.calls) OR j.external_post_id IS NULL))
     OR (method='thumbnails.set' AND (jsonb_array_length(j.snapshot->'media')<>2 OR j.youtube_stage IS DISTINCT FROM 'uploaded'))
     OR (method='videos.update' AND j.youtube_stage IS DISTINCT FROM 'publishing')
     OR (method='videos.list' AND j.youtube_stage IS DISTINCT FROM 'update_started')
   THEN RAISE EXCEPTION 'youtube_call_not_planned'; END IF;
   UPDATE public.sns_youtube_quota_attempts SET calls=array_append(calls,method),
     upload_calls_started=upload_calls_started+CASE WHEN method='videos.insert' THEN 1 ELSE 0 END,
     general_units_started=general_units_started+CASE WHEN method='videos.list' THEN 1 WHEN method IN ('thumbnails.set','videos.update') THEN 50 ELSE 0 END WHERE job_id=j.id AND attempt=j.attempts;
   IF method='videos.update' THEN UPDATE public.sns_x_send_jobs SET youtube_stage='update_started',updated_at=now() WHERE id=j.id RETURNING * INTO j; END IF;
   RETURN to_jsonb(j);
 END IF;
 r:=public.transition_sns_send_139(p_job_id,p_action,p_result);
 IF j.channel='youtube' AND p_action='claim' AND r->>'state'='sending' THEN
   SELECT * INTO q FROM public.sns_youtube_quota_control WHERE id=true FOR UPDATE;
   IF q.verified IS NOT TRUE OR q.baseline_day IS DISTINCT FROM v_day OR q.upload_limit IS NULL OR q.general_limit IS NULL THEN RAISE EXCEPTION 'youtube_quota_unconfirmed'; END IF;
   SELECT coalesce(sum(upload_reserved),0),coalesce(sum(general_reserved),0) INTO upload_total,general_total
     FROM public.sns_youtube_quota_attempts WHERE sns_youtube_quota_attempts.quota_day=v_day;
   general_total:=general_total+(SELECT coalesce(sum(units),0) FROM public.sns_youtube_quota_reads WHERE quota_day=v_day);
   IF upload_total+q.external_uploads+1>q.upload_limit OR general_total+q.external_general+104>q.general_limit THEN RAISE EXCEPTION 'youtube_quota_limit'; END IF;
   INSERT INTO public.sns_youtube_quota_attempts(job_id,attempt,quota_day) VALUES(j.id,(r->>'attempts')::integer,v_day);
 END IF;
 -- 置き換え6: item の下書きが全部 posted になったら item を sent にする（X はスレッドの全件）。
 IF p_action='complete' AND j.auto_item_id IS NOT NULL AND r->>'state'='posted' THEN
   UPDATE public.sns_auto_send_items i SET state='sent',updated_at=now()
   WHERE i.id=j.auto_item_id AND i.state IN ('manual','notified') AND NOT EXISTS (
     SELECT 1 FROM public.sns_drafts dd LEFT JOIN public.sns_x_send_jobs jj ON jj.draft_id=dd.id
     WHERE dd.bundle_import_id=i.bundle_import_id AND dd.platform=i.channel AND dd.status<>'archived'
       AND jj.state IS DISTINCT FROM 'posted');
 END IF;
 RETURN r;
END;
$$;

-- 止める: item を stopped にし（送信の関数の許可のリストが外れる）、まだ送信が始まっていない下書きを公開保留に戻す。
-- 公開保留に戻すと 148 の guard_sns_x_approval が承認を外し、queued・held の job を取り消す（139 の cancel は queued だけなので使わない）。
-- sending・reconcile・posted の job の下書き、138 の外部操作の途中の下書きには触らない（148・138 のガードで RAISE するため）。返り値で「送信が始まっていた」件数を返す。
-- 下書き→item の順でロックする（transition_sns_x_send と同じ順。デッドロックを避ける）。
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

-- 毎日の基準日（2026-10-13 ユーザー決定）: JST・太平洋時間の日付が変わっていたら、基準日を当日にし、他の経路の本数を0にする。
-- オーナーが一度も設定していない（NULL・未確認）ときは何もしない（初回の確認はオーナー）。sns-auto-plan が毎回呼ぶ。
CREATE OR REPLACE FUNCTION public.roll_sns_send_baselines()
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_jst DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_pt DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_x INTEGER;
  v_yt INTEGER;
BEGIN
  UPDATE public.sns_x_send_control SET daily_baseline_date = v_jst, daily_external_count = 0
    WHERE id = true AND daily_baseline_date IS NOT NULL AND daily_baseline_date < v_jst;
  GET DIAGNOSTICS v_x = ROW_COUNT;
  UPDATE public.sns_youtube_quota_control SET baseline_day = v_pt, external_uploads = 0, external_general = 0
    WHERE id = true AND verified AND baseline_day IS NOT NULL AND baseline_day < v_pt;
  GET DIAGNOSTICS v_yt = ROW_COUNT;
  RETURN jsonb_build_object('x_rolled', v_x > 0, 'youtube_rolled', v_yt > 0, 'jst', v_jst, 'pt', v_pt);
END $$;

-- 月の切り替え（オーナーが本番 SQL で実行）。予約額は戻らないので、請求期間ごとに0から数え直す。今の期間が終わってからだけ実行できる。
CREATE OR REPLACE FUNCTION public.renew_sns_x_send_period(p_start TIMESTAMPTZ, p_end TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_end <= p_start THEN RAISE EXCEPTION 'invalid_period'; END IF;
  UPDATE public.sns_x_send_control
    SET period_start = p_start, period_end = p_end, reserved_microusd = 0
    WHERE id = true AND (period_end IS NULL OR (period_end <= p_start AND now() >= period_end));
  IF NOT FOUND THEN RAISE EXCEPTION 'period_overlaps_current'; END IF;
END $$;

-- 共通の cron ラッパは scrape_job_state に行が無い・mode='off' だと何もしない。試運転の前提として shadow で入れる（live はオーナーが L1 で）
INSERT INTO public.scrape_job_state (job, mode)
VALUES ('sns_auto_plan', 'shadow'), ('sns_send', 'shadow'), ('sns_metrics', 'shadow'), ('sns_daily', 'shadow'), ('sns_insights', 'shadow')
ON CONFLICT (job) DO NOTHING;

ALTER TABLE public.sns_auto_send_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_auto_send_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sns_auto_send_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_auto_send_control, public.sns_auto_send_items, public.sns_auto_send_incidents
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sns_auto_send_control, public.sns_auto_send_items, public.sns_auto_send_incidents
  TO service_role;
REVOKE ALL ON FUNCTION public.sns_bundle_send_allowed(public.sns_drafts) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sns_bundle_send_allowed(public.sns_drafts) TO service_role;
REVOKE ALL ON FUNCTION public.stop_sns_auto_item(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_sns_auto_item(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.roll_sns_send_baselines() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.roll_sns_send_baselines() TO service_role;
-- 月の切り替えはオーナーが SQL Editor で実行するので、service_role にも渡さない
REVOKE ALL ON FUNCTION public.renew_sns_x_send_period(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
-- CREATE OR REPLACE は既存の権限を保つ。念のため 135・139・146 と同じ権限を明示する
REVOKE ALL ON FUNCTION public.guard_sns_preview_bundle_draft() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sns_x_send(UUID,UUID,JSONB,TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.transition_sns_send_139(UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_sns_x_send(UUID,TEXT,JSONB) TO service_role;

COMMIT;
