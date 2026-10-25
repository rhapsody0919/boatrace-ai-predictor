-- 174: /today の X 投稿の「型の列」（日付→その日の型の中身）の表（PD02、2026-10-25 hq の依頼）
-- hq の毎日の PDCA（~/hq/platform/pdca_daily.py）が週1回、先の7日分の型を作り、龍神の scripts/sns/push-today-types.js で入れる
-- （全貌の push-full-picture.js と同じく、hq は龍神のスクリプトを .env.local の service key で動かす。検査は龍神のスクリプトが持つ）。
-- cron sns_auto_plan（scripts/lib/snsTodayPlanner.js）がその日の行を読み、行が無い・壊れている・読めない日は
-- config/today-variants.json の a・b で送る（止めない。理由は下書きの source_data.content_type.fallback_reason）。
-- 仕組みは docs/operation/sns-today-heading-variants.md。表を1つ足すだけで、関数・既存の表は変えない。db-apply で当てる。
-- コードは表が無くても動く（読み取りが 404 なら config で送る）ので、コードの PR と同時でも前後でもよい。
--
-- 適用前の確認（期待値 NULL）:
--   SELECT to_regclass('public.sns_today_type_schedule');
--
-- 適用後の確認:
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sns_today_type_schedule'::regclass;  -- 期待: true
--   SELECT has_table_privilege('anon', 'public.sns_today_type_schedule', 'SELECT'),
--          has_table_privilege('authenticated', 'public.sns_today_type_schedule', 'INSERT');      -- 期待: false, false
--   SELECT has_table_privilege('claude_ro', 'public.sns_today_type_schedule', 'SELECT'),
--          has_table_privilege('service_role', 'public.sns_today_type_schedule', 'INSERT');      -- 期待: true, true（hq の読み返し・push-today-types.js の書き込み）
--
-- 戻し方（行は hq が作り直せる。下書きの source_data.content_type に送った型が残る）:
--   DROP TABLE public.sns_today_type_schedule;
BEGIN;

CREATE TABLE public.sns_today_type_schedule (
  day DATE PRIMARY KEY,                       -- JST の日付（/today の投稿の日）
  type_id TEXT NOT NULL CHECK (type_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  post JSONB NOT NULL CHECK (jsonb_typeof(post) = 'object'),  -- {heading, link_lead?, link_position?}。中身の検査は snsTodayVariants.js
  source TEXT NOT NULL DEFAULT 'hq' CHECK (char_length(source) BETWEEN 1 AND 64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 書くのは service_role（push-today-types.js）・読むのは service_role（cron）と claude_ro（hq の読み返し、166 の既定の権限）だけ
ALTER TABLE public.sns_today_type_schedule ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sns_today_type_schedule FROM anon, authenticated;

COMMIT;
