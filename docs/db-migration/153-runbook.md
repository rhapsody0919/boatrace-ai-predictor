# 153・154 の適用手順（sns-pdca-loop: 自動送信・取り込みジョブ）

マイグレーション153（自動送信の表・関数、v1 素材とスレッドの受け入れ、既存の送信関数5つの置き換え）と154（X のトークンの保存、48h/7d の取り込みジョブ、暦日の値、136 の累積値の時刻の許容差）の本番適用の手順。設計は `docs/design/sns-pdca-loop/plan.md`、決定は ADR 0094。

適用直後も **送信は始まらない**。`sns_x_send_control.paused=true` のまま、新しい `sns_auto_send_control` は2チャネルとも `mode=manual`・`dry_run=true`（dry_run の間はそのチャネルの claim を拒否する）。X・YouTube への実接続・鍵・費用の設定はこの手順に含まない（tasks の 26・27）。

## 置き換える関数の土台
2026-10-13 に本番の `pg_get_functiondef` の md5 を読み取りで取得し、リポジトリの 135・139・146・148 を PGlite に入れた結果と23関数すべて一致することを確認した。153 はこの定義を土台に書いている。手順1でもう一度同じ md5 を確かめ、違っていたら適用しない（間に別の変更が入っている）。

## 既存のデータ・画面への影響（2026-10-13 の本番: sns_bundle_imports 1件（v0）、sns_x_send_jobs 0件）
- v0 の素材: 取り込み・公開保留・承認の拒否は今のまま（PGlite で確認）。取り込みの返り値の各下書きに `thread_index`（0）が増える
- 個別承認の経路（本人）: 予約額・日次上限は、新しい列（ceiling_x_url・ceiling_x_plain・daily_limit_x・daily_limit_youtube）が NULL の間は今の attempt_ceiling・daily_limit を使う。ただし **YouTube の予約額は0になる**（YouTube Data API は無料。クォータは別の台帳）。また dry_run=true の間は本人の承認の job も claim できない（L1 の試運転は外部投稿ゼロ）
- 既存の検証（verify-sns-shorts-send 21件・deadline-queue 15件・approval-posted 2件）を、153 を足し dry_run=false にした状態でも全件通ることを確認した
- `sns_drafts`: 列 `thread_index`（既定0）が増え、一意索引 `sns_drafts_bundle_version_channel_language` を作り直す（今ある行は全部 0 なので重複は起きない）
- `sns_metric_observations`（154）: 2026-10-12 時点で0行。制約を緩めるだけで、今ある行が違反することは無い

## 順序（入れ替えない）
1. ユーザー: SQL Editor で手順1（読み取り）→ 153 の本体 → 154 の本体 を実行する
2. Claude: 手順3の SELECT を読み取りで確認し、APPLIED.md の 153・154 を「適用済み」に直す
3. このPRのコードは新しい列・関数をまだ使わないので、マージは適用の前後どちらでもよい

## 手順1（実行前の確認・読み取りのみ）
```sql
-- 期待値: 5行とも ok=true
SELECT p.proname, md5(pg_get_functiondef(p.oid)) = x.h AS ok
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN (VALUES ('import_sns_preview_bundle', 'bce5809e6cfba4ddfd58c7857150bc63'),
             ('guard_sns_preview_bundle_draft', '1cbd30888d297b4e13a0068a1b185b1e'),
             ('approve_sns_x_send', 'c31e5457cb17aa50221fc5de6944ffa2'),
             ('transition_sns_send_139', '17458fe1adf8f90e966e93d7cc4c9bb5'),
             ('transition_sns_x_send', '3e1836cb8a2365cb3d76987ebd03afe2')) x(name, h) ON x.name = p.proname
WHERE n.nspname = 'public' ORDER BY 1;

-- 期待値: 3つとも NULL、approver が 0、jobs が 0
SELECT to_regclass('public.sns_auto_send_items') AS items, to_regclass('public.sns_metric_jobs') AS metric_jobs,
       to_regclass('public.sns_oauth_tokens') AS tokens,
       (SELECT count(*) FROM public.sns_approvers WHERE display_name = '自動送信（止められなかった）') AS approver,
       (SELECT count(*) FROM public.sns_x_send_jobs) AS jobs;
-- 期待値: 4つの制約名が全部ある（153・154 が DROP する名前）
SELECT conname FROM pg_constraint WHERE conname IN ('sns_bundle_imports_schema_version_check', 'sns_metric_observations_check5',
  'sns_metric_observations_check6', 'sns_post_tracking_utm_campaign_check') ORDER BY 1;
```

## 手順2（本体）
`docs/db-migration/153_sns_auto_send.sql` の全文を1回で実行し、続けて `docs/db-migration/154_sns_tokens_metric_jobs.sql` の全文を1回で実行する（どちらも BEGIN〜COMMIT）。

## 手順3（実行後の確認・読み取りのみ。Claude が行う）
```sql
-- 期待値: 11行とも ok=true（PGlite で同じ SQL を入れたときの md5）。transition_sns_x_send だけ prosecdef=true
SELECT p.proname, p.prosecdef, md5(pg_get_functiondef(p.oid)) = x.h AS ok
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN (VALUES ('approve_sns_x_send', 'b33a3ce36ae4dc6ad72541528d4d5141'),
             ('enqueue_sns_metric_jobs', 'b635b35552120b7704ee08ae146c8e69'),
             ('guard_sns_preview_bundle_draft', 'fa8810c4052da42d36dbb7b1e73d8679'),
             ('import_sns_preview_bundle', '78c84e804f3b8bbd9f5be53fad77c804'),
             ('renew_sns_x_send_period', '722e9a0760455b49aab5a8a112fb1a7a'),
             ('reserve_sns_x_read', '59d41f4d2d51935e000b6373772f926b'),
             ('roll_sns_send_baselines', '386df8e8daaf4375e7662929c48745bd'),
             ('sns_bundle_send_allowed', 'ef21efb1872336925a3a1925c2a00863'),
             ('stop_sns_auto_item', '6256d23dafbfa477df9c4364ba67b478'),
             ('transition_sns_send_139', '9afa26357d86e2d56494b9ac17028388'),
             ('transition_sns_x_send', '839f9159b9adb26e0dd0113259d5ae59')) x(name, h) ON x.name = p.proname
WHERE n.nspname = 'public' ORDER BY 1;

-- 期待値: 2行（x・youtube）、mode=manual、dry_run=true、auto_approver_id が NULL でない
SELECT channel, mode, dry_run, auto_approver_id IS NOT NULL AS has_auto_approver FROM public.sns_auto_send_control ORDER BY 1;
-- 期待値: 5行とも shadow
SELECT job, mode FROM public.scrape_job_state WHERE job LIKE 'sns_%' ORDER BY 1;
-- 期待値: 6表とも relrowsecurity=true
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('sns_auto_send_control', 'sns_auto_send_items',
  'sns_auto_send_incidents', 'sns_oauth_tokens', 'sns_metric_jobs', 'sns_channel_daily') ORDER BY 1;
-- 期待値: すべて false（匿名・ログイン利用者は実行できない）。renew の service_role も false
SELECT has_function_privilege('anon', 'public.stop_sns_auto_item(uuid,text)', 'EXECUTE') AS anon_stop,
       has_function_privilege('anon', 'public.transition_sns_x_send(uuid,text,jsonb)', 'EXECUTE') AS anon_transition,
       has_function_privilege('authenticated', 'public.roll_sns_send_baselines()', 'EXECUTE') AS auth_roll,
       has_function_privilege('service_role', 'public.renew_sns_x_send_period(timestamptz,timestamptz)', 'EXECUTE') AS sr_renew,
       has_function_privilege('service_role', 'public.transition_sns_send_139(uuid,text,jsonb)', 'EXECUTE') AS sr_139;
```
適用後に Supabase の advisor（security）で `rls_disabled_in_public`・`security_definer_view` が0件であることも確かめる。

## 戻し方
v1 の素材を取り込む前（`sns_bundle_imports` に v1 が無く、`sns_drafts.thread_index` が全部0、`sns_auto_send_items` が0行）にだけ使える。v1 のデータがあると、一意索引と CHECK の作り直しで失敗する（その場合はオーケストレーターに知らせる）。

```sql
BEGIN;
-- 154
DROP TRIGGER IF EXISTS sns_metric_jobs_on_posted ON public.sns_x_send_jobs;
DROP FUNCTION IF EXISTS public.enqueue_sns_metric_jobs();
DROP FUNCTION IF EXISTS public.reserve_sns_x_read(BIGINT, BIGINT);
DROP TABLE IF EXISTS public.sns_channel_daily, public.sns_metric_jobs, public.sns_oauth_tokens;
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT IF EXISTS sns_metric_observations_snapshot_tolerance;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_check6
  CHECK (measurement_kind <> 'snapshot' OR metric_value IS NULL OR observed_at = period_end);
ALTER TABLE public.sns_metric_observations DROP CONSTRAINT IF EXISTS sns_metric_observations_value_data_through;
ALTER TABLE public.sns_metric_observations ADD CONSTRAINT sns_metric_observations_check5
  CHECK (metric_value IS NULL OR (data_through IS NOT NULL AND data_through = period_end));
ALTER TABLE public.sns_post_tracking DROP CONSTRAINT sns_post_tracking_utm_campaign_check;
ALTER TABLE public.sns_post_tracking ADD CONSTRAINT sns_post_tracking_utm_campaign_check CHECK (utm_campaign = 'sonar-preview');
ALTER TABLE public.sns_post_tracking ALTER COLUMN template_variant_id SET NOT NULL;
-- 153: 置き換えた関数を戻す（下の「置き換える前の定義」をここで実行する）
DROP FUNCTION IF EXISTS public.stop_sns_auto_item(UUID, TEXT);
DROP FUNCTION IF EXISTS public.roll_sns_send_baselines();
DROP FUNCTION IF EXISTS public.renew_sns_x_send_period(TIMESTAMPTZ, TIMESTAMPTZ);
-- （置き換える前の定義5つをここに貼る）
DROP FUNCTION IF EXISTS public.sns_bundle_send_allowed(public.sns_drafts);
DELETE FROM public.scrape_job_state WHERE job IN ('sns_auto_plan', 'sns_send', 'sns_metrics', 'sns_daily', 'sns_insights');
ALTER TABLE public.sns_bundle_imports DROP CONSTRAINT sns_bundle_imports_schema_version_check;
ALTER TABLE public.sns_bundle_imports ADD CONSTRAINT sns_bundle_imports_schema_version_check CHECK (schema_version = 'ryujin-preview/0');
DROP INDEX public.sns_drafts_bundle_version_channel_language;
CREATE UNIQUE INDEX sns_drafts_bundle_version_channel_language
  ON public.sns_drafts (bundle_version_hash, platform, language) WHERE bundle_version_hash IS NOT NULL;
ALTER TABLE public.sns_drafts DROP COLUMN thread_index;
ALTER TABLE public.sns_x_send_jobs DROP COLUMN auto_item_id;
ALTER TABLE public.sns_x_send_control DROP COLUMN ceiling_x_url_microusd, DROP COLUMN ceiling_x_plain_microusd,
  DROP COLUMN daily_limit_x, DROP COLUMN daily_limit_youtube;
DROP TABLE public.sns_auto_send_incidents, public.sns_auto_send_items, public.sns_auto_send_control;
DELETE FROM public.sns_approvers WHERE display_name = '自動送信（止められなかった）'
  AND NOT EXISTS (SELECT 1 FROM public.sns_x_send_jobs WHERE approver_id = sns_approvers.id);
COMMIT;
```
`thread_index` の列を落とす前に関数を戻す（新しい定義が列を参照しているため、上の順で実行する）。戻した後、手順1の md5 の SELECT が5行とも true になることを確かめる。

### 置き換える前の定義（本番と md5 一致。PGlite の pg_get_functiondef の出力）
```sql
CREATE OR REPLACE FUNCTION public.import_sns_preview_bundle(p_version_hash text, p_schema_version text, p_bundle jsonb, p_qa jsonb, p_manifest jsonb, p_missing jsonb, p_hold_reasons jsonb, p_risk_flags jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  group_id UUID;
  channel TEXT;
  draft_id UUID;
  created BOOLEAN;
  results JSONB := '[]'::jsonb;
  video_path TEXT;
  cover_path TEXT;
BEGIN
  IF p_schema_version <> 'ryujin-preview/0' OR p_bundle->>'schema_version' IS DISTINCT FROM p_schema_version THEN
    RAISE EXCEPTION '未対応のschema_versionです';
  END IF;
  INSERT INTO public.sns_bundle_imports(version_hash, schema_version, bundle,
    source_manifest, qa, release_evidence, missing_files, hold_reasons)
  VALUES (p_version_hash, p_schema_version, p_bundle, p_manifest, p_qa,
    jsonb_build_object('release_status', NULL, 'release_notice', NULL,
      'snapshot_at', NULL, 'ui_version', NULL, 'destination_url', NULL,
      'missing_reason', 'v0では正式公開情報が未提供・確認条件が未確定'),
    p_missing, p_hold_reasons)
  ON CONFLICT (version_hash) DO NOTHING;
  SELECT id INTO group_id FROM public.sns_bundle_imports WHERE version_hash = p_version_hash FOR UPDATE;
  SELECT entry->>'storage_path' INTO video_path FROM jsonb_array_elements(p_manifest) entry WHERE entry->>'name' = 'draft.mp4';
  SELECT entry->>'storage_path' INTO cover_path FROM jsonb_array_elements(p_manifest) entry WHERE entry->>'name' = 'scene-1.png';
  FOREACH channel IN ARRAY ARRAY['x', 'youtube'] LOOP
    draft_id := NULL;
    INSERT INTO public.sns_drafts(content_group_id, bundle_import_id, bundle_version_hash,
      format, template_variant_id, language, platform, status, title, caption_text,
      video_storage_path, cover_image_path, source_data, publish_blocked, publication_hold_reasons, risk_flags)
    VALUES (group_id, group_id, p_version_hash, p_bundle->>'format', NULL, 'ja', channel,
      'pending_review', p_bundle->>'title',
      CASE WHEN channel = 'x' THEN p_bundle->>'x_text' ELSE p_bundle->>'script' END,
      video_path, cover_path,
      jsonb_build_object('bundle_origin', 'local-preview', 'schema_version', p_schema_version,
        'race_id', p_bundle->>'race_id', 'stage', p_bundle->>'stage',
        'local_template_variant_id', p_bundle->>'template_variant_id',
        'bundle', p_bundle, 'source_manifest', p_manifest, 'qa', p_qa),
      true, p_hold_reasons, COALESCE(p_risk_flags->channel, '[]'::jsonb))
    ON CONFLICT (bundle_version_hash, platform, language) WHERE bundle_version_hash IS NOT NULL DO NOTHING
    RETURNING id INTO draft_id;
    created := draft_id IS NOT NULL;
    IF NOT created THEN
      SELECT id INTO draft_id FROM public.sns_drafts WHERE bundle_version_hash = p_version_hash AND platform = channel AND language = 'ja';
    END IF;
    results := results || jsonb_build_array(jsonb_build_object('id', draft_id, 'platform', channel,
      'result', CASE WHEN created THEN 'created' ELSE 'duplicate' END));
  END LOOP;
  RETURN jsonb_build_object('content_group_id', group_id, 'version_hash', p_version_hash,
    'drafts', results, 'publish_blocked', true, 'hold_reasons', p_hold_reasons);
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_sns_preview_bundle_draft()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
       NEW.bundle_version_hash IS DISTINCT FROM OLD.bundle_version_hash THEN
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
      RAISE EXCEPTION 'v0素材は公開不可です';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.sns_bundle_imports WHERE id = NEW.content_group_id) THEN
    RAISE EXCEPTION 'bundle由来のgroupにはbundle_import_idが必要です';
  ELSIF NEW.bundle_version_hash IS NOT NULL THEN
    RAISE EXCEPTION 'bundle_import_idが必要です';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_sns_x_send(p_draft_id uuid, p_approver_id uuid, p_snapshot jsonb, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; h TEXT; txt TEXT; media_path TEXT;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=p_draft_id FOR UPDATE;
  IF NOT FOUND OR d.platform NOT IN ('x','youtube') OR d.language <> 'ja' OR d.status NOT IN ('pending_review','approved')
    OR d.source_data->>'dataCardUrl' IS NOT NULL OR d.publish_blocked OR d.bundle_import_id IS NOT NULL OR jsonb_array_length(d.publication_hold_reasons)>0 THEN
    RAISE EXCEPTION 'この下書きはX送信を承認できません';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sns_approvers WHERE id=p_approver_id AND display_name='本人') THEN
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
    youtube_stage=NULL, external_post_id=NULL
    WHERE id=j.id RETURNING * INTO j;
  UPDATE public.sns_drafts SET status='approved',approver_id=p_approver_id,approved_at=j.approved_at,
    x_approved_hash=h,scheduled_at=j.scheduled_at WHERE id=d.id;
  RETURN to_jsonb(j);
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_sns_send_139(p_job_id uuid, p_action text, p_result jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE d public.sns_drafts; j public.sns_x_send_jobs; c public.sns_x_send_control; reason TEXT; day_count INTEGER;
BEGIN
  SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
  SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
  SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
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
      OR c.attempt_ceiling_microusd IS NULL THEN RAISE EXCEPTION 'X送信は停止中・費用未確認です'; END IF;
    IF d.status<>'approved' OR d.publish_blocked OR d.bundle_import_id IS NOT NULL
      OR jsonb_array_length(d.publication_hold_reasons)>0 OR d.x_approved_hash IS DISTINCT FROM j.approved_hash
      OR d.approver_id IS DISTINCT FROM j.approver_id OR d.approved_at IS DISTINCT FROM j.approved_at THEN
      RAISE EXCEPTION '再承認が必要です'; END IF;
  END IF;
  IF p_action='begin_post' AND j.state<>'sending' THEN RAISE EXCEPTION '送信開始できません'; END IF;
  IF p_action IN ('claim','begin_post') THEN
    IF c.daily_limit IS NULL OR c.daily_limit<1 OR c.daily_baseline_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
      RAISE EXCEPTION '日次全体上限・他経路の本数が未確認です';
    END IF;
    SELECT count(*) INTO day_count FROM public.sns_x_send_jobs jobs,
      LATERAL unnest(jobs.attempt_dates,jobs.attempt_channels) attempt(day,channel) WHERE attempt.channel=j.channel
      AND attempt.day=(now() AT TIME ZONE 'Asia/Tokyo')::date;
    IF day_count+c.daily_external_count >= c.daily_limit + (CASE WHEN p_action='begin_post' THEN 1 ELSE 0 END) THEN
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
    IF c.reserved_microusd+c.attempt_ceiling_microusd>c.budget_microusd THEN RAISE EXCEPTION '月額上限です'; END IF;
    UPDATE public.sns_x_send_control SET reserved_microusd=reserved_microusd+attempt_ceiling_microusd WHERE id=true;
    j.budget_period_start:=c.period_start;
    j.state:='sending'; j.attempts:=j.attempts+1;
    j.reserved_microusd:=j.reserved_microusd+c.attempt_ceiling_microusd;
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
$function$;

CREATE OR REPLACE FUNCTION public.transition_sns_x_send(p_job_id uuid, p_action text, p_result jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE d public.sns_drafts; c public.sns_x_send_control; j public.sns_x_send_jobs;
 q public.sns_youtube_quota_control; a public.sns_youtube_quota_attempts;
 r JSONB; v_day DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
 upload_total BIGINT; general_total BIGINT; day_count INTEGER; method TEXT;
BEGIN
 SELECT * INTO d FROM public.sns_drafts WHERE id=(SELECT draft_id FROM public.sns_x_send_jobs WHERE id=p_job_id) FOR UPDATE;
 SELECT * INTO c FROM public.sns_x_send_control WHERE id=true FOR UPDATE;
 SELECT * INTO j FROM public.sns_x_send_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'jobが見つかりません'; END IF;
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
     OR d.status<>'approved' OR d.publish_blocked OR d.bundle_import_id IS NOT NULL
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
   IF c.daily_limit IS NULL OR day_count+c.daily_external_count>c.daily_limit THEN RAISE EXCEPTION 'youtube_daily_limit'; END IF;
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
 RETURN r;
END;
$function$;
```
