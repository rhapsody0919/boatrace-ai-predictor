-- 214: 選手の性別の表 racer_sex を足す（データの欠け J1b、女子戦の判定の出所。docs/design/data-gaps/db-draft.md §1.5）
--
-- 背景: racer_profiles.sex（083）は手動の fan-backfill.js sync-profiles --apply でしか書かれず、本番では全行 NULL
--   （2026-11-28 の読み取り）。毎日の Cron（fan_period・racer-profiles）はどれも sex を書かない。女子戦（facts の
--   field_gender、後の M1・M2）を6艇の性別から決めるため、fan（期ごとに全選手の性別を持つ、1=男・2=女）から
--   選手1人に1行で持つ。オーナー決定（2026-11-28、窓口の会話「J1b よい」）。設計の審査: system-architect（2026-11-28）。
--   racer_period_stats に列を足す案は採らない（期ごとに重ねて持つうえ、verify-fan-period.js の列の一致が変わる）。
--
-- 変更: 表を1つ足すだけ（CREATE TABLE IF NOT EXISTS・RLS・REVOKE・COMMENT）。既存の表・関数は変えない。冪等。
--   読み手・書き手はまだ無い。古い版のコードは影響を受けない。
--   anon・authenticated からは読めない（ポリシーを置かない＋REVOKE）。書き手は service_role（RLS を越える）。
--
-- 適用前の確認（読み取り。claude_ro）:
--   SELECT to_regclass('public.racer_sex');
--   -> NULL
--
-- 適用後の確認（読み取りのみ）:
--   SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.racer_sex'::regclass ORDER BY contype;
--   -> CHECK（c）と PK（p）の2行
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.racer_sex'::regclass;
--   -> true
--   SELECT has_table_privilege('anon', 'public.racer_sex', 'select'), has_table_privilege('authenticated', 'public.racer_sex', 'select');
--   -> false, false
--
-- 適用の後: 書き手の PR（fanPeriodJob.js の1段と過去分の CLI）→ 過去分の CLI（オーナーの --apply）→ 件数と sex の内訳、
--   plan.md §4 の Q8a・Q8b を racer_sex に替えて回す。
--
-- 戻し（書き手を戻した後）:
--   BEGIN; SET LOCAL lock_timeout = '10s'; DROP TABLE IF EXISTS public.racer_sex; COMMIT;
--
-- 検証: scripts/maintenance の verify-racer-sex-migration.js（PGlite、本番には接続しない）

SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.racer_sex (
  racer_id   integer PRIMARY KEY,            -- racer_period_stats（083）と同じ型。FK は張らない（racer_profiles に無い選手も入れる）
  sex        smallint NOT NULL CHECK (sex IN (1, 2)),
  source_fan text NOT NULL,                  -- 最後に値を確かめた fan（例 fan2604）。差分の比較には使わない
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

ALTER TABLE public.racer_sex ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.racer_sex FROM anon;
REVOKE ALL ON public.racer_sex FROM authenticated;

COMMENT ON TABLE public.racer_sex IS '選手の性別（fan 由来、1=男・2=女）。facts の field_gender の出所（docs/design/data-gaps）';
