# 135 の適用手順（sns-hub v0展望bundle取り込み、PR #1302）

マイグレーション135（素材台帳`sns_bundle_imports`の新設、`sns_drafts`への4列追加、公開不可を強制するトリガー、2チャネル一括登録RPC）の本番適用の手順。既存の`sns_drafts`の行・画面挙動には影響しない（新しい列はすべて`DEFAULT`付き、新しいトリガーはbundle起源の行にしか効かない）。

## 順序（入れ替えない）

1. ユーザー: SQL Editorで、下のSQLを上から順に実行する（手順1の確認 → 手順2の本体 → 手順3の確認）
2. Claude: 適用の確認（手順3のSELECT。読み取りなのでClaudeが実行してよい）。APPLIED.mdの135の行を「適用済み」に直す
3. ユーザー: PR #1302をマージする（135が前提とする新しい列・RPCを使うコード）

適用より先にPRをマージすると、`/admin/sns-hub`の取り込みパネルがRPC`import_sns_preview_bundle`を呼んだ時点でPostgRESTが「関数が存在しない」エラーを返す（他の既存機能には影響しない、取り込みパネルだけが動かない状態になる）。134（BOA-430、`venue_technique_period_stats`）は2026-10-07に適用済みで、135はその次の空き番号。

## 1. 適用する SQL（全文）

本体（手順2）は`docs/db-migration/135_sns_preview_bundle_import.sql`と同じ。

```sql
-- ============================================================================
-- 135 の本番適用（sns-hub v0展望bundle取り込み、PR #1302）
-- 実行する人: ユーザー（Supabase Dashboard > SQL Editor）
-- 何をするか: 新しい表 sns_bundle_imports を作り、既存の sns_drafts に4列
--            （bundle_import_id・bundle_version_hash・publish_blocked・
--            publication_hold_reasons）を追加し、公開不可を強制するトリガーと
--            2チャネル一括登録RPCを作る。既存の sns_drafts の行・画面挙動には
--            影響しない（新列は全てDEFAULT付き、トリガーはbundle起源の行にしか
--            効かない）
-- 戻し方: 末尾の「戻す」のブロック（適用直後は新表0行・新列は既存行に効果なし
--         なので、戻しても失うものは無い）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 手順1（実行前の確認・読み取りのみ）: まだ表が無く、sns_drafts に対象列が無いこと
--   期待値: table_exists が NULL（表が無い）、drafts_has_column が 0（列が無い）
-- ---------------------------------------------------------------------------
SELECT to_regclass('public.sns_bundle_imports') AS table_exists;
SELECT count(*) AS drafts_has_column FROM information_schema.columns
WHERE table_name = 'sns_drafts' AND column_name = 'bundle_import_id';
--   → table_exists が NULL かつ drafts_has_column が 0 なら手順2へ。
--     どちらかが条件を満たさなければ実行せず、オーケストレーターに知らせる

-- ---------------------------------------------------------------------------
-- 手順2（本体）: ここから COMMIT までを1回で実行する
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.sns_bundle_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_hash TEXT NOT NULL UNIQUE CHECK (version_hash ~ '^[a-f0-9]{64}$'),
  schema_version TEXT NOT NULL CHECK (schema_version = 'ryujin-preview/0'),
  bundle JSONB NOT NULL,
  source_manifest JSONB NOT NULL,
  qa JSONB NOT NULL,
  release_evidence JSONB NOT NULL,
  missing_files JSONB NOT NULL,
  hold_reasons JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.sns_bundle_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sns_bundle_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sns_bundle_imports TO service_role;

ALTER TABLE public.sns_drafts
  ADD COLUMN IF NOT EXISTS bundle_import_id UUID REFERENCES public.sns_bundle_imports(id),
  ADD COLUMN IF NOT EXISTS bundle_version_hash TEXT,
  ADD COLUMN IF NOT EXISTS publish_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS publication_hold_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS sns_drafts_bundle_version_channel_language
  ON public.sns_drafts(bundle_version_hash, platform, language)
  WHERE bundle_version_hash IS NOT NULL;

-- topic由来のgroupはsns_topics.id、bundle由来はsns_bundle_imports.id。
-- bundle_import_idを明示して生成元を区別し、topic/targetやRoutineは作らない。
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
$$;
REVOKE ALL ON FUNCTION public.guard_sns_preview_bundle_draft() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_sns_preview_bundle_draft ON public.sns_drafts;
CREATE TRIGGER guard_sns_preview_bundle_draft BEFORE INSERT OR UPDATE ON public.sns_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_sns_preview_bundle_draft();

-- 同じ版の並行取り込みを行ロックで直列化し、2チャネルを一括登録する。
-- SECURITY INVOKER: service_role以外に実行権限を与えない。
CREATE OR REPLACE FUNCTION public.import_sns_preview_bundle(
  p_version_hash TEXT, p_schema_version TEXT, p_bundle JSONB, p_qa JSONB,
  p_manifest JSONB, p_missing JSONB, p_hold_reasons JSONB, p_risk_flags JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
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
$$;
REVOKE ALL ON FUNCTION public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 手順3（実行後の確認・読み取りのみ）: 7つとも期待値どおりか
-- ---------------------------------------------------------------------------
-- 3-1 sns_bundle_imports が存在し RLS 有効   期待値: true
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sns_bundle_imports'::regclass;

-- 3-2 sns_bundle_imports の権限は service_role のみ
--   期待値: service_role の SELECT/INSERT/UPDATE の3行だけ（anon・authenticatedは0行）
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'sns_bundle_imports'
ORDER BY grantee, privilege_type;

-- 3-3 sns_drafts に4列が追加されている   期待値: 4行
SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_name = 'sns_drafts'
  AND column_name IN ('bundle_import_id', 'bundle_version_hash', 'publish_blocked', 'publication_hold_reasons')
ORDER BY column_name;

-- 3-4 一意インデックスが存在する   期待値: 1行
SELECT indexname FROM pg_indexes
WHERE tablename = 'sns_drafts' AND indexname = 'sns_drafts_bundle_version_channel_language';

-- 3-5 トリガーが存在する   期待値: 1行
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.sns_drafts'::regclass AND tgname = 'guard_sns_preview_bundle_draft';

-- 3-6 RPCの実行権限は service_role のみ   期待値: service_role の1行だけ
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
WHERE routine_name = 'import_sns_preview_bundle';

-- 3-7 新表は空、既存の sns_drafts 行数は変化なし
--   期待値: bundle_imports_count が 0。drafts_total は適用前と同じ件数のはず
--   （適用前に別途 SELECT count(*) FROM public.sns_drafts; を控えておき比較する）
SELECT
  (SELECT count(*) FROM public.sns_bundle_imports) AS bundle_imports_count,
  (SELECT count(*) FROM public.sns_drafts) AS drafts_total;

-- ---------------------------------------------------------------------------
-- 戻す（必要なときだけ。適用直後・取り込み未実施なら影響無し）
-- ---------------------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS guard_sns_preview_bundle_draft ON public.sns_drafts;
-- DROP FUNCTION IF EXISTS public.guard_sns_preview_bundle_draft();
-- DROP FUNCTION IF EXISTS public.import_sns_preview_bundle(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB);
-- DROP INDEX IF EXISTS public.sns_drafts_bundle_version_channel_language;
-- ALTER TABLE public.sns_drafts
--   DROP COLUMN IF EXISTS bundle_import_id,
--   DROP COLUMN IF EXISTS bundle_version_hash,
--   DROP COLUMN IF EXISTS publish_blocked,
--   DROP COLUMN IF EXISTS publication_hold_reasons;
-- DROP TABLE IF EXISTS public.sns_bundle_imports;
-- COMMIT;
```

## 期待値のまとめ

| 確認 | 期待値 |
|---|---|
| 手順1 `table_exists` | NULL |
| 手順1 `drafts_has_column` | 0 |
| 3-1 `relrowsecurity` | true |
| 3-2 権限 | service_role の SELECT/INSERT/UPDATE の3行だけ |
| 3-3 新規4列 | `bundle_import_id`・`bundle_version_hash`・`publish_blocked`・`publication_hold_reasons`の4行 |
| 3-4 一意インデックス | 1行 |
| 3-5 トリガー | 1行 |
| 3-6 RPC権限 | service_role の1行だけ |
| 3-7 行数 | `bundle_imports_count`が0、`drafts_total`が適用前と同じ |

適用後、取り込みパネル（`/admin/sns-hub`、PR #1302マージ後）から実際に1件取り込み、X・YouTube各1件の`pending_review`・`publish_blocked=true`下書きができることを確認するのが望ましい（PGlite・モックでの検証は完了済みだが、実Storage・実RLSでの確認はまだ無い）。
